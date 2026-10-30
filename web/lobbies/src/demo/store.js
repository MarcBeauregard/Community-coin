// The demo store: plays one lobby hour in the browser. It holds the state, the actions the screens call and a one
// second clock. Money goes through the program's rules (lobby.js on chain/rules.js): pledges, withdrawals, moves,
// the lock, the launch and the refunds give the program's results, and receipts are read from its events. Wallet
// mode will send the same operations to the program instead.
//
// Scenes (`?scene=`) seed deterministic states for screenshots and tests; `?freeze` stops the clock.

import { CLANS, CROWD, CHATTER, ME, seedClanMessages, seedLobbyChat, message } from "./data.js";
import { HOUR, sol } from "../format.js";
import { connectLobby, connectClan, voiceToken } from "../realtime/client.js";
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
    voice: { listening: false, hand: false, onStage: false, mic: true },
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
  };
}

// SOL on an idea, ours included: the chain's number.
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

  // The lock and the launch come from the chain's crank; this turns its events into what the screens show.
  function settle(s) {
    const events = crank(s.chain, s.elapsed);
    if (!events.length) return {};
    const patch = { ideas: ideasFrom(s.chain, s.meta), pledge: myPledge(s.chain), locked: lockedOf(s.chain) };
    const launched = launchSummary(s.chain, events);
    if (!launched) return patch;
    const win = patch.ideas.find((d) => d.id === launched.id);
    const mine = events.filter((e) => e.user === ME || e.proposer === ME);
    Object.assign(patch, { launched, balance: s.balance + launched.refund + launched.bondBack, sheet: null, signing: false,
      receipts: [...mine.map((e) => receiptOf(e, s)).filter(Boolean), ...s.receipts] });
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
  const lineToChat = (line, you) => ({ who: line.from === you ? ME : short(line.from), text: line.text });
  const raceIdeas = (rows, meta) => ideasFrom({ ideas: rows.map((r) => ({ ...r, pledged: BigInt(r.pledged), proposer: "" })) }, meta);
  function onLive(m) {
    const s = state;
    switch (m.t) {
      case "hello":
        set({ live: { connected: true, lobby: m.lobby, inside: m.inside, listening: m.listening, opensAt: m.opensAt, you: m.you, guest: m.guest, race: m.race, stage: m.stage },
          elapsed: Math.floor((m.now - m.opensAt) / 1000), ideas: raceIdeas(m.race, s.meta), chat: m.chat.map((l) => lineToChat(l, m.you)) });
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
        set({ launched: liveLaunch(m, s.locked?.total ?? 0), route: s.route.screen === "lobby" ? { screen: "launch" } : s.route, sheet: null });
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
      case "stage": {
        const v = s.voice;
        const onStage = m.speakers.includes(s.live.you);
        const hand = m.hands.includes(s.live.you);
        set({ live: { ...s.live, stage: { host: m.host, speakers: m.speakers, cohosts: m.cohosts, hands: m.hands } }, voice: { ...v, onStage, hand, listening: v.listening || onStage } });
        if (onStage !== v.onStage) {
          toast(onStage ? "You’re on stage. Your mic is live." : "You’re back in the audience.", "sky");
          joinVoice({ lobby: s.live.lobby }); // a new right to speak (or not) needs a new token
        }
        break;
      }
      case "presence": set({ live: { ...s.live, inside: m.inside, listening: m.listening } }); break;
      case "chat": set({ chat: chatLine(lineToChat(m.line, s.live.you)) }); break;
      case "error": toast(LIVE_ERRORS[m.code] || m.code, "white"); break;
      case "closed": if (s.live) set({ live: { ...s.live, connected: false } }); break;
      default:
    }
  }

  // ------------------------------------------------------------------ live clan (founders only)
  // The clan's channels come from the server once this wallet is a founder of a live launch; the screens read the
  // same message shape as the demo's.
  let server = null; // { base, token }
  let clanLink = null;
  const hhmm = (at) => new Date(at).toTimeString().slice(0, 5);
  function lineToMessage(l, you) {
    const mine = new Set(l.mine);
    return { id: l.id, who: l.from === you ? ME : short(l.from), from: l.from, role: l.role, t: hhmm(l.at), text: l.text, deleted: l.deleted, hidden: l.hidden,
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
      case "error": toast(CLAN_ERRORS[m.code] || m.code, "white"); break;
      case "closed": if (s.liveClan) set({ liveClan: { ...s.liveClan, connected: false } }); break;
      default:
    }
  }
  const CLAN_ERRORS = { TooFast: "One moment between messages.", SlowMode: "Slow mode is on in this channel.", Muted: "You are muted for now.",
    NotAllowed: "Only moderators can do that.", EmptyMessage: "Write something first.", UnknownMedia: "That file was not uploaded." };

  // Voice: an SFU token for where we listen or speak. The audio transport (LiveKit's client) connects with it; a
  // server without an SFU says so once.
  let voiceOffTold = false;
  function joinVoice(where) {
    if (!server) return;
    voiceToken(server.base, server.token, where).then((v) => set({ voice: { ...state.voice, sfu: { room: v.room, canPublish: v.canPublish } } }), (e) => {
      if (e.status === 503 && !voiceOffTold) { voiceOffTold = true; toast("Voice isn’t connected on this server yet. The stage still works.", "white"); }
    });
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

  const liveClanOn = () => !!(clanLink && state.liveClan?.connected && state.clan === "new");
  const canPledge = () => state.elapsed < LOCK_AT && !state.launched;
  const selectedIdea = () => state.ideas.find((i) => i.id === state.selected) || state.ideas[0];

  const actions = {
    goLive({ base, lobby, token }) {
      server = { base, token };
      if (link) link.close();
      link = connectLobby({ base, lobby, token, onMessage: onLive });
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
    openSheet(sheet) { set({ sheet, signing: false }); },
    closeSheet() { if (!state.signing) set({ sheet: null }); },
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
        if (listening) joinVoice({ lobby: state.live?.lobby });
        if (!listening && state.voice.onStage) link.down();
        if (!listening && state.voice.hand) link.hand(false);
      }
      set({ voice: { listening, hand: false, onStage: listening && state.voice.onStage, mic: true } });
      if (listening) toast("Listening to the stage", "sky");
    },
    toggleHand() {
      if (link && state.live) {
        if (state.live.guest) return toast("Connect a wallet to speak.", "white");
        if (!state.voice.listening) actions.toggleListen();
        return link.hand(!state.voice.hand); // the server's stage update sets it
      }
      if (state.voice.hand) return set({ voice: { ...state.voice, hand: false } });
      set({ voice: { ...state.voice, listening: true, hand: true } });
      later(() => {
        if (!state.voice.hand) return;
        set({ voice: { ...state.voice, hand: false, onStage: true, mic: true }, chat: chatLine({ sys: true, kind: "stage", text: "mira.sol brought degen_marc on stage" }) });
        toast("You’re on stage. Your mic is live.", "sky");
      }, 3200);
    },
    toggleMic() { set({ voice: { ...state.voice, mic: !state.voice.mic } }); },
    stepDown() {
      if (link && state.live) return link.down();
      set({ voice: { ...state.voice, onStage: false } });
    },
    bringUp(user) { link?.bring(user); },
    setLobbyTab(lobbyTab) { set({ lobbyTab }); },

    // The race.
    select(id) { set({ selected: id }); },
    setAmount(amount) { set({ amount }); },
    proposeIdea({ name, ticker, pitch, hue }) {
      const r = act(state.chain, "propose_idea", { proposer: ME, symbol: ticker, name }, state.elapsed);
      if (!r.ok) return toast(errorText(r.error), "white");
      set((s) => {
        const meta = { ...s.meta, [ticker]: { id: ticker.toLowerCase(), hue, pitch } };
        return { meta, ideas: ideasFrom(s.chain, meta), selected: ticker.toLowerCase(), sheet: null, balance: s.balance - toSol(s.chain.lobby.bond),
          chat: chatLine({ sys: true, kind: "propose", text: `@degen_marc proposed $${ticker} · ${name}` }) };
      });
      toast(`$${ticker} is in the race. Back it to give it a start.`, "sky");
    },
    confirmPledge() {
      set({ signing: true });
      later(() => {
        const idea = selectedIdea();
        const r = act(state.chain, "pledge", { user: ME, symbol: idea.ticker, amount: toLamports(state.amount) }, state.elapsed);
        if (!r.ok) {
          set({ signing: false, sheet: null });
          return toast(errorText(r.error), "white");
        }
        set((s) => ({ signing: false, sheet: "receipt", receipt: r.receipt, receipts: [r.receipt, ...s.receipts], pledge: myPledge(s.chain),
          ideas: ideasFrom(s.chain, s.meta), balance: s.balance - s.amount,
          chat: chatLine({ sys: true, kind: "pledge", text: `@degen_marc pledged ${s.amount} SOL to $${idea.ticker}` }) }));
      }, 1200);
    },
    withdraw() {
      const p = state.pledge;
      if (!p) return;
      const r = act(state.chain, "withdraw", { user: ME, symbol: p.symbol, amount: p.lamports }, state.elapsed);
      if (!r.ok) return toast(errorText(r.error), "white");
      set((s) => ({ balance: s.balance + p.amount, pledge: myPledge(s.chain), ideas: ideasFrom(s.chain, s.meta), sheet: null, receipt: r.receipt, receipts: [r.receipt, ...s.receipts] }));
      toast(`${sol(p.amount)} returned to your wallet`, "white");
    },
    movePledge() {
      const p = state.pledge;
      const idea = selectedIdea();
      const r = act(state.chain, "move_pledge", { user: ME, from: p.symbol, to: idea.ticker }, state.elapsed);
      if (!r.ok) return toast(errorText(r.error), "white");
      set((s) => ({ pledge: myPledge(s.chain), ideas: ideasFrom(s.chain, s.meta), receipt: r.receipt, receipts: [r.receipt, ...s.receipts] }));
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
      if (link) return link.chat(text), set({ draft: "" });
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
        joinVoice({ clan: state.launched.mint });
      }
      if (!state.campfire.joined) toast("Connected to Campfire", "sky");
      set((s) => ({ campfire: { ...s.campfire, joined: true }, clanView: openCall ? "chat" : s.clanView }));
    },
    leaveCampfire() {
      if (liveClanOn()) clanLink.campfire(false);
      set({ campfire: { joined: false, muted: false, deafened: false, sharing: false } });
    },
    toggleMute() { set((s) => ({ campfire: { ...s.campfire, muted: !s.campfire.muted } })); },
    toggleDeafen() { set((s) => ({ campfire: { ...s.campfire, deafened: !s.campfire.deafened, muted: !s.campfire.deafened || s.campfire.muted } })); },
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
        toast(e.message, "white");
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
    copyAddress() { toast("Address copied", "white"); },
    showReceipt(receipt) { set({ sheet: "receipt", receipt }); },
    shareBirthCard() { toast("Birth card link copied"); },
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
    "sheet-wallet": () => { pledgeNow("WIF", 1); set({ sheet: "wallet" }); },
    "launch-founder": () => { pledgeNow("WIF", 1); set({ route: { screen: "lobby" }, elapsed: HOUR }); set(settle(state)); },
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
    stop() { clearInterval(interval); interval = null; timers.forEach(clearTimeout); timers.clear(); if (link) link.close(); if (clanLink) clanLink.close(); },
    tick,
  };
}
