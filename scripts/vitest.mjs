// Runs Vitest with an uppercase drive letter on Windows.
// A terminal opened at "c:\..." (lowercase, common in VS Code and Git Bash)
// makes Vitest load itself twice, and every test fails with
// "Vitest failed to find the current suite".
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const upperDrive = (path) =>
  process.platform === "win32" && /^[a-z]:/.test(path) ? path[0].toUpperCase() + path.slice(1) : path;

const require = createRequire(import.meta.url);
const vitestBin = upperDrive(join(dirname(require.resolve("vitest/package.json")), "vitest.mjs"));

const result = spawnSync(process.execPath, [vitestBin, ...process.argv.slice(2)], {
  cwd: upperDrive(process.cwd()),
  stdio: "inherit",
});
process.exit(result.status ?? 1);
