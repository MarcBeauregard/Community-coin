// The audio of a voice room (the lobby stage, a clan's Campfire) over LiveKit. The server decides who may speak and
// signs the token; this module joins the room with it, plays the others, turns the microphone on and off, and
// reports who is speaking so the screens light up the right faces. Every failure becomes a state the screens
// explain: the microphone refused, the browser waiting for a tap before it plays sound, the network dropping.

// LiveKit's client is loaded the first time someone joins a voice room, not with the app.
const loadLiveKit = () => globalThis.__lobbiesLiveKit ?? import("livekit-client");

/**
 * `onChange(state)` gets `{ status, speaking: [identities], micOn, needsTap, error }` on every change. `status`:
 * "connecting" | "live" | "reconnecting" | "off". A test page may provide its own `{ Room, RoomEvent, Track }` as
 * `globalThis.__lobbiesLiveKit`.
 */
export function createAudio({ onChange }) {
  let RoomEvent, Track;
  let room = null;
  let attempt = 0; // each join is numbered: a late answer from an abandoned one changes nothing
  let wantSpeak = false; // asked to speak while still connecting: the microphone turns on once connected
  let last = null; // the last join's arguments, to rejoin after a drop
  let retries = 0;
  let state = { status: "off", speaking: [], micOn: false, needsTap: false, error: null, room: null };
  const players = new Map(); // track sid -> <audio>
  const emit = (patch) => { state = { ...state, ...patch }; onChange(state); };

  function attach(track) {
    if (track.kind !== Track.Kind.Audio) return;
    const el = track.attach();
    el.dataset.lobbiesAudio = "";
    el.style.display = "none";
    document.body.appendChild(el);
    players.set(track.sid, el);
  }
  function detach(track) {
    const el = players.get(track.sid);
    if (el) { track.detach(el); el.remove(); players.delete(track.sid); }
  }

  async function micOn(on) {
    if (!room) return;
    try {
      await room.localParticipant.setMicrophoneEnabled(on);
      emit({ micOn: on, error: null });
    } catch (e) {
      const denied = e?.name === "NotAllowedError" || /permission|denied/i.test(String(e?.message));
      emit({ micOn: false, error: denied ? "mic-denied" : e?.name === "NotFoundError" ? "no-mic" : "mic-failed" });
    }
  }

  return {
    get state() { return state; },
    /** Joins `name` with a server token; turns the microphone on if this token may publish and `speak` is asked. */
    async join({ url, token, name, speak = false, rejoin = false }) {
      if (!rejoin) retries = 0;
      if (room && state.room === name) {
        wantSpeak = speak;
        if (state.status === "live" && speak !== state.micOn) await micOn(speak);
        return;
      }
      await this.leave();
      last = { url, token, name };
      const id = ++attempt;
      wantSpeak = speak;
      emit({ status: "connecting", room: name, error: null, speaking: [] });
      let lk;
      try { lk = await loadLiveKit(); } catch { emit({ status: "off", error: "connect-failed" }); return; }
      ({ RoomEvent, Track } = lk);
      const r = new lk.Room({ adaptiveStream: true, dynacast: true });
      room = r;
      r.on(RoomEvent.TrackSubscribed, (track) => attach(track));
      r.on(RoomEvent.TrackUnsubscribed, (track) => detach(track));
      r.on(RoomEvent.ActiveSpeakersChanged, (list) => emit({ speaking: list.map((p) => p.identity) }));
      r.on(RoomEvent.AudioPlaybackStatusChanged, () => emit({ needsTap: !r.canPlaybackAudio }));
      r.on(RoomEvent.Reconnecting, () => emit({ status: "reconnecting" }));
      r.on(RoomEvent.Reconnected, () => emit({ status: "live" }));
      // Dropped (not left): rejoin by itself, three times, 1 s, 2 s, then 4 s apart; then say so and offer Try again.
      r.on(RoomEvent.Disconnected, () => {
        if (attempt !== id || state.status === "connecting") return;
        room = null;
        const speak = state.micOn;
        if (retries >= 3) { emit({ status: "off", speaking: [], micOn: false, error: "connect-failed" }); return; }
        emit({ status: "reconnecting", speaking: [], micOn: false });
        const tryNo = retries++;
        setTimeout(() => { if (attempt === id && last) this.join({ ...last, speak, rejoin: true }); }, 1000 * 2 ** tryNo);
      });
      // The server can take the right to speak away at once (moved off the stage, muted): follow it.
      r.on(RoomEvent.ParticipantPermissionsChanged, (_prev, p) => { if (p === r.localParticipant && !r.localParticipant.permissions?.canPublish) emit({ micOn: false }); });
      try {
        // LiveKit retries on its own; past 10 s the person is told rather than left waiting.
        await Promise.race([r.connect(url, token), new Promise((_, no) => setTimeout(() => no(new Error("timeout")), 10000))]);
      } catch {
        if (attempt === id) { room = null; r.disconnect?.().catch?.(() => {}); emit({ status: "off", error: "connect-failed" }); }
        return;
      }
      if (attempt !== id) return; // left while connecting
      retries = 0;
      emit({ status: "live", needsTap: !r.canPlaybackAudio });
      if (wantSpeak) await micOn(true);
    },
    setMic: micOn,
    /** Silences everyone else (the microphone is the caller's business). */
    setDeafened(on) {
      for (const el of players.values()) el.muted = on;
    },
    /** Browsers play sound only after a tap: call from the "Turn on sound" button. */
    async startAudio() {
      if (!room) return;
      try { await room.startAudio(); } catch { /* still blocked: the button stays */ }
      emit({ needsTap: !room.canPlaybackAudio });
    },
    /** After "Voice couldn't connect": the same room again. */
    retry() { if (last) { retries = 0; return this.join({ ...last, speak: false }); } },
    async leave() {
      attempt++;
      last = null;
      const r = room;
      room = null;
      for (const [sid, el] of players) { el.remove(); players.delete(sid); }
      if (r) await r.disconnect();
      emit({ status: "off", speaking: [], micOn: false, needsTap: false, room: null, error: null });
    },
  };
}

// Where the microphone setting lives, on this device.
const IOS = typeof navigator !== "undefined" && /iPhone|iPad|iPod/.test(navigator.userAgent);
const MIC_HOW = IOS ? "On iPhone: tap aA in the address bar, then Website Settings, then Microphone: Allow." : "Click the icon at the left of the address bar, then Microphone: Allow.";

/** What a voice error means, in words, with what to do. */
export const AUDIO_ERRORS = {
  "mic-denied": `Your browser blocked the microphone. ${MIC_HOW} Then Try again.`,
  "no-mic": "No microphone found. Connect one, then Try again.",
  "mic-failed": "The microphone didn’t start. Try again.",
  "connect-failed": "Voice couldn’t connect. Check your connection; the lobby still works without it.",
};
