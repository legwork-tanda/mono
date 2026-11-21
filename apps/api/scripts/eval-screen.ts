// Compares candidate screening models (#98) on the labelled set in
// test/fixtures/screen-requests.json, through the same prompt, schema and
// OpenRouter call the API uses (src/screen.ts).
//
//   node apps/api/scripts/eval-screen.ts [model ...]     (or: npx tsx ...)
//
// Reads OPENROUTER_API_KEY from the environment, or from apps/api/.dev.vars
// (DEV_VARS=/path/to/.dev.vars to point elsewhere). The key is never printed.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { openRouterScreener, screenRequest, type ScreenVerdict } from "../src/screen.ts";

const CANDIDATES = ["typesafe/jev-router", "openai/gpt-6-luna", "google/gemini-3.5-flash-lite", "anthropic/claude-haiku-5.5", "z-ai/glm-5.3-flash"];
/** Longer than the API's timeout, so slow models are measured rather than cut off. */
const TIMEOUT_MS = 15_000;

type Case = { text: string; reply?: string; photoCount?: number; expected: ScreenVerdict; note?: string };

function apiKey(): string {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  const path = process.env.DEV_VARS ?? join(import.meta.dirname, "../.dev.vars");
  try {
    const line = readFileSync(path, "utf8")
      .split("\n")
      .find((l) => /^\s*OPENROUTER_API_KEY\s*=/.test(l));
    const value = line?.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "");
    if (value) return value;
  } catch {
    // Reported below.
  }
  console.error(`No OPENROUTER_API_KEY in the environment or ${path}.`);
  process.exit(1);
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

const key = apiKey();
const cases = (JSON.parse(readFileSync(join(import.meta.dirname, "../test/fixtures/screen-requests.json"), "utf8")) as { cases: Case[] }).cases;
const models = process.argv.slice(2).length ? process.argv.slice(2) : CANDIDATES;

const rows: string[] = [];
for (const model of models) {
  const screener = openRouterScreener(key, model);
  // One warm-up call so the first case doesn't pay for a cold route.
  await screenRequest(screener, { text: "tap is dripping", photoCount: 0 }, TIMEOUT_MS).catch(() => {});
  const results = await pool(cases, 4, async (c) => {
    const started = performance.now();
    try {
      const verdict = await screenRequest(screener, { text: c.text, reply: c.reply ?? null, photoCount: c.photoCount ?? 0 }, TIMEOUT_MS);
      return { c, verdict, ms: performance.now() - started, error: null as string | null };
    } catch (error) {
      return { c, verdict: null, ms: performance.now() - started, error: String(error instanceof Error ? error.message : error).slice(0, 100) };
    }
  });

  const of = (expected: ScreenVerdict) => results.filter((r) => r.c.expected === expected);
  const missedInvalid = of("invalid").filter((r) => r.verdict === "work");
  const wronglyBlocked = of("work").filter((r) => r.verdict === "invalid");
  const extraQuestion = of("work").filter((r) => r.verdict === "unclear");
  const unclearAsked = of("unclear").filter((r) => r.verdict === "unclear");
  const unclearPassed = of("unclear").filter((r) => r.verdict === "work");
  const errors = results.filter((r) => r.error);
  const correct = results.filter((r) => r.verdict === r.c.expected);
  const ms = results.filter((r) => !r.error).map((r) => r.ms);

  console.log(`\n## ${model}`);
  for (const r of results) {
    if (r.verdict !== r.c.expected) {
      console.log(`  ✗ expected ${r.c.expected}, got ${r.verdict ?? `error (${r.error})`}: ${JSON.stringify(r.c.text)}${r.c.reply ? ` + ${JSON.stringify(r.c.reply)}` : ""}`);
    }
  }
  const summary = {
    correct: `${correct.length}/${results.length}`,
    missedInvalid: `${missedInvalid.length}/${of("invalid").length}`,
    wronglyBlocked: `${wronglyBlocked.length}/${of("work").length}`,
    extraQuestion: extraQuestion.length,
    unclear: `${unclearAsked.length}/${of("unclear").length} asked, ${unclearPassed.length} passed`,
    errors: errors.length,
    medianMs: Math.round(percentile(ms, 50)),
    p95Ms: Math.round(percentile(ms, 95)),
  };
  console.log(JSON.stringify(summary));
  rows.push(
    `| \`${model}\` | ${summary.correct} | ${summary.missedInvalid} | ${summary.wronglyBlocked} | ${summary.extraQuestion} | ${summary.unclear} | ${summary.errors} | ${summary.medianMs} | ${summary.p95Ms} |`,
  );
}

console.log(`
| Model | Correct | Missed invalid | Genuine blocked | Genuine asked to clarify | Unclear | Errors/timeouts | Median ms | p95 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
${rows.join("\n")}`);
