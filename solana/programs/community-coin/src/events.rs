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

#[event]
pub struct LobbyCreated {
    pub lobby: Pubkey,
    pub id: u64,
    pub host: Pubkey,
    pub opens_at: i64,
    pub proposals_close: i64,
    pub lock_at: i64,
    pub launch_at: i64,
    pub max_pledge: u64,
    pub bond: u64,
}

#[event]
pub struct IdeaProposed {
    pub lobby: Pubkey,
    pub index: u8,
    pub proposer: Pubkey,
    pub name: String,
    pub symbol: String,
}

/// A pledge, with the totals after it: the user's, the idea's and the lobby's.
#[event]
pub struct Pledged {
    pub lobby: Pubkey,
    pub user: Pubkey,
    pub idea: u8,
    pub amount: u64,
    pub user_total: u64,
    pub idea_total: u64,
    pub lobby_total: u64,
}

#[event]
pub struct Withdrawn {
    pub lobby: Pubkey,
    pub user: Pubkey,
    pub idea: u8,
    pub amount: u64,
    pub user_total: u64,
    pub idea_total: u64,
    pub lobby_total: u64,
}

#[event]
pub struct PledgeMoved {
    pub lobby: Pubkey,
    pub user: Pubkey,
    pub from: u8,
    pub to: u8,
    pub amount: u64,
    pub from_total: u64,
    pub to_total: u64,
}

/// Pledges are frozen. `winner` is NO_WINNER when nothing was pledged; `pot` is what the winner launches with.
#[event]
pub struct LobbyFinalized {
    pub lobby: Pubkey,
    pub winner: u8,
    pub pot: u64,
    pub total: u64,
}

/// The winner's ticker was taken on the launchpad before it could launch: every pledge is refunded.
#[event]
pub struct WinnerVoided {
    pub lobby: Pubkey,
    pub idea: u8,
}

#[event]
pub struct LobbyLaunched {
    pub lobby: Pubkey,
    pub mint: Pubkey,
    pub idea: u8,
    pub pot: u64,
    pub founders: u32,
}

#[event]
pub struct PledgeRefunded {
    pub lobby: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
}

/// A winning pledge became the founder's commitment to the opening batch.
#[event]
pub struct FounderJoined {
    pub lobby: Pubkey,
    pub user: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub seq: u32,
}

#[event]
pub struct BondReturned {
    pub lobby: Pubkey,
    pub idea: u8,
    pub proposer: Pubkey,
    pub amount: u64,
}
