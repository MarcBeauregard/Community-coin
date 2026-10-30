use anchor_lang::prelude::*;

#[error_code]
pub enum CoinError {
    #[msg("This ticker is taken")]
    MemeExists,
    #[msg("Unknown meme")]
    UnknownMeme,
    #[msg("Invalid ticker: 1 to 16 letters or digits once normalized")]
    InvalidSymbol,
    #[msg("Name or link too long")]
    InvalidName,
    #[msg("Lineage too deep: 6 levels at most")]
    TooDeep,
    #[msg("The opening is over")]
    OpeningClosed,
    #[msg("The opening is still running")]
    StillOpening,
    #[msg("The opening is already settled")]
    AlreadySettled,
    #[msg("Nothing to claim")]
    NothingToClaim,
    #[msg("Amount must be above zero")]
    ZeroAmount,
    #[msg("Paid with the wrong asset for this meme")]
    WrongAsset,
    #[msg("The price moved beyond the slippage limit")]
    Slippage,
    #[msg("Only a root meme can join another family")]
    NotRoot,
    #[msg("These memes are already in the same family")]
    CycleDetected,
    #[msg("The vote is still open")]
    VotingOpen,
    #[msg("The vote is closed")]
    VotingClosed,
    #[msg("No majority: more than half of the circulating supply must be locked")]
    QuorumNotReached,
    #[msg("Reserve too small for a union")]
    ReserveTooSmall,
    #[msg("Reserve invariant broken")]
    ReserveInvariant,
    #[msg("Invalid configuration")]
    InvalidConfig,
    #[msg("The accounts passed are not this meme's lineage")]
    BadLineage,
    #[msg("Not allowed")]
    Unauthorized,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Invalid lobby: windows must be increasing and at most four hours, with a pledge limit")]
    InvalidLobby,
    #[msg("The lobby is not open yet")]
    LobbyNotOpen,
    #[msg("Proposals are closed")]
    ProposalsClosed,
    #[msg("Pledges are locked")]
    PledgesLocked,
    #[msg("Pledges are not locked yet")]
    StillPledging,
    #[msg("The lobby is already finalized")]
    AlreadyFinalized,
    #[msg("The lobby is not finalized yet")]
    NotFinalized,
    #[msg("This lobby is full: 16 ideas at most")]
    TooManyIdeas,
    #[msg("Your pledge is on another idea: move it instead")]
    OnAnotherIdea,
    #[msg("Above this lobby's pledge limit")]
    PledgeCap,
    #[msg("Not launch time yet")]
    NotLaunchTime,
    #[msg("This lobby has no winner")]
    NoWinner,
    #[msg("The winner is already launched")]
    AlreadyLaunched,
    #[msg("The winner is not launched yet")]
    NotLaunched,
    #[msg("This pledge is already refunded or committed")]
    PledgeSettled,
    #[msg("This pledge is not on the winner")]
    NotTheWinner,
    #[msg("A pledge on the winner becomes a founder's commitment, not a refund")]
    WinnerNoRefund,
    #[msg("Pass every idea of the lobby, once each")]
    BadIdeas,
    #[msg("The winner's ticker is still free")]
    TickerFree,
    #[msg("This ticker is held by a lobby's race")]
    TickerHeld,
}
