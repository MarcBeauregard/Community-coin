//! Community Coin on Solana: a memecoin launchpad that turns the vamp/PvP game into a family game.
//!
//!  1. One meme, one ticker. A meme's mint address is derived from its normalized ticker (case, punctuation and
//!     leetspeak folded), so a duplicate cannot be created at all.
//!  2. Lineage. A variant launches inside the family of the meme it copies: its curve is priced in the parent
//!     token, so every buy of the copy is first a buy of the original, and money leaving a losing variant lands
//!     back in the parent instead of leaving the meme.
//!  3. Fair opening. The first `open_window` seconds of every launch are a batch auction: all committers get the
//!     same price. The batch, which gets the cheapest tokens, vests over `vest_window`.
//!  4. Spike share. Whatever part of a sale executes above the reference price (a one-hour moving price),
//!     `spike_share_bps` of the excess stays in the reserve and lifts the price of every remaining token.
//!  5. Union. A rival root can vote, with a majority of its supply, to join another family. Its SOL reserve buys
//!     into the target and its curve is re-priced in the target token; balances are untouched.
//!
//! Fees. Every continuous trade pays 1% in the quote asset: `protocol_fee_bps` of the trade to `fee_recipient`,
//! the rest to the meme's creator. Both are fixed when the hub is initialized; the protocol's part never exceeds
//! 0.5%. Openings and unions pay no fee.
//!
//! Accounting. Every lamport the hub owes sits in one vault. Tokens the hub holds (the reserves of variants, open
//! batches, fees in parent tokens, votes) are numbers in the meme accounts: they are minted only when they leave
//! the hub, so every real token is in somebody's wallet and the hub can always buy back the whole supply.
//! Ported from contracts/CommunityCoin.sol; web/src/protocol.js replays the same rules in the browser.

use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_2022_extensions::{token_metadata_initialize, TokenMetadataInitialize};
use anchor_spl::token_interface::{self, Burn, Mint, MintTo, TokenAccount, TokenInterface};

pub mod errors;
pub mod events;
pub mod math;
pub mod state;

use errors::CoinError;
use events::*;
use math::*;
use state::*;

declare_id!("CommCoin11111111111111111111111111111111111");

pub const MAX_DEPTH: usize = 6;
pub const DECIMALS: u8 = 6;
/// A union must bring at least this much SOL into the target family (0.03 SOL).
pub const MIN_UNION_RESERVE: u128 = 30_000_000;
pub const MAX_URI: usize = 200;

fn now() -> Result<i64> {
    Ok(Clock::get()?.unix_timestamp)
}

/// The meme accounts passed as remaining accounts, checked to be `meme`'s ancestors, root first.
fn lineage<'info>(remaining: &'info [AccountInfo<'info>], parent: Pubkey) -> Result<Vec<Box<Account<'info, Meme>>>> {
    let mut out: Vec<Box<Account<'info, Meme>>> = Vec::with_capacity(remaining.len());
    for info in remaining.iter() {
        let m = Box::new(Account::<Meme>::try_from(info)?);
        let expected_parent = out.last().map(|p| p.mint).unwrap_or_default();
        require_keys_eq!(m.parent, expected_parent, CoinError::BadLineage);
        out.push(m);
    }
    require_keys_eq!(out.last().map(|p| p.mint).unwrap_or_default(), parent, CoinError::BadLineage);
    require!(out.len() <= MAX_DEPTH, CoinError::TooDeep);
    Ok(out)
}

fn save(accounts: &[Box<Account<Meme>>]) -> Result<()> {
    for a in accounts {
        a.exit(&crate::ID)?;
    }
    Ok(())
}

fn emit_trade(mint: Pubkey, trader: Pubkey, is_buy: bool, h: &Hop) {
    emit!(Trade {
        mint,
        trader,
        is_buy,
        quote_amount: h.quote_amount as u64,
        token_amount: h.token_amount as u64,
        fee: h.fee as u64,
        protocol_fee: h.protocol_fee as u64,
        spike_share: h.spike as u64,
    });
}

fn emit_settled_if(m: &Meme, h: &Hop) {
    if h.settled_now {
        emit!(Settled { mint: m.mint, quote: m.batch_quote as u64, tokens: m.batch_tokens as u64 });
    }
}

/// Buys through `path` (root first) with lamports or the first curve's quote asset; intermediate tokens never
/// leave the hub: they become the reserve of the next curve down.
fn buy_path(path: &mut [Box<Account<Meme>>], quote_in: u128, take_fees: bool, protocol_bps: u128, trader: Pubkey, now: i64) -> Result<u128> {
    let mut x = quote_in;
    for m in path.iter_mut() {
        let h = buy_hop(m, x, take_fees, protocol_bps, now)?;
        emit_settled_if(m, &h);
        if take_fees {
            emit_trade(m.mint, trader, true, &h);
        }
        x = h.out;
    }
    Ok(x)
}

fn pay_lamports(vault: &AccountInfo, to: &AccountInfo, amount: u64) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    **vault.try_borrow_mut_lamports()? = vault.lamports().checked_sub(amount).ok_or(CoinError::ReserveInvariant)?;
    **to.try_borrow_mut_lamports()? = to.lamports().checked_add(amount).ok_or(CoinError::MathOverflow)?;
    Ok(())
}

fn to_u64(x: u128) -> Result<u64> {
    u64::try_from(x).map_err(|_| error!(CoinError::MathOverflow))
}

fn raise_heights(chain_up: &mut [&mut Box<Account<Meme>>], mut h: u8) {
    for m in chain_up.iter_mut() {
        if m.height >= h {
            break;
        }
        m.height = h;
        h += 1;
    }
}

#[program]
pub mod community_coin {
    use super::*;

    /// Sets the hub's parameters, once. Nothing can change them afterwards.
    pub fn initialize(
        ctx: Context<Initialize>,
        open_window: i64,
        vest_window: i64,
        spike_share_bps: u16,
        union_window: i64,
        protocol_fee_bps: u16,
        fee_recipient: Pubkey,
    ) -> Result<()> {
        require!(spike_share_bps as u128 + FEE_BPS <= BPS, CoinError::InvalidConfig);
        require!(protocol_fee_bps <= MAX_PROTOCOL_FEE_BPS, CoinError::InvalidConfig);
        require!(protocol_fee_bps == 0 || fee_recipient != Pubkey::default(), CoinError::InvalidConfig);
        require!(open_window >= 0 && vest_window >= 0 && union_window >= 0, CoinError::InvalidConfig);
        let c = &mut ctx.accounts.config;
        c.open_window = open_window;
        c.vest_window = vest_window;
        c.spike_share_bps = spike_share_bps;
        c.union_window = union_window;
        c.protocol_fee_bps = protocol_fee_bps;
        c.fee_recipient = fee_recipient;
        c.bump = ctx.bumps.config;
        c.authority_bump = ctx.bumps.authority;
        c.vault_bump = ctx.bumps.vault;
        Ok(())
    }

    /// Launches a meme. Pass the parent's lineage (root first, ending with the parent) as remaining accounts to
    /// launch a variant; none for a root priced in SOL. `sol_in` is committed to the opening on the creator's behalf.
    pub fn launch<'info>(
        ctx: Context<'_, '_, 'info, 'info, Launch<'info>>,
        key: Vec<u8>,
        name: String,
        symbol: String,
        uri: String,
        sol_in: u64,
    ) -> Result<()> {
        require!(symbol_key(&symbol)? == key, CoinError::InvalidSymbol);
        require!(!name.is_empty() && name.len() <= 40 && uri.len() <= MAX_URI, CoinError::InvalidName);
        let t = now()?;
        let parent_mint = match ctx.remaining_accounts.last() {
            Some(info) => Account::<Meme>::try_from(info)?.mint,
            None => Pubkey::default(),
        };
        // root..parent, at most MAX_DEPTH of them: the new meme is at most MAX_DEPTH levels below SOL.
        let mut ancestors = lineage(ctx.remaining_accounts, parent_mint)?;
        if !ancestors.is_empty() {
            let mut up: Vec<&mut Box<Account<Meme>>> = ancestors.iter_mut().rev().collect();
            raise_heights(&mut up, 1);
        }

        let config = &mut ctx.accounts.config;
        let m = &mut ctx.accounts.meme;
        let virtual_quote = if ancestors.is_empty() { ROOT_VIRTUAL_QUOTE } else { CHILD_VIRTUAL_QUOTE };
        m.mint = ctx.accounts.mint.key();
        m.parent = parent_mint;
        m.creator = ctx.accounts.creator.key();
        m.index = config.meme_count;
        m.open_until = t + config.open_window;
        m.v_quote = virtual_quote;
        m.floor = virtual_quote;
        m.v_token = VIRTUAL_TOKENS;
        m.name = name.clone();
        m.symbol = symbol.clone();
        m.bump = ctx.bumps.meme;
        reset_ref(m, t)?;
        config.meme_count += 1;

        // Token metadata lives in the mint itself (Token-2022): fund the extra space, then write it.
        let meta_len = 4 + 80 + name.len() + symbol.len() + uri.len();
        let mint_info = ctx.accounts.mint.to_account_info();
        let needed = Rent::get()?.minimum_balance(mint_info.data_len() + meta_len).saturating_sub(mint_info.lamports());
        if needed > 0 {
            system_program::transfer(
                CpiContext::new(ctx.accounts.system_program.to_account_info(), system_program::Transfer { from: ctx.accounts.creator.to_account_info(), to: mint_info.clone() }),
                needed,
            )?;
        }
        let seeds: &[&[u8]] = &[b"authority", &[config.authority_bump]];
        token_metadata_initialize(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TokenMetadataInitialize {
                    program_id: ctx.accounts.token_program.to_account_info(),
                    metadata: mint_info.clone(),
                    update_authority: ctx.accounts.authority.to_account_info(),
                    mint_authority: ctx.accounts.authority.to_account_info(),
                    mint: mint_info.clone(),
                },
                &[seeds],
            ),
            name.clone(),
            symbol.clone(),
            uri,
        )?;
        emit!(Launched { mint: m.mint, parent: parent_mint, creator: m.creator, name, symbol });

        if sol_in > 0 {
            system_program::transfer(
                CpiContext::new(ctx.accounts.system_program.to_account_info(), system_program::Transfer { from: ctx.accounts.creator.to_account_info(), to: ctx.accounts.vault.to_account_info() }),
                sol_in,
            )?;
            let quote = buy_path(&mut ancestors, sol_in as u128, true, config.protocol_fee_bps as u128, m.creator, t)?;
            require!(quote > 0, CoinError::ZeroAmount);
            m.batch_quote += quote;
            ctx.accounts.commitment.committed = ctx.accounts.commitment.committed.checked_add(to_u64(quote)?).ok_or(CoinError::MathOverflow)?;
            emit!(Committed { mint: m.mint, user: m.creator, quote: to_u64(quote)? });
        }
        save(&ancestors)
    }

    /// Commits SOL to the opening; for a variant the SOL is first routed through its ancestors (remaining accounts).
    pub fn commit_sol<'info>(ctx: Context<'_, '_, 'info, 'info, CommitSol<'info>>, sol_in: u64, min_quote: u64) -> Result<()> {
        let t = now()?;
        let m = &mut ctx.accounts.meme;
        require!(!m.settled && t < m.open_until, CoinError::OpeningClosed);
        require!(sol_in > 0, CoinError::ZeroAmount);
        let mut ancestors = lineage(ctx.remaining_accounts, m.parent)?;
        system_program::transfer(
            CpiContext::new(ctx.accounts.system_program.to_account_info(), system_program::Transfer { from: ctx.accounts.user.to_account_info(), to: ctx.accounts.vault.to_account_info() }),
            sol_in,
        )?;
        let quote = buy_path(&mut ancestors, sol_in as u128, true, ctx.accounts.config.protocol_fee_bps as u128, ctx.accounts.user.key(), t)?;
        require!(quote >= min_quote as u128 && quote > 0, CoinError::Slippage);
        m.batch_quote += quote;
        let c = &mut ctx.accounts.commitment;
        c.committed = c.committed.checked_add(to_u64(quote)?).ok_or(CoinError::MathOverflow)?;
        emit!(Committed { mint: m.mint, user: ctx.accounts.user.key(), quote: to_u64(quote)? });
        save(&ancestors)
    }

    /// Commits the quote asset itself: SOL for a root, parent tokens (burned from the wallet) for a variant.
    pub fn commit(ctx: Context<CommitQuote>, amount: u64) -> Result<()> {
        let t = now()?;
        require!(amount > 0, CoinError::ZeroAmount);
        let a = &mut *ctx.accounts;
        require!(!a.meme.settled && t < a.meme.open_until, CoinError::OpeningClosed);
        pull_quote(&a.meme, &a.user, &a.vault, &a.parent_mint, &a.user_parent_tokens, &a.token_program, &a.system_program, amount)?;
        a.meme.batch_quote += amount as u128;
        a.commitment.committed = a.commitment.committed.checked_add(amount).ok_or(CoinError::MathOverflow)?;
        emit!(Committed { mint: a.meme.mint, user: a.user.key(), quote: amount });
        Ok(())
    }

    /// Closes the opening: the whole batch buys on the curve at once. Anyone can call it; any trade does it lazily.
    pub fn settle(ctx: Context<Settle>) -> Result<()> {
        let m = &mut ctx.accounts.meme;
        settle_meme(m, now()?)?;
        emit!(Settled { mint: m.mint, quote: m.batch_quote as u64, tokens: m.batch_tokens as u64 });
        Ok(())
    }

    /// Withdraws the vested part of your share of the opening batch.
    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let t = now()?;
        let a = &mut *ctx.accounts;
        if tradable(&mut a.meme, t)? {
            emit!(Settled { mint: a.meme.mint, quote: a.meme.batch_quote as u64, tokens: a.meme.batch_tokens as u64 });
        }
        let amount = vested(&a.meme, a.commitment.committed as u128, a.config.vest_window, t)? - a.commitment.claimed as u128;
        require!(amount > 0, CoinError::NothingToClaim);
        let amount = to_u64(amount)?;
        a.commitment.claimed += amount;
        a.meme.batch_claimed += amount as u128;
        mint_tokens(&a.token_program, &a.mint, &a.user_tokens, &a.authority, a.config.authority_bump, amount)?;
        emit!(Claimed { mint: a.meme.mint, user: a.user.key(), amount });
        Ok(())
    }

    /// Buys with the quote asset: SOL for a root, parent tokens for a variant.
    pub fn buy(ctx: Context<TradeQuote>, amount: u64, min_out: u64) -> Result<()> {
        let t = now()?;
        require!(amount > 0, CoinError::ZeroAmount);
        let a = &mut *ctx.accounts;
        pull_quote(&a.meme, &a.user, &a.vault, &a.parent_mint, &a.user_parent_tokens, &a.token_program, &a.system_program, amount)?;
        let h = buy_hop(&mut a.meme, amount as u128, true, a.config.protocol_fee_bps as u128, t)?;
        require!(h.out >= min_out as u128, CoinError::Slippage);
        emit_settled_if(&a.meme, &h);
        emit_trade(a.meme.mint, a.user.key(), true, &h);
        mint_tokens(&a.token_program, &a.mint, &a.user_tokens, &a.authority, a.config.authority_bump, to_u64(h.out)?)
    }

    /// Buys any meme with SOL. A variant is bought through every ancestor (remaining accounts), root first.
    pub fn buy_sol<'info>(ctx: Context<'_, '_, 'info, 'info, TradeSol<'info>>, sol_in: u64, min_out: u64) -> Result<()> {
        let t = now()?;
        require!(sol_in > 0, CoinError::ZeroAmount);
        let a = &mut *ctx.accounts;
        let mut ancestors = lineage(ctx.remaining_accounts, a.meme.parent)?;
        system_program::transfer(
            CpiContext::new(a.system_program.to_account_info(), system_program::Transfer { from: a.user.to_account_info(), to: a.vault.to_account_info() }),
            sol_in,
        )?;
        let protocol = a.config.protocol_fee_bps as u128;
        let quote = buy_path(&mut ancestors, sol_in as u128, true, protocol, a.user.key(), t)?;
        let h = buy_hop(&mut a.meme, quote, true, protocol, t)?;
        require!(h.out >= min_out as u128, CoinError::Slippage);
        emit_settled_if(&a.meme, &h);
        emit_trade(a.meme.mint, a.user.key(), true, &h);
        save(&ancestors)?;
        mint_tokens(&a.token_program, &a.mint, &a.user_tokens, &a.authority, a.config.authority_bump, to_u64(h.out)?)
    }

    /// Sells for the quote asset: SOL for a root, parent tokens (minted to the wallet) for a variant.
    pub fn sell(ctx: Context<TradeQuote>, amount: u64, min_out: u64) -> Result<()> {
        let t = now()?;
        require!(amount > 0, CoinError::ZeroAmount);
        let a = &mut *ctx.accounts;
        burn_tokens(&a.token_program, &a.mint, &a.user_tokens, &a.user, amount)?;
        let h = sell_hop(&mut a.meme, amount as u128, a.config.spike_share_bps as u128, a.config.protocol_fee_bps as u128, t)?;
        require!(h.out >= min_out as u128, CoinError::Slippage);
        emit_settled_if(&a.meme, &h);
        emit_trade(a.meme.mint, a.user.key(), false, &h);
        push_quote(&a.meme, &a.user, &a.vault, &a.parent_mint, &a.user_parent_tokens, &a.authority, &a.token_program, a.config.authority_bump, to_u64(h.out)?)
    }

    /// Sells any meme all the way back to SOL through every ancestor (remaining accounts, root first).
    pub fn sell_to_sol<'info>(ctx: Context<'_, '_, 'info, 'info, TradeSol<'info>>, amount: u64, min_out: u64) -> Result<()> {
        let t = now()?;
        require!(amount > 0, CoinError::ZeroAmount);
        let a = &mut *ctx.accounts;
        let mut ancestors = lineage(ctx.remaining_accounts, a.meme.parent)?;
        burn_tokens(&a.token_program, &a.mint, &a.user_tokens, &a.user, amount)?;
        let spike = a.config.spike_share_bps as u128;
        let protocol = a.config.protocol_fee_bps as u128;
        let h = sell_hop(&mut a.meme, amount as u128, spike, protocol, t)?;
        emit_settled_if(&a.meme, &h);
        emit_trade(a.meme.mint, a.user.key(), false, &h);
        let mut x = h.out;
        for m in ancestors.iter_mut().rev() {
            let h = sell_hop(m, x, spike, protocol, t)?;
            emit_settled_if(m, &h);
            emit_trade(m.mint, a.user.key(), false, &h);
            x = h.out;
        }
        require!(x >= min_out as u128, CoinError::Slippage);
        save(&ancestors)?;
        pay_lamports(&a.vault.to_account_info(), &a.user.to_account_info(), to_u64(x)?)
    }

    /// Withdraws the fees a meme owes its creator (`protocol = false`) or the protocol (`protocol = true`), in the
    /// meme's quote asset: SOL from the vault, or parent tokens minted to the signer.
    pub fn claim_fees(ctx: Context<ClaimFees>, protocol: bool) -> Result<()> {
        let a = &mut *ctx.accounts;
        let owner = a.owner.key();
        let amount = if protocol {
            require_keys_eq!(owner, a.config.fee_recipient, CoinError::Unauthorized);
            std::mem::take(&mut a.meme.protocol_fees)
        } else {
            require_keys_eq!(owner, a.meme.creator, CoinError::Unauthorized);
            std::mem::take(&mut a.meme.creator_fees)
        };
        require!(amount > 0, CoinError::NothingToClaim);
        emit!(FeesClaimed { owner, meme: a.meme.mint, asset: a.meme.parent, amount });
        push_quote(&a.meme, &a.owner, &a.vault, &a.parent_mint, &a.owner_parent_tokens, &a.authority, &a.token_program, a.config.authority_bump, amount)
    }

    /// Proposes that root `meme` joins the family of `target`. Remaining accounts: the target's ancestors.
    pub fn propose_union<'info>(ctx: Context<'_, '_, 'info, 'info, ProposeUnion<'info>>) -> Result<()> {
        let t = now()?;
        let a = &mut *ctx.accounts;
        require!(a.meme.parent == Pubkey::default(), CoinError::NotRoot);
        let ancestors = lineage(ctx.remaining_accounts, a.target.parent)?;
        let target_root = ancestors.first().map(|m| m.mint).unwrap_or(a.target.mint);
        require!(target_root != a.meme.mint, CoinError::CycleDetected);
        if tradable(&mut a.meme, t)? {
            emit!(Settled { mint: a.meme.mint, quote: a.meme.batch_quote as u64, tokens: a.meme.batch_tokens as u64 });
        }
        let u = &mut a.union;
        u.id = a.config.union_count;
        u.meme = a.meme.mint;
        u.target = a.target.mint;
        u.deadline = t + a.config.union_window;
        a.config.union_count += 1;
        emit!(UnionProposed { id: u.id, meme: u.meme, target: u.target, deadline: u.deadline });
        Ok(())
    }

    /// Locks meme tokens in favour of a union (they are burned while locked and come back on unlock).
    pub fn lock_union(ctx: Context<LockUnion>, amount: u64) -> Result<()> {
        let t = now()?;
        let a = &mut *ctx.accounts;
        require!(!a.union.executed && t <= a.union.deadline, CoinError::VotingClosed);
        require!(amount > 0, CoinError::ZeroAmount);
        burn_tokens(&a.token_program, &a.mint, &a.user_tokens, &a.user, amount)?;
        a.lock.amount += amount;
        a.union.locked += amount;
        a.meme.escrowed += amount;
        emit!(UnionLocked { id: a.union.id, voter: a.user.key(), amount });
        Ok(())
    }

    /// Takes locked tokens back, at any time, before or after the vote.
    pub fn unlock_union(ctx: Context<UnlockUnion>) -> Result<()> {
        let a = &mut *ctx.accounts;
        let amount = std::mem::take(&mut a.lock.amount);
        require!(amount > 0, CoinError::NothingToClaim);
        if !a.union.executed {
            a.union.locked -= amount;
        }
        a.meme.escrowed -= amount;
        mint_tokens(&a.token_program, &a.mint, &a.user_tokens, &a.authority, a.config.authority_bump, amount)?;
        emit!(UnionUnlocked { id: a.union.id, voter: a.user.key(), amount });
        Ok(())
    }

    /// After the vote, if more than half of the circulating supply is locked in favour, the meme joins the target
    /// family: its SOL fees are paid out, its whole SOL reserve buys the target (fee-free) and its curve is
    /// re-priced in the target token at the rate obtained. Balances do not change. Remaining: target's ancestors.
    pub fn execute_union<'info>(ctx: Context<'_, '_, 'info, 'info, ExecuteUnion<'info>>, min_target_in: u64) -> Result<()> {
        let t = now()?;
        let a = &mut *ctx.accounts;
        require!(!a.union.executed, CoinError::VotingClosed);
        require!(t > a.union.deadline, CoinError::VotingOpen);
        require!(a.meme.parent == Pubkey::default(), CoinError::NotRoot);
        let circulating = a.mint.supply as u128 + a.meme.escrowed as u128;
        require!((a.union.locked as u128) * 2 > circulating, CoinError::QuorumNotReached);
        let mut ancestors = lineage(ctx.remaining_accounts, a.target.parent)?;
        let target_root = ancestors.first().map(|m| m.mint).unwrap_or(a.target.mint);
        require!(target_root != a.meme.mint, CoinError::CycleDetected);
        // depth(target) + 1 + the meme's own subtree must stay within MAX_DEPTH.
        require!(ancestors.len() + 1 + a.meme.height as usize <= MAX_DEPTH, CoinError::TooDeep);
        let sol_in = a.meme.v_quote - a.meme.floor;
        require!(sol_in >= MIN_UNION_RESERVE, CoinError::ReserveTooSmall);
        a.union.executed = true;

        // SOL fees earned before the union stay SOL: pay them out now, the meme's quote asset is about to change.
        let vault = a.vault.to_account_info();
        let creator_fees = std::mem::take(&mut a.meme.creator_fees);
        let protocol_fees = std::mem::take(&mut a.meme.protocol_fees);
        pay_lamports(&vault, &a.creator.to_account_info(), creator_fees)?;
        pay_lamports(&vault, &a.fee_recipient.to_account_info(), protocol_fees)?;
        if creator_fees > 0 {
            emit!(FeesClaimed { owner: a.meme.creator, meme: a.meme.mint, asset: Pubkey::default(), amount: creator_fees });
        }
        if protocol_fees > 0 {
            emit!(FeesClaimed { owner: a.config.fee_recipient, meme: a.meme.mint, asset: Pubkey::default(), amount: protocol_fees });
        }

        // The reserve's SOL stays in the vault: it becomes the target root's reserve as the path is bought.
        let mut x = buy_path(&mut ancestors, sol_in, false, 0, a.executor.key(), t)?;
        let h = buy_hop(&mut a.target, x, false, 0, t)?;
        emit_settled_if(&a.target, &h);
        x = h.out;
        require!(x >= min_target_in as u128, CoinError::Slippage);
        rescale(&mut a.meme, x)?;
        require!(a.meme.floor != 0, CoinError::ReserveTooSmall);
        a.meme.parent = a.target.mint;
        let h0 = a.meme.height + 1;
        {
            let target = &mut a.target;
            let mut up: Vec<&mut Box<Account<Meme>>> = vec![target];
            up.extend(ancestors.iter_mut().rev());
            raise_heights(&mut up, h0);
        }
        emit!(UnionExecuted { id: a.union.id, meme: a.meme.mint, target: a.target.mint, sol_in: to_u64(sol_in)?, target_in: to_u64(x)? });
        save(&ancestors)
    }
}

fn settle_meme(m: &mut Meme, t: i64) -> Result<()> {
    math::settle(m, t)
}

/// Takes the quote asset from the user: SOL into the vault, or parent tokens burned from the wallet.
#[allow(clippy::too_many_arguments)]
fn pull_quote<'info>(
    meme: &Account<'info, Meme>,
    user: &Signer<'info>,
    vault: &Account<'info, Vault>,
    parent_mint: &Option<Box<InterfaceAccount<'info, Mint>>>,
    user_parent_tokens: &Option<Box<InterfaceAccount<'info, TokenAccount>>>,
    token_program: &Interface<'info, TokenInterface>,
    system: &Program<'info, System>,
    amount: u64,
) -> Result<()> {
    if meme.parent == Pubkey::default() {
        return system_program::transfer(
            CpiContext::new(system.to_account_info(), system_program::Transfer { from: user.to_account_info(), to: vault.to_account_info() }),
            amount,
        );
    }
    let (pm, pt) = match (parent_mint, user_parent_tokens) {
        (Some(pm), Some(pt)) => (pm, pt),
        _ => return err!(CoinError::WrongAsset),
    };
    require_keys_eq!(pm.key(), meme.parent, CoinError::WrongAsset);
    burn_tokens(token_program, pm, pt, user, amount)
}

/// Pays the quote asset out: SOL from the vault, or parent tokens minted to the recipient.
#[allow(clippy::too_many_arguments)]
fn push_quote<'info>(
    meme: &Account<'info, Meme>,
    to: &Signer<'info>,
    vault: &Account<'info, Vault>,
    parent_mint: &Option<Box<InterfaceAccount<'info, Mint>>>,
    to_parent_tokens: &Option<Box<InterfaceAccount<'info, TokenAccount>>>,
    authority: &UncheckedAccount<'info>,
    token_program: &Interface<'info, TokenInterface>,
    authority_bump: u8,
    amount: u64,
) -> Result<()> {
    if meme.parent == Pubkey::default() {
        return pay_lamports(&vault.to_account_info(), &to.to_account_info(), amount);
    }
    let (pm, pt) = match (parent_mint, to_parent_tokens) {
        (Some(pm), Some(pt)) => (pm, pt),
        _ => return err!(CoinError::WrongAsset),
    };
    require_keys_eq!(pm.key(), meme.parent, CoinError::WrongAsset);
    require_keys_eq!(pt.owner, to.key(), CoinError::WrongAsset);
    mint_tokens(token_program, pm, pt, authority, authority_bump, amount)
}

fn mint_tokens<'info>(
    token_program: &Interface<'info, TokenInterface>,
    mint: &InterfaceAccount<'info, Mint>,
    to: &InterfaceAccount<'info, TokenAccount>,
    authority: &UncheckedAccount<'info>,
    bump: u8,
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    require_keys_eq!(to.mint, mint.key(), CoinError::WrongAsset);
    let seeds: &[&[u8]] = &[b"authority", &[bump]];
    token_interface::mint_to(
        CpiContext::new_with_signer(token_program.to_account_info(), MintTo { mint: mint.to_account_info(), to: to.to_account_info(), authority: authority.to_account_info() }, &[seeds]),
        amount,
    )
}

fn burn_tokens<'info>(
    token_program: &Interface<'info, TokenInterface>,
    mint: &InterfaceAccount<'info, Mint>,
    from: &InterfaceAccount<'info, TokenAccount>,
    owner: &Signer<'info>,
    amount: u64,
) -> Result<()> {
    require_keys_eq!(from.mint, mint.key(), CoinError::WrongAsset);
    token_interface::burn(CpiContext::new(token_program.to_account_info(), Burn { mint: mint.to_account_info(), from: from.to_account_info(), authority: owner.to_account_info() }), amount)
}

// ---------------------------------------------------------------------------------------------- accounts

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(init, payer = payer, space = 8 + Config::INIT_SPACE, seeds = [b"config"], bump)]
    pub config: Box<Account<'info, Config>>,
    /// CHECK: the PDA that signs every mint; never holds data.
    #[account(seeds = [b"authority"], bump)]
    pub authority: UncheckedAccount<'info>,
    #[account(init, payer = payer, space = 8 + Vault::INIT_SPACE, seeds = [b"vault"], bump)]
    pub vault: Box<Account<'info, Vault>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(key: Vec<u8>, name: String, symbol: String)]
pub struct Launch<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    /// CHECK: mint authority PDA.
    #[account(seeds = [b"authority"], bump = config.authority_bump)]
    pub authority: UncheckedAccount<'info>,
    #[account(mut, seeds = [b"vault"], bump = config.vault_bump)]
    pub vault: Box<Account<'info, Vault>>,
    /// The mint's address is derived from the normalized ticker: a second meme with the same ticker cannot exist.
    #[account(
        init,
        payer = creator,
        seeds = [b"mint", key.as_slice()],
        bump,
        mint::decimals = DECIMALS,
        mint::authority = authority,
        mint::token_program = token_program,
        extensions::metadata_pointer::authority = authority,
        extensions::metadata_pointer::metadata_address = mint,
    )]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(init, payer = creator, space = 8 + Meme::INIT_SPACE, seeds = [b"meme", mint.key().as_ref()], bump)]
    pub meme: Box<Account<'info, Meme>>,
    #[account(init, payer = creator, space = 8 + Commitment::INIT_SPACE, seeds = [b"commit", mint.key().as_ref(), creator.key().as_ref()], bump)]
    pub commitment: Box<Account<'info, Commitment>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CommitSol<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [b"vault"], bump = config.vault_bump)]
    pub vault: Box<Account<'info, Vault>>,
    #[account(mut, seeds = [b"meme", meme.mint.as_ref()], bump = meme.bump)]
    pub meme: Box<Account<'info, Meme>>,
    #[account(init_if_needed, payer = user, space = 8 + Commitment::INIT_SPACE, seeds = [b"commit", meme.mint.as_ref(), user.key().as_ref()], bump)]
    pub commitment: Box<Account<'info, Commitment>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CommitQuote<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [b"vault"], bump = config.vault_bump)]
    pub vault: Box<Account<'info, Vault>>,
    #[account(mut, seeds = [b"meme", meme.mint.as_ref()], bump = meme.bump)]
    pub meme: Box<Account<'info, Meme>>,
    #[account(init_if_needed, payer = user, space = 8 + Commitment::INIT_SPACE, seeds = [b"commit", meme.mint.as_ref(), user.key().as_ref()], bump)]
    pub commitment: Box<Account<'info, Commitment>>,
    #[account(mut)]
    pub parent_mint: Option<Box<InterfaceAccount<'info, Mint>>>,
    #[account(mut)]
    pub user_parent_tokens: Option<Box<InterfaceAccount<'info, TokenAccount>>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(mut, seeds = [b"meme", meme.mint.as_ref()], bump = meme.bump)]
    pub meme: Box<Account<'info, Meme>>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    /// CHECK: mint authority PDA.
    #[account(seeds = [b"authority"], bump = config.authority_bump)]
    pub authority: UncheckedAccount<'info>,
    #[account(mut, seeds = [b"meme", meme.mint.as_ref()], bump = meme.bump)]
    pub meme: Box<Account<'info, Meme>>,
    #[account(mut, address = meme.mint)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, seeds = [b"commit", meme.mint.as_ref(), user.key().as_ref()], bump)]
    pub commitment: Box<Account<'info, Commitment>>,
    #[account(init_if_needed, payer = user, associated_token::mint = mint, associated_token::authority = user, associated_token::token_program = token_program)]
    pub user_tokens: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// A one-hop trade against the quote asset (SOL for a root, parent tokens for a variant).
#[derive(Accounts)]
pub struct TradeQuote<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    /// CHECK: mint authority PDA.
    #[account(seeds = [b"authority"], bump = config.authority_bump)]
    pub authority: UncheckedAccount<'info>,
    #[account(mut, seeds = [b"vault"], bump = config.vault_bump)]
    pub vault: Box<Account<'info, Vault>>,
    #[account(mut, seeds = [b"meme", meme.mint.as_ref()], bump = meme.bump)]
    pub meme: Box<Account<'info, Meme>>,
    #[account(mut, address = meme.mint)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(init_if_needed, payer = user, associated_token::mint = mint, associated_token::authority = user, associated_token::token_program = token_program)]
    pub user_tokens: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub parent_mint: Option<Box<InterfaceAccount<'info, Mint>>>,
    #[account(mut)]
    pub user_parent_tokens: Option<Box<InterfaceAccount<'info, TokenAccount>>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// A trade routed through the whole lineage to or from SOL; the ancestors come as remaining accounts.
#[derive(Accounts)]
pub struct TradeSol<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    /// CHECK: mint authority PDA.
    #[account(seeds = [b"authority"], bump = config.authority_bump)]
    pub authority: UncheckedAccount<'info>,
    #[account(mut, seeds = [b"vault"], bump = config.vault_bump)]
    pub vault: Box<Account<'info, Vault>>,
    #[account(mut, seeds = [b"meme", meme.mint.as_ref()], bump = meme.bump)]
    pub meme: Box<Account<'info, Meme>>,
    #[account(mut, address = meme.mint)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(init_if_needed, payer = user, associated_token::mint = mint, associated_token::authority = user, associated_token::token_program = token_program)]
    pub user_tokens: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimFees<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    /// CHECK: mint authority PDA.
    #[account(seeds = [b"authority"], bump = config.authority_bump)]
    pub authority: UncheckedAccount<'info>,
    #[account(mut, seeds = [b"vault"], bump = config.vault_bump)]
    pub vault: Box<Account<'info, Vault>>,
    #[account(mut, seeds = [b"meme", meme.mint.as_ref()], bump = meme.bump)]
    pub meme: Box<Account<'info, Meme>>,
    #[account(mut)]
    pub parent_mint: Option<Box<InterfaceAccount<'info, Mint>>>,
    #[account(mut)]
    pub owner_parent_tokens: Option<Box<InterfaceAccount<'info, TokenAccount>>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ProposeUnion<'info> {
    #[account(mut)]
    pub proposer: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [b"meme", meme.mint.as_ref()], bump = meme.bump)]
    pub meme: Box<Account<'info, Meme>>,
    #[account(seeds = [b"meme", target.mint.as_ref()], bump = target.bump)]
    pub target: Box<Account<'info, Meme>>,
    #[account(init, payer = proposer, space = 8 + Union::INIT_SPACE, seeds = [b"union", config.union_count.to_le_bytes().as_ref()], bump)]
    pub union: Box<Account<'info, Union>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct LockUnion<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut, seeds = [b"union", union.id.to_le_bytes().as_ref()], bump)]
    pub union: Box<Account<'info, Union>>,
    #[account(mut, seeds = [b"meme", union.meme.as_ref()], bump = meme.bump)]
    pub meme: Box<Account<'info, Meme>>,
    #[account(mut, address = meme.mint)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, token::mint = mint, token::authority = user, token::token_program = token_program)]
    pub user_tokens: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(init_if_needed, payer = user, space = 8 + Lock::INIT_SPACE, seeds = [b"lock", union.id.to_le_bytes().as_ref(), user.key().as_ref()], bump)]
    pub lock: Box<Account<'info, Lock>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UnlockUnion<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    /// CHECK: mint authority PDA.
    #[account(seeds = [b"authority"], bump = config.authority_bump)]
    pub authority: UncheckedAccount<'info>,
    #[account(mut, seeds = [b"union", union.id.to_le_bytes().as_ref()], bump)]
    pub union: Box<Account<'info, Union>>,
    #[account(mut, seeds = [b"meme", union.meme.as_ref()], bump = meme.bump)]
    pub meme: Box<Account<'info, Meme>>,
    #[account(mut, address = meme.mint)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(init_if_needed, payer = user, associated_token::mint = mint, associated_token::authority = user, associated_token::token_program = token_program)]
    pub user_tokens: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, seeds = [b"lock", union.id.to_le_bytes().as_ref(), user.key().as_ref()], bump)]
    pub lock: Box<Account<'info, Lock>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExecuteUnion<'info> {
    #[account(mut)]
    pub executor: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [b"vault"], bump = config.vault_bump)]
    pub vault: Box<Account<'info, Vault>>,
    #[account(mut, seeds = [b"union", union.id.to_le_bytes().as_ref()], bump)]
    pub union: Box<Account<'info, Union>>,
    #[account(mut, seeds = [b"meme", union.meme.as_ref()], bump = meme.bump)]
    pub meme: Box<Account<'info, Meme>>,
    #[account(address = meme.mint)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, seeds = [b"meme", union.target.as_ref()], bump = target.bump)]
    pub target: Box<Account<'info, Meme>>,
    /// CHECK: receives the meme's SOL creator fees; must be its creator.
    #[account(mut, address = meme.creator)]
    pub creator: UncheckedAccount<'info>,
    /// CHECK: receives the meme's SOL protocol fees; must be the hub's fee recipient.
    #[account(mut, address = config.fee_recipient)]
    pub fee_recipient: UncheckedAccount<'info>,
}
