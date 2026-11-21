// Compares the scope gates on one labelled set: the OpenRouter 3-way screen
// (#98) against the Jev scope gate (four outcomes, plus trade and safety).
//
//   npx tsx apps/api/scripts/eval-scope.ts [gate ...]
//
// Gates: openrouter (google/gemini-3.5-flash-lite), jev. Reads OPENROUTER_API_KEY
// and TYPESAFE_API_KEY from the environment or from apps/api/.dev.vars
// (DEV_VARS=/path/to/.dev.vars to point elsewhere). Keys are never printed.
//
// Cases come from test/fixtures/screen-requests.json (the original 38, three
// outcomes) plus test/fixtures/scope-cases.json (the boundary cases, four
// outcomes). `expected` is the outcome a good gate gives.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { openRouterScreener, screenRequest, type ScreenVerdict } from "../src/screen.ts";
import { jevScopeGateOver, scopeClassifier, type ScopeOutcome } from "../src/scope.ts";

type Case = { text: string; reply?: string; photoCount?: number; expected: ScopeOutcome; note?: string };
type Outcome = ScreenVerdict | "out_of_scope";
type Result = { c: Case; got: Outcome | null; ms: number; error: string | null; detail?: string };

const TIMEOUT_MS = 15_000;
const DEFAULT_GATES = ["openrouter", "jev", "jev-router"];

function devVars(): Record<string, string> {
  const path = process.env.DEV_VARS ?? join(import.meta.dirname, "../.dev.vars");
  const out: Record<string, string> = {};
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const m = /^\s*([A-Z_]+)\s*=\s*(.*)$/.exec(line);
      if (m?.[1]) out[m[1]] = (m[2] ?? "").trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    // Reported by need() below.
  }
  return out;
}

const vars = devVars();
function need(name: string): string {
  const value = process.env[name] || vars[name];
  if (!value) {
    console.error(`No ${name} in the environment or apps/api/.dev.vars.`);
    process.exit(1);
  }
  return value;
}

const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? NaN;
};

async function pool<T, R>(items: T[], size: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await run(items[i]!);
      }
    }),
  );
  return out;
}

const cases = (): Case[] => {
  const read = (file: string) => (JSON.parse(readFileSync(join(import.meta.dirname, "../test/fixtures", file), "utf8")) as { cases: Case[] }).cases;
  // The two-turn cases in the original set share a text with a single-turn case,
  // so a case is keyed by its text and reply. scope-cases.json supersedes: it
  // restates three of the original 38 where this gate resolves the question
  // their notes deferred ("another check handles that" — this is that check).
  const byKey = new Map<string, Case>();
  for (const c of [...read("screen-requests.json"), ...read("scope-cases.json")]) byKey.set(JSON.stringify([c.text, c.reply ?? null]), c);
  return [...byKey.values()];
};

type Gate = { name: string; run: (c: Case) => Promise<{ got: Outcome; detail?: string }> };

const gate = (name: string): Gate => {
  if (name === "openrouter") {
    const screener = openRouterScreener(need("OPENROUTER_API_KEY"), process.env.SCREEN_MODEL || "google/gemini-3.5-flash-lite");
    return {
      name: `${process.env.SCREEN_MODEL || "google/gemini-3.5-flash-lite"} (3-way, OpenRouter)`,
      run: async (c) => ({ got: await screenRequest(screener, { text: c.text, reply: c.reply ?? null, photoCount: c.photoCount ?? 0 }, TIMEOUT_MS) }),
    };
  }
  // "jev" is Jev over the native TypeSafe API; "jev-router" is the same model
  // through OpenRouter, on the key the Worker already holds.
  if (name === "jev" || name === "jev-router") {
    const classifier = scopeClassifier({ typesafe: name === "jev" ? need("TYPESAFE_API_KEY") : undefined, openrouter: name === "jev-router" ? need("OPENROUTER_API_KEY") : undefined });
    if (!classifier) {
      console.error("No key for that gate.");
      process.exit(1);
    }
    const gate = jevScopeGateOver(classifier);
    return {
      name: name === "jev" ? "jev-latest (4-way, TypeSafe)" : "typesafe/jev-router (4-way, OpenRouter)",
      run: async (c) => {
        const r = await gate.assess({ text: c.text, reply: c.reply ?? null, photoCount: c.photoCount ?? 0 }, AbortSignal.timeout(TIMEOUT_MS));
        return { got: r.verdict, detail: [r.trade, r.safety ? "safety" : null].filter(Boolean).join(" ") || undefined };
      },
    };
  }
  console.error(`Unknown gate: ${name}`);
  process.exit(1);
};

const all = cases();
const rows: string[] = [];
for (const name of process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_GATES) {
  const g = gate(name);
  // One warm-up call so the first case doesn't pay for a cold route.
  await g.run({ text: "tap is dripping", expected: "work" }).catch(() => {});
  const results: Result[] = await pool(all, 4, async (c) => {
    const started = performance.now();
    try {
      const { got, detail } = await g.run(c);
      return { c, got, ms: performance.now() - started, error: null, detail };
    } catch (error) {
      return { c, got: null, ms: performance.now() - started, error: String(error instanceof Error ? error.message : error).slice(0, 90) };
    }
  });

  const exact = results.filter((r) => r.got === r.c.expected);
  const genuineBlocked = results.filter((r) => r.c.expected === "work" && r.got === "invalid");
  const invalidLet = results.filter((r) => r.c.expected === "invalid" && r.got === "work");
  const scopeCases = results.filter((r) => r.c.expected === "out_of_scope");
  const scopeCaught = scopeCases.filter((r) => r.got === "out_of_scope");
  const errors = results.filter((r) => r.error);
  const ms = results.filter((r) => !r.error).map((r) => r.ms);

  console.log(`\n## ${g.name}`);
  for (const r of results) {
    if (r.got !== r.c.expected) {
      console.log(`  ✗ ${r.c.expected} → ${r.got ?? `error (${r.error})`}${r.detail ? ` [${r.detail}]` : ""}: ${JSON.stringify(r.c.text)}${r.c.reply ? ` + ${JSON.stringify(r.c.reply)}` : ""}`);
    }
  }
  const summary = {
    exact: `${exact.length}/${results.length}`,
    genuineBlocked: `${genuineBlocked.length}/${results.filter((r) => r.c.expected === "work").length}`,
    invalidLetThrough: `${invalidLet.length}/${results.filter((r) => r.c.expected === "invalid").length}`,
    outOfScopeCaught: `${scopeCaught.length}/${scopeCases.length}`,
    errors: errors.length,
    medianMs: Math.round(percentile(ms, 50)),
    p95Ms: Math.round(percentile(ms, 95)),
  };
  console.log(JSON.stringify(summary));
  rows.push(
    `| ${g.name} | ${summary.exact} | ${summary.genuineBlocked} | ${summary.invalidLetThrough} | ${summary.outOfScopeCaught} | ${summary.errors} | ${summary.medianMs} | ${summary.p95Ms} |`,
  );
}

console.log(`\n| Gate | Exact | Genuine blocked | Invalid let through | Out of scope caught | Errors | Median ms | p95 ms |
| --- | --- | --- | --- | --- | --- | --- | --- |
${rows.join("\n")}`);
