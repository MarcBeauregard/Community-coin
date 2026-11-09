// Every check of the lobbies, one after the other, on a fresh build: each *-check.mjs, then the screenshots
// (visual.mjs). One line per suite; a failing suite prints what failed. Exits 1 if any failed.
// chain-check reads what the program's tests wrote: run `npm run test:solana` first.
// Usage: node web/lobbies/check.mjs [name…]     e.g. `finale net` runs finale-check and net-check only

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const all = [...readdirSync(here).filter((f) => f.endsWith("-check.mjs")).sort(), "visual.mjs"];
const wanted = process.argv.slice(2);
const unknown = wanted.filter((w) => !all.some((f) => f === `${w}-check.mjs` || f === `${w}.mjs`));
if (unknown.length) { console.error(`No such check: ${unknown.join(", ")}. There are: ${all.map((f) => f.replace(/(-check)?\.mjs$/, "")).join(", ")}`); process.exit(2); }
const suites = wanted.length ? all.filter((f) => wanted.some((w) => f === `${w}-check.mjs` || f === `${w}.mjs`)) : all;

const run = (file) => spawnSync(process.execPath, [join(here, file)], { encoding: "utf8", timeout: 15 * 60_000, maxBuffer: 64 << 20 });
const build = run("build.mjs");
if (build.status !== 0) { console.error(build.stdout + build.stderr); console.error("FAIL  build"); process.exit(1); }

let failed = 0;
for (const file of suites) {
  const t0 = Date.now();
  const r = run(file);
  const ok = r.status === 0;
  console.log(`${ok ? "PASS" : "FAIL"}  ${file.replace(/\.mjs$/, "")}  (${Math.round((Date.now() - t0) / 1000)} s)`);
  if (!ok) {
    failed++;
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.split("\n");
    const lines = out.filter((l) => /^FAIL|Error|error:/.test(l));
    console.log((lines.length ? lines : out.slice(-25)).slice(0, 25).map((l) => `      ${l}`).join("\n"));
    if (r.error) console.log(`      ${r.error.message}`);
  }
}
console.log(failed ? `\n${failed} of ${suites.length} suites failed` : `\nall ${suites.length} suites passed`);
process.exit(failed ? 1 : 0);
