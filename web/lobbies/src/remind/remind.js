// Reminders for a lobby that hasn't opened yet: a notification 5 minutes before (from this page, so while one of
// its tabs is open: browsers don't let a page wake itself up later), and the calendar, which always works.

export const LEAD_MS = 5 * 60 * 1000;
const KEY = "lobbies.reminders";

/** The next time the clock reads `hhmm` ("21:00") here, as ms. Past today's, tomorrow's. */
export function nextOpening(hhmm, now = Date.now()) {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** A time as the app writes every time: 24-hour, "20:55". */
export const hhmm = (ms) => new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
/** "today" or "tomorrow" for a time within the next day. */
export const dayOf = (ms, now = Date.now()) => (new Date(ms).toDateString() === new Date(now).toDateString() ? "today" : "tomorrow");

const stamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const esc = (t) => String(t).replace(/\\/g, "\\\\").replace(/[;,]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");

/** An .ics file for the lobby's hour, with an alarm 5 minutes before. */
export function icsFor({ id, name, theme, host }, at, url) {
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Community Coin//Lobbies//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:lobby-${id}-${at}@community-coin`,
    `DTSTAMP:${stamp(Date.now())}`,
    `DTSTART:${stamp(at)}`,
    `DTEND:${stamp(at + 3600_000)}`,
    `SUMMARY:${esc(`${name} · Community Coin lobby`)}`,
    `DESCRIPTION:${esc(`${theme}\nHosted by @${host}. One hour to pick a coin together: pledge on the idea you want launched.\n${url}`)}`,
    `URL:${url}`,
    "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(`${name} opens in 5 minutes`)}`, "TRIGGER:-PT5M", "END:VALARM",
    "END:VEVENT", "END:VCALENDAR", "",
  ].join("\r\n");
}

/** The same event, as a link that opens Google Calendar's new-event page. */
export function googleCalendarUrl({ name, theme, host }, at, url) {
  const q = new URLSearchParams({ action: "TEMPLATE", text: `${name} · Community Coin lobby`, dates: `${stamp(at)}/${stamp(at + 3600_000)}`,
    details: `${theme}\nHosted by @${host}.\n${url}`, location: url });
  return `https://calendar.google.com/calendar/render?${q}`;
}

export const calendarFileName = (lobby) => `${lobby.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.ics`;

/** Whether this browser can show notifications, and what the person said: "granted" | "denied" | "default" | null. */
export function notifyPermission() {
  try { return typeof Notification === "undefined" ? null : Notification.permission; } catch { return null; }
}
export async function askToNotify() {
  try { return typeof Notification === "undefined" ? null : await Notification.requestPermission(); } catch { return "denied"; }
}

/** The reminders kept on this device: { [lobbyId]: { at, name, theme, notify } }. */
export function loadReminders() {
  try { const r = JSON.parse(localStorage.getItem(KEY) ?? "{}"); return r && typeof r === "object" ? r : {}; } catch { return {}; }
}
export function saveReminders(r) {
  try { localStorage.setItem(KEY, JSON.stringify(r)); } catch {}
}

/**
 * Arms a timer per reminder that notifies 5 minutes before the opening (or right away when the page opens inside
 * those 5 minutes). Returns a function that disarms them all. `onFire(id, reminder)` runs when one goes off.
 */
export function armReminders(reminders, onFire, now = Date.now()) {
  const timers = [];
  for (const [id, r] of Object.entries(reminders)) {
    if (!r || typeof r !== "object" || !r.notify) continue;
    const due = r.at - LEAD_MS - now;
    if (r.at <= now || due > 2 ** 31 - 1) continue; // past, or further than a timer can wait
    timers.push(setTimeout(() => onFire(id, r), Math.max(0, due)));
  }
  return () => timers.forEach(clearTimeout);
}

/** Shows the notification; a click brings the tab back. */
export function notify(r, url) {
  try {
    const n = new Notification(`${r.name} opens in 5 minutes`, { body: r.theme, tag: `lobby-${r.id ?? r.name}` });
    n.onclick = () => { window.focus(); if (url) location.href = url; n.close(); };
    return true;
  } catch { return false; }
}
