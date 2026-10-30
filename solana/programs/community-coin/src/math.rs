//! The hub's arithmetic, kept apart from the accounts so it reads like the Solidity contract it was ported from:
//! virtual constant-product curves, rounded in favour of the reserve, a reference price that closes the gap to
//! the spot price over an hour, the spike share and the rescale that keeps a curve's shape when its reserve
//! changes. Every intermediate product that can exceed 128 bits goes through U256. web/src/protocol.js replays
//! these same steps in the browser and must stay identical to the integer.

use crate::errors::CoinError;
use crate::state::Meme;
use anchor_lang::prelude::*;

mod wide {
    uint::construct_uint! {
        pub struct U256(4);
    }
}
pub use wide::U256;

/// Token side of every curve: 1 billion tokens with 6 decimals. Supply tends to it but never reaches it.
pub const VIRTUAL_TOKENS: u128 = 1_000_000_000 * 1_000_000;
/// Virtual SOL a root curve starts with (sets the launch price): 30 SOL, in lamports.
pub const ROOT_VIRTUAL_QUOTE: u128 = 30_000_000_000;
/// Virtual parent tokens a variant curve starts with: 1 million parent tokens.
pub const CHILD_VIRTUAL_QUOTE: u128 = 1_000_000 * 1_000_000;
pub const FEE_BPS: u128 = 100;
pub const BPS: u128 = 10_000;
pub const MAX_PROTOCOL_FEE_BPS: u16 = 50;
pub const REF_WINDOW: i64 = 3600;
/// Below this many outstanding base units (0.001 token) nobody is left to receive a spike share.
pub const DUST_TOKENS: u128 = 1_000;
/// Prices are quote base units per token base unit, scaled by 1e18.
pub const PRICE_SCALE: u128 = 1_000_000_000_000_000_000;

pub fn mul_div(a: u128, b: u128, c: u128) -> Result<u128> {
    let r = U256::from(a) * U256::from(b) / U256::from(c);
    require!(r <= U256::from(u128::MAX), CoinError::MathOverflow);
    Ok(r.as_u128())
}

pub fn mul_div_ceil(a: u128, b: u128, c: u128) -> Result<u128> {
    let p = U256::from(a) * U256::from(b);
    let r = (p + U256::from(c) - U256::one()) / U256::from(c);
    require!(r <= U256::from(u128::MAX), CoinError::MathOverflow);
    Ok(r.as_u128())
}

/// Floor of the square root, like OpenZeppelin's Math.sqrt.
pub fn sqrt(n: U256) -> U256 {
    if n < U256::from(2u8) {
        return n;
    }
    let mut x = n;
    let mut y = (x + U256::one()) / 2;
    while y < x {
        x = y;
        y = (x + n / x) / 2;
    }
    x
}

/// Constant product, rounded in favour of the reserve.
pub fn buy_out(v_quote: u128, v_token: u128, quote_in: u128) -> Result<(u128, u128, u128)> {
    let new_v_quote = v_quote.checked_add(quote_in).ok_or(CoinError::MathOverflow)?;
    let new_v_token = mul_div_ceil(v_quote, v_token, new_v_quote)?;
    Ok((v_token - new_v_token, new_v_quote, new_v_token))
}

pub fn sell_out(v_quote: u128, v_token: u128, tokens_in: u128) -> Result<(u128, u128, u128)> {
    let new_v_token = v_token.checked_add(tokens_in).ok_or(CoinError::MathOverflow)?;
    let new_v_quote = mul_div_ceil(v_quote, v_token, new_v_token)?;
    Ok((v_quote - new_v_quote, new_v_quote, new_v_token))
}

pub fn spot(v_quote: u128, v_token: u128) -> Result<u128> {
    mul_div(v_quote, PRICE_SCALE, v_token)
}

/// The reference price a trade would be measured against now: it closes the gap to the spot price linearly.
pub fn ref_now(m: &Meme, v_quote: u128, v_token: u128, now: i64) -> Result<u128> {
    let s = spot(v_quote, v_token)?;
    if !m.settled {
        return Ok(s);
    }
    let elapsed = now - m.ref_time;
    if elapsed >= REF_WINDOW {
        return Ok(s);
    }
    let e = elapsed as u128;
    let w = REF_WINDOW as u128;
    if s > m.reference {
        Ok(m.reference + mul_div(s - m.reference, e, w)?)
    } else {
        Ok(m.reference - mul_div(m.reference - s, e, w)?)
    }
}

pub fn reset_ref(m: &mut Meme, now: i64) -> Result<()> {
    m.reference = spot(m.v_quote, m.v_token)?;
    m.ref_time = now;
    Ok(())
}

pub fn update_ref(m: &mut Meme, now: i64) -> Result<()> {
    m.reference = ref_now(m, m.v_quote, m.v_token, now)?;
    m.ref_time = now;
    Ok(())
}

/// Re-prices the curve so that its real reserve becomes `new_reserve` without changing its shape.
pub fn rescale(m: &mut Meme, new_reserve: u128) -> Result<()> {
    let reserve = m.v_quote - m.floor;
    let new_floor = mul_div(m.floor, new_reserve, reserve)?;
    m.reference = mul_div(m.reference, new_reserve, reserve)?;
    m.floor = new_floor;
    m.v_quote = new_floor + new_reserve;
    Ok(())
}

pub fn nobody_left(reserve_after: u128, v_token_after: u128) -> bool {
    reserve_after == 0 || VIRTUAL_TOKENS - v_token_after <= DUST_TOKENS
}

/// `spike_bps` of what the part of a sale executed above the reference price fetches beyond that price.
pub fn spike_share(v_quote: u128, v_token: u128, reference: u128, mut tokens_in: u128, mut gross: u128, spike_bps: u128) -> Result<u128> {
    let s = spot(v_quote, v_token)?;
    if reference == 0 || s <= reference {
        return Ok(0);
    }
    let ratio = U256::from(s) * U256::from(PRICE_SCALE) * U256::from(PRICE_SCALE) / U256::from(reference);
    let root = sqrt(ratio);
    let scaled = U256::from(v_token) * root / U256::from(PRICE_SCALE);
    require!(scaled <= U256::from(u128::MAX), CoinError::MathOverflow);
    let above_ref = scaled.as_u128() - v_token;
    if tokens_in > above_ref {
        tokens_in = above_ref;
        gross = sell_out(v_quote, v_token, above_ref)?.0;
    }
    let at_ref = mul_div(tokens_in, reference, PRICE_SCALE)?;
    Ok(if gross > at_ref { (gross - at_ref) * spike_bps / BPS } else { 0 })
}

/// Closes the opening: the whole batch buys on the curve at once and its price becomes the first reference.
pub fn settle(m: &mut Meme, now: i64) -> Result<()> {
    require!(!m.settled, CoinError::AlreadySettled);
    require!(now >= m.open_until, CoinError::StillOpening);
    m.settled = true;
    if m.batch_quote > 0 {
        let (out, vq, vt) = buy_out(m.v_quote, m.v_token, m.batch_quote)?;
        m.batch_tokens = out;
        m.v_quote = vq;
        m.v_token = vt;
    }
    reset_ref(m, now)
}

pub fn tradable(m: &mut Meme, now: i64) -> Result<bool> {
    if !m.settled {
        settle(m, now)?;
        return Ok(true);
    }
    Ok(false)
}

/// What one trade on one curve did, in that curve's quote asset (`token` side in its own tokens).
#[derive(Clone, Copy, Debug, Default)]
pub struct Hop {
    pub quote_amount: u128,
    pub token_amount: u128,
    pub fee: u128,
    pub protocol_fee: u128,
    pub spike: u128,
    pub out: u128,
    pub settled_now: bool,
}

/// The fee of a trade: 1% of it, of which `protocol_bps` of the trade goes to the protocol and the rest to the
/// creator. Both are recorded on the meme itself, in its quote asset.
pub fn take_fee(m: &mut Meme, amount: u128, protocol_bps: u128) -> Result<(u128, u128)> {
    let fee = amount * FEE_BPS / BPS;
    let to_protocol = amount * protocol_bps / BPS;
    m.protocol_fees = m.protocol_fees.checked_add(to_protocol as u64).ok_or(CoinError::MathOverflow)?;
    m.creator_fees = m.creator_fees.checked_add((fee - to_protocol) as u64).ok_or(CoinError::MathOverflow)?;
    Ok((fee, to_protocol))
}

pub fn buy_hop(m: &mut Meme, quote_in: u128, take_fees: bool, protocol_bps: u128, now: i64) -> Result<Hop> {
    let settled_now = tradable(m, now)?;
    update_ref(m, now)?;
    let (fee, protocol_fee) = if take_fees { take_fee(m, quote_in, protocol_bps)? } else { (0, 0) };
    let (out, vq, vt) = buy_out(m.v_quote, m.v_token, quote_in - fee)?;
    m.v_quote = vq;
    m.v_token = vt;
    Ok(Hop { quote_amount: quote_in, token_amount: out, fee, protocol_fee, spike: 0, out, settled_now })
}

pub fn sell_hop(m: &mut Meme, tokens_in: u128, spike_bps: u128, protocol_bps: u128, now: i64) -> Result<Hop> {
    let settled_now = tradable(m, now)?;
    update_ref(m, now)?;
    let (v_quote, v_token) = (m.v_quote, m.v_token);
    let (gross, new_v_quote, new_v_token) = sell_out(v_quote, v_token, tokens_in)?;
    require!(new_v_quote >= m.floor, CoinError::ReserveInvariant);
    m.v_quote = new_v_quote;
    m.v_token = new_v_token;
    let (fee, protocol_fee) = take_fee(m, gross, protocol_bps)?;
    let reserve = m.v_quote - m.floor;
    let spike = if nobody_left(reserve, m.v_token) { 0 } else { spike_share(v_quote, v_token, m.reference, tokens_in, gross, spike_bps)? };
    if spike > 0 {
        rescale(m, reserve + spike)?;
    }
    Ok(Hop { quote_amount: gross, token_amount: tokens_in, fee, protocol_fee, spike, out: gross - fee - spike, settled_now })
}

/// Part of a batch share unlocked so far. Only called once the opening is over.
pub fn vested(m: &Meme, share: u128, vest_window: i64, now: i64) -> Result<u128> {
    if share == 0 || m.batch_quote == 0 {
        return Ok(0);
    }
    let total = mul_div(m.batch_tokens, share, m.batch_quote)?;
    let elapsed = now - m.open_until;
    if elapsed >= vest_window {
        Ok(total)
    } else {
        mul_div(total, elapsed as u128, vest_window as u128)
    }
}

/// Canonical key of a ticker: case, punctuation and common leetspeak folded away, so "PNUT", "$pnut", "P.N.U.T"
/// and "PNU7" are the same meme. The meme's mint address is derived from it, so a duplicate cannot exist.
pub fn symbol_key(symbol: &str) -> Result<Vec<u8>> {
    let raw = symbol.as_bytes();
    require!(!raw.is_empty() && raw.len() <= 32, CoinError::InvalidSymbol);
    let mut key = Vec::with_capacity(16);
    for &b in raw {
        let mut c = b;
        if c.is_ascii_lowercase() {
            c -= 0x20;
        }
        c = match c {
            b'0' => b'O',
            b'1' => b'I',
            b'3' => b'E',
            b'4' => b'A',
            b'5' => b'S',
            b'7' => b'T',
            _ => c,
        };
        if c.is_ascii_uppercase() || c.is_ascii_digit() {
            key.push(c);
        }
    }
    require!(!key.is_empty() && key.len() <= 16, CoinError::InvalidSymbol);
    Ok(key)
}
