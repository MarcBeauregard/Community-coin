// Builds the lobbies app into web/dist/lobbies: index.html (styles inlined), app.js, the chunks loaded only when
// needed (voice: LiveKit) and assets/.
// Usage: node web/lobbies/build.mjs

import { build } from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = process.env.OUTDIR ?? join(here, "..", "dist", "lobbies");

mkdirSync(dist, { recursive: true });
rmSync(join(dist, "chunks"), { recursive: true, force: true }); // no stale chunks from earlier builds
await build({
  entryPoints: [join(here, "src/main.js")],
  bundle: true,
  format: "esm",
  splitting: true,
  chunkNames: "chunks/[name]-[hash]",
  platform: "browser",
  target: "es2022",
  minify: process.env.MINIFY !== "0",
  outdir: dist,
  entryNames: "app",
  define: { "process.env.NODE_ENV": '"production"' },
  legalComments: "none",
  logLevel: "warning",
});
cpSync(join(here, "assets"), join(dist, "assets"), { recursive: true });
const css = readFileSync(join(here, "src/styles.css"), "utf8");
writeFileSync(join(dist, "index.html"), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#000000">
<title>Social Launch — Lobbies</title>
<meta name="description" content="Pick the next memecoin together in one hour, then stay together in its clan.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">
<style>
${css}</style>
</head>
<body>
<div id="app"></div>
<script type="module" src="app.js"></script>
</body>
</html>
`);
console.log(`built ${dist} (app.js ${(readFileSync(join(dist, "app.js")).length / 1024).toFixed(0)} KB)`);
