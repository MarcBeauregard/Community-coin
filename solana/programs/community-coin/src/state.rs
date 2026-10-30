use anchor_lang::prelude::*;

/// The hub's parameters, fixed when it is initialized, and its counters.
#[account]
#[derive(InitSpace)]
pub struct Config {
    pub open_window: i64,
    pub vest_window: i64,
    pub spike_share_bps: u16,
    pub union_window: i64,
    /// Part of every trade, in basis points of the trade, paid to `fee_recipient` out of the 1% fee.
    pub protocol_fee_bps: u16,
    pub fee_recipient: Pubkey,
    pub meme_count: u64,
    pub union_count: u64,
    pub bump: u8,
    pub authority_bump: u8,
    pub vault_bump: u8,
}

/// Holds every lamport the hub owes: root reserves, open batches, SOL fees.
#[account]
#[derive(InitSpace)]
pub struct Vault {}

/// One meme and its curve. Reserves of variants, opening batches and fees are numbers here: the tokens they stand
/// for are minted only when they leave the hub, so every real token is in somebody's wallet.
#[account]
#[derive(InitSpace)]
pub struct Meme {
    pub mint: Pubkey,
    /// Quote asset: Pubkey::default() for SOL (a root), else the parent meme's mint.
    pub parent: Pubkey,
    pub creator: Pubkey,
    pub index: u64,
    pub open_until: i64,
    pub settled: bool,
    /// Height of the subtree below this meme (0 for a leaf).
    pub height: u8,
    pub ref_time: i64,
    /// Reference price, quote base units per token base unit, 1e18-scaled.
    pub reference: u128,
    pub v_quote: u128,
    pub v_token: u128,
    /// Virtual part of v_quote: the real reserve is v_quote - floor.
    pub floor: u128,
    pub batch_quote: u128,
    pub batch_tokens: u128,
    /// Opening tokens claimed so far by everyone.
    pub batch_claimed: u128,
    /// Tokens locked in union votes (burned while locked, minted back on unlock).
    pub escrowed: u64,
    /// Fees owed in the quote asset.
    pub creator_fees: u64,
    pub protocol_fees: u64,
    #[max_len(40)]
    pub name: String,
    #[max_len(32)]
    pub symbol: String,
    pub bump: u8,
}

/// What one account committed to an opening and claimed of it.
#[account]
#[derive(InitSpace)]
pub struct Commitment {
    pub committed: u64,
    pub claimed: u64,
}

#[account]
#[derive(InitSpace)]
pub struct Union {
    pub id: u64,
    /// Root asking to join.
    pub meme: Pubkey,
    /// Meme whose family it joins.
    pub target: Pubkey,
    pub deadline: i64,
    pub executed: bool,
    pub locked: u64,
}

#[account]
#[derive(InitSpace)]
pub struct Lock {
    pub amount: u64,
}
