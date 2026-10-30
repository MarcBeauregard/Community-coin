// The demo store: plays one lobby hour in the browser. It holds the state, the actions the screens call and a one
// second clock. It is the seam later steps replace: the same actions will call the lobby program and the realtime
// channel instead of changing local state.
//
// Scenes (`?scene=`) seed deterministic states for screenshots and tests; `?freeze` stops the clock.

import { IDEAS, CLANS, CROWD, CHATTER, ME, seedClanMessages, seedLobbyChat, message } from "./data.js";
import { HOUR, sol } from "../format.js";

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
export const FOUNDER_SUPPLY = 800_000_000; // tokens sold to founders in the opening auction

export function phaseAt(elapsed) {
  if (elapsed >= HOUR) return "done";
  return PHASES.find((p) => elapsed < p.end).id;
}

function initialState() {
  return {
    route: { screen: "discover" },
    elapsed: START_ELAPSED,
    beat: 0,
    ideas: IDEAS.map((i) => ({ ...i })),
    selected: "wif",
    amount: 1,
    pledge: null, // { id, amount }
    balance: 14.2,
    bond: 0,
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

// Effective SOL on an idea: the crowd's pledges plus ours.
export function pledgedOn(state, idea) {
  return idea.sol + (state.pledge && state.pledge.id === idea.id ? state.pledge.amount : 0);
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

  function finalize(s) {
    const ranked = s.ideas.map((d) => ({ d, v: pledgedOn(s, d) })).sort((a, b) => b.v - a.v);
    const win = ranked[0];
    const total = ranked.reduce((a, b) => a + b.v, 0);
    const founder = !!(s.pledge && s.pledge.id === win.d.id);
    const refund = s.pledge && !founder ? s.pledge.amount : 0;
    const out = {
      launched: {
        id: win.d.id, sol: win.v, total, founder, refund,
        backers: win.d.backers + (founder ? 1 : 0),
        myAmount: s.pledge ? s.pledge.amount : 0, myId: s.pledge ? s.pledge.id : null,
      },
      balance: s.balance + refund + s.bond, bond: 0, sheet: null, signing: false,
    };
    if (s.route.screen === "lobby") out.route = { screen: "launch" };
    if (founder) {
      out.clans = [{ id: "new", name: win.d.name, ticker: win.d.ticker, hue: win.d.hue, logo: win.d.logo, members: win.d.backers + 1,
        born: "Born tonight", change: null, voice: 5, unread: 0, fresh: true, story: win.d.pitch }, ...s.clans];
    }
    return out;
  }

  function tick() {
    const s = state;
    const beat = s.beat + 1;
    if (s.launched) return set({ beat });
    const elapsed = s.elapsed + 1;
    const patch = { elapsed, beat };
    if (elapsed < LOCK_AT && beat % 3 === 0) {
      // The crowd keeps pledging, more often on what already leads.
      const ideas = s.ideas.map((i) => ({ ...i }));
      let r = Math.random() * ideas.reduce((a, b) => a + b.sol, 0), k = 0;
      for (; k < ideas.length - 1; k++) { r -= ideas[k].sol; if (r <= 0) break; }
      const amount = Math.round((0.2 + Math.random() * 2.2) * 10) / 10;
      ideas[k].sol += amount;
      ideas[k].backers += 1;
      patch.ideas = ideas;
      if (beat % 6 === 0) patch.chat = chatLine({ sys: true, kind: "pledge", text: `@${CROWD[beat % CROWD.length]} pledged ${amount} SOL to $${ideas[k].ticker}` });
    }
    if (beat % 7 === 0 && elapsed < HOUR) patch.chat = [...(patch.chat || s.chat), { who: CROWD[(beat * 3) % CROWD.length], text: CHATTER[beat % CHATTER.length] }].slice(-60);
    if (elapsed >= HOUR) Object.assign(patch, finalize({ ...s, ...patch }));
    set(patch);
  }

  const canPledge = () => state.elapsed < LOCK_AT && !state.launched;
  const selectedIdea = () => state.ideas.find((i) => i.id === state.selected) || state.ideas[0];

  const actions = {
    go(route) { set({ route, sheet: null }); },
    openClan(id) {
      set((s) => ({ route: { screen: "clan" }, clan: id, clanView: "list", sheet: null, clans: s.clans.map((c) => (c.id === id ? { ...c, unread: 0 } : c)) }));
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
      set({ voice: { listening, hand: false, onStage: listening && state.voice.onStage, mic: true } });
      if (listening) toast("Listening to the stage", "sky");
    },
    toggleHand() {
      if (state.voice.hand) return set({ voice: { ...state.voice, hand: false } });
      set({ voice: { ...state.voice, listening: true, hand: true } });
      later(() => {
        if (!state.voice.hand) return;
        set({ voice: { ...state.voice, hand: false, onStage: true, mic: true }, chat: chatLine({ sys: true, kind: "stage", text: "mira.sol brought degen_marc on stage" }) });
        toast("You’re on stage. Your mic is live.", "sky");
      }, 3200);
    },
    toggleMic() { set({ voice: { ...state.voice, mic: !state.voice.mic } }); },
    stepDown() { set({ voice: { ...state.voice, onStage: false } }); },
    setLobbyTab(lobbyTab) { set({ lobbyTab }); },

    // The race.
    select(id) { set({ selected: id }); },
    setAmount(amount) { set({ amount }); },
    proposeIdea({ name, ticker, pitch, hue }) {
      const id = `u${Date.now()}`;
      set((s) => ({
        ideas: [...s.ideas, { id, name, ticker, pitch, hue, by: ME, sol: 0, backers: 0 }], selected: id, sheet: null,
        balance: s.balance - PROPOSE_BOND, bond: s.bond + PROPOSE_BOND,
        chat: chatLine({ sys: true, kind: "propose", text: `@degen_marc proposed $${ticker} · ${name}` }),
      }));
      toast(`$${ticker} is in the race. Back it to give it a start.`, "sky");
    },
    confirmPledge() {
      set({ signing: true });
      later(() => {
        if (!canPledge()) return set({ signing: false, sheet: null });
        const idea = selectedIdea();
        set((s) => ({ signing: false, sheet: null, pledge: { id: idea.id, amount: s.amount }, balance: s.balance - s.amount,
          chat: chatLine({ sys: true, kind: "pledge", text: `@degen_marc pledged ${s.amount} SOL to $${idea.ticker}` }) }));
        toast(`Pledged ${sol(state.pledge.amount)} to $${idea.ticker}`);
      }, 1200);
    },
    withdraw() {
      if (!state.pledge) return;
      const amount = state.pledge.amount;
      set((s) => ({ balance: s.balance + amount, pledge: null, sheet: null }));
      toast(`${sol(amount)} returned to your wallet`, "white");
    },
    movePledge() {
      const idea = selectedIdea();
      set((s) => ({ pledge: { ...s.pledge, id: idea.id } }));
      toast(`Moved your ${sol(state.pledge.amount)} to $${idea.ticker}`);
    },
    skipToLock() { set((s) => ({ elapsed: Math.max(s.elapsed, HOUR - 6), sheet: null })); },
    replay() {
      set({ launched: null, elapsed: START_ELAPSED, ideas: IDEAS.map((i) => ({ ...i })), pledge: null, selected: "wif", route: { screen: "lobby" }, voice: { listening: false, hand: false, onStage: false, mic: true } });
      toast("A fresh run of the lobby has started", "sky");
    },

    // Lobby chat.
    setDraft(draft) { set({ draft }); },
    send() {
      const text = state.draft.trim();
      if (text) set({ draft: "", chat: chatLine({ who: ME, text }) });
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
      if (!state.campfire.joined) toast("Connected to Campfire", "sky");
      set((s) => ({ campfire: { ...s.campfire, joined: true }, clanView: openCall ? "chat" : s.clanView }));
    },
    leaveCampfire() { set({ campfire: { joined: false, muted: false, deafened: false, sharing: false } }); },
    toggleMute() { set((s) => ({ campfire: { ...s.campfire, muted: !s.campfire.muted } })); },
    toggleDeafen() { set((s) => ({ campfire: { ...s.campfire, deafened: !s.campfire.deafened, muted: !s.campfire.deafened || s.campfire.muted } })); },
    toggleShare() { set((s) => ({ campfire: { ...s.campfire, sharing: !s.campfire.sharing } })); },
    setClanDraft(clanDraft) { set({ clanDraft }); },
    sendClan() {
      const text = state.clanDraft.trim();
      if (!text) return;
      set((s) => ({ clanDraft: "", clanMessages: { ...s.clanMessages, [s.channel]: [...(s.clanMessages[s.channel] || []), message(ME, text)] } }));
    },
    shareMeme() {
      const clan = state.clans.find((c) => c.id === state.clan);
      const media = [{ hue: clan.hue }, { hue: (clan.hue + 40) % 360 }, { hue: (clan.hue + 300) % 360, video: true }];
      set((s) => ({ clanMessages: { ...s.clanMessages, [s.channel]: [...(s.clanMessages[s.channel] || []), message(ME, "", { media })] } }));
    },
    react(id, kind) {
      const key = kind === "heart" ? "heartOn" : "fireOn";
      set((s) => ({ clanMessages: { ...s.clanMessages, [s.channel]: s.clanMessages[s.channel].map((m) => (m.id === id ? { ...m, [key]: !m[key] } : m)) } }));
    },
    copyAddress() { toast("Address copied", "white"); },
    shareBirthCard() { toast("Birth card link copied"); },
  };

  // Deterministic scenes for screenshots and tests.
  const scenes = {
    lobby: () => set({ route: { screen: "lobby" } }),
    "lobby-stage": () => set({ route: { screen: "lobby" }, lobbyTab: "stage", voice: { listening: true, hand: false, onStage: true, mic: true } }),
    "lobby-chat": () => set({ route: { screen: "lobby" }, lobbyTab: "chat" }),
    "lobby-backed": () => set({ route: { screen: "lobby" }, pledge: { id: "wif", amount: 1 }, balance: 13.2 }),
    "lobby-locked": () => set({ route: { screen: "lobby" }, elapsed: 3420, pledge: { id: "wif", amount: 1 }, balance: 13.2 }),
    "sheet-pledge": () => set({ route: { screen: "lobby" }, sheet: "pledge" }),
    "sheet-propose": () => set({ route: { screen: "lobby" }, sheet: "propose" }),
    "sheet-host": () => set({ sheet: "host" }),
    "sheet-wallet": () => set({ sheet: "wallet", pledge: { id: "wif", amount: 1 }, balance: 13.2 }),
    "launch-founder": () => { set({ route: { screen: "lobby" }, pledge: { id: "wif", amount: 1 }, balance: 13.2 }); set(finalize(state)); },
    "launch-refund": () => { set({ route: { screen: "lobby" }, pledge: { id: "brett", amount: 2 }, balance: 12.2 }); set(finalize(state)); },
    clan: () => actions.openClan("bonk"),
    "clan-voice": () => { actions.openClan("bonk"); set({ clanView: "chat", campfire: { joined: true, muted: false, deafened: false, sharing: false } }); },
    listening: () => set({ voice: { listening: true, hand: false, onStage: false, mic: true } }),
  };
  if (scene && scenes[scene]) { scenes[scene](); state = { ...state, toast: null }; }

  let interval = null;
  return {
    get: () => state,
    subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); },
    actions,
    start() { if (!freeze && !interval) interval = setInterval(tick, 1000); },
    stop() { clearInterval(interval); interval = null; timers.forEach(clearTimeout); timers.clear(); },
    tick,
  };
}
