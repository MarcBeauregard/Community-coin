// The demo store: plays one lobby hour in the browser. It holds the state, the actions the screens call and a one
// second clock. Money goes through the program's rules (lobby.js on chain/rules.js): pledges, withdrawals, moves,
// the lock, the launch and the refunds give the program's results, and receipts are read from its events. Wallet
// mode will send the same operations to the program instead.
//
// Scenes (`?scene=`) seed deterministic states for screenshots and tests; `?freeze` stops the clock.

import { CLANS, CROWD, CHATTER, ME, seedClanMessages, seedLobbyChat, message } from "./data.js";
import { HOUR, sol } from "../format.js";
import { connectLobby, connectClan, voiceToken, walletSession, guestSession } from "../realtime/client.js";
import { createAudio } from "../voice/audio.js";
import { detectWallets, connectWallet, signText, disconnectWallet, lastWallet, watchWallet, walletError, shortAddress, readBalance } from "../wallet/wallets.js";
import { createDemoLobby, ideasFrom, ideaMeta, myPledge, act, crank, launchSummary, lockedOf, liveLaunch, founderAllocation, toLamports, toSol, errorText, receiptFor } from "./lobby.js";

export const PHASES = [
  { id: "gather", label: "Gather", start: 0, end: 300, color: "var(--text)" },
  { id: "floor", label: "Propose & pledge", start: 300, end: 1800, color: "var(--sky)" },
  { id: "pledge", label: "Pledge", start: 1800, end: 3300, color: "var(--lime)" },
  { id: "lock", label: "Lock", start: 3300, end: 3600, color: "var(--amber)" },
];
export const PROPOSALS_CLOSE = 1800;
export const LOCK_AT = 3300;
export const START_ELAPSED = 1452; // the demo opens 24:12 into the hour
export const PROPOSE_BOND = 0.05;

export function phaseAt(elapsed) {
  if (elapsed >= HOUR) return "done";
  return PHASES.find((p) => elapsed < p.end).id;
}

function initialState() {
  const chain = createDemoLobby();
  const meta = ideaMeta();
  return {
    chain, // the lobby on the program's rules (mutable; state changes are announced by replacing `ideas`)
    meta,
    receipts: [], // newest first
    receipt: null, // the one the receipt sheet shows
    route: { screen: "discover" },
    elapsed: START_ELAPSED,
    beat: 0,
    ideas: ideasFrom(chain, meta),
    selected: "wif",
    amount: 1,
    pledge: null, // { id, amount }
    balance: 14.2,
    locked: null, // { winner, pot, total, voided } once the lobby is finalized
    launched: null,
    voice: { listening: false, hand: false, onStage: false, mic: true, invited: false },
    chat: seedLobbyChat(),
    draft: "",
    filter: "all",
    query: "",
    reminders: { cat: true },
    hosted: [],
    lobbyTab: "ideas",
    clans: CLANS.map((c) => ({ ...c })),
    clan: "bonk",
    channel: "memes",
    clanView: "list",
    read: {},
    clanMessages: seedClanMessages(),
    clanDraft: "",
    campfire: { joined: false, muted: false, deafened: false, sharing: false },
    showMembers: true,
    sheet: null,
    signing: false,
    toast: null,
    // The person's wallet: "none" | "connecting" | "signing" | "connected". `signedIn`: the server knows the address.
    wallet: { status: "none", id: null, name: null, address: null, error: null, signedIn: false, balance: null },
    audio: { status: "off", speaking: [], micOn: false, needsTap: false, error: null, room: null }, // live voice (voice/audio.js)
    connectFor: null, // why the connect sheet opened ("chat", "speak", "clan"), for its first line
  };
}

// SOL on an idea, ours included: the chain's number.
// A connected wallet for screenshots and tests only (scenes): never shown as a real wallet.
const SAMPLE_WALLET = { status: "connected", id: "phantom", name: "Phantom", address: "7Hq4dJ3xG1sT9bY2mQ5vRk8NwZcLp6EaFu4Kk2Pf", error: null, signedIn: false, balance: null };

export function pledgedOn(state, idea) {
  return idea.sol;
}

export function createStore({ scene, freeze } = {}) {
  let state = initialState();
  const subscribers = new Set();
  const timers = new Set();
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); };
  const set = (patch) => {
    state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
    subscribers.forEach((fn) => fn(state));
  };
  const toast = (text, tone = "lime") => {
    set({ toast: { text, tone, id: Math.random() } });
    const mine = state.toast.id;
    later(() => { if (state.toast && state.toast.id === mine) set({ toast: null }); }, 2800);
  };
  const chatLine = (line) => [...state.chat, line].slice(-60);

  // The lock and the launch come from the chain's crank; this turns its events into what the screens show. At the
  // lock our losing pledge and our bond come back; at 01:00 the winner launches.
  function settle(s) {
    const events = crank(s.chain, s.elapsed);
    if (!events.length) return {};
    const mine = events.filter((e) => e.user === ME || e.proposer === ME);
    const back = mine.reduce((n, e) => n + (e.event === "PledgeRefunded" || e.event === "BondReturned" ? toSol(e.amount) : 0), 0);
    const patch = { ideas: ideasFrom(s.chain, s.meta), pledge: myPledge(s.chain), locked: lockedOf(s.chain), balance: s.balance + back,
      receipts: [...mine.map((e) => receiptOf(e, s)).filter(Boolean), ...s.receipts] };
    const launched = launchSummary(s.chain);
    if (!launched || s.launched) return patch;
    const win = patch.ideas.find((d) => d.id === launched.id);
    Object.assign(patch, { launched, sheet: null, signing: false });
    if (s.route.screen === "lobby") patch.route = { screen: "launch" };
    if (launched.founder) {
      patch.clans = [{ id: "new", name: win.name, ticker: win.ticker, hue: win.hue, logo: win.logo, members: launched.backers,
        born: "Born tonight", change: null, voice: 5, unread: 0, fresh: true, story: win.pitch }, ...s.clans];
    }
    return patch;
  }
  const receiptOf = (e, s) => receiptFor(e, s.chain);

  // ------------------------------------------------------------------ live (realtime server)
  // When connected, the server owns the clock, the race, the chat and the presence; the demo's crowd stops.
  let link = null;
  const LIVE_ERRORS = { SlowMode: "Slow mode: one message every 3 seconds.", SignInToChat: "Connect a wallet to chat.", EmptyMessage: "Write something first.", LobbyNotOpen: "The lobby is not open yet." };
  const short = (who) => (who.length > 20 ? `${who.slice(0, 4)}…${who.slice(-4)}` : who);
  // Live, everyone is who the server says, the person included (their wallet), with `mine` to say "you".
  const lineToChat = (line, you) => ({ who: line.from, mine: line.from === you, text: line.text });
  const raceIdeas = (rows, meta) => ideasFrom({ ideas: rows.map((r) => ({ ...r, pledged: BigInt(r.pledged), proposer: r.proposer ?? "" })) }, meta);
  // Live, the race on screen is the server's: a practice pledge never replaces it with the demo's numbers.
  const shownIdeas = (s) => (s.live ? s.ideas : ideasFrom(s.chain, s.meta));
  function onLive(m) {
    const s = state;
    switch (m.t) {
      case "hello":
        set({ live: { connected: true, lobby: m.lobby, inside: m.inside, listening: m.listening, opensAt: m.opensAt, you: m.you, guest: m.guest, race: m.race, stage: m.stage },
          elapsed: Math.floor((m.now - m.opensAt) / 1000), ideas: raceIdeas(m.race, s.meta), chat: m.chat.map((l) => lineToChat(l, m.you)), voice: { ...s.voice, onStage: !!m.stage?.speakers.includes(m.you) } });
        // A practice lobby: this wallet's pledge and practice SOL, as the server keeps them (across reloads).
        if (m.practice) set({ live: { ...state.live, practice: true }, pledge: m.guest ? null : liveMine(m), balance: m.guest ? 10 : toSol(BigInt(m.balance ?? "0")) }); // a guest sees the allowance they get by signing in
        // A late joiner gets what the crank already announced.
        if (m.locked) onLive({ t: "locked", ...m.locked });
        if (m.launch) onLive({ t: "launch", ...m.launch });
        break;
      case "race": {
        const rows = s.live.race.map((r) => m.ideas.find((x) => x.index === r.index) ?? r);
        for (const x of m.ideas) if (!rows.some((r) => r.index === x.index)) rows.push(x);
        set({ live: { ...s.live, race: rows }, ideas: raceIdeas(rows, s.meta) });
        break;
      }
      case "locked": {
        const win = m.winner === null ? null : s.live.race.find((r) => r.index === m.winner);
        set({ locked: { winner: win ? win.symbol : null, pot: win ? toSol(BigInt(win.pledged)) : 0, total: toSol(BigInt(m.total)), voided: !!m.voided } });
        break;
      }
      case "voided":
        set({ locked: { ...s.locked, voided: true } });
        toast("The winning ticker was taken elsewhere. No launch tonight: every pledge is refunded.", "white");
        break;
      case "launch":
        // The launch screen opens if the person was in the lobby, or had it open before a reload.
        set({ launched: liveLaunch(m, s.locked?.total ?? 0), route: s.route.screen === "lobby" || wantScreen === "launch" ? { screen: "launch" } : s.route, sheet: null });
        wantScreen = null;
        break;
      case "settled": {
        const amount = toSol(BigInt(m.amount));
        const l = s.launched;
        if (m.kind === "founder" && l) {
          set({ launched: { ...l, founder: true, rank: m.rank, myAmount: amount, myId: l.id, allocation: founderAllocation(l.pot, BigInt(m.amount)) },
            clans: [{ id: "new", name: m.name ?? s.ideas.find((d) => d.id === l.id)?.name ?? l.id, ticker: l.id.toUpperCase(), hue: s.ideas.find((d) => d.id === l.id)?.hue ?? 150,
              members: l.backers, born: "Born tonight", change: null, voice: 0, unread: 0, fresh: true, story: "" }, ...s.clans.filter((c) => c.id !== "new")] });
        } else if (m.kind === "refund") {
          set({ launched: l && { ...l, refund: amount, myAmount: amount } });
          toast(`${sol(amount)} refunded to your wallet`, "white");
        }
        break;
      }
      case "practice": {
        const op = pending;
        pending = null;
        const patch = { signing: false, pledge: liveMine(m), balance: toSol(BigInt(m.balance ?? "0")) };
        if (!m.ok) {
          set({ ...patch, sheet: op?.op === "pledge" ? null : state.sheet });
          toast(m.error === "NotEnoughPractice" ? "Not enough practice SOL for that." : errorText(m.error), "error");
          break;
        }
        if (op?.op === "pledge") {
          const r = liveReceipt(`Practice pledge · ${sol(op.amount)} on $${op.symbol}`, [["Pledged", op.amount], ["Your pledge on $" + op.symbol, patch.pledge?.amount ?? op.amount], ["Practice SOL left", patch.balance]]);
          set({ ...patch, sheet: "receipt", receipt: r, receipts: [r, ...state.receipts] });
        } else if (op?.op === "withdraw") {
          set({ ...patch, sheet: null });
          toast(`${sol(op.amount)} of practice SOL back`, "white");
        } else if (op?.op === "move") {
          set(patch);
          toast(`Moved your ${sol(op.amount)} to $${op.symbol}`);
        } else if (op?.op === "propose") {
          set({ ...patch, meta: { ...state.meta, [op.ticker]: { id: op.ticker.toLowerCase(), hue: op.hue, pitch: op.pitch } }, selected: op.ticker.toLowerCase(), sheet: null });
          toast(`$${op.ticker} is in the race. Back it to give it a start.`, "sky");
        } else set(patch);
        break;
      }
      case "stage": {
        const v = s.voice;
        const onStage = m.speakers.includes(s.live.you);
        const hand = m.hands.includes(s.live.you);
        set({ live: { ...s.live, stage: { host: m.host, speakers: m.speakers, cohosts: m.cohosts, hands: m.hands } }, voice: { ...v, onStage, hand } });
        // The microphone follows the stage only for someone already in the audio (who asked to be): nobody's
        // microphone turns on because of a list they did not touch (a host lands on stage before choosing to speak).
        // Brought up: an invitation, not an open microphone; the person says when they speak. Moved down: the
        // microphone closes at once.
        if (onStage !== v.onStage && v.listening) {
          set({ voice: { ...state.voice, invited: onStage } });
          if (!onStage) audio.setMic(false);
          else if (!(audio.state.room === `lobby-${s.live.lobby}`)) joinVoice({ lobby: s.live.lobby }, false);
        }
        break;
      }
      case "presence": set({ live: { ...s.live, inside: m.inside, listening: m.listening } }); break;
      case "chat": set({ chat: chatLine(lineToChat(m.line, s.live.you)), draft: m.line.from === s.live.you && m.line.text === s.draft.trim() ? "" : s.draft }); break;
      case "error":
        // A guest who tries to talk is offered the wallet, not just told.
        if (m.code === "SignInToChat" || m.code === "SignInToSpeak") actions.openConnect(m.code === "SignInToChat" ? "chat" : "speak");
        else toast(LIVE_ERRORS[m.code] || m.code, "error");
        break;
      case "closed": if (s.live) set({ live: { ...s.live, connected: false } }); break;
      default:
    }
  }

  // ------------------------------------------------------------------ live clan (founders only)
  // The clan's channels come from the server once this wallet is a founder of a live launch; the screens read the
  // same message shape as the demo's.
  let server = null; // { base, token, lobby }
  let rpc = null; // a cluster's JSON-RPC, to read the real balance (?rpc=)
  let walletRef = null; // the connected wallet (detectWallets entry)
  let unwatch = () => {};
  const SESSION = "lobbies.session";
  const setWallet = (patch) => set({ wallet: { ...state.wallet, ...patch } });
  // Live: a new session (wallet or guest) means new sockets with it.
  function useSession(token) {
    server.token = token;
    if (link) actions.goLive({ base: server.base, lobby: server.lobby, token });
    if (clanLink) { clanLink.close(); clanLink = null; if (state.clan === "new") actions.openClan("new"); }
  }
  const cached = (address) => { try { const c = JSON.parse(localStorage.getItem(SESSION) ?? "null"); return c && c.address === address && c.base === server.base && c.exp > Date.now() ? c.token : null; } catch { return null; } };
  const remember = (address, token) => { try { localStorage.setItem(SESSION, JSON.stringify({ address, token, base: server.base, exp: Date.now() + 20 * 3600 * 1000 })); } catch {} };
  const forget = () => { try { localStorage.removeItem(SESSION); } catch {} };
  async function signedOut(note) {
    unwatch(); unwatch = () => {};
    walletRef = null;
    forget();
    setWallet({ status: "none", id: null, name: null, address: null, signedIn: false, balance: null, error: null });
    if (note) toast(note, "white");
    if (server) { try { useSession(await guestSession(server.base)); } catch { /* the server allows no guests: stay disconnected */ } }
  }
  let clanLink = null;
  const hhmm = (at) => new Date(at).toTimeString().slice(0, 5);
  function lineToMessage(l, you) {
    const mine = new Set(l.mine);
    return { id: l.id, who: l.from, from: l.from, role: l.role, t: hhmm(l.at), text: l.text, deleted: l.deleted, hidden: l.hidden,
      media: l.media.map((m) => ({ url: clanLink.mediaUrl(m.id), video: m.type.startsWith("video/") })),
      hearts: l.reactions.heart - (mine.has("heart") ? 1 : 0), fires: l.reactions.fire - (mine.has("fire") ? 1 : 0),
      heartOn: mine.has("heart"), fireOn: mine.has("fire"), yours: l.from === you, live: true };
  }
  function onClan(m) {
    const s = state;
    const you = s.liveClan?.you;
    switch (m.t) {
      case "hello":
        set({ liveClan: { connected: true, you: m.you, role: m.role, rank: m.rank, mods: m.mods, mutedUntil: m.mutedUntil, campfire: m.campfire },
          clanMessages: Object.fromEntries(m.channels.map((c) => [c.id, c.lines.map((l) => lineToMessage(l, m.you))])) });
        break;
      case "post": {
        const ch = m.line.ch;
        set({ clanMessages: { ...s.clanMessages, [ch]: [...(s.clanMessages[ch] || []), lineToMessage(m.line, you)] } });
        break;
      }
      case "update": {
        const ch = m.line.ch;
        set({ clanMessages: { ...s.clanMessages, [ch]: (s.clanMessages[ch] || []).map((x) => (x.id === m.line.id ? lineToMessage(m.line, you) : x)) } });
        break;
      }
      case "reported": toast("Reported to the clan’s moderators", "white"); break;
      case "muted": if (m.user === you) { set({ liveClan: { ...s.liveClan, mutedUntil: m.until } }); if (m.until) toast(`A moderator muted you until ${hhmm(m.until)}`, "white"); } break;
      case "mods": set({ liveClan: { ...s.liveClan, mods: m.mods } }); break;
      case "campfire": set({ liveClan: { ...s.liveClan, campfire: m.people } }); break;
      case "error": toast(CLAN_ERRORS[m.code] || m.code, "error"); break;
      case "closed": if (s.liveClan) set({ liveClan: { ...s.liveClan, connected: false } }); break;
      default:
    }
  }
  const CLAN_ERRORS = { TooFast: "One moment between messages.", SlowMode: "Slow mode is on in this channel.", Muted: "You are muted for now.",
    NotAllowed: "Only moderators can do that.", EmptyMessage: "Write something first.", UnknownMedia: "That file was not uploaded." };

  // Voice: an SFU token for where we listen or speak. The audio transport (LiveKit's client) connects with it; a
  // server without an SFU says so once.
  let voiceOffTold = false;
  // The voice room's audio; its state goes to the screens (who is speaking, the microphone, a tap to hear).
  // Its errors are shown where they matter (the stage panel, the voice pill), not as toasts.
  const audio = createAudio({ onChange: (a) => set({ audio: a }) });
  function joinVoice(where, speak = false) {
    if (!server) return;
    voiceToken(server.base, server.token, where).then(
      (v) => audio.join({ url: v.url, token: v.token, name: v.room, speak: speak && v.canPublish }),
      (e) => { if (e.status === 503 && !voiceOffTold) { voiceOffTold = true; toast("Voice isn’t connected on this server yet. The stage still works.", "white"); } },
    );
  }

  function tick() {
    const s = state;
    const beat = s.beat + 1;
    if (s.launched) return set({ beat });
    if (link && s.live && s.live.connected) return set({ beat, elapsed: Math.floor((link.now() - s.live.opensAt) / 1000) });
    const elapsed = s.elapsed + 1;
    const patch = { elapsed, beat };
    if (elapsed < LOCK_AT && beat % 3 === 0) {
      // The crowd keeps pledging, more often on what already leads; each new backer is a new wallet.
      const ideas = s.ideas;
      let r = Math.random() * ideas.reduce((a, b) => a + b.sol, 0), k = 0;
      for (; k < ideas.length - 1; k++) { r -= ideas[k].sol; if (r <= 0) break; }
      const amount = Math.round((0.2 + Math.random() * 2.2) * 10) / 10;
      const done = s.chain.apply("pledge", { user: `crowd-live-${beat}`, symbol: ideas[k].ticker, amount: toLamports(amount) }, elapsed);
      if (done.ok) {
        patch.ideas = ideasFrom(s.chain, s.meta);
        if (beat % 6 === 0) patch.chat = chatLine({ sys: true, kind: "pledge", text: `@${CROWD[beat % CROWD.length]} pledged ${amount} SOL to $${ideas[k].ticker}` });
      }
    }
    if (beat % 7 === 0 && elapsed < HOUR) patch.chat = [...(patch.chat || s.chat), { who: CROWD[(beat * 3) % CROWD.length], text: CHATTER[beat % CHATTER.length] }].slice(-60);
    if (elapsed >= LOCK_AT) Object.assign(patch, settle({ ...s, ...patch }));
    set(patch);
  }

  // Live on a practice lobby, the money goes to the server's lobby (shared, kept, settled at the launch).
  const practiceLive = () => !!(link && state.live?.practice);
  const signedLive = () => !!(state.live && (!state.live.guest || state.wallet.signedIn));
  let pending = null; // the practice operation waiting for the server's answer
  let wantScreen = null; // a screen the address asked for that needs the server first (#/launch after a reload)
  const liveMine = (m) => (m.mine ? { id: m.mine.symbol.toLowerCase(), symbol: m.mine.symbol, amount: toSol(BigInt(m.mine.amount)), lamports: BigInt(m.mine.amount) } : null);
  const liveReceipt = (title, rows) => ({ title, lines: rows, practice: true });
  const liveClanOn = () => !!(clanLink && state.liveClan?.connected && state.clan === "new");
  const canPledge = () => state.elapsed < LOCK_AT && !state.launched;
  const selectedIdea = () => state.ideas.find((i) => i.id === state.selected) || state.ideas[0];

  const actions = {
    wantScreen(screen) { wantScreen = screen; },
    goLive({ base, lobby, token }) {
      server = { base, token, lobby };
      if (link) link.close();
      link = connectLobby({ base, lobby, token, onMessage: onLive });
      if (state.voice.listening) link.listen(true); // a new session (signed in) keeps the person counted as listening
    },
    go(route) { set({ route, sheet: null }); },
    openClan(id) {
      set((s) => ({ route: { screen: "clan" }, clan: id, clanView: "list", sheet: null, clans: s.clans.map((c) => (c.id === id ? { ...c, unread: 0 } : c)) }));
      const mint = state.launched?.mint;
      if (id === "new" && mint && server && state.launched.founder && !clanLink) {
        clanLink = connectClan({ base: server.base, mint, token: server.token, onMessage: onClan });
        set({ channel: "general" });
      }
    },
    openSheet(sheet) { set({ sheet, signing: false, sheetAt: Date.now() }); },

    // Wallet. Connecting shares only the address; on a live server the wallet also signs a one-time message so the
    // server knows it is really this address (free, no transaction).
    setRpc(url) { rpc = url; },
    wallets: () => detectWallets(),
    openConnect(reason = null) { set({ sheet: "connect", sheetAt: Date.now(), connectFor: reason, wallet: { ...state.wallet, error: null } }); },
    async connectWallet(id) {
      const w = detectWallets().find((x) => x.id === id);
      if (!w) return;
      if (state.wallet.status === "connecting" || state.wallet.status === "signing") return; // one request at a time
      // Not here: on a phone, reopen this page inside the wallet's app; elsewhere, its download page.
      if (!w.installed) { if (w.browseUrl) location.href = w.browseUrl; else window.open(w.url, "_blank", "noopener"); return; }
      setWallet({ status: "connecting", id: w.id, name: w.name, error: null });
      try {
        const address = await connectWallet(w);
        await actions.signIn(w, address);
        set({ sheet: null });
        toast(`Connected · ${shortAddress(address)}`);
        actions.resume();
      } catch (e) {
        // Refused at the signature: the address was shared, but nothing else, and nobody is signed in.
        const atSign = state.wallet.status === "signing";
        const msg = walletError(e, w.name);
        setWallet({ status: "none", id: null, name: null, address: null, signedIn: false,
          error: atSign && /cancelled/.test(msg) ? `You cancelled the signature in ${w.name}. You’re not signed in; nothing else was shared.` : msg });
      }
    },
    /** What the person was doing when asked to connect, done now that they are: their message, their hand. */
    resume() {
      const why = state.connectFor;
      set({ connectFor: null });
      if (!link || state.wallet.status !== "connected") return;
      if (why === "chat" && state.draft.trim()) actions.send();
      if (why === "speak" && !state.voice.hand && !state.voice.onStage) actions.toggleHand();
      if (why === "pledge") set({ sheet: "pledge", sheetAt: Date.now() });
    },
    /** After connecting: the server session (live), the balance, and following the wallet's own switches. */
    async signIn(w, address) {
      walletRef = w;
      let signedIn = false;
      if (server) {
        setWallet({ status: "signing", address });
        const token = cached(address) ?? await walletSession(server.base, address, (text) => signText(w, text));
        remember(address, token);
        useSession(token);
        signedIn = true;
      }
      setWallet({ status: "connected", id: w.id, name: w.name, address, signedIn, error: null });
      unwatch();
      unwatch = watchWallet(w, {
        onAccount: (next) => { if (next !== state.wallet.address) signedOut(`You switched accounts in ${w.name}. Connect again to use the new one.`); },
        onDisconnect: () => signedOut(`${w.name} disconnected.`),
      });
      if (rpc) readBalance(rpc, address).then((b) => { if (state.wallet.address === address) setWallet({ balance: b }); });
    },
    /** On load: the wallet used last time reconnects without asking, if it still trusts this site. */
    async restoreWallet() {
      const w = lastWallet();
      if (!w) return;
      setWallet({ status: "restoring", id: w.id, name: w.name }); // the corner waits quietly instead of flashing Connect
      try {
        const address = await connectWallet(w, { silent: true });
        // Live, a new signature is asked only if the saved session is gone: never a prompt out of nowhere.
        if (server && !cached(address)) { setWallet({ status: "none", id: w.id, name: w.name, address: null }); return; }
        await actions.signIn(w, address);
      } catch { setWallet({ status: "none" }); /* not trusted any more: stay disconnected, quietly */ }
    },
    async disconnect() {
      unwatch(); unwatch = () => {}; // our own disconnect: the wallet's echo of it is not news
      await disconnectWallet(walletRef);
      set({ sheet: null });
      await signedOut("Wallet disconnected");
    },
    copyText(text, done) { navigator.clipboard?.writeText(text).then(() => toast(done, "white"), () => toast(text, "white")); },
    copyAddress() {
      const a = state.wallet.address;
      if (!a) return;
      navigator.clipboard?.writeText(a).then(() => toast("Address copied", "white"), () => toast(a, "white"));
    },
    // A tap that lands on the backdrop right as a sheet opens is the second half of a double tap, not "close".
    closeSheet(fromBackdrop = false) { if (!state.signing && !(fromBackdrop === true && Date.now() - (state.sheetAt ?? 0) < 450)) set({ sheet: null }); },
    setFilter(filter) { set({ filter }); },
    setQuery(query) { set({ query }); },
    toggleReminder(lobby) {
      const on = !state.reminders[lobby.id];
      set({ reminders: { ...state.reminders, [lobby.id]: on } });
      if (on) toast(`We’ll ping you when ${lobby.name} opens at ${lobby.opens}`, "sky");
    },
    hostLobby({ name, theme, opens }) {
      const id = `h${Date.now()}`;
      set((s) => ({ hosted: [{ id, name, theme, host: "you", opens, waiting: 0, mine: true }, ...s.hosted], reminders: { ...s.reminders, [id]: true }, sheet: null, filter: "all", query: "" }));
      toast(`${name} opens at ${opens}. You’re the host.`, "sky");
    },

    // Voice on the lobby stage.
    toggleListen() {
      const listening = !state.voice.listening;
      if (link) {
        link.listen(listening);
        if (listening) joinVoice({ lobby: state.live?.lobby }, state.voice.onStage);
        else audio.leave();
        // Leaving the audio leaves the stage too, except for the host, whose stage it is.
        if (!listening && state.voice.onStage && state.live?.stage?.host !== state.live?.you) link.down();
        if (!listening && state.voice.hand) link.hand(false);
        // The stage panel (and the voice pill elsewhere) says what is happening: no toast on top of it.
        set({ voice: { ...state.voice, listening, hand: false, mic: state.voice.onStage, invited: false } });
        return;
      }
      set({ voice: { listening, hand: false, onStage: listening && state.voice.onStage, mic: true } });
      if (listening) toast("Listening to the stage", "sky");
    },
    toggleHand() {
      if (link && state.live) {
        if (state.live.guest && !state.wallet.signedIn) return actions.openConnect("speak");
        if (!state.voice.listening) actions.toggleListen();
        return link.hand(!state.voice.hand); // the server's stage update sets it
      }
      if (state.voice.hand) return set({ voice: { ...state.voice, hand: false } });
      set({ voice: { ...state.voice, listening: true, hand: true } });
      later(() => {
        if (!state.voice.hand) return;
        set({ voice: { ...state.voice, hand: false, onStage: true, invited: true, mic: false }, chat: chatLine({ sys: true, kind: "stage", text: "mira.sol invited degen_marc to speak" }) });
      }, 3200);
    },
    toggleMic() {
      const mic = !(state.live ? state.audio.micOn : state.voice.mic);
      if (state.live) audio.setMic(mic);
      set({ voice: { ...state.voice, mic } });
    },
    /** Invited on stage: speak (the microphone opens now), or stay in the audience. */
    acceptInvite() {
      if (state.live) audio.setMic(true);
      set({ voice: { ...state.voice, invited: false, mic: true } });
    },
    declineInvite() {
      if (link && state.live) link.down();
      set({ voice: { ...state.voice, invited: false, onStage: false, mic: false } });
    },
    retryMic() { audio.setMic(true); },
    retryVoice() { audio.retry(); },
    startAudio() { audio.startAudio(); },
    stepDown() {
      if (link && state.live) return link.down();
      set({ voice: { ...state.voice, onStage: false } });
    },
    bringUp(user) { link?.bring(user); },
    /** The host (or a co-host) moves a speaker back to the audience. */
    moveDown(user) { link?.down(user); },
    setLobbyTab(lobbyTab) { set({ lobbyTab }); },

    // The race.
    select(id) { set({ selected: id }); },
    setAmount(amount) { set({ amount }); },
    proposeIdea({ name, ticker, pitch, hue }) {
      if (practiceLive()) {
        if (!signedLive()) return actions.openConnect("pledge");
        pending = { op: "propose", ticker, name, hue, pitch };
        return link.practice("propose", { symbol: ticker, name });
      }
      const r = act(state.chain, "propose_idea", { proposer: ME, symbol: ticker, name }, state.elapsed);
      if (!r.ok) return toast(errorText(r.error), "error");
      set((s) => {
        const meta = { ...s.meta, [ticker]: { id: ticker.toLowerCase(), hue, pitch } };
        return { meta, ideas: ideasFrom(s.chain, meta), selected: ticker.toLowerCase(), sheet: null, balance: s.balance - toSol(s.chain.lobby.bond),
          chat: chatLine({ sys: true, kind: "propose", text: `@degen_marc proposed $${ticker} · ${name}` }) };
      });
      toast(`$${ticker} is in the race. Back it to give it a start.`, "sky");
    },
    confirmPledge() {
      if (practiceLive()) {
        if (!signedLive()) return actions.openConnect("pledge");
        const idea = selectedIdea();
        set({ signing: true });
        pending = { op: "pledge", symbol: idea.ticker, amount: state.amount };
        return link.practice("pledge", { symbol: idea.ticker, amount: String(toLamports(state.amount)) });
      }
      set({ signing: true });
      later(() => {
        const idea = selectedIdea();
        const r = act(state.chain, "pledge", { user: ME, symbol: idea.ticker, amount: toLamports(state.amount) }, state.elapsed);
        if (!r.ok) {
          set({ signing: false, sheet: null });
          return toast(errorText(r.error), "error");
        }
        set((s) => ({ signing: false, sheet: "receipt", receipt: r.receipt, receipts: [r.receipt, ...s.receipts], pledge: myPledge(s.chain),
          ideas: shownIdeas(s), balance: s.balance - s.amount,
          chat: chatLine({ sys: true, kind: "pledge", text: `@degen_marc pledged ${s.amount} SOL to $${idea.ticker}` }) }));
      }, 1200);
    },
    withdraw() {
      const p = state.pledge;
      if (!p || state.signing) return;
      if (practiceLive()) { set({ signing: true }); pending = { op: "withdraw", amount: p.amount }; return link.practice("withdraw", { symbol: p.symbol, amount: String(p.lamports) }); }
      const r = act(state.chain, "withdraw", { user: ME, symbol: p.symbol, amount: p.lamports }, state.elapsed);
      if (!r.ok) return toast(errorText(r.error), "error");
      set((s) => ({ balance: s.balance + p.amount, pledge: myPledge(s.chain), ideas: shownIdeas(s), sheet: null, receipt: r.receipt, receipts: [r.receipt, ...s.receipts] }));
      toast(`${sol(p.amount)} returned to your wallet`, "white");
    },
    movePledge() {
      const p = state.pledge;
      const idea = selectedIdea();
      if (practiceLive()) { pending = { op: "move", symbol: idea.ticker, amount: p.amount }; return link.practice("move", { from: p.symbol, to: idea.ticker }); }
      const r = act(state.chain, "move_pledge", { user: ME, from: p.symbol, to: idea.ticker }, state.elapsed);
      if (!r.ok) return toast(errorText(r.error), "error");
      set((s) => ({ pledge: myPledge(s.chain), ideas: shownIdeas(s), receipt: r.receipt, receipts: [r.receipt, ...s.receipts] }));
      toast(`Moved your ${sol(p.amount)} to $${idea.ticker}`);
    },
    skipToLock() { set((s) => ({ elapsed: Math.max(s.elapsed, HOUR - 6), sheet: null })); set(settle(state)); },
    replay() {
      const chain = createDemoLobby();
      const meta = ideaMeta();
      set({ chain, meta, locked: null, launched: null, elapsed: START_ELAPSED, ideas: ideasFrom(chain, meta), pledge: null, selected: "wif", route: { screen: "lobby" }, voice: { listening: false, hand: false, onStage: false, mic: true } });
      toast("A fresh run of the lobby has started", "sky");
    },

    // Lobby chat.
    setDraft(draft) { set({ draft }); },
    send() {
      const text = state.draft.trim();
      if (!text) return;
      // A guest's message waits in the field while they connect, then goes out by itself.
      if (link && state.live?.guest && !state.wallet.signedIn) return actions.openConnect("chat");
      if (link) return link.chat(text); // the draft clears when the room shows it; refused (slow mode), it stays
      set({ draft: "", chat: chatLine({ who: ME, text }) });
    },
    shareArt() {
      const idea = selectedIdea();
      set({ chat: chatLine({ who: ME, text: `vote $${idea.ticker}, look at this`, art: idea.id }) });
    },

    // Clan.
    openChannel(id) { set((s) => ({ channel: id, clanView: "chat", read: { ...s.read, [id]: true } })); },
    backToChannels() { set({ clanView: "list" }); },
    toggleMembers() { set({ showMembers: !state.showMembers }); },
    joinCampfire(openCall = false) {
      if (liveClanOn() && !state.campfire.joined) {
        clanLink.campfire(true);
        joinVoice({ clan: state.launched.mint }, !state.campfire.muted);
      }
      if (!state.campfire.joined) toast("Connected to Campfire", "sky");
      set((s) => ({ campfire: { ...s.campfire, joined: true }, clanView: openCall ? "chat" : s.clanView }));
    },
    leaveCampfire() {
      if (liveClanOn()) { clanLink.campfire(false); audio.leave(); }
      set({ campfire: { joined: false, muted: false, deafened: false, sharing: false } });
    },
    toggleMute() {
      const muted = !state.campfire.muted;
      if (audio.state.status === "live") audio.setMic(!muted);
      set((s) => ({ campfire: { ...s.campfire, muted } }));
    },
    toggleDeafen() {
      const deafened = !state.campfire.deafened;
      const muted = deafened || state.campfire.muted;
      if (audio.state.status === "live") { audio.setDeafened(deafened); audio.setMic(!muted); }
      set((s) => ({ campfire: { ...s.campfire, deafened, muted } }));
    },
    toggleShare() { set((s) => ({ campfire: { ...s.campfire, sharing: !s.campfire.sharing } })); },
    setClanDraft(clanDraft) { set({ clanDraft }); },
    sendClan() {
      const text = state.clanDraft.trim();
      if (!text) return;
      if (liveClanOn()) return clanLink.post(state.channel, text), set({ clanDraft: "" });
      set((s) => ({ clanDraft: "", clanMessages: { ...s.clanMessages, [s.channel]: [...(s.clanMessages[s.channel] || []), message(ME, text)] } }));
    },
    shareMeme() {
      const clan = state.clans.find((c) => c.id === state.clan);
      const media = [{ hue: clan.hue }, { hue: (clan.hue + 40) % 360 }, { hue: (clan.hue + 300) % 360, video: true }];
      set((s) => ({ clanMessages: { ...s.clanMessages, [s.channel]: [...(s.clanMessages[s.channel] || []), message(ME, "", { media })] } }));
    },
    /** Live: uploads the chosen file to the clan, then posts it in the channel. */
    async shareFile(file) {
      if (!liveClanOn() || !file) return;
      try {
        const up = await clanLink.upload(file);
        clanLink.post(state.channel, "", [up.id]);
      } catch (e) {
        toast(e.message, "error");
      }
    },
    deleteMessage(id) {
      if (liveClanOn()) return clanLink.remove(id);
      set((s) => ({ clanMessages: { ...s.clanMessages, [s.channel]: s.clanMessages[s.channel].map((m) => (m.id === id ? { ...m, deleted: true, text: "", media: [] } : m)) } }));
    },
    reportMessage(id) {
      if (liveClanOn()) return clanLink.report(id);
      toast("Reported to the clan’s moderators", "white");
    },
    react(id, kind) {
      const key = kind === "heart" ? "heartOn" : "fireOn";
      if (liveClanOn()) {
        const m = state.clanMessages[state.channel].find((x) => x.id === id);
        return clanLink.react(id, kind, !m[key]);
      }
      set((s) => ({ clanMessages: { ...s.clanMessages, [s.channel]: s.clanMessages[s.channel].map((m) => (m.id === id ? { ...m, [key]: !m[key] } : m)) } }));
    },
    showReceipt(receipt) { set({ sheet: "receipt", receipt }); },
    shareBirthCard() { set({ sheet: "card", sheetAt: Date.now() }); },
    cardDone(text) { toast(text); }, // the sheet stays: save and copy, or both shapes
  };

  // Deterministic scenes for screenshots and tests.
  const scenes = {
    lobby: () => set({ route: { screen: "lobby" } }),
    "lobby-stage": () => set({ route: { screen: "lobby" }, lobbyTab: "stage", voice: { listening: true, hand: false, onStage: true, mic: true } }),
    "lobby-chat": () => set({ route: { screen: "lobby" }, lobbyTab: "chat" }),
    "lobby-backed": () => { pledgeNow("WIF", 1); set({ route: { screen: "lobby" } }); },
    "lobby-locked": () => { pledgeNow("WIF", 1); set({ route: { screen: "lobby" }, elapsed: 3420 }); set(settle(state)); },
    "sheet-pledge": () => set({ route: { screen: "lobby" }, sheet: "pledge" }),
    "sheet-receipt": () => { pledgeNow("WIF", 1); set({ route: { screen: "lobby" }, sheet: "receipt" }); },
    "sheet-propose": () => set({ route: { screen: "lobby" }, sheet: "propose" }),
    "sheet-host": () => set({ sheet: "host" }),
    "sheet-terms": () => set({ sheet: "terms" }),
    "sheet-wallet": () => { pledgeNow("WIF", 1); set({ sheet: "wallet", wallet: { ...SAMPLE_WALLET } }); },
    "sheet-connect": () => set({ sheet: "connect", connectFor: "chat" }),
    "launch-founder": () => { pledgeNow("WIF", 1); set({ route: { screen: "lobby" }, elapsed: HOUR }); set(settle(state)); },
    "sheet-card": () => { pledgeNow("WIF", 1); set({ route: { screen: "lobby" }, elapsed: HOUR }); set(settle(state)); set({ sheet: "card" }); },
    "launch-refund": () => { pledgeNow("BRETT", 2); set({ route: { screen: "lobby" }, elapsed: HOUR }); set(settle(state)); },
    clan: () => actions.openClan("bonk"),
    "clan-voice": () => { actions.openClan("bonk"); set({ clanView: "chat", campfire: { joined: true, muted: false, deafened: false, sharing: false } }); },
    listening: () => set({ voice: { listening: true, hand: false, onStage: false, mic: true } }),
  };
  // A pledge of ours, straight through the rules (scenes only).
  function pledgeNow(symbol, amount) {
    const r = act(state.chain, "pledge", { user: ME, symbol, amount: toLamports(amount) }, state.elapsed);
    set((s) => ({ pledge: myPledge(s.chain), ideas: ideasFrom(s.chain, s.meta), balance: s.balance - amount, selected: symbol.toLowerCase(), amount, receipt: r.receipt, receipts: [r.receipt, ...s.receipts] }));
  }
  if (scene && scenes[scene]) { scenes[scene](); state = { ...state, toast: null }; }

  let interval = null;
  return {
    get: () => state,
    subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); },
    actions,
    start() { if (!freeze && !interval) interval = setInterval(tick, 1000); },
    stop() { clearInterval(interval); interval = null; timers.forEach(clearTimeout); timers.clear(); if (link) link.close(); if (clanLink) clanLink.close(); audio.leave(); },
    tick,
  };
}
