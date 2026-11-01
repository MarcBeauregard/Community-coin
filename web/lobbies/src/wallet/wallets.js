// Solana wallets in the browser: the ones installed (Phantom, Solflare, Backpack, or any other that injects
// `window.solana`), connecting to one, and proving the address with a signed message (Sign-In With Solana). No
// transaction is ever signed here and nothing costs anything: connecting only shares the public address.

const KNOWN = [
  { id: "phantom", name: "Phantom", url: "https://phantom.com/download", find: () => window.phantom?.solana ?? (window.solana?.isPhantom ? window.solana : null) },
  { id: "solflare", name: "Solflare", url: "https://solflare.com/download", find: () => window.solflare ?? null },
  { id: "backpack", name: "Backpack", url: "https://backpack.app/download", find: () => window.backpack?.solana ?? window.backpack ?? null },
];
const LAST = "lobbies.wallet";

const safe = (fn, fallback = null) => { try { return fn(); } catch { return fallback; } };

/** The wallets to offer: each known one (installed or not), then any other injected provider. */
export function detectWallets() {
  const list = KNOWN.map((w) => ({ id: w.id, name: w.name, url: w.url, provider: safe(w.find) }));
  const other = safe(() => window.solana);
  if (other && !list.some((w) => w.provider === other)) list.push({ id: "injected", name: other.name || "Browser wallet", url: null, provider: other });
  return list.map((w) => ({ ...w, installed: !!w.provider }));
}

/** Why a wallet call failed, in words a person reads. */
export function walletError(e, name) {
  const code = e?.code ?? e?.error?.code;
  const msg = String(e?.message ?? e ?? "");
  if (code === 4001 || /reject|denied|cancel|declin/i.test(msg)) return `You cancelled in ${name}. Nothing was shared.`;
  if (code === -32002 || /pending|already/i.test(msg)) return `${name} is already asking you something. Open it to finish.`;
  if (/locked|unlock/i.test(msg)) return `Unlock ${name}, then try again.`;
  if (/timeout|timed out/i.test(msg)) return `${name} didn’t answer. Open it and try again.`;
  return `${name} couldn’t connect. Try again, or pick another wallet.`;
}

const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`${what} timed out`)), ms))]);

/** Connects; resolves to the address (base58). `silent` reconnects only a wallet that already trusts this site. */
export async function connectWallet(wallet, { silent = false } = {}) {
  const p = wallet.provider;
  const r = await withTimeout(p.connect(silent ? { onlyIfTrusted: true } : undefined), silent ? 3000 : 120000, "connect");
  const key = r?.publicKey ?? p.publicKey;
  if (!key) throw new Error("No account");
  const address = typeof key === "string" ? key : key.toBase58();
  safe(() => localStorage.setItem(LAST, wallet.id));
  return address;
}

/** Asks the wallet to sign `text`; resolves to the signature bytes. */
export async function signText(wallet, text) {
  const out = await withTimeout(wallet.provider.signMessage(new TextEncoder().encode(text), "utf8"), 120000, "sign");
  return out?.signature ?? out;
}

export async function disconnectWallet(wallet) {
  safe(() => localStorage.removeItem(LAST));
  await safe(() => wallet?.provider?.disconnect?.());
}

/** The wallet this person used last time, if it is still installed. */
export function lastWallet() {
  const id = safe(() => localStorage.getItem(LAST));
  return id ? detectWallets().find((w) => w.id === id && w.installed) ?? null : null;
}

/** Follows account switches and disconnects made inside the wallet. Returns a function that stops following. */
export function watchWallet(wallet, { onAccount, onDisconnect }) {
  const p = wallet.provider;
  if (!p?.on) return () => {};
  const acc = (key) => (key ? onAccount(typeof key === "string" ? key : key.toBase58()) : onDisconnect());
  p.on("accountChanged", acc);
  p.on("disconnect", onDisconnect);
  return () => { safe(() => p.off?.("accountChanged", acc) ?? p.removeListener?.("accountChanged", acc)); safe(() => p.off?.("disconnect", onDisconnect) ?? p.removeListener?.("disconnect", onDisconnect)); };
}

/** A short form of an address for the screen: 7Hq4…k2Pf. */
export const shortAddress = (a) => (a && a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a ?? "");

/** The SOL balance of an address, from a cluster's JSON-RPC; null if it can't be read. */
export async function readBalance(rpc, address) {
  try {
    const r = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [address, { commitment: "confirmed" }] }) });
    const v = (await r.json())?.result?.value;
    return typeof v === "number" ? v / 1e9 : null;
  } catch {
    return null;
  }
}

/** An address drawn as a person: its own color, its first letters (no photo). */
export function addressPerson(address) {
  let h = 0;
  for (const c of address ?? "") h = (h * 31 + c.charCodeAt(0)) % 360;
  return { id: address, name: shortAddress(address), hue: h, src: null };
}

/** Each wallet's mark: its initial on its own color (their logos are theirs to use). */
export const WALLET_TINT = { phantom: "#ab9ff2", solflare: "#fc7227", backpack: "#e33e3f", injected: "#8e8e93" };
