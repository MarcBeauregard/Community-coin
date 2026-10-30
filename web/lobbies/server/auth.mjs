// Sign-In With Solana: the server hands out a one-time nonce, the wallet signs a readable message containing it
// (ed25519, as Phantom's signMessage does), and the server answers with a session token (HMAC-signed, expiring).
// The token is what the realtime socket and the clan endpoints check; the wallet address in it is the identity.

import { createHmac, createPublicKey, randomBytes, timingSafeEqual, verify } from "node:crypto";
import { PublicKey } from "@solana/web3.js";

const NONCE_TTL = 5 * 60 * 1000;
const SESSION_TTL = 24 * 3600 * 1000;
// DER prefix of an Ed25519 SubjectPublicKeyInfo; the 32 raw key bytes follow it.
const ED25519_SPKI = Buffer.from("302a300506032b6570032100", "hex");

/** The exact text a wallet signs. Readable, bound to the domain and the nonce. */
export function signInMessage(domain, address, nonce, issuedAt) {
  return `${domain} wants you to sign in with your Solana account:\n${address}\n\nSign in to Community Coin lobbies.\n\nNonce: ${nonce}\nIssued At: ${new Date(issuedAt).toISOString()}`;
}

export function createAuth({ secret = randomBytes(32), domain = "lobbies.communitycoin", now = () => Date.now() } = {}) {
  const nonces = new Map(); // nonce -> issuedAt
  const mac = (body) => createHmac("sha256", secret).update(body).digest("base64url");

  return {
    domain,
    nonce() {
      const n = randomBytes(16).toString("hex");
      const t = now();
      nonces.set(n, t);
      for (const [k, at] of nonces) if (t - at > NONCE_TTL) nonces.delete(k);
      return { nonce: n, issuedAt: t };
    },
    /** Checks a signed sign-in message; returns a session token, or throws with the reason. */
    verify({ address, nonce, signature }) {
      const issuedAt = nonces.get(nonce);
      if (issuedAt === undefined || now() - issuedAt > NONCE_TTL) throw new Error("Unknown or expired nonce");
      nonces.delete(nonce); // one use
      let raw;
      try { raw = new PublicKey(address).toBytes(); } catch { throw new Error("Not a Solana address"); }
      const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI, Buffer.from(raw)]), format: "der", type: "spki" });
      const message = Buffer.from(signInMessage(domain, address, nonce, issuedAt));
      if (!verify(null, message, key, Buffer.from(signature, "base64"))) throw new Error("Bad signature");
      return this.issue(address);
    },
    issue(address, { guest = false } = {}) {
      const body = Buffer.from(JSON.stringify({ sub: address, guest, exp: now() + SESSION_TTL })).toString("base64url");
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
