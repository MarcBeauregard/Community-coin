use anchor_lang::prelude::*;

#[event]
pub struct Launched {
    pub mint: Pubkey,
    pub parent: Pubkey,
    pub creator: Pubkey,
    pub name: String,
    pub symbol: String,
}

#[event]
pub struct Committed {
    pub mint: Pubkey,
    pub user: Pubkey,
    pub quote: u64,
}

#[event]
pub struct Settled {
    pub mint: Pubkey,
    pub quote: u64,
    pub tokens: u64,
}

#[event]
pub struct Claimed {
    pub mint: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
}

/// One hop of a trade, in that curve's quote asset. `fee` is the whole 1%; `protocol_fee` is the protocol's part.
#[event]
pub struct Trade {
    pub mint: Pubkey,
    pub trader: Pubkey,
    pub is_buy: bool,
    pub quote_amount: u64,
    pub token_amount: u64,
    pub fee: u64,
    pub protocol_fee: u64,
    pub spike_share: u64,
}

#[event]
pub struct FeesClaimed {
    pub owner: Pubkey,
    pub meme: Pubkey,
    pub asset: Pubkey,
    pub amount: u64,
}

#[event]
pub struct UnionProposed {
    pub id: u64,
    pub meme: Pubkey,
    pub target: Pubkey,
    pub deadline: i64,
}

#[event]
pub struct UnionLocked {
    pub id: u64,
    pub voter: Pubkey,
    pub amount: u64,
}

#[event]
pub struct UnionUnlocked {
    pub id: u64,
    pub voter: Pubkey,
    pub amount: u64,
}

#[event]
pub struct UnionExecuted {
    pub id: u64,
    pub meme: Pubkey,
    pub target: Pubkey,
    pub sol_in: u64,
    pub target_in: u64,
}
