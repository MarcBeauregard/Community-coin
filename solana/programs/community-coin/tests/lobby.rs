//! Lobbies: an hour in which a crowd proposes coin ideas and pledges SOL on them, the pledge being the vote. The
//! winner launches with its whole pot as its opening batch (one price for every backer); every other pledge is
//! refunded to the lamport.
//!
//! tests/lobby_walk.rs walks a lobby at random, checks its books after every step and writes the cross-check of
//! the app's JavaScript side.

mod common;
use anchor_lang::prelude::Pubkey;
use common::*;
use community_coin::errors::CoinError;
use community_coin::NO_WINNER;
use solana_program_test::BanksClientError;
use solana_sdk::signer::Signer;

const ID: u64 = 7;

fn expect_err<T: std::fmt::Debug>(r: Result<T, BanksClientError>, e: CoinError) {
    let err = r.expect_err("expected the transaction to fail");
    assert_eq!(error_code(&err), Some(code(e)), "{err:?}");
}

async fn open_lobby(hub: &mut Hub, ideas: &[(usize, &str)]) {
    let t = hub.now;
    hub.create_lobby(0, ID, t, 5 * SOL, BOND).await.unwrap();
    for &(i, s) in ideas {
        hub.propose(i, ID, s).await.unwrap();
    }
}

// ------------------------------------------------------------------ the hour

#[tokio::test]
async fn the_winner_launches_with_its_pot_and_every_backer_gets_the_same_price() {
    let mut hub = Hub::start(Params::default(), 5).await;
    open_lobby(&mut hub, &[(0, "WIF"), (1, "POPCAT")]).await;
    hub.pledge(1, ID, "WIF", 2 * SOL).await.unwrap();
    hub.pledge(2, ID, "WIF", 3 * SOL).await.unwrap();
    hub.pledge(3, ID, "POPCAT", 4 * SOL).await.unwrap();
    hub.withdraw(3, ID, "POPCAT", SOL).await.unwrap();
    assert_eq!(hub.lobby(ID).await.total, 8 * SOL);
    assert_eq!(hub.lobby_balance(ID).await, 8 * SOL + 2 * BOND);

    expect_err(hub.finalize(4, ID, &["WIF", "POPCAT"]).await, CoinError::StillPledging);
    hub.warp(LOCK).await;
    expect_err(hub.pledge(4, ID, "WIF", SOL).await, CoinError::PledgesLocked);
    expect_err(hub.withdraw(1, ID, "WIF", SOL).await, CoinError::PledgesLocked);
    hub.finalize(4, ID, &["WIF", "POPCAT"]).await.unwrap();
    // (Repeats come from another sender: the same transaction twice would be dropped as already processed.)
    expect_err(hub.finalize(3, ID, &["WIF", "POPCAT"]).await, CoinError::AlreadyFinalized);
    let l = hub.lobby(ID).await;
    assert!(l.finalized && l.winner == 0);

    // The loser's pledge comes back to the lamport, whoever sends the refund.
    let k3 = hub.user(3).pubkey();
    let before = hub.lamports(&k3).await;
    hub.refund(4, ID, 3).await.unwrap();
    assert_eq!(hub.lamports(&k3).await - before, 3 * SOL);
    expect_err(hub.refund(2, ID, 3).await, CoinError::PledgeSettled);
    expect_err(hub.refund(4, ID, 1).await, CoinError::WinnerNoRefund);

    expect_err(hub.launch_winner(4, ID, "WIF").await, CoinError::NotLaunchTime);
    hub.warp(LENGTH - LOCK).await;
    expect_err(hub.launch_winner(4, ID, "POPCAT").await, CoinError::NotTheWinner);
    let mint = hub.launch_winner(4, ID, "WIF").await.unwrap();
    let m = hub.meme(&mint).await;
    assert_eq!(m.batch_quote, 5 * SOL as u128);
    assert_eq!(m.creator, hub.user(0).pubkey(), "the proposer is the meme's creator");
    assert_eq!(m.parent, Pubkey::default());
    assert!(hub.launch_winner(4, ID, "WIF").await.is_err(), "the winner launches once (its mint now exists)");

    hub.claim_founder(4, ID, 1).await.unwrap();
    hub.claim_founder(4, ID, 2).await.unwrap();
    expect_err(hub.claim_founder(3, ID, 2).await, CoinError::PledgeSettled);
    expect_err(hub.claim_founder(4, ID, 3).await, CoinError::PledgeSettled);
    hub.warp(OPEN).await;
    hub.claim(1, mint).await.unwrap();
    hub.claim(2, mint).await.unwrap();
    let (k1, k2) = (hub.user(1).pubkey(), hub.user(2).pubkey());
    let (b1, b2) = (hub.balance(&k1, &mint).await, hub.balance(&k2, &mint).await);
    assert!((b1 as u128 * 3).abs_diff(b2 as u128 * 2) <= 3, "2 : 3 SOL gives 2 : 3 of the batch: {b1} {b2}");

    hub.return_bond(4, ID, "WIF").await.unwrap();
    hub.return_bond(4, ID, "POPCAT").await.unwrap();
    expect_err(hub.return_bond(4, ID, "POPCAT").await, CoinError::PledgeSettled);
    assert_eq!(hub.lobby_balance(ID).await, 0, "the lobby keeps nothing");
}

// ------------------------------------------------------------------ rules

#[tokio::test]
async fn one_ticker_per_idea_free_on_the_launchpad_and_proposals_close_on_time() {
    let mut hub = Hub::start(Params::default(), 4).await;
    hub.launch(3, "PNUT", None, 0).await.unwrap();
    assert!(hub.propose(0, ID, "WIF").await.is_err(), "no lobby yet");
    open_lobby(&mut hub, &[(0, "WIF")]).await;
    expect_err(hub.propose(1, ID, "PNUT").await, CoinError::MemeExists);
    assert!(hub.propose(1, ID, "w1f").await.is_err(), "W1F is WIF once normalized");
    hub.warp(PROPOSE).await;
    expect_err(hub.propose(1, ID, "MEW").await, CoinError::ProposalsClosed);
    assert_eq!(hub.lobby(ID).await.idea_count, 1);
}

#[tokio::test]
async fn a_wallet_backs_one_idea_up_to_the_cap_and_can_move_or_withdraw_until_the_lock() {
    let mut hub = Hub::start(Params::default(), 3).await;
    open_lobby(&mut hub, &[(0, "WIF"), (0, "MEW")]).await;
    hub.pledge(1, ID, "WIF", 3 * SOL).await.unwrap();
    expect_err(hub.pledge(1, ID, "WIF", 3 * SOL).await, CoinError::PledgeCap);
    expect_err(hub.pledge(1, ID, "MEW", SOL).await, CoinError::OnAnotherIdea);
    hub.move_pledge(1, ID, "WIF", "MEW").await.unwrap();
    let (wif, mew) = (hub.idea(ID, "WIF").await, hub.idea(ID, "MEW").await);
    assert_eq!((wif.pledged, wif.backers, mew.pledged, mew.backers), (0, 0, 3 * SOL, 1));
    expect_err(hub.withdraw(1, ID, "WIF", SOL).await, CoinError::OnAnotherIdea);
    expect_err(hub.withdraw(1, ID, "MEW", 4 * SOL).await, CoinError::ZeroAmount);
    hub.withdraw(1, ID, "MEW", 3 * SOL).await.unwrap();
    assert_eq!(hub.idea(ID, "MEW").await.backers, 0);
    // An emptied pledge can go anywhere again, and keeps its place in line.
    hub.pledge(2, ID, "WIF", SOL).await.unwrap();
    hub.pledge(1, ID, "WIF", SOL).await.unwrap();
    let (p1, p2) = (hub.pledge_of(ID, 1).await.unwrap(), hub.pledge_of(ID, 2).await.unwrap());
    assert_eq!((p1.seq, p2.seq), (0, 1));
    assert_eq!(hub.lobby(ID).await.pledgers, 2);
}

#[tokio::test]
async fn finalize_needs_every_idea_and_breaks_ties_by_the_earliest() {
    let mut hub = Hub::start(Params::default(), 3).await;
    open_lobby(&mut hub, &[(0, "WIF"), (0, "MEW"), (0, "BRETT")]).await;
    hub.pledge(1, ID, "MEW", 2 * SOL).await.unwrap();
    hub.pledge(2, ID, "BRETT", 2 * SOL).await.unwrap();
    hub.warp(LOCK).await;
    expect_err(hub.finalize(0, ID, &["WIF", "MEW"]).await, CoinError::BadIdeas);
    expect_err(hub.finalize(0, ID, &["WIF", "MEW", "MEW"]).await, CoinError::BadIdeas);
    hub.finalize(0, ID, &["BRETT", "WIF", "MEW"]).await.unwrap();
    assert_eq!(hub.lobby(ID).await.winner, 1, "MEW was proposed before BRETT");
}

#[tokio::test]
async fn a_lobby_without_pledges_has_no_winner_and_returns_the_bonds() {
    let mut hub = Hub::start(Params::default(), 2).await;
    open_lobby(&mut hub, &[(1, "WIF")]).await;
    hub.warp(LOCK).await;
    hub.finalize(0, ID, &["WIF"]).await.unwrap();
    assert_eq!(hub.lobby(ID).await.winner, NO_WINNER);
    hub.warp(LENGTH).await;
    expect_err(hub.launch_winner(0, ID, "WIF").await, CoinError::NotTheWinner);
    let k1 = hub.user(1).pubkey();
    let before = hub.lamports(&k1).await;
    hub.return_bond(0, ID, "WIF").await.unwrap();
    assert_eq!(hub.lamports(&k1).await - before, BOND);
}

#[tokio::test]
async fn a_ticker_in_the_race_is_held_for_its_lobby() {
    let mut hub = Hub::start(Params::default(), 3).await;
    open_lobby(&mut hub, &[(0, "WIF")]).await;
    // Nobody can launch it on the launchpad to front-run the lobby, and no other lobby can race it.
    expect_err(hub.launch(2, "WIF", None, 0).await, CoinError::TickerHeld);
    let t = hub.now;
    hub.create_lobby(1, ID + 1, t, 5 * SOL, BOND).await.unwrap();
    expect_err(hub.propose(1, ID + 1, "WIF").await, CoinError::TickerHeld);
    hub.pledge(1, ID, "WIF", SOL).await.unwrap();
    hub.warp(LOCK).await;
    hub.finalize(0, ID, &["WIF"]).await.unwrap();
    hub.warp(LENGTH - LOCK).await;
    expect_err(hub.launch(2, "WIF", None, 0).await, CoinError::TickerHeld);
    hub.launch_winner(0, ID, "WIF").await.unwrap();
    // A losing idea's ticker is free again once its hold lapses, a day after the lobby's launch time.
    let mut hub = Hub::start(Params::default(), 3).await;
    open_lobby(&mut hub, &[(0, "MEW")]).await;
    hub.warp(LENGTH + community_coin::HOLD_GRACE).await;
    expect_err(hub.launch(2, "MEW", None, 0).await, CoinError::TickerHeld);
    hub.warp(1).await;
    hub.launch(2, "MEW", None, 0).await.unwrap();
}

#[tokio::test]
async fn if_the_winners_ticker_is_taken_after_its_hold_everyone_is_refunded() {
    let mut hub = Hub::start(Params::default(), 3).await;
    open_lobby(&mut hub, &[(0, "WIF"), (0, "MEW")]).await;
    hub.pledge(1, ID, "WIF", 2 * SOL).await.unwrap();
    hub.pledge(2, ID, "MEW", SOL).await.unwrap();
    hub.warp(LOCK).await;
    hub.finalize(0, ID, &["WIF", "MEW"]).await.unwrap();
    expect_err(hub.void_winner(0, ID, "WIF").await, CoinError::TickerFree);
    // Nobody cranked the launch for a whole day: the hold lapses and someone else launches the ticker.
    hub.warp(LENGTH - LOCK + community_coin::HOLD_GRACE + 1).await;
    hub.launch(0, "WIF", None, 0).await.unwrap();
    hub.void_winner(0, ID, "WIF").await.unwrap();
    assert_eq!(hub.lobby(ID).await.winner, NO_WINNER);
    hub.refund(0, ID, 1).await.unwrap();
    hub.refund(0, ID, 2).await.unwrap();
    hub.return_bond(0, ID, "WIF").await.unwrap();
    hub.return_bond(0, ID, "MEW").await.unwrap();
    assert_eq!(hub.lobby_balance(ID).await, 0);
}

#[tokio::test]
async fn lobby_windows_are_checked() {
    let mut hub = Hub::start(Params::default(), 1).await;
    let host = hub.user(0).pubkey();
    let bad = |propose: i64, lock: i64, length: i64, max: u64| {
        use anchor_lang::{InstructionData, ToAccountMetas};
        solana_sdk::instruction::Instruction {
            program_id: community_coin::ID,
            accounts: community_coin::accounts::CreateLobby { host, lobby: lobby_pda(9), system_program: solana_sdk::system_program::ID }.to_account_metas(None),
            data: community_coin::instruction::CreateLobby { id: 9, opens_at: 0, propose_secs: propose, lock_secs: lock, length, max_pledge: max, bond: 0 }.data(),
        }
    };
    for (p, l, n, m) in [(0, 10, 20, SOL), (30, 20, 40, SOL), (10, 20, 15, SOL), (10, 20, 5 * 3600, SOL), (10, 20, 30, 0)] {
        expect_err(hub.send_as(0, vec![bad(p, l, n, m)]).await, CoinError::InvalidLobby);
    }
}
