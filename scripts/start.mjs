#!/usr/bin/env node
// One command to install everything and run Legwork locally: `npm start`.
// Installs dependencies, creates apps/api/.dev.vars from the example if it's
// missing, sets up the local database, then starts the web app and API.

import { execSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const log = (msg) => console.log(`\n\x1b[1m▶ ${msg}\x1b[0m`);
const fail = (msg) => {
  console.error(`\n\x1b[31m✖ ${msg}\x1b[0m`);
  process.exit(1);
};

const major = Number(process.versions.node.split(".")[0]);
if (major < 22) fail(`Node 22 or newer is needed (you have ${process.version}). Install it from https://nodejs.org or run \`nvm use\`.`);

// Use pnpm if it's installed, otherwise run the pinned version through npx.
let pnpm = ["pnpm"];
try {
  execSync("pnpm --version", { stdio: "ignore" });
} catch {
  const pinned = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).packageManager ?? "pnpm@10";
  pnpm = ["npx", "--yes", pinned];
}

const run = (args, opts = {}) => {
  const [cmd, ...rest] = [...pnpm, ...args];
  const res = spawnSync(cmd, rest, { cwd: root, stdio: "inherit", shell: process.platform === "win32", ...opts });
  if (res.status !== 0) fail(`\`pnpm ${args.join(" ")}\` failed.`);
};

log("Installing dependencies");
run(["install"]);

const vars = join(root, "apps/api/.dev.vars");
if (!existsSync(vars)) {
  copyFileSync(join(root, "apps/api/.dev.vars.example"), vars);
  log("Created apps/api/.dev.vars from the example");
}
const env = readFileSync(vars, "utf8");
const missing = (key) => !new RegExp(`^${key}=\\S+`, "m").test(env);
if (missing("ANTHROPIC_API_KEY")) {
  console.warn("\x1b[33m  ! ANTHROPIC_API_KEY is empty in apps/api/.dev.vars. The job questions won't work until you add it.\x1b[0m");
}
if (missing("OPENROUTER_API_KEY")) {
  console.warn("\x1b[33m  ! OPENROUTER_API_KEY is empty. Optional: it powers photo reading and the voice typing fallback.\x1b[0m");
}

log("Setting up the local database");
run(["--filter", "@legwork/api", "db:migrate"], { env: { ...process.env, CI: "1" } });

const inUse = (port) =>
  new Promise((resolve) => {
    const server = createServer()
      .once("error", () => resolve(true))
      .once("listening", () => server.close(() => resolve(false)))
      .listen(port);
  });
for (const port of [3000, 8787]) {
  if (await inUse(port)) fail(`Port ${port} is already in use. Legwork may already be running; stop it (Ctrl+C) and try again.`);
}

log("Starting Legwork: web on http://localhost:3000, API on http://localhost:8787 (Ctrl+C to stop)");
run(["dev"]);
