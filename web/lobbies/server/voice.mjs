// Voice. The audio itself goes through an SFU (LiveKit, or anything that takes its access tokens); this server
// decides who may speak and hands out the tokens that say so. Two shapes:
//
// - The lobby stage: the host speaks, up to 8 speakers, everyone else listens. A listener raises a hand; the host
//   (or a speaker they made a co-host) brings them up; a speaker steps down, or the host moves them back. Only a
//   speaker's token can publish audio.
// - The clan Campfire: every member may talk; a moderator can mute someone (their next token cannot publish).
//
// Tokens are LiveKit access tokens: an HS256 JWT signed with the SFU's API secret, with a `video` grant.

import { createHmac } from "node:crypto";

export const MAX_SPEAKERS = 8;
const TOKEN_TTL_SEC = 2 * 3600;

const b64url = (x) => Buffer.from(typeof x === "string" ? x : JSON.stringify(x)).toString("base64url");

/** A LiveKit access token for `identity` in `room`, publishing only if `canPublish`. */
export function sfuToken({ apiKey, apiSecret, identity, room, canPublish, name = identity, now = Date.now() }) {
  const iat = Math.floor(now / 1000);
  const payload = { iss: apiKey, sub: identity, name, nbf: iat, iat, exp: iat + TOKEN_TTL_SEC, jti: `${identity}-${iat}`,
    video: { room, roomJoin: true, canSubscribe: true, canPublish, canPublishData: false, canPublishSources: canPublish ? ["microphone"] : [] } };
  const body = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(payload)}`;
  return `${body}.${createHmac("sha256", apiSecret).update(body).digest("base64url")}`;
}

/** Reads a token back (tests, and the SFU webhook if one is wired): the payload if the signature holds, else null. */
export function readSfuToken(token, apiSecret) {
  const [h, p, sig] = String(token).split(".");
  if (!h || !p || !sig) return null;
  if (createHmac("sha256", apiSecret).update(`${h}.${p}`).digest("base64url") !== sig) return null;
  return JSON.parse(Buffer.from(p, "base64url").toString());
}

/**
 * One lobby's stage: pure state, the room relays it. `host` is the lobby's host, or a function giving it (on a
 * cluster it is known once the indexer has read the lobby). Each action returns null or an error code.
 */
export function createStage({ host: hostOf }) {
  const host = () => (typeof hostOf === "function" ? hostOf() : hostOf);
  const speakers = new Set(); // besides the host
  const cohosts = new Set();
  const hands = []; // in the order raised
  const isSpeaker = (user) => !!user && (user === host() || speakers.has(user));
  const canManage = (user) => !!user && (user === host() || cohosts.has(user));
  return {
    view: () => ({ host: host(), speakers: [host(), ...speakers].filter(Boolean), cohosts: [...cohosts], hands: [...hands] }),
    isSpeaker,
    raise(user, up) {
      if (isSpeaker(user)) return "AlreadySpeaking";
      const i = hands.indexOf(user);
      if (up && i < 0) hands.push(user);
      if (!up && i >= 0) hands.splice(i, 1);
      return null;
    },
    bring(by, user) {
      if (!canManage(by)) return "NotAllowed";
      if (isSpeaker(user)) return null;
      if (speakers.size + 1 >= MAX_SPEAKERS) return "StageFull";
      const i = hands.indexOf(user);
      if (i < 0) return "NoHandRaised"; // nobody is pulled on stage who did not ask
      hands.splice(i, 1);
      speakers.add(user);
      return null;
    },
    down(by, user) {
      if (user === host()) return "NotAllowed";
      if (by !== user && !canManage(by)) return "NotAllowed";
      if (cohosts.has(user) && by !== host() && by !== user) return "NotAllowed"; // a co-host is moved only by the host
      speakers.delete(user);
      cohosts.delete(user);
      return null;
    },
    cohost(by, user, on) {
      if (by !== host() || !speakers.has(user)) return "NotAllowed";
      if (on) cohosts.add(user); else cohosts.delete(user);
      return null;
    },
    leave(user) {
      const i = hands.indexOf(user);
      if (i >= 0) hands.splice(i, 1);
      speakers.delete(user);
      cohosts.delete(user);
    },
  };
}

/**
 * The SFU's admin API (LiveKit's RoomService over Twirp): a speaker moved off the stage, or a muted member, loses the
 * right to publish at once, not only at their next token. `url` is the SFU's HTTP address.
 */
export function sfuAdmin({ url, apiKey, apiSecret, fetchImpl = globalThis.fetch, now = () => Date.now() }) {
  const adminToken = (room) => {
    const iat = Math.floor(now() / 1000);
    const body = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ iss: apiKey, sub: "lobbies-server", nbf: iat, iat, exp: iat + 600, video: { room, roomAdmin: true } })}`;
    return `${body}.${createHmac("sha256", apiSecret).update(body).digest("base64url")}`;
  };
  return {
    async setCanPublish(room, identity, canPublish) {
      const r = await fetchImpl(`${url.replace(/\/$/, "")}/twirp/livekit.RoomService/UpdateParticipant`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${adminToken(room)}` },
        body: JSON.stringify({ room, identity, permission: { canSubscribe: true, canPublish, canPublishData: false, canPublishSources: canPublish ? ["MICROPHONE"] : [] } }),
      });
      // Not in the room right now is fine: their next token carries the same right.
      if (!r.ok && r.status !== 404) throw new Error(`SFU refused UpdateParticipant (${r.status})`);
    },
  };
}
