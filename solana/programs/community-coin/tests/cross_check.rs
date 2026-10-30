//! Replays scenarios on the program and writes, after every step, what the step did (ok or the error it failed
//! with) and the whole state of the hub to target/cross-check/<scenario>.json. web/protocol-check.mjs replays the
//! same scenarios on web/src/protocol.js and must find, step after step, exactly the same results and the same
//! state: curves, fees, batches, supplies, wallet balances, votes and vault, to the unit.
//!
//! Scenarios: web/src/seed.json (the demo history) and tests/scenarios/*.json (written by
//! `node web/protocol-check.mjs --write-walk`: a long random walk through every instruction, failures included).

mod common;
use anchor_lang::prelude::Pubkey;
use common::*;
use serde_json::{json, Map, Value};
use solana_program_test::BanksClientError;
use solana_sdk::signer::Signer;
use std::path::{Path, PathBuf};

fn lamports(sol: &str) -> u64 {
    let (whole, frac) = sol.split_once('.').unwrap_or((sol, ""));
    let frac = format!("{frac:0<9}");
    whole.parse::<u64>().unwrap() * SOL + frac[..9].parse::<u64>().unwrap()
}

/// The name of the error a step failed with, as web/src/protocol.js names it.
fn error_name(e: &BanksClientError) -> String {
    use community_coin::errors::CoinError::*;
    let all = [
        MemeExists, UnknownMeme, InvalidSymbol, InvalidName, TooDeep, OpeningClosed, StillOpening, AlreadySettled, NothingToClaim, ZeroAmount,
        WrongAsset, Slippage, NotRoot, CycleDetected, VotingOpen, VotingClosed, QuorumNotReached, ReserveTooSmall, ReserveInvariant,
        InvalidConfig, BadLineage, Unauthorized, MathOverflow,
    ];
    match error_code(e) {
        Some(c) if c >= 6000 => all.iter().find(|x| code(**x) == c).map(|x| x.name()).unwrap_or(format!("Custom({c})")),
        Some(3012) => "AccountNotInitialized".into(),
        // A taken ticker: its mint and meme accounts exist, and the system program refuses to create them again.
        Some(0) => "MemeExists".into(),
        Some(c) => format!("Custom({c})"),
        None => format!("{e:?}"),
    }
}

/// "all", "half", "all:TICKER" of what `me` holds of the meme `m` (or of the named one), or a number of base units.
async fn amount(hub: &mut Hub, me: Pubkey, spec: &str, m: Pubkey) -> u64 {
    if let Some(t) = spec.strip_prefix("all:") {
        return hub.balance(&me, &mint_of(t)).await;
    }
    match spec {
        "all" => hub.balance(&me, &m).await,
        "half" => hub.balance(&me, &m).await / 2,
        n => n.parse().unwrap(),
    }
}

/// The state, by ticker and account name, every number as a decimal string.
async fn snapshot(hub: &mut Hub, names: &[String], owners: &[Pubkey], mints: &[(String, Pubkey)]) -> Value {
    let symbol_of = |k: &Pubkey| mints.iter().find(|(_, m)| m == k).map(|(s, _)| s.clone()).unwrap_or_default();
    let name_of = |k: &Pubkey| owners.iter().position(|o| o == k).map(|i| names[i].clone()).unwrap_or_else(|| k.to_string());
    let (mut memes, mut supply, mut balances, mut commitments, mut locks) = (Map::new(), Map::new(), Map::new(), Map::new(), Map::new());
    for (symbol, m) in mints {
        let x = hub.meme(m).await;
        memes.insert(symbol.clone(), json!({
            "parent": symbol_of(&x.parent), "creator": name_of(&x.creator), "settled": x.settled, "height": x.height,
            "openUntil": x.open_until.to_string(), "refTime": x.ref_time.to_string(), "reference": x.reference.to_string(),
            "vQuote": x.v_quote.to_string(), "vToken": x.v_token.to_string(), "floor": x.floor.to_string(),
            "batchQuote": x.batch_quote.to_string(), "batchTokens": x.batch_tokens.to_string(), "batchClaimed": x.batch_claimed.to_string(),
            "escrowed": x.escrowed.to_string(), "creatorFees": x.creator_fees.to_string(), "protocolFees": x.protocol_fees.to_string(),
        }));
        supply.insert(symbol.clone(), json!(hub.supply(m).await.to_string()));
        for (i, owner) in owners.iter().enumerate() {
            let b = hub.balance(owner, m).await;
            if b > 0 {
                balances.insert(format!("{}|{symbol}", names[i]), json!(b.to_string()));
            }
            if let Some(c) = hub.commitment(m, owner).await {
                commitments.insert(format!("{symbol}|{}", names[i]), json!({ "committed": c.committed.to_string(), "claimed": c.claimed.to_string() }));
            }
        }
    }
    let mut unions = vec![];
    for id in 0..hub.config().await.union_count {
        let u = hub.union(id).await;
        unions.push(json!({ "meme": symbol_of(&u.meme), "target": symbol_of(&u.target), "deadline": u.deadline.to_string(), "executed": u.executed, "locked": u.locked.to_string() }));
        for (i, owner) in owners.iter().enumerate() {
            if let Some(l) = hub.lock(id, owner).await.filter(|l| l.amount > 0) {
                locks.insert(format!("{id}|{}", names[i]), json!(l.amount.to_string()));
            }
        }
    }
    let vault = hub.account(vault_pda()).await.unwrap();
    let rent = hub.ctx.banks_client.get_rent().await.unwrap().minimum_balance(vault.data.len());
    json!({ "memes": memes, "supply": supply, "balances": balances, "commitments": commitments, "unions": unions, "locks": locks, "vault": (vault.lamports - rent).to_string() })
}

async fn replay(name: &str, file: &Path) {
    let scenario: Value = serde_json::from_str(&std::fs::read_to_string(file).unwrap()).unwrap();
    let p = &scenario["params"];
    let params = Params {
        open: p["openWindow"].as_i64().unwrap(),
        vest: p["vestWindow"].as_i64().unwrap(),
        spike: p["spikeShareBps"].as_u64().unwrap() as u16,
        vote: p["unionWindow"].as_i64().unwrap(),
        protocol: p["protocolFeeBps"].as_u64().unwrap() as u16,
    };
    // The last account is the protocol's fee recipient; it signs like any other account.
    let names: Vec<String> = scenario["accounts"].as_array().unwrap().iter().map(|a| a.as_str().unwrap().to_string()).collect();
    assert_eq!(names.last().map(String::as_str), p["feeRecipient"].as_str(), "the fee recipient is the last account");
    let mut hub = Hub::start(params, names.len() - 1).await;
    let treasury = solana_sdk::signature::Keypair::from_bytes(&hub.treasury.to_bytes()).unwrap();
    hub.users.push(treasury);
    let owners: Vec<Pubkey> = hub.users.iter().map(|k| k.pubkey()).collect();
    let actor = |n: &str| names.iter().position(|a| a == n).unwrap_or_else(|| panic!("unknown account {n}"));
    let mut mints: Vec<(String, Pubkey)> = vec![];
    let mint = |mints: &Vec<(String, Pubkey)>, s: &str| match mints.iter().find(|(k, _)| k == s) {
        Some(m) => m.1,
        None if s.is_empty() => Pubkey::default(),
        None => mint_of(s),
    };
    let mut trace = vec![];

    for step in scenario["steps"].as_array().unwrap() {
        if let Some(w) = step.get("warp") {
            hub.warp(w.as_i64().unwrap()).await;
            continue;
        }
        let s = |k: &str| step.get(k).and_then(|v| v.as_str()).unwrap_or("");
        let who = actor(s("actor"));
        let me = owners[who];
        let sol = if step.get("sol").is_some() { lamports(s("sol")) } else { s("lamports").parse().unwrap_or(0) };
        let min_out: u64 = s("minOut").parse().unwrap_or(0);
        let m = mint(&mints, s("meme"));
        let res: Result<(), BanksClientError> = match s("op") {
            "launch" => {
                let parent = step.get("parent").map(|p| mint(&mints, p.as_str().unwrap()));
                hub.launch_named(who, s("name"), s("symbol"), parent, sol).await.map(|k| mints.push((s("symbol").to_string(), k)))
            }
            "commitSol" => hub.commit_sol(who, m, sol).await,
            "commit" => {
                let a = amount(&mut hub, me, s("amount"), m).await;
                hub.commit_quote(who, m, a).await
            }
            "settle" => hub.settle(who, m).await,
            "claim" => hub.claim(who, m).await,
            "buySol" => hub.buy_sol(who, m, sol, min_out).await,
            "buy" => {
                let a = amount(&mut hub, me, s("amount"), m).await;
                hub.buy(who, m, a, min_out).await
            }
            "sell" => {
                let a = amount(&mut hub, me, s("amount"), m).await;
                hub.sell(who, m, a, min_out).await
            }
            "sellToSol" => {
                let a = amount(&mut hub, me, s("amount"), m).await;
                hub.sell_to_sol(who, m, a, min_out).await
            }
            "claimFees" => hub.claim_fees(Some(who), m, step["protocol"].as_bool().unwrap_or(false)).await,
            "proposeUnion" => hub.propose_union(who, m, mint(&mints, s("target"))).await.map(|_| ()),
            "lockUnion" => {
                let a = amount(&mut hub, me, s("amount"), Pubkey::default()).await;
                hub.lock_union(who, step["union"].as_u64().unwrap(), a).await
            }
            "unlockUnion" => hub.unlock_union(who, step["union"].as_u64().unwrap()).await,
            "executeUnion" => hub.execute_union(who, step["union"].as_u64().unwrap()).await,
            op => panic!("unknown op {op}"),
        };
        let result = match &res {
            Ok(()) => "ok".to_string(),
            Err(e) => error_name(e),
        };
        if let Some(expected) = step.get("expect").and_then(|v| v.as_str()) {
            assert_eq!(result, expected, "{name}, step {}: {step}", trace.len());
        }
        let state = snapshot(&mut hub, &names, &owners, &mints).await;
        trace.push(json!({ "result": result, "state": state }));
    }

    let out = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/cross-check");
    std::fs::create_dir_all(&out).unwrap();
    std::fs::write(out.join(format!("{name}.json")), serde_json::to_string(&json!({ "steps": trace })).unwrap()).unwrap();
}

fn scenarios() -> Vec<(String, PathBuf)> {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let mut out = vec![("demo".to_string(), dir.join("../../../web/src/seed.json"))];
    let mut walks: Vec<PathBuf> = std::fs::read_dir(dir.join("tests/scenarios")).map(|d| d.map(|e| e.unwrap().path()).collect()).unwrap_or_default();
    walks.sort();
    for p in walks {
        out.push((p.file_stem().unwrap().to_string_lossy().into_owned(), p));
    }
    out
}

#[tokio::test]
async fn scenarios_replay() {
    for (name, file) in scenarios() {
        replay(&name, &file).await;
    }
}
