// The app's side of the realtime server: signs in (wallet or guest), keeps one socket per lobby open (reconnecting
// with backoff), follows the server's clock, and hands every message to the store. Clans get their own socket.

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

/** A dev session (servers started with --dev-sessions only): tests and local development as a named wallet. */
export async function devSession(base, sub) {
  const r = await fetch(`${base}/auth/dev`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sub }) });
  if (!r.ok) throw new Error("Dev sessions are off on this server");
  return (await r.json()).token;
}

export function connectLobby({ base, lobby, token, onMessage, WebSocketImpl = globalThis.WebSocket }) {
  const link = connect({ url: `${base.replace(/^http/, "ws")}/ws?lobby=${lobby}&token=${encodeURIComponent(token)}`, onMessage, WebSocketImpl });
  return {
    chat: (text) => link.send({ t: "chat", text }),
    listen: (on) => link.send({ t: "listen", on }),
    hand: (up) => link.send({ t: "hand", up }),
    bring: (user) => link.send({ t: "bring", user }),
    down: (user) => link.send({ t: "down", user }),
    cohost: (user, on) => link.send({ t: "cohost", user, on }),
    ping: () => link.send({ t: "ping", echo: Date.now() }),
    /** The server's time now, in ms. */
    now: link.now,
    close: link.close,
  };
}

/** A clan's channels: post, react, delete, report, and the moderators' tools. Members only (4403 otherwise). */
export function connectClan({ base, mint, token, onMessage, WebSocketImpl = globalThis.WebSocket }) {
  const link = connect({ url: `${base.replace(/^http/, "ws")}/ws?clan=${encodeURIComponent(mint)}&token=${encodeURIComponent(token)}`, onMessage, WebSocketImpl });
  return {
    post: (ch, text, media = [], reply = null) => link.send({ t: "post", ch, text, media, reply }),
    react: (id, emoji, on) => link.send({ t: "react", id, emoji, on }),
    remove: (id) => link.send({ t: "delete", id }),
    report: (id) => link.send({ t: "report", id }),
    restore: (id) => link.send({ t: "restore", id }),
    mute: (user, minutes) => link.send({ t: "mute", user, minutes }),
    slow: (ch, sec) => link.send({ t: "slow", ch, sec }),
    mod: (user, on) => link.send({ t: "mod", user, on }),
    campfire: (on) => link.send({ t: "campfire", on }),
    history: (ch, before) => link.send({ t: "history", ch, before }),
    /** Uploads a file to the clan; resolves to `{ id, type, size }` to attach to a post. */
    async upload(file) {
      const r = await fetch(`${base}/clans/${encodeURIComponent(mint)}/media`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: file });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error);
      return body;
    },
    mediaUrl: (id) => `${base}/media/${id}?token=${encodeURIComponent(token)}`,
    close: link.close,
  };
}

function connect({ url, onMessage, WebSocketImpl }) {
  let ws = null;
  let offset = 0;
  let retry = 0;
  let closed = false;
  const queue = [];
  function open() {
    ws = new WebSocketImpl(url);
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
  return { send, now: () => Date.now() + offset, close() { closed = true; ws.close(); } };
}

/**
 * An SFU access token for a lobby's stage or a clan's Campfire: `{ url, room, token, canPublish }`. Ask again when
 * the stage says your role changed. 503 means the server has no voice configured.
 */
export async function voiceToken(base, token, where) {
  const r = await fetch(`${base}/voice/token`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(where) });
  const body = await r.json();
  if (!r.ok) throw Object.assign(new Error(body.error), { status: r.status });
  return body;
}
