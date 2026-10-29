// Builds the launchpad web app into web/dist:
//   app.js      the whole app (UI, EVM, contracts) in one script
//   page.html   the page as published on claude.ai (the host adds doctype, head and body)
//   index.html  the same page as a standalone document, for any static host
// Run `npx hardhat compile` first so the contract artifacts are fresh.

import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const web = dirname(fileURLToPath(import.meta.url));
const root = join(web, "..");
const artifact = (name) => JSON.parse(readFileSync(join(root, `artifacts/contracts/${name}.sol/${name}.json`), "utf8"));
const contracts = Object.fromEntries(
  ["CommunityCoin", "MemeToken"].map((name) => {
    const { abi, bytecode } = artifact(name);
    return [name, { abi, bytecode }];
  }),
);
writeFileSync(join(web, "src/contracts.json"), JSON.stringify(contracts));

const dist = process.env.OUTDIR ?? join(web, "dist");

// DEPLOYMENTS_JSON='{"31337":{"name":"…","hub":"0x…"}}' builds the app against other hubs (used by the wallet test).
const deploymentsOverride = process.env.DEPLOYMENTS_JSON && {
  name: "deployments-override",
  setup(b) {
    b.onLoad({ filter: /deployments\.js$/ }, () => ({
      contents: `export const DEPLOYMENTS = ${JSON.stringify(JSON.parse(process.env.DEPLOYMENTS_JSON))};`,
      loader: "js",
    }));
  },
};
mkdirSync(dist, { recursive: true });
await build({
  entryPoints: [join(web, "src/app.js")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  minify: process.env.MINIFY !== "0",
  outfile: join(dist, "app.js"),
  define: { "process.env.NODE_ENV": '"production"' },
  legalComments: "none",
  logLevel: "warning",
  plugins: deploymentsOverride ? [deploymentsOverride] : [],
});

const page = readFileSync(join(web, "page.html"), "utf8");
writeFileSync(join(dist, "page.html"), page);
const [head, body] = page.split("<!-- body -->");
writeFileSync(
  join(dist, "index.html"),
  `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${head}</head>\n<body>${body}</body>\n</html>\n`,
);
console.log(`built ${dist} (app.js ${(readFileSync(join(dist, "app.js")).length / 1024).toFixed(0)} KB)`);
