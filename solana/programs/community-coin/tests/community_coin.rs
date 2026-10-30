//! The Solidity suite's behaviours, on Solana: one ticker per meme, fair openings with vesting, lineage routing,
//! the spike share, creator and protocol fees, unions, and the books balancing to the lamport and the token unit.

mod common;
use common::*;
use community_coin::errors::CoinError;
use community_coin::math::{BPS, FEE_BPS, ROOT_VIRTUAL_QUOTE};
use solana_sdk::signer::Signer;

fn expect_err<T: std::fmt::Debug>(r: Result<T, solana_program_test::BanksClientError>, e: CoinError) {
    let err = r.expect_err("expected the transaction to fail");
    assert_eq!(error_code(&err), Some(code(e)), "{err:?}");
}

async fn live_root(hub: &mut Hub, creator: usize, symbol: &str, buyers: &[(usize, u64)]) -> anchor_lang::prelude::Pubkey {
    let mint = hub.launch(creator, symbol, None, SOL / 10).await.unwrap();
    hub.warp(OPEN).await;
    hub.claim(creator, mint).await.unwrap();
    for &(b, v) in buyers {
        hub.buy_sol(b, mint, v, 0).await.unwrap();
    }
    mint
}

// ------------------------------------------------------------------ one meme, one ticker

#[tokio::test]
async fn refuses_a_second_meme_with_the_same_ticker() {
    let mut hub = Hub::start(Params::default(), 3).await;
    let mint = hub.launch(0, "PNUT", None, 0).await.unwrap();
    assert_eq!(mint, mint_of("$pnut"));
    for copy in ["PNUT", "$pnut", "P.N.U.T", "PNU7"] {
        assert!(hub.launch(1, copy, None, 0).await.is_err(), "{copy} should be refused");
    }
    assert!(hub.launch(1, "PNUTS", None, 0).await.is_ok());
    assert_eq!(hub.config().await.meme_count, 2);
}

#[tokio::test]
async fn caps_lineage_depth() {
    let mut hub = Hub::start(Params::default(), 2).await;
    let mut parent = hub.launch(0, "L0", None, 0).await.unwrap();
    for d in 1..=6 {
        parent = hub.launch(0, &format!("L{d}"), Some(parent), 0).await.unwrap();
    }
    expect_err(hub.launch(0, "L7", Some(parent), 0).await, CoinError::TooDeep);
    let root = hub.meme(&mint_of("L0")).await;
    assert_eq!(root.height, 6);
}

// ------------------------------------------------------------------ fair opening

#[tokio::test]
async fn gives_everyone_in_the_opening_the_same_price() {
    let mut hub = Hub::start(Params::default(), 4).await;
    let mint = hub.launch(0, "PNUT", None, SOL).await.unwrap();
    hub.commit_sol(1, mint, 3 * SOL).await.unwrap();
    hub.commit_quote(2, mint, 6 * SOL).await.unwrap();
    expect_err(hub.buy_sol(3, mint, SOL, 0).await, CoinError::StillOpening);
    hub.warp(OPEN).await;
    expect_err(hub.commit_sol(3, mint, SOL).await, CoinError::OpeningClosed);
    for i in 0..3 {
        hub.claim(i, mint).await.unwrap();
    }
    let got: Vec<u64> = futures_balances(&mut hub, mint, &[0, 1, 2]).await;
    // 1 : 3 : 6 SOL gives 1 : 3 : 6 of the batch, to the token unit.
    assert!(got[1].abs_diff(got[0] * 3) <= 3 && got[2].abs_diff(got[0] * 6) <= 6, "{got:?}");
    let m = hub.meme(&mint).await;
    assert_eq!(m.batch_quote, 10 * SOL as u128);
    assert!(m.settled);
    expect_err(hub.claim(1, mint).await, CoinError::NothingToClaim);
}

async fn futures_balances(hub: &mut Hub, mint: anchor_lang::prelude::Pubkey, users: &[usize]) -> Vec<u64> {
    let mut out = vec![];
    for &u in users {
        let k = hub.user(u).pubkey();
        out.push(hub.balance(&k, &mint).await);
    }
    out
}

#[tokio::test]
async fn vests_the_opening_batch_linearly() {
    let mut hub = Hub::start(Params { vest: 3600, ..Params::default() }, 2).await;
    let mint = hub.launch(0, "PNUT", None, 2 * SOL).await.unwrap();
    hub.warp(OPEN + 1800).await;
    hub.claim(0, mint).await.unwrap();
    let half = hub.balance(&hub.user(0).pubkey(), &mint).await;
    let total = hub.meme(&mint).await.batch_tokens as u64;
    assert_eq!(half, total / 2);
    hub.warp(3600).await;
    hub.claim(0, mint).await.unwrap();
    assert_eq!(hub.balance(&hub.user(0).pubkey(), &mint).await, total);
}

// ------------------------------------------------------------------ lineage

#[tokio::test]
async fn routes_a_buy_of_a_copy_through_the_original() {
    let mut hub = Hub::start(Params::default(), 4).await;
    let pnut = live_root(&mut hub, 0, "PNUT", &[(2, 5 * SOL)]).await;
    let wif = hub.launch(1, "PNUTWIFHAT", Some(pnut), 0).await.unwrap();
    hub.warp(OPEN).await;
    let before = hub.meme(&pnut).await;
    hub.buy_sol(3, wif, 2 * SOL, 0).await.unwrap();
    let after = hub.meme(&pnut).await;
    // The original's reserve grows by the SOL less its 1% fee; its creator earns 0.8%, the protocol 0.2%.
    assert_eq!((after.v_quote - after.floor) - (before.v_quote - before.floor), (2 * SOL as u128) * 99 / 100);
    assert_eq!(after.creator_fees - before.creator_fees, 2 * SOL * 80 / 10_000);
    assert_eq!(after.protocol_fees - before.protocol_fees, 2 * SOL * 20 / 10_000);
    let w = hub.meme(&wif).await;
    assert!(w.v_quote > w.floor, "the copy's reserve is held in PNUT");
    assert!(hub.balance(&hub.user(3).pubkey(), &wif).await > 0);
    assert_eq!(hub.supply(&wif).await, hub.balance(&hub.user(3).pubkey(), &wif).await);
}

#[tokio::test]
async fn pays_a_sale_of_a_copy_in_the_original() {
    let mut hub = Hub::start(Params::default(), 4).await;
    let pnut = live_root(&mut hub, 0, "PNUT", &[(2, 5 * SOL)]).await;
    let wif = hub.launch(1, "PNUTWIFHAT", Some(pnut), 0).await.unwrap();
    hub.warp(OPEN).await;
    hub.buy_sol(3, wif, 2 * SOL, 0).await.unwrap();
    hub.warp(2 * 3600).await; // patient: no spike share
    let bal = hub.balance(&hub.user(3).pubkey(), &wif).await;
    let pnut_supply = hub.supply(&pnut).await;
    hub.sell(3, wif, bal, 0).await.unwrap();
    let got = hub.balance(&hub.user(3).pubkey(), &pnut).await;
    assert!(got > 0);
    assert_eq!(hub.supply(&pnut).await, pnut_supply + got, "the PNUT paid out is minted from the copy's reserve");
    assert_eq!(hub.supply(&wif).await, 0);
}

#[tokio::test]
async fn sells_a_copy_all_the_way_back_to_sol() {
    let mut hub = Hub::start(Params::default(), 4).await;
    let pnut = live_root(&mut hub, 0, "PNUT", &[(2, 5 * SOL)]).await;
    let wif = hub.launch(1, "PNUTWIFHAT", Some(pnut), 0).await.unwrap();
    hub.warp(OPEN).await;
    hub.buy_sol(3, wif, 2 * SOL, 0).await.unwrap();
    hub.warp(2 * 3600).await;
    let bal = hub.balance(&hub.user(3).pubkey(), &wif).await;
    let before = hub.lamports(&hub.user(3).pubkey()).await;
    hub.sell_to_sol(3, wif, bal, 0).await.unwrap();
    let back = hub.lamports(&hub.user(3).pubkey()).await + TX_FEE - before;
    // Two hops each way at 1%: a round trip costs about 4%, the rest comes back.
    assert!(back > 2 * SOL * 95 / 100 && back < 2 * SOL, "{back}");
}

// ------------------------------------------------------------------ spike share

#[tokio::test]
async fn keeps_half_of_an_instant_flip_above_the_reference_for_the_holders() {
    let mut hub = Hub::start(Params::default(), 4).await;
    let pnut = live_root(&mut hub, 0, "PNUT", &[(1, 10 * SOL)]).await;
    hub.warp(2 * 3600).await;
    let start = hub.meme(&pnut).await;
    hub.buy_sol(2, pnut, 20 * SOL, 0).await.unwrap();
    let bal = hub.balance(&hub.user(2).pubkey(), &pnut).await;
    hub.sell_to_sol(2, pnut, bal, 0).await.unwrap();
    let end = hub.meme(&pnut).await;
    // Bought and sold back at once, above the reference: part of the gain stays in the reserve for the holders.
    let left = (end.v_quote - end.floor) - (start.v_quote - start.floor);
    assert!(left > SOL as u128 / 2, "only {left} lamports stayed behind");
}

#[tokio::test]
async fn costs_nothing_extra_to_a_patient_seller() {
    let mut hub = Hub::start(Params::default(), 3).await;
    let pnut = live_root(&mut hub, 0, "PNUT", &[(1, 10 * SOL)]).await;
    hub.warp(2 * 3600).await;
    let bal = hub.balance(&hub.user(1).pubkey(), &pnut).await;
    let m = hub.meme(&pnut).await;
    let (gross, _, _) = community_coin::math::sell_out(m.v_quote, m.v_token, bal as u128).unwrap();
    let before = hub.lamports(&hub.user(1).pubkey()).await;
    hub.sell_to_sol(1, pnut, bal, 0).await.unwrap();
    let got = hub.lamports(&hub.user(1).pubkey()).await + TX_FEE - before;
    assert_eq!(got as u128, gross - gross * FEE_BPS / BPS, "only the 1% fee, no spike share");
}

// ------------------------------------------------------------------ fees

#[tokio::test]
async fn pays_creators_and_the_protocol_in_the_quote_asset() {
    let mut hub = Hub::start(Params::default(), 4).await;
    let pnut = live_root(&mut hub, 0, "PNUT", &[(2, 5 * SOL)]).await;
    let wif = hub.launch(1, "PNUTY", Some(pnut), 0).await.unwrap();
    hub.warp(OPEN).await;
    hub.buy_sol(3, wif, SOL, 0).await.unwrap();

    let root = hub.meme(&pnut).await;
    let dev = hub.user(0).pubkey();
    let before = hub.lamports(&dev).await;
    hub.claim_fees(Some(0), pnut, false).await.unwrap();
    assert_eq!(hub.lamports(&dev).await + TX_FEE - before, root.creator_fees);
    expect_err(hub.claim_fees(Some(0), pnut, false).await, CoinError::NothingToClaim);
    expect_err(hub.claim_fees(Some(1), pnut, true).await, CoinError::Unauthorized);

    let treasury = hub.treasury.pubkey();
    let t0 = hub.lamports(&treasury).await;
    hub.claim_fees(None, pnut, true).await.unwrap();
    assert_eq!(hub.lamports(&treasury).await + TX_FEE - t0, root.protocol_fees);

    // The variant's fees are in PNUT, minted when claimed.
    let v = hub.meme(&wif).await;
    assert!(v.protocol_fees > 0 && v.creator_fees >= 3 * v.protocol_fees, "0.8% against 0.2%: {} / {}", v.creator_fees, v.protocol_fees);
    hub.claim_fees(Some(1), wif, false).await.unwrap();
    assert_eq!(hub.balance(&hub.user(1).pubkey(), &pnut).await, v.creator_fees);
    hub.claim_fees(None, wif, true).await.unwrap();
    assert_eq!(hub.balance(&treasury, &pnut).await, v.protocol_fees);
}

#[tokio::test]
async fn never_charges_more_than_one_percent_whatever_the_protocol_cut() {
    for protocol in [0u16, 20, 50] {
        let mut hub = Hub::start(Params { protocol, ..Params::default() }, 3).await;
        let pnut = live_root(&mut hub, 0, "PNUT", &[]).await;
        hub.buy_sol(1, pnut, 7 * SOL, 0).await.unwrap();
        let m = hub.meme(&pnut).await;
        assert_eq!(m.creator_fees + m.protocol_fees, 7 * SOL / 100, "protocol {protocol}");
        assert_eq!(m.protocol_fees, 7 * SOL * protocol as u64 / 10_000);
    }
}

// ------------------------------------------------------------------ union

async fn rivals(hub: &mut Hub) -> (anchor_lang::prelude::Pubkey, anchor_lang::prelude::Pubkey) {
    let pnut = live_root(hub, 0, "PNUT", &[(4, 10 * SOL)]).await;
    let peanut = live_root(hub, 1, "PEANUT", &[(2, 6 * SOL), (3, 2 * SOL)]).await;
    (pnut, peanut)
}

#[tokio::test]
async fn moves_a_rival_root_and_its_reserve_into_the_target_family() {
    let mut hub = Hub::start(Params::default(), 5).await;
    let (pnut, peanut) = rivals(&mut hub).await;
    let id = hub.propose_union(2, peanut, pnut).await.unwrap();
    let alice = hub.balance(&hub.user(2).pubkey(), &peanut).await;
    hub.lock_union(2, id, alice).await.unwrap();
    expect_err(hub.execute_union(3, id).await, CoinError::VotingOpen);
    hub.warp(VOTE + 1).await;

    let before_target = hub.meme(&pnut).await;
    let before = hub.meme(&peanut).await;
    let dev = hub.user(1).pubkey();
    let dev_sol = hub.lamports(&dev).await;
    hub.execute_union(3, id).await.unwrap();
    let after = hub.meme(&peanut).await;
    let target = hub.meme(&pnut).await;
    let sol_in = before.v_quote - before.floor;
    assert_eq!(after.parent, pnut);
    assert_eq!((target.v_quote - target.floor) - (before_target.v_quote - before_target.floor), sol_in, "fee-free");
    assert_eq!(hub.lamports(&dev).await - dev_sol, before.creator_fees, "SOL fees paid out before the switch");
    assert_eq!(after.creator_fees, 0);
    assert!(after.v_quote > after.floor);
    assert_eq!(target.height, 1);

    hub.unlock_union(2, id).await.unwrap();
    assert_eq!(hub.balance(&hub.user(2).pubkey(), &peanut).await, alice);
    // A PEANUT holder can now sell all the way to SOL through PNUT.
    let bob = hub.balance(&hub.user(3).pubkey(), &peanut).await;
    hub.sell_to_sol(3, peanut, bob, 0).await.unwrap();
}

#[tokio::test]
async fn needs_a_majority_of_the_supply() {
    let mut hub = Hub::start(Params::default(), 5).await;
    let (pnut, peanut) = rivals(&mut hub).await;
    let id = hub.propose_union(3, peanut, pnut).await.unwrap();
    let bob = hub.balance(&hub.user(3).pubkey(), &peanut).await;
    hub.lock_union(3, id, bob).await.unwrap();
    hub.warp(VOTE + 1).await;
    expect_err(hub.execute_union(3, id).await, CoinError::QuorumNotReached);
    expect_err(hub.lock_union(2, id, 1).await, CoinError::VotingClosed);
    hub.unlock_union(3, id).await.unwrap();
    assert_eq!(hub.balance(&hub.user(3).pubkey(), &peanut).await, bob);
}

#[tokio::test]
async fn refuses_cycles_and_non_roots() {
    let mut hub = Hub::start(Params::default(), 5).await;
    let (pnut, _) = rivals(&mut hub).await;
    let wif = hub.launch(2, "PNUTWIFHAT", Some(pnut), 0).await.unwrap();
    hub.warp(OPEN).await;
    expect_err(hub.propose_union(2, pnut, wif).await, CoinError::CycleDetected);
    expect_err(hub.propose_union(2, wif, pnut).await, CoinError::NotRoot);
}

// ------------------------------------------------------------------ configuration

#[tokio::test]
async fn caps_the_protocol_cut_and_needs_somewhere_to_send_it() {
    let mut hub = Hub::bare(1).await;
    let to = hub.treasury.pubkey();
    expect_err(hub.initialize(&Params { protocol: 51, ..Params::default() }, to).await, CoinError::InvalidConfig);
    expect_err(hub.initialize(&Params::default(), anchor_lang::prelude::Pubkey::default()).await, CoinError::InvalidConfig);
    expect_err(hub.initialize(&Params { spike: 9901, ..Params::default() }, to).await, CoinError::InvalidConfig);
    hub.initialize(&Params { protocol: 50, ..Params::default() }, to).await.unwrap();
    let c = hub.config().await;
    assert_eq!((c.protocol_fee_bps, c.fee_recipient), (50, to));
    assert!(hub.initialize(&Params::default(), to).await.is_err(), "initialize works once");
}

#[tokio::test]
async fn starts_root_curves_at_thirty_virtual_sol() {
    let mut hub = Hub::start(Params::default(), 1).await;
    let mint = hub.launch(0, "PNUT", None, 0).await.unwrap();
    let m = hub.meme(&mint).await;
    assert_eq!(m.v_quote, ROOT_VIRTUAL_QUOTE);
    assert_eq!(m.floor, ROOT_VIRTUAL_QUOTE);
}
