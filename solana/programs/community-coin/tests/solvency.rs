//! Random walks over every action, checking the hub's books at each step and at the end, when everybody has left:
//!
//!  SOL     vault lamports above its rent = every root's reserve + every open root batch + every root's SOL fees
//!  tokens  for each meme X: tokens its curve has sold (VIRTUAL - v_token) = tokens in wallets + tokens locked in
//!          votes + opening tokens not yet claimed + what X's variants hold in X (reserves, open batches, fees)
//!
//! Exact equalities: every rounding in the program goes to a reserve, and the books must still balance to the unit.

mod common;
use anchor_lang::prelude::Pubkey;
use common::*;
use community_coin::math::VIRTUAL_TOKENS;
use solana_sdk::signer::Signer;

struct Rng(u32);
impl Rng {
    fn next(&mut self) -> f64 {
        self.0 = self.0.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        self.0 as f64 / 4_294_967_296.0
    }
    fn pick(&mut self, n: usize) -> usize {
        (self.next() * n as f64) as usize % n
    }
}

async fn check_books(hub: &mut Hub, mints: &[Pubkey], holders: &[Pubkey]) {
    let mut memes = vec![];
    for m in mints {
        memes.push(hub.meme(m).await);
    }
    // SOL
    let vault = hub.account(vault_pda()).await.unwrap();
    let rent = hub.ctx.banks_client.get_rent().await.unwrap().minimum_balance(vault.data.len());
    let mut owed: u128 = 0;
    for m in memes.iter().filter(|m| m.parent == Pubkey::default()) {
        owed += (m.v_quote - m.floor) + if m.settled { 0 } else { m.batch_quote } + m.creator_fees as u128 + m.protocol_fees as u128;
    }
    assert_eq!((vault.lamports - rent) as u128, owed, "SOL books");
    // Tokens
    for x in memes.iter() {
        let mut held: u128 = 0;
        for c in memes.iter().filter(|c| c.parent == x.mint) {
            held += (c.v_quote - c.floor) + if c.settled { 0 } else { c.batch_quote } + c.creator_fees as u128 + c.protocol_fees as u128;
        }
        let supply = hub.supply(&x.mint).await as u128;
        let mut wallets: u128 = 0;
        for h in holders {
            wallets += hub.balance(h, &x.mint).await as u128;
        }
        assert_eq!(wallets, supply, "{}: every token is in a wallet", x.symbol);
        let sold = VIRTUAL_TOKENS - x.v_token;
        let unclaimed = x.batch_tokens - x.batch_claimed;
        assert_eq!(sold, supply + x.escrowed as u128 + unclaimed + held, "{} token books", x.symbol);
    }
}

async fn walk(seed: u32) {
    let mut hub = Hub::start(Params { vest: 1800, ..Params::default() }, 9).await;
    let mut rng = Rng(seed);
    let creators = [0usize, 1, 2];
    let traders = [3usize, 4, 5, 6, 7, 8];
    let mut holders: Vec<Pubkey> = (0..9).map(|i| hub.user(i).pubkey()).collect();
    holders.push(hub.treasury.pubkey());

    let a = hub.launch(creators[0], "AAA", None, 30 * SOL).await.unwrap();
    let b = hub.launch(creators[1], "BBB", None, 15 * SOL).await.unwrap();
    let a1 = hub.launch(creators[2], "AAA1", Some(a), 0).await.unwrap();
    let b1 = hub.launch(creators[1], "BBB1", Some(b), 0).await.unwrap();
    hub.commit_sol(traders[0], a, 9 * SOL).await.unwrap();
    let mut mints = vec![a, b, a1, b1];
    check_books(&mut hub, &mints, &holders).await;
    hub.warp(OPEN + 600).await; // a third of the vesting has run
    for (i, m) in [(creators[0], a), (creators[1], b), (traders[0], a)] {
        hub.claim(i, m).await.unwrap();
    }
    // AAA is trading: a new variant two levels down can take SOL in its opening, routed through AAA and AAA1.
    let a2 = hub.launch(creators[2], "AAA2", Some(a1), 6 * SOL).await.unwrap();
    hub.commit_sol(traders[1], a2, 3 * SOL).await.unwrap();
    mints.push(a2);
    check_books(&mut hub, &mints, &holders).await;
    let mut union: Option<u64> = None;

    for step in 0..70 {
        hub.warp(60 + (rng.next() * 900.0) as i64).await;
        let who = traders[rng.pick(traders.len())];
        let t = mints[rng.pick(mints.len())];
        let me = hub.user(who).pubkey();
        let bal = hub.balance(&me, &t).await;
        let r = rng.next();
        let res = if r < 0.4 || bal == 0 {
            hub.buy_sol(who, t, (SOL as f64 * (0.5 + rng.next() * 20.0)) as u64, 0).await
        } else if r < 0.65 {
            hub.sell_to_sol(who, t, bal * (1 + rng.pick(100) as u64) / 100, 0).await
        } else if r < 0.8 {
            hub.sell(who, t, bal * (1 + rng.pick(100) as u64) / 100, 0).await
        } else {
            // Buy with the parent token when the trader holds some, else claim whatever has vested.
            let parent = hub.meme(&t).await.parent;
            let pb = if parent == Pubkey::default() { 0 } else { hub.balance(&me, &parent).await };
            if pb > 0 { hub.buy(who, t, pb / 2 + 1, 0).await } else { hub.claim(who, t).await }
        };
        if let Err(e) = res {
            let c = error_code(&e);
            let benign = [community_coin::errors::CoinError::StillOpening, community_coin::errors::CoinError::ZeroAmount, community_coin::errors::CoinError::NothingToClaim]
                .iter()
                .any(|x| c == Some(code(*x)))
                || c == Some(3012); // claiming without having committed: no commitment account
            assert!(benign, "step {step}: unexpected failure {e:?}");
        }
        if step == 25 {
            // A union: BBB asks to join AAA1's family; every holder votes, then takes the tokens back.
            hub.buy_sol(traders[2], b, 40 * SOL, 0).await.unwrap();
            let id = hub.propose_union(traders[2], b, a1).await.unwrap();
            for i in 0..9 {
                let k = hub.user(i).pubkey();
                let held = hub.balance(&k, &b).await;
                if held > 0 {
                    hub.lock_union(i, id, held).await.unwrap();
                }
            }
            check_books(&mut hub, &mints, &holders).await;
            union = Some(id);
        }
        if step == 26 {
            hub.warp(VOTE + 1).await;
            hub.execute_union(traders[3], union.unwrap()).await.unwrap();
            for i in 0..9 {
                let k = hub.user(i).pubkey();
                if hub.lock(union.unwrap(), &k).await.map(|l| l.amount).unwrap_or(0) > 0 {
                    hub.unlock_union(i, union.unwrap()).await.unwrap();
                }
            }
        }
        if step % 10 == 0 {
            check_books(&mut hub, &mints, &holders).await;
        }
    }
    check_books(&mut hub, &mints, &holders).await;

    // Everybody leaves, deepest memes first; creators and the protocol cash out their fees as they go.
    let mut by_depth = vec![];
    for m in &mints {
        let d = hub.ancestors(m).await.len();
        by_depth.push((d, *m));
    }
    by_depth.sort_by(|x, y| y.0.cmp(&x.0));
    for _round in 0..6 {
        for &(_, m) in &by_depth {
            for c in 0..9 {
                let _ = hub.claim(c, m).await;
                let _ = hub.claim_fees(Some(c), m, false).await;
            }
            let _ = hub.claim_fees(None, m, true).await;
        }
        for &(_, m) in &by_depth {
            for s in 0..9 {
                let k = hub.user(s).pubkey();
                let bal = hub.balance(&k, &m).await;
                if bal > 0 {
                    hub.sell_to_sol(s, m, bal, 0).await.unwrap();
                }
            }
        }
        // The treasury sells the parent tokens its fees were paid in.
        let t = hub.treasury.pubkey();
        for &(_, m) in &by_depth {
            let bal = hub.balance(&t, &m).await;
            if bal > 0 {
                let kp = solana_sdk::signature::Keypair::from_bytes(&hub.treasury.to_bytes()).unwrap();
                hub.users.push(kp);
                let idx = hub.users.len() - 1;
                hub.sell_to_sol(idx, m, bal, 0).await.unwrap();
                hub.users.pop();
            }
        }
    }
    check_books(&mut hub, &mints, &holders).await;
    for m in &mints {
        assert_eq!(hub.supply(m).await, 0, "nobody holds anything any more");
    }
    let vault = hub.account(vault_pda()).await.unwrap();
    let rent = hub.ctx.banks_client.get_rent().await.unwrap().minimum_balance(vault.data.len());
    assert!(vault.lamports - rent < 100_000, "only rounding dust is left: {} lamports", vault.lamports - rent);
}

#[tokio::test]
async fn books_balance_seed_1() {
    walk(1).await;
}

#[tokio::test]
async fn books_balance_seed_42() {
    walk(42).await;
}

#[tokio::test]
async fn books_balance_seed_1337() {
    walk(1337).await;
}

#[tokio::test]
async fn books_balance_seed_2026() {
    walk(2026).await;
}
