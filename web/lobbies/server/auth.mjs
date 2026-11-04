// Sign-In With Solana: the server hands out a one-time nonce, the wallet signs a readable message containing it
// (ed25519, as Phantom's signMessage does), and the server answers with a session token (HMAC-signed, expiring).
// The token is what the realtime socket and the clan endpoints check; the wallet address in it is the identity.

import { createHmac, createPublicKey, randomBytes, timingSafeEqual, verify } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { signInMessage } from "../src/realtime/siws.js";

const NONCE_TTL = 5 * 60 * 1000;
const SESSION_TTL = 24 * 3600 * 1000; // a guest
const WALLET_TTL = 30 * 24 * 3600 * 1000; // a signed-in wallet: one signature a month, not a visit
const MAX_NONCES = 100_000;
// DER prefix of an Ed25519 SubjectPublicKeyInfo; the 32 raw key bytes follow it.
const ED25519_SPKI = Buffer.from("302a300506032b6570032100", "hex");

export { signInMessage };

export function createAuth({ secret = randomBytes(32), domain = "lobbies.communitycoin", uri = `https://${domain}`, chain = "solana:mainnet", now = () => Date.now() } = {}) {
  const nonces = new Map(); // nonce -> { at, domain, uri }
  const mac = (body) => createHmac("sha256", secret).update(body).digest("base64url");

  return {
    domain,
    uri,
    chain,
    /**
     * A one-time nonce. `site` (`{ domain, uri }`): the page asking, when the server lets it name itself (only an
     * allowed origin, see server.mjs), so the wallet shows the site the person is on; the signature is bound to it.
     */
    nonce(site = null) {
      const n = randomBytes(16).toString("hex");
      const t = now();
      // Expired nonces go first (oldest at the front of the map); a flood beyond the cap is refused.
      for (const [k, v] of nonces) { if (t - v.at <= NONCE_TTL) break; nonces.delete(k); }
      if (nonces.size >= MAX_NONCES) throw new Error("Too many sign-ins in progress");
      const d = site ?? { domain, uri };
      nonces.set(n, { at: t, ...d });
      return { nonce: n, issuedAt: t, domain: d.domain, uri: d.uri, chain };
    },
    /** Checks a signed sign-in message; returns a session token, or throws with the reason. */
    verify({ address, nonce, signature }) {
      const held = nonces.get(nonce);
      if (held === undefined || now() - held.at > NONCE_TTL) throw new Error("Unknown or expired nonce");
      const issuedAt = held.at;
      nonces.delete(nonce); // one use
      let raw;
      try { raw = new PublicKey(address).toBytes(); } catch { throw new Error("Not a Solana address"); }
      const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI, Buffer.from(raw)]), format: "der", type: "spki" });
      const message = Buffer.from(signInMessage(held.domain, address, nonce, issuedAt, { uri: held.uri, chain }));
      if (!verify(null, message, key, Buffer.from(signature, "base64"))) throw new Error("Bad signature");
      return this.issue(address);
    },
    issue(address, { guest = false } = {}) {
      const body = Buffer.from(JSON.stringify({ sub: address, guest, exp: now() + (guest ? SESSION_TTL : WALLET_TTL) })).toString("base64url");
      return `${body}.${mac(body)}`;
    },
    /** The session in a token, or null if it is forged or expired. */
    session(token) {
      const [body, sig] = String(token ?? "").split(".");
      if (!body || !sig) return null;
      const want = Buffer.from(mac(body));
      const got = Buffer.from(sig);
      if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
      const s = JSON.parse(Buffer.from(body, "base64url").toString());
      return s.exp > now() ? s : null;
    },
  };
}
