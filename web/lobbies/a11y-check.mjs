// Accessibility audit (WCAG 2.2 AA), every scene on a phone and a desktop: names for every control, alt text,
// labelled fields, unique ids, text contrast measured on the rendered page, touch targets, landmarks, the sheets'
// keyboard behaviour (focus moves in, Escape closes, focus comes back), and reduced motion.
// Usage: node web/lobbies/a11y-check.mjs   (after npm run build:lobbies)

import { createRequire } from "node:module";
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "lobbies");
const SCENES = ["discover", "listening", "lobby", "lobby-stage", "lobby-chat", "lobby-backed", "lobby-locked", "sheet-pledge", "sheet-propose",
  "sheet-host", "sheet-wallet", "sheet-receipt", "sheet-terms", "launch-founder", "launch-refund", "clan", "clan-voice"];
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".png": "image/png", ".jpg": "image/jpeg" };

let failures = 0;
const check = (cond, msg) => { if (cond) console.log(`  ok  ${msg}`); else { failures++; console.log(`FAIL  ${msg}`); } };

const files = http.createServer((req, res) => {
  const p = join(dist, decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/\/$/, "/index.html"));
  if (!p.startsWith(dist) || !existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": TYPES[extname(p)] || "application/octet-stream" });
  res.end(readFileSync(p));
});
await new Promise((r) => files.listen(0, r));
const base = `http://localhost:${files.address().port}/index.html`;
const browser = await chromium.launch();

// Runs in the page: the audit of what is on screen now.
function audit() {
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  const name = (el) => (el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") && document.getElementById(el.getAttribute("aria-labelledby"))?.textContent || el.textContent || el.getAttribute("title") || "").trim();
  const out = { unnamed: [], noAlt: [], unlabelled: [], dupIds: [], lowContrast: [], small: [], tiny: [], landmarks: 0 };
  for (const el of document.querySelectorAll("button, a[href], [role=button], [role=tab]")) if (visible(el) && !name(el)) out.unnamed.push(el.outerHTML.slice(0, 90));
  for (const el of document.querySelectorAll("img")) if (visible(el) && !el.hasAttribute("alt")) out.noAlt.push(el.src.slice(-40));
  for (const el of document.querySelectorAll("input:not([type=hidden]):not([hidden]), textarea, select")) {
    const labelled = el.getAttribute("aria-label") || el.closest("label") || (el.id && document.querySelector(`label[for="${el.id}"]`)) || el.getAttribute("aria-labelledby");
    if (visible(el) && !labelled) out.unlabelled.push(el.outerHTML.slice(0, 90));
  }
  const ids = [...document.querySelectorAll("[id]")].map((e) => e.id);
  out.dupIds = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  // Contrast: each visible text node's colour against the first opaque background behind it (gradients are read
  // through their darkest stop: the pages sit on black).
  const rgba = (c) => { const m = c.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 0]; return { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
  // The backgrounds behind an element, as the list of colours the text may sit on: a gradient gives each of its
  // stops (the worst one counts), layered over whatever is behind it.
  const backdrops = (el) => {
    let stack = [[]];
    for (let e = el; e; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (/url\(/.test(s.backgroundImage)) return null; // text over a picture: not measurable here
      const stops = s.backgroundImage === "none" ? [] : (s.backgroundImage.match(/rgba?\([^)]+\)/g) ?? []).map(rgba);
      const c = rgba(s.backgroundColor);
      const here = [...(c.a > 0 ? [c] : []), ...(stops.length ? [stops] : [])];
      if (here.length) stack.push(here);
      if (c.a >= 1 && !stops.length) break;
    }
    let colors = [{ r: 0, g: 0, b: 0, a: 1 }];
    for (const layer of stack.reverse()) for (const part of layer) {
      const tops = Array.isArray(part) ? part : [part];
      colors = colors.flatMap((u) => tops.map((t) => over(t, u)));
      if (colors.length > 16) colors = colors.slice(0, 16);
    }
    return colors;
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!n.textContent.trim() || !el || !visible(el) || el.closest("[aria-hidden=true], .sr, svg")) continue;
    // Initials under a photo or a logo are only seen while it loads: the picture covers them.
    if ([...el.children].some((c) => c.tagName === "IMG" && c.complete && c.naturalWidth > 0)) continue;
    const s = getComputedStyle(el);
    const bgs = backdrops(el);
    if (!bgs) continue;
    const ratio = Math.min(...bgs.map((bg) => {
      let fg = rgba(s.color);
      fg = over({ ...fg, a: fg.a * Number(s.opacity) }, bg);
      const [l1, l2] = [lum(fg), lum(bg)].sort((a, b) => b - a);
      return (l1 + 0.05) / (l2 + 0.05);
    }));
    const size = parseFloat(s.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(s.fontWeight) >= 700);
    const disabled = el.closest("button:disabled, [aria-disabled=true]");
    if (!disabled && ratio < (large ? 3 : 4.5)) out.lowContrast.push(`${ratio.toFixed(2)} "${n.textContent.trim().slice(0, 30)}"`);
  }
  for (const el of document.querySelectorAll("button, a[href], input, [role=button], [role=tab]")) {
    if (!visible(el) || el.closest(".sr")) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 24 || r.height < 24) out.tiny.push(`${Math.round(r.width)}×${Math.round(r.height)} ${name(el).slice(0, 24) || el.tagName}`);
    else if (r.width < 44 && r.height < 44) out.small.push(name(el).slice(0, 24));
  }
  out.landmarks = document.querySelectorAll("main, nav, [role=main], [role=navigation], section[aria-label], aside[aria-label], [role=region]").length;
  out.lowContrast = [...new Set(out.lowContrast)];
  return out;
}

const totals = { small: 0 };
for (const [w, h, label] of [[390, 844, "phone"], [1440, 900, "desktop"]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  const found = { unnamed: [], noAlt: [], unlabelled: [], dupIds: [], lowContrast: [], tiny: [], landmarks: [] };
  for (const scene of SCENES) {
    await page.goto(`${base}?freeze&scene=${scene}`);
    await page.waitForTimeout(350);
    const a = await page.evaluate(audit);
    for (const k of ["unnamed", "noAlt", "unlabelled", "dupIds", "lowContrast", "tiny"]) for (const x of a[k]) found[k].push(`${scene}: ${x}`);
    if (a.landmarks === 0) found.landmarks.push(scene);
    totals.small += a.small.length;
  }
  const show = (xs) => (xs.length ? ` (${[...new Set(xs.map((x) => x.replace(/^[\w-]+: /, "")))].slice(0, 8).join("; ")}${xs.length > 8 ? `; ${xs.length} in all` : ""})` : "");
  check(found.unnamed.length === 0, `${label}: every control has a name${show(found.unnamed)}`);
  check(found.noAlt.length === 0, `${label}: every image has alt text${show(found.noAlt)}`);
  check(found.unlabelled.length === 0, `${label}: every field has a label${show(found.unlabelled)}`);
  check(found.dupIds.length === 0, `${label}: ids are unique${show(found.dupIds)}`);
  check(found.lowContrast.length === 0, `${label}: text contrast at least 4.5:1 (3:1 large)${show(found.lowContrast)}`);
  check(found.tiny.length === 0, `${label}: every target is at least 24×24 px (WCAG 2.5.8)${show(found.tiny)}`);
  check(found.landmarks.length === 0, `${label}: every screen has landmarks${show(found.landmarks)}`);
  await page.close();
}
console.log(`  --  targets between 24 and 44 px (fine for WCAG AA, below Apple's 44 pt comfort size): ${totals.small} across all scenes`);

// Keyboard: a sheet takes focus, keeps Tab inside, closes on Escape and gives focus back.
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.goto(`${base}?freeze&scene=lobby`);
  await page.waitForTimeout(400);
  const opener = page.getByRole("button", { name: /^Pledge/ }).first();
  await opener.focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  const inDialog = () => page.evaluate(() => !!document.activeElement?.closest("[role=dialog]"));
  check(await inDialog(), "opening a sheet moves focus into it");
  let stayed = true;
  for (let i = 0; i < 12; i++) { await page.keyboard.press("Tab"); stayed &&= await inDialog(); }
  check(stayed, "Tab stays inside the open sheet");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  check((await page.locator("[role=dialog]").count()) === 0, "Escape closes it");
  check(await page.evaluate(() => /Pledge/.test(document.activeElement?.textContent ?? "")), "and focus returns to the button that opened it");
  await page.close();
}

// Reduced motion: animations stop for people who ask.
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.goto(`${base}?freeze&scene=lobby-stage`);
  await page.waitForTimeout(400);
  const moving = await page.evaluate(() => [...document.querySelectorAll("*")].filter((e) => { const s = getComputedStyle(e); return s.animationName !== "none" && parseFloat(s.animationDuration) > 0.01 && s.animationIterationCount === "infinite"; }).length);
  check(moving === 0, `with reduced motion, nothing loops (${moving} looping)`);
  await page.close();
}

await browser.close();
files.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
