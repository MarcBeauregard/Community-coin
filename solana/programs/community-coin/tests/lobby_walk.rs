//! A random walk through a lobby's whole life: proposals, pledges, withdrawals, moves (failures included), the
//! lock, refunds, the launch, founders and bonds. The books are checked after every step: the ideas add up to the
//! lobby's total and the lobby holds exactly what it owes. It writes target/cross-check/lobby.json, every step
//! with its instructions, result, events and the state after it; web/lobbies/chain-check.mjs replays it on the
//! app's JavaScript rules and wire format and must find the same results, bytes, events and state.
//! Alone in its binary because it taps the program's events (see common::tap_events).

mod common;
use common::*;
use community_coin::NO_WINNER;
use serde_json::{json, Value};
use solana_sdk::signer::Signer;

const ID: u64 = 7;


struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        self.0 >> 33
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

const IDEAS: [&str; 4] = ["WIF", "POPCAT", "MEW", "BRETT"];

async fn snapshot(hub: &mut Hub, users: usize) -> Value {
    let l = hub.lobby(ID).await;
    let mut ideas = vec![];
    for s in IDEAS.iter().take(l.idea_count as usize) {
        let i = hub.idea(ID, s).await;
        ideas.push(json!({ "symbol": i.symbol, "index": i.index, "pledged": i.pledged, "backers": i.backers, "bond_returned": i.bond_returned }));
    }
    let mut pledges = vec![];
    for u in 0..users {
        if let Some(p) = hub.pledge_of(ID, u).await {
            pledges.push(json!({ "user": u, "seq": p.seq, "idea": p.idea, "amount": p.amount, "settled": p.settled }));
        }
    }
    let balance = hub.lobby_balance(ID).await;
    json!({
        "lobby": { "total": l.total, "idea_count": l.idea_count, "pledgers": l.pledgers, "finalized": l.finalized, "winner": l.winner, "launched": l.launched, "mint": l.mint.to_string() },
        "ideas": ideas, "pledges": pledges, "balance": balance,
    })
}

/// Books of a lobby before it launches: what it holds is what is pledged plus the bonds still owed.
async fn check_books(hub: &mut Hub, users: usize) {
    let l = hub.lobby(ID).await;
    let mut ideas_total = 0;
    let mut bonds = 0;
    for s in IDEAS.iter().take(l.idea_count as usize) {
        let i = hub.idea(ID, s).await;
        ideas_total += i.pledged;
        if !i.bond_returned {
            bonds += BOND;
        }
    }
    let mut owed = 0;
    for u in 0..users {
        if let Some(p) = hub.pledge_of(ID, u).await {
            if !p.settled && !(l.launched && p.idea == l.winner) {
                owed += p.amount;
            }
        }
    }
    assert_eq!(ideas_total, l.total, "ideas add up to the lobby total");
    // Once launched, the winner's pot is in the hub's vault as the opening batch: the lobby owes it no more.
    assert_eq!(hub.lobby_balance(ID).await, owed + bonds, "the lobby holds exactly what it owes");
}

#[tokio::test]
async fn random_walk_keeps_the_books_and_writes_the_cross_check() {
    const USERS: usize = 8;
    let mut hub = Hub::start(Params::default(), USERS).await;
    tap_events();
    let mut rng = Rng(0x10bb1e5);
    let users: Vec<String> = (0..USERS).map(|u| hub.user(u).pubkey().to_string()).collect();
    let mut steps: Vec<Value> = vec![];
    hub.sent.clear();

    macro_rules! step {
        ($op:expr, $args:expr, $call:expr) => {{
            let r = $call.await;
            let result = match &r {
                Ok(_) => json!("ok"),
                Err(e) => json!(error_code(e)),
            };
            let sent: Vec<Value> = std::mem::take(&mut hub.sent)
                .into_iter()
                .map(|t| {
                    let ixs: Vec<Value> = t
                        .instructions
                        .iter()
                        .map(|ix| json!({ "keys": ix.accounts.iter().map(|a| json!([a.pubkey.to_string(), a.is_signer, a.is_writable])).collect::<Vec<_>>(), "data": hex(&ix.data) }))
                        .collect();
                    json!({ "instructions": ixs, "events": t.events.iter().map(|e| hex(e)).collect::<Vec<_>>() })
                })
                .collect();
            let state = snapshot(&mut hub, USERS).await;
            check_books(&mut hub, USERS).await;
            steps.push(json!({ "op": $op, "args": $args, "time": hub.now, "result": result, "sent": sent, "state": state }));
            drop(r);
        }};
    }

    hub.launch(7, "PNUT", None, 0).await.unwrap();
    hub.sent.clear();
    let t0 = hub.now;
    step!("create_lobby", json!({ "user": 0, "id": ID, "opens_at": t0, "max_pledge": 5 * SOL, "bond": BOND }), hub.create_lobby(0, ID, t0, 5 * SOL, BOND));
    for (i, s) in IDEAS.iter().enumerate() {
        step!("propose", json!({ "user": i, "symbol": s }), hub.propose(i, ID, s));
    }
    step!("propose", json!({ "user": 5, "symbol": "w1f" }), hub.propose(5, ID, "w1f"));
    step!("propose", json!({ "user": 5, "symbol": "PNUT" }), hub.propose(5, ID, "PNUT"));

    for n in 0..140 {
        let u = 1 + rng.below(USERS as u64 - 1) as usize;
        let mut idea = IDEAS[rng.below(4) as usize];
        // Most pledges top up the idea a wallet already backs, as people do.
        if let Some(p) = hub.pledge_of(ID, u).await {
            if p.amount > 0 && rng.below(10) < 7 {
                idea = IDEAS[p.idea as usize];
            }
        }
        let amount = (1 + rng.below(30)) * SOL / 10;
        match rng.below(10) {
            0..=4 => {
                step!("pledge", json!({ "user": u, "symbol": idea, "amount": amount }), hub.pledge(u, ID, idea, amount));
            }
            5..=6 => {
                let on = hub.pledge_of(ID, u).await.map(|p| IDEAS[p.idea as usize]).unwrap_or(idea);
                step!("withdraw", json!({ "user": u, "symbol": on, "amount": amount }), hub.withdraw(u, ID, on, amount));
            }
            _ => {
                let on = hub.pledge_of(ID, u).await.map(|p| IDEAS[p.idea as usize]).unwrap_or(IDEAS[0]);
                step!("move_pledge", json!({ "user": u, "from": on, "to": idea }), hub.move_pledge(u, ID, on, idea));
            }
        }
        if n == 60 {
            hub.warp(PROPOSE).await;
            step!("propose", json!({ "user": 6, "symbol": "FLOKI" }), hub.propose(6, ID, "FLOKI"));
        }
    }

    hub.warp(LOCK - PROPOSE).await;
    step!("pledge", json!({ "user": 1, "symbol": "WIF", "amount": SOL }), hub.pledge(1, ID, "WIF", SOL));
    step!("finalize", json!({ "user": 7, "symbols": ["WIF", "POPCAT", "MEW"] }), hub.finalize(7, ID, &["WIF", "POPCAT", "MEW"]));
    step!("finalize", json!({ "user": 7, "symbols": IDEAS }), hub.finalize(7, ID, &IDEAS));
    let winner = hub.lobby(ID).await.winner;
    assert_ne!(winner, NO_WINNER);
    for u in 0..USERS {
        step!("refund", json!({ "user": 7, "of": u }), hub.refund(7, ID, u));
    }
    step!("launch_winner", json!({ "user": 7, "symbol": IDEAS[winner as usize] }), hub.launch_winner(7, ID, IDEAS[winner as usize]));
    hub.warp(LENGTH - LOCK).await;
    for s in IDEAS {
        step!("launch_winner", json!({ "user": 7, "symbol": s }), hub.launch_winner(7, ID, s));
    }
    for u in 0..USERS {
        step!("claim_founder", json!({ "user": 7, "of": u }), hub.claim_founder(7, ID, u));
    }
    for s in IDEAS {
        step!("return_bond", json!({ "user": 7, "symbol": s }), hub.return_bond(7, ID, s));
    }
    assert_eq!(hub.lobby_balance(ID).await, 0, "every lamport went back, or into the opening");

    // What the founders committed is exactly the pot the opening holds.
    let l = hub.lobby(ID).await;
    let mut committed = 0;
    for u in 0..USERS {
        let k = hub.user(u).pubkey();
        committed += hub.commitment(&l.mint, &k).await.map(|c| c.committed).unwrap_or(0);
    }
    assert_eq!(committed as u128, hub.meme(&l.mint).await.batch_quote);

    // The raw accounts at the end, to check the app's decoders and its client's reads.
    let lobby_key = lobby_pda(ID);
    let mut keys = vec![lobby_key];
    keys.extend(IDEAS.iter().map(|s| idea_pda(&lobby_key, s)));
    keys.extend((0..USERS).map(|u| pledge_pda(&lobby_key, &hub.user(u).pubkey())));
    let mut accounts = serde_json::Map::new();
    for k in keys {
        if let Some(a) = hub.account(k).await {
            accounts.insert(k.to_string(), json!({ "owner": a.owner.to_string(), "lamports": a.lamports, "data": hex(&a.data) }));
        }
    }

    let ok = steps.iter().filter(|s| s["result"] == json!("ok")).count();
    assert!(ok > 60 && ok < steps.len(), "the walk exercises successes and failures ({ok}/{})", steps.len());
    let out = json!({
        "program": community_coin::ID.to_string(),
        "users": users,
        "id": ID, "propose": PROPOSE, "lock": LOCK, "length": LENGTH,
        "errors": { "base": 6000 },
        "steps": steps,
        "accounts": accounts,
    });
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/cross-check");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("lobby.json"), serde_json::to_string_pretty(&out).unwrap()).unwrap();
}
