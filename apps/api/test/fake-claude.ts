// A scripted stand-in for Claude, so intake can be tested without the API.
// Each model call takes the next reply from the script: an object is sent as
// JSON, a string as-is (handy for malformed output), an Error is thrown. Text
// streams out in small chunks, the way the real stream arrives.

import type Anthropic from "@anthropic-ai/sdk";
import type { IntakeModel } from "../src/intake";

export type Scripted = object | string | Error;

export type ModelRequest = { system: string; content: Anthropic.ContentBlockParam[] };

export function fakeClaude(...script: Scripted[]) {
  const requests: ModelRequest[] = [];
  const model: IntakeModel = {
    async stream(request, onText) {
      requests.push(request);
      const next = script.shift();
      if (next === undefined) throw new Error("fake Claude: the script ran out");
      if (next instanceof Error) throw next;
      const text = typeof next === "string" ? next : JSON.stringify(next);
      for (let i = 0; i < text.length; i += 24) onText(text.slice(i, i + 24));
      return { text, stopReason: "end_turn" };
    },
  };
  return {
    model,
    requests,
    /** Adds replies for later rounds. */
    then: (...more: Scripted[]) => script.push(...more),
    /** The text of the nth request's user message. */
    prompt: (n: number) =>
      requests[n]!.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n"),
    images: (n: number) => requests[n]!.content.filter((b) => b.type === "image"),
  };
}

export const choice = (prompt: string, options = ["Yes", "No"]) => ({ type: "choice", prompt, helper: null, options, placeholder: null });

type Fact = { label: string; value: string; source: "given" | "inferred" };

/** A reply that asks these questions. */
export const ask = (...questions: object[]) => ({ kind: "questions", known: [] as Fact[], missing: [] as string[], questions, job: null });

/** A planning reply that also reports what's settled and what's missing. */
export const plan = (known: Fact[], missing: string[], ...questions: object[]) => ({ ...ask(...questions), known, missing });

/** A reply that writes the job up. */
export const finish = (job: Partial<FinishJob> = {}) => ({
  kind: "finish",
  known: [],
  missing: [],
  questions: [],
  job: {
    title: "Fix leaking kitchen tap",
    trade: "plumbing",
    unsupported: null,
    summary: "Kitchen mixer leaking from the base.",
    location: null,
    details: [{ label: "Fixture", value: "Kitchen mixer", source: "given" }],
    missing: [],
    severity: 3.4,
    safety: false,
    prices: { low: { min: 150, max: 250 }, medium: { min: 200, max: 320 }, high: { min: 280, max: 450 } },
    price_reason: "Usually a cartridge swap.",
    ...job,
  },
});

type FinishJob = {
  title: string;
  trade: string;
  unsupported: string | null;
  summary: string;
  severity: number;
  safety: boolean;
  details: Fact[];
  missing: string[];
};
