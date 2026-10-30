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

/// A lobby: a fixed window (an hour by default) in which a crowd proposes coin ideas and pledges SOL on them.
/// The pledge is the vote. At `lock_at` pledges freeze and the idea with the most SOL wins; at `launch_at` it
/// launches with its whole pot as its opening batch, so every backer gets the same price. Every other pledge is
/// refunded. The pledged lamports sit in the lobby account until then.
#[account]
#[derive(InitSpace)]
pub struct Lobby {
    pub id: u64,
    pub host: Pubkey,
    pub opens_at: i64,
    pub proposals_close: i64,
    pub lock_at: i64,
    pub launch_at: i64,
    /// Most a wallet can have pledged at once, in lamports.
    pub max_pledge: u64,
    /// Lamports a proposer deposits against spam, returned after the lock, win or lose.
    pub bond: u64,
    pub idea_count: u8,
    /// Wallets that ever pledged here: the next pledge's `seq`.
    pub pledgers: u32,
    /// Lamports pledged and not withdrawn.
    pub total: u64,
    pub finalized: bool,
    /// Index of the winning idea, or NO_WINNER.
    pub winner: u8,
    pub launched: bool,
    /// The winner's mint, once launched.
    pub mint: Pubkey,
    pub bump: u8,
}

/// One idea in a lobby's race. Its address is derived from the lobby and its normalized ticker, so a lobby
/// cannot hold the same ticker twice.
#[account]
#[derive(InitSpace)]
pub struct Idea {
    pub lobby: Pubkey,
    pub index: u8,
    pub proposer: Pubkey,
    #[max_len(16)]
    pub key: Vec<u8>,
    #[max_len(40)]
    pub name: String,
    #[max_len(32)]
    pub symbol: String,
    #[max_len(200)]
    pub uri: String,
    pub pledged: u64,
    pub backers: u32,
    pub bond_returned: bool,
    pub bump: u8,
}

/// One wallet's pledge in a lobby: on one idea at a time.
#[account]
#[derive(InitSpace)]
pub struct Pledge {
    pub lobby: Pubkey,
    pub user: Pubkey,
    /// Order in which this wallet first pledged in the lobby (0 first): a founder's rank.
    pub seq: u32,
    pub idea: u8,
    pub amount: u64,
    /// Refunded, or turned into a founder's commitment to the opening.
    pub settled: bool,
    pub bump: u8,
}

/// A ticker held for a lobby: while an idea with this ticker is in a lobby's race, and for a day after its launch
/// time, nobody can launch it on the launchpad, so the lobby's winner cannot be front-run (or voided) by a copycat.
#[account]
#[derive(InitSpace)]
pub struct Hold {
    pub lobby: Pubkey,
    /// Unix time after which the hold lapses: the lobby's launch time plus `HOLD_GRACE`.
    pub until: i64,
    pub bump: u8,
}
