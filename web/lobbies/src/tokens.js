// Design tokens of the lobbies app ("Obsidian Glass"). styles.css declares the same values as CSS variables;
// visual.mjs checks that the two stay equal, so the script and the stylesheet never drift.
//
// Each accent has one job: lime is money and actions, sky is voice and presence, amber is the lock and warnings,
// red is leaving or destroying. Text never goes dimmer than `text2` (4.5:1 on black).

export const color = {
  bg: "#000000",
  text: "#f5f5f7",
  text2: "rgba(235, 235, 245, 0.64)",
  lime: "#cbf35c",
  sky: "#64d2ff",
  amber: "#ff9f0a",
  red: "#ff453a",
  redFill: "#d70015", // under white text (5.3:1); the brighter red is for icons and text on black
  glass: "rgba(24, 24, 28, 0.62)",
  line: "rgba(255, 255, 255, 0.08)",
  fill: "rgba(118, 118, 128, 0.24)",
};

export const radius = { sm: 12, md: 22, lg: 30, pill: 999 };

export const motion = {
  spring: "cubic-bezier(0.2, 0.8, 0.2, 1)",
  fast: 250,
  base: 450,
};

// Width below which the app uses its phone layout (tab bar, one panel at a time).
export const phoneBreakpoint = 900;

// A coin is struck in its own hue: a lit face, a darker rim, and a glow of the same color.
export function coinStyle(hue, big = false) {
  return {
    background: `radial-gradient(circle at 32% 24%, hsl(${hue} 100% 90%) 0%, hsl(${hue} 88% 70%) 36%, hsl(${hue} 72% 48%) 100%)`,
    color: `hsl(${hue} 70% 16%)`,
    boxShadow: big
      ? `inset 0 0 0 3px hsla(${hue},100%,94%,.6), inset 0 -22px 40px hsla(${hue},70%,22%,.5), 0 30px 90px hsla(${hue},90%,55%,.45), 0 0 0 14px hsla(${hue},90%,70%,.06)`
      : `inset 0 0 0 1.5px hsla(${hue},100%,94%,.55), inset 0 -8px 16px hsla(${hue},70%,22%,.45), 0 10px 28px hsla(${hue},90%,55%,.28)`,
  };
}

// The ambient light behind a screen takes the hue of whatever leads it (the leading idea, the winner, the clan).
export function ambient(hue, strength = 0.22) {
  return `radial-gradient(60% 60% at 75% 0%, hsla(${hue},90%,55%,${strength}), transparent 70%), radial-gradient(40% 50% at 10% 10%, hsla(${(hue + 120) % 360},90%,55%,${strength / 2}), transparent 70%)`;
}
