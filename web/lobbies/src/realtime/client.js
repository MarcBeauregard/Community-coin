// The app's side of the realtime server: signs in (wallet or guest), keeps one socket per lobby open (reconnecting
// with backoff), follows the server's clock, and hands every message to the store.

/** A guest session: read-only, for people without a wallet yet. */
export async function guestSession(base) {
  const r = await fetch(`${base}/auth/guest`, { method: "POST" });
  if (!r.ok) throw new Error("Guests are not allowed on this server");
  return (await r.json()).token;
}

/** Sign-In With Solana: the wallet signs the server's message (wallet: `{ publicKey, signMessage }`, as Phantom). */
export async function walletSession(base, wallet, messageFor) {
  const { nonce, issuedAt, domain } = await (await fetch(`${base}/auth/nonce`)).json();
  const address = wallet.publicKey.toBase58();
  const message = new TextEncoder().encode(messageFor(domain, address, nonce, issuedAt));
  const { signature } = await wallet.signMessage(message);
  const sig = btoa(String.fromCharCode(...(signature.signature ?? signature)));
  const r = await fetch(`${base}/auth/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address, nonce, signature: sig }) });
  if (!r.ok) throw new Error((await r.json()).error);
  return (await r.json()).token;
}

export function connectLobby({ base, lobby, token, onMessage, WebSocketImpl = globalThis.WebSocket }) {
  const wsBase = base.replace(/^http/, "ws");
  let ws = null;
  let offset = 0;
  let retry = 0;
  let closed = false;
  const queue = [];
  function open() {
    ws = new WebSocketImpl(`${wsBase}/ws?lobby=${lobby}&token=${encodeURIComponent(token)}`);
    ws.onopen = () => {
      retry = 0;
      while (queue.length) ws.send(queue.shift());
      onMessage({ t: "open" });
    };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (typeof m.now === "number" && (m.t === "hello" || m.t === "clock")) offset = m.now - Date.now();
      onMessage(m);
    };
    ws.onclose = (e) => {
      onMessage({ t: "closed", code: e.code, reason: e.reason });
      // 44xx are the server's refusals (sign in, unknown lobby, flooding): retrying would not help.
      if (!closed && !(e.code >= 4400 && e.code < 4500)) setTimeout(open, Math.min(30000, 500 * 2 ** retry++));
    };
  }
  open();
  const send = (m) => {
    const s = JSON.stringify(m);
    if (ws.readyState === 1) ws.send(s);
    else queue.push(s);
  };
  return {
    chat: (text) => send({ t: "chat", text }),
    listen: (on) => send({ t: "listen", on }),
    ping: () => send({ t: "ping", echo: Date.now() }),
    /** The server's time now, in ms. */
    now: () => Date.now() + offset,
    close() { closed = true; ws.close(); },
  };
}
