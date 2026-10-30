//! Test harness: the program runs natively inside the Solana runtime (solana-program-test), next to the real
//! Token-2022 and associated-token programs. `Hub` wraps the instructions so tests read like the Solidity suite.
#![allow(dead_code)]

use anchor_lang::prelude::Pubkey;
use anchor_lang::{AccountDeserialize, InstructionData, ToAccountMetas};
use anchor_spl::token_2022::spl_token_2022;
use anchor_spl::token_2022::spl_token_2022::extension::StateWithExtensions;
use community_coin::state::{Commitment, Config, Lock, Meme, Union};
use solana_program_test::{processor, BanksClientError, ProgramTest, ProgramTestContext};
use solana_sdk::{
    account::Account,
    clock::Clock,
    instruction::{AccountMeta, Instruction},
    native_token::LAMPORTS_PER_SOL,
    signature::Keypair,
    signer::Signer,
    system_program,
    transaction::Transaction,
};

pub const SOL: u64 = LAMPORTS_PER_SOL;
pub const TOKEN: u64 = 1_000_000;
pub const OPEN: i64 = 300;
pub const VOTE: i64 = 3 * 24 * 3600;
pub const SPIKE: u16 = 5000;
pub const PROTOCOL: u16 = 20;
pub const T0: i64 = 1_800_000_000;
/// What the runtime charges the signer of a transaction (one signature).
pub const TX_FEE: u64 = 5_000;

fn entry(program_id: &Pubkey, accounts: &[anchor_lang::prelude::AccountInfo], data: &[u8]) -> anchor_lang::solana_program::entrypoint::ProgramResult {
    let accounts = Box::leak(Box::new(accounts.to_vec()));
    community_coin::entry(program_id, accounts, data)
}

pub fn pda(seeds: &[&[u8]]) -> Pubkey {
    Pubkey::find_program_address(seeds, &community_coin::ID).0
}
pub fn config_pda() -> Pubkey {
    pda(&[b"config"])
}
pub fn authority_pda() -> Pubkey {
    pda(&[b"authority"])
}
pub fn vault_pda() -> Pubkey {
    pda(&[b"vault"])
}
pub fn mint_of(symbol: &str) -> Pubkey {
    pda(&[b"mint", &community_coin::math::symbol_key(symbol).unwrap()])
}
pub fn meme_pda(mint: &Pubkey) -> Pubkey {
    pda(&[b"meme", mint.as_ref()])
}
pub fn commit_pda(mint: &Pubkey, user: &Pubkey) -> Pubkey {
    pda(&[b"commit", mint.as_ref(), user.as_ref()])
}
pub fn union_pda(id: u64) -> Pubkey {
    pda(&[b"union", &id.to_le_bytes()])
}
pub fn lock_pda(id: u64, user: &Pubkey) -> Pubkey {
    pda(&[b"lock", &id.to_le_bytes(), user.as_ref()])
}
pub fn ata(owner: &Pubkey, mint: &Pubkey) -> Pubkey {
    spl_associated_token_account_client::address::get_associated_token_address_with_program_id(owner, mint, &spl_token_2022::ID)
}

pub struct Params {
    pub open: i64,
    pub vest: i64,
    pub spike: u16,
    pub vote: i64,
    pub protocol: u16,
}

impl Default for Params {
    fn default() -> Self {
        Params { open: OPEN, vest: 0, spike: SPIKE, vote: VOTE, protocol: PROTOCOL }
    }
}

pub struct Hub {
    pub ctx: ProgramTestContext,
    pub users: Vec<Keypair>,
    pub treasury: Keypair,
    pub now: i64,
}

pub fn program() -> ProgramTest {
    let mut pt = ProgramTest::new("community_coin", community_coin::ID, processor!(entry));
    pt.prefer_bpf(false);
    pt
}

impl Hub {
    pub async fn start(params: Params, users: usize) -> Hub {
        let mut hub = Hub::bare(users).await;
        let to = hub.treasury.pubkey();
        hub.initialize(&params, to).await.unwrap();
        hub
    }

    /// A chain with the program and funded users, the hub not initialized yet.
    pub async fn bare(users: usize) -> Hub {
        let mut pt = program();
        let users: Vec<Keypair> = (0..users).map(|_| Keypair::new()).collect();
        let treasury = Keypair::new();
        for u in users.iter().chain(std::iter::once(&treasury)) {
            pt.add_account(u.pubkey(), Account { lamports: 10_000 * SOL, owner: system_program::ID, ..Account::default() });
        }
        let ctx = pt.start_with_context().await;
        let mut hub = Hub { ctx, users, treasury, now: T0 };
        hub.set_time(T0).await;
        hub
    }

    pub async fn set_time(&mut self, t: i64) {
        let mut clock: Clock = self.ctx.banks_client.get_sysvar().await.unwrap();
        clock.unix_timestamp = t;
        self.ctx.set_sysvar(&clock);
        self.now = t;
    }

    pub async fn warp(&mut self, seconds: i64) {
        let t = self.now + seconds;
        self.set_time(t).await;
    }

    pub fn user(&self, i: usize) -> &Keypair {
        &self.users[i]
    }

    pub async fn send(&mut self, ixs: Vec<Instruction>, signer: &Keypair) -> Result<(), BanksClientError> {
        let hash = self.ctx.banks_client.get_latest_blockhash().await.unwrap();
        let payer = Keypair::from_bytes(&signer.to_bytes()).unwrap();
        let tx = Transaction::new_signed_with_payer(&ixs, Some(&payer.pubkey()), &[&payer], hash);
        let r = self.ctx.banks_client.process_transaction(tx).await;
        // Every transaction gets a fresh blockhash so identical retries are not deduplicated.
        let _ = self.ctx.get_new_latest_blockhash().await;
        r
    }

    pub async fn send_as(&mut self, i: usize, ixs: Vec<Instruction>) -> Result<(), BanksClientError> {
        let kp = Keypair::from_bytes(&self.users[i].to_bytes()).unwrap();
        self.send(ixs, &kp).await
    }

    pub async fn initialize(&mut self, p: &Params, recipient: Pubkey) -> Result<(), BanksClientError> {
        let ix = Instruction {
            program_id: community_coin::ID,
            accounts: community_coin::accounts::Initialize {
                payer: self.treasury.pubkey(),
                config: config_pda(),
                authority: authority_pda(),
                vault: vault_pda(),
                system_program: system_program::ID,
            }
            .to_account_metas(None),
            data: community_coin::instruction::Initialize {
                open_window: p.open,
                vest_window: p.vest,
                spike_share_bps: p.spike,
                union_window: p.vote,
                protocol_fee_bps: p.protocol,
                fee_recipient: recipient,
            }
            .data(),
        };
        let kp = Keypair::from_bytes(&self.treasury.to_bytes()).unwrap();
        self.send(vec![ix], &kp).await
    }

    // ------------------------------------------------------------------ reads

    pub async fn account(&mut self, key: Pubkey) -> Option<Account> {
        self.ctx.banks_client.get_account(key).await.unwrap()
    }

    pub async fn meme(&mut self, mint: &Pubkey) -> Meme {
        let a = self.account(meme_pda(mint)).await.expect("meme account");
        Meme::try_deserialize(&mut a.data.as_slice()).unwrap()
    }

    pub async fn config(&mut self) -> Config {
        let a = self.account(config_pda()).await.unwrap();
        Config::try_deserialize(&mut a.data.as_slice()).unwrap()
    }

    pub async fn commitment(&mut self, mint: &Pubkey, user: &Pubkey) -> Option<Commitment> {
        let a = self.account(commit_pda(mint, user)).await?;
        Some(Commitment::try_deserialize(&mut a.data.as_slice()).unwrap())
    }

    pub async fn union(&mut self, id: u64) -> Union {
        let a = self.account(union_pda(id)).await.unwrap();
        Union::try_deserialize(&mut a.data.as_slice()).unwrap()
    }

    pub async fn lock(&mut self, id: u64, user: &Pubkey) -> Option<Lock> {
        let a = self.account(lock_pda(id, user)).await?;
        Some(Lock::try_deserialize(&mut a.data.as_slice()).unwrap())
    }

    pub async fn balance(&mut self, owner: &Pubkey, mint: &Pubkey) -> u64 {
        match self.account(ata(owner, mint)).await {
            Some(a) => StateWithExtensions::<spl_token_2022::state::Account>::unpack(&a.data).unwrap().base.amount,
            None => 0,
        }
    }

    pub async fn supply(&mut self, mint: &Pubkey) -> u64 {
        let a = self.account(*mint).await.unwrap();
        StateWithExtensions::<spl_token_2022::state::Mint>::unpack(&a.data).unwrap().base.supply
    }

    pub async fn lamports(&mut self, key: &Pubkey) -> u64 {
        self.account(*key).await.map(|a| a.lamports).unwrap_or(0)
    }

    /// The meme's ancestors, root first, as the remaining accounts of a routed instruction.
    pub async fn ancestors(&mut self, mint: &Pubkey) -> Vec<Pubkey> {
        let mut out = vec![];
        let mut p = self.meme(mint).await.parent;
        while p != Pubkey::default() {
            out.insert(0, p);
            p = self.meme(&p).await.parent;
        }
        out
    }

    fn metas(mints: &[Pubkey]) -> Vec<AccountMeta> {
        mints.iter().map(|m| AccountMeta::new(meme_pda(m), false)).collect()
    }

    // ------------------------------------------------------------------ instructions

    pub async fn launch(&mut self, i: usize, symbol: &str, parent: Option<Pubkey>, sol_in: u64) -> Result<Pubkey, BanksClientError> {
        let creator = self.user(i).pubkey();
        let key = community_coin::math::symbol_key(symbol).map(|k| k).unwrap_or_else(|_| symbol.as_bytes().to_vec());
        let mint = pda(&[b"mint", &key]);
        let mut lineage = match parent {
            Some(p) => self.ancestors(&p).await,
            None => vec![],
        };
        if let Some(p) = parent {
            lineage.push(p);
        }
        let mut accounts = community_coin::accounts::Launch {
            creator,
            config: config_pda(),
            authority: authority_pda(),
            vault: vault_pda(),
            mint,
            meme: meme_pda(&mint),
            commitment: commit_pda(&mint, &creator),
            token_program: spl_token_2022::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None);
        accounts.extend(Self::metas(&lineage));
        let ix = Instruction {
            program_id: community_coin::ID,
            accounts,
            data: community_coin::instruction::Launch { key, name: format!("{symbol} coin"), symbol: symbol.to_string(), uri: String::new(), sol_in }.data(),
        };
        self.send_as(i, vec![ix]).await.map(|_| mint)
    }

    pub async fn commit_sol(&mut self, i: usize, mint: Pubkey, sol_in: u64) -> Result<(), BanksClientError> {
        let user = self.user(i).pubkey();
        let lineage = self.ancestors(&mint).await;
        let mut accounts = community_coin::accounts::CommitSol {
            user,
            config: config_pda(),
            vault: vault_pda(),
            meme: meme_pda(&mint),
            commitment: commit_pda(&mint, &user),
            system_program: system_program::ID,
        }
        .to_account_metas(None);
        accounts.extend(Self::metas(&lineage));
        let ix = Instruction { program_id: community_coin::ID, accounts, data: community_coin::instruction::CommitSol { sol_in, min_quote: 0 }.data() };
        self.send_as(i, vec![ix]).await
    }

    pub async fn commit_quote(&mut self, i: usize, mint: Pubkey, amount: u64) -> Result<(), BanksClientError> {
        let user = self.user(i).pubkey();
        let parent = self.meme(&mint).await.parent;
        let (pm, pt) = if parent == Pubkey::default() { (None, None) } else { (Some(parent), Some(ata(&user, &parent))) };
        let accounts = community_coin::accounts::CommitQuote {
            user,
            config: config_pda(),
            vault: vault_pda(),
            meme: meme_pda(&mint),
            commitment: commit_pda(&mint, &user),
            parent_mint: pm,
            user_parent_tokens: pt,
            token_program: spl_token_2022::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None);
        let ix = Instruction { program_id: community_coin::ID, accounts, data: community_coin::instruction::Commit { amount }.data() };
        self.send_as(i, vec![ix]).await
    }

    pub async fn settle(&mut self, i: usize, mint: Pubkey) -> Result<(), BanksClientError> {
        let ix = Instruction {
            program_id: community_coin::ID,
            accounts: community_coin::accounts::Settle { meme: meme_pda(&mint) }.to_account_metas(None),
            data: community_coin::instruction::Settle {}.data(),
        };
        self.send_as(i, vec![ix]).await
    }

    pub async fn claim(&mut self, i: usize, mint: Pubkey) -> Result<(), BanksClientError> {
        let user = self.user(i).pubkey();
        let ix = Instruction {
            program_id: community_coin::ID,
            accounts: community_coin::accounts::Claim {
                user,
                config: config_pda(),
                authority: authority_pda(),
                meme: meme_pda(&mint),
                mint,
                commitment: commit_pda(&mint, &user),
                user_tokens: ata(&user, &mint),
                token_program: spl_token_2022::ID,
                associated_token_program: spl_associated_token_account_client::program::ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
            data: community_coin::instruction::Claim {}.data(),
        };
        self.send_as(i, vec![ix]).await
    }

    fn ensure_ata(payer: &Pubkey, owner: &Pubkey, mint: &Pubkey) -> Instruction {
        spl_associated_token_account_client::instruction::create_associated_token_account_idempotent(payer, owner, mint, &spl_token_2022::ID)
    }

    fn trade_sol_accounts(user: Pubkey, mint: Pubkey) -> Vec<AccountMeta> {
        community_coin::accounts::TradeSol {
            user,
            config: config_pda(),
            authority: authority_pda(),
            vault: vault_pda(),
            meme: meme_pda(&mint),
            mint,
            user_tokens: ata(&user, &mint),
            token_program: spl_token_2022::ID,
            associated_token_program: spl_associated_token_account_client::program::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None)
    }

    pub async fn buy_sol(&mut self, i: usize, mint: Pubkey, sol_in: u64, min_out: u64) -> Result<(), BanksClientError> {
        let user = self.user(i).pubkey();
        let lineage = self.ancestors(&mint).await;
        let mut accounts = Self::trade_sol_accounts(user, mint);
        accounts.extend(Self::metas(&lineage));
        let ix = Instruction { program_id: community_coin::ID, accounts, data: community_coin::instruction::BuySol { sol_in, min_out }.data() };
        self.send_as(i, vec![ix]).await
    }

    pub async fn sell_to_sol(&mut self, i: usize, mint: Pubkey, amount: u64, min_out: u64) -> Result<(), BanksClientError> {
        let user = self.user(i).pubkey();
        let lineage = self.ancestors(&mint).await;
        let mut accounts = Self::trade_sol_accounts(user, mint);
        accounts.extend(Self::metas(&lineage));
        let ix = Instruction { program_id: community_coin::ID, accounts, data: community_coin::instruction::SellToSol { amount, min_out }.data() };
        self.send_as(i, vec![ix]).await
    }

    async fn trade_quote(&mut self, i: usize, mint: Pubkey, data: Vec<u8>) -> Result<(), BanksClientError> {
        let user = self.user(i).pubkey();
        let parent = self.meme(&mint).await.parent;
        let (pm, pt) = if parent == Pubkey::default() { (None, None) } else { (Some(parent), Some(ata(&user, &parent))) };
        let mut ixs = vec![];
        if let Some(p) = pm {
            ixs.push(Self::ensure_ata(&user, &user, &p));
        }
        let accounts = community_coin::accounts::TradeQuote {
            user,
            config: config_pda(),
            authority: authority_pda(),
            vault: vault_pda(),
            meme: meme_pda(&mint),
            mint,
            user_tokens: ata(&user, &mint),
            parent_mint: pm,
            user_parent_tokens: pt,
            token_program: spl_token_2022::ID,
            associated_token_program: spl_associated_token_account_client::program::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None);
        ixs.push(Instruction { program_id: community_coin::ID, accounts, data });
        self.send_as(i, ixs).await
    }

    pub async fn buy(&mut self, i: usize, mint: Pubkey, amount: u64, min_out: u64) -> Result<(), BanksClientError> {
        self.trade_quote(i, mint, community_coin::instruction::Buy { amount, min_out }.data()).await
    }

    pub async fn sell(&mut self, i: usize, mint: Pubkey, amount: u64, min_out: u64) -> Result<(), BanksClientError> {
        self.trade_quote(i, mint, community_coin::instruction::Sell { amount, min_out }.data()).await
    }

    /// `who`: Some(i) for a user, None for the treasury.
    pub async fn claim_fees(&mut self, who: Option<usize>, mint: Pubkey, protocol: bool) -> Result<(), BanksClientError> {
        let kp = match who {
            Some(i) => Keypair::from_bytes(&self.users[i].to_bytes()).unwrap(),
            None => Keypair::from_bytes(&self.treasury.to_bytes()).unwrap(),
        };
        let owner = kp.pubkey();
        let parent = self.meme(&mint).await.parent;
        let (pm, pt) = if parent == Pubkey::default() { (None, None) } else { (Some(parent), Some(ata(&owner, &parent))) };
        let mut ixs = vec![];
        if let Some(p) = pm {
            ixs.push(Self::ensure_ata(&owner, &owner, &p));
        }
        ixs.push(Instruction {
            program_id: community_coin::ID,
            accounts: community_coin::accounts::ClaimFees {
                owner,
                config: config_pda(),
                authority: authority_pda(),
                vault: vault_pda(),
                meme: meme_pda(&mint),
                parent_mint: pm,
                owner_parent_tokens: pt,
                token_program: spl_token_2022::ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
            data: community_coin::instruction::ClaimFees { protocol }.data(),
        });
        self.send(ixs, &kp).await
    }

    pub async fn propose_union(&mut self, i: usize, meme: Pubkey, target: Pubkey) -> Result<u64, BanksClientError> {
        let id = self.config().await.union_count;
        let lineage = self.ancestors(&target).await;
        let mut accounts = community_coin::accounts::ProposeUnion {
            proposer: self.user(i).pubkey(),
            config: config_pda(),
            meme: meme_pda(&meme),
            target: meme_pda(&target),
            union: union_pda(id),
            system_program: system_program::ID,
        }
        .to_account_metas(None);
        accounts.extend(lineage.iter().map(|m| AccountMeta::new_readonly(meme_pda(m), false)));
        let ix = Instruction { program_id: community_coin::ID, accounts, data: community_coin::instruction::ProposeUnion {}.data() };
        self.send_as(i, vec![ix]).await.map(|_| id)
    }

    pub async fn lock_union(&mut self, i: usize, id: u64, amount: u64) -> Result<(), BanksClientError> {
        let user = self.user(i).pubkey();
        let meme = self.union(id).await.meme;
        let ix = Instruction {
            program_id: community_coin::ID,
            accounts: community_coin::accounts::LockUnion {
                user,
                union: union_pda(id),
                meme: meme_pda(&meme),
                mint: meme,
                user_tokens: ata(&user, &meme),
                lock: lock_pda(id, &user),
                token_program: spl_token_2022::ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
            data: community_coin::instruction::LockUnion { amount }.data(),
        };
        self.send_as(i, vec![ix]).await
    }

    pub async fn unlock_union(&mut self, i: usize, id: u64) -> Result<(), BanksClientError> {
        let user = self.user(i).pubkey();
        let meme = self.union(id).await.meme;
        let ix = Instruction {
            program_id: community_coin::ID,
            accounts: community_coin::accounts::UnlockUnion {
                user,
                config: config_pda(),
                authority: authority_pda(),
                union: union_pda(id),
                meme: meme_pda(&meme),
                mint: meme,
                user_tokens: ata(&user, &meme),
                lock: lock_pda(id, &user),
                token_program: spl_token_2022::ID,
                associated_token_program: spl_associated_token_account_client::program::ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
            data: community_coin::instruction::UnlockUnion {}.data(),
        };
        self.send_as(i, vec![ix]).await
    }

    pub async fn execute_union(&mut self, i: usize, id: u64) -> Result<(), BanksClientError> {
        let u = self.union(id).await;
        let creator = self.meme(&u.meme).await.creator;
        let lineage = self.ancestors(&u.target).await;
        let mut accounts = community_coin::accounts::ExecuteUnion {
            executor: self.user(i).pubkey(),
            config: config_pda(),
            vault: vault_pda(),
            union: union_pda(id),
            meme: meme_pda(&u.meme),
            mint: u.meme,
            target: meme_pda(&u.target),
            creator,
            fee_recipient: self.treasury.pubkey(),
        }
        .to_account_metas(None);
        accounts.extend(Self::metas(&lineage));
        let ix = Instruction { program_id: community_coin::ID, accounts, data: community_coin::instruction::ExecuteUnion { min_target_in: 0 }.data() };
        self.send_as(i, vec![ix]).await
    }
}

/// The custom error code a failed transaction carries (6000 + its index in CoinError), if any.
pub fn error_code(e: &BanksClientError) -> Option<u32> {
    use solana_sdk::instruction::InstructionError;
    use solana_sdk::transaction::TransactionError;
    match e {
        BanksClientError::TransactionError(TransactionError::InstructionError(_, InstructionError::Custom(c)))
        | BanksClientError::SimulationError { err: TransactionError::InstructionError(_, InstructionError::Custom(c)), .. } => Some(*c),
        _ => None,
    }
}

pub fn code(e: community_coin::errors::CoinError) -> u32 {
    6000 + e as u32
}
