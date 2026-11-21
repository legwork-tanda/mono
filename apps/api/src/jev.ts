// The TypeSafe client for Jev, the System One model: one POST carries the
// customer's words plus every question about them, answered in parallel. Used
// by screening (src/screen.ts) as a second, cheaper classifier beside the
// OpenRouter one (#98).
//
// No relative imports, so scripts/eval-screen.ts can import this directly.

/** Where a request goes. The API version is in the path and the model picks the build. */
export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const DEFAULT_JEV_MODEL = "jev-latest";

/** "Is this statement true?" — one probability, calibrated. Wording is everything. */
export type JevNoul = { type: "noul"; instructions: string };
/** Pick one option; each criterion says what that option looks like. */
export type JevChoice = { type: "choice"; instructions: string; criteria: Record<string, string> };
/** Place the state on an ordered rubric, lowest first. */
export type JevScore = { type: "score"; instructions: string; criteria: readonly string[] };
export type JevQuestion = JevNoul | JevChoice | JevScore;
/** Every question in one request, keyed by the name the answer comes back under. */
export type JevQuestions = Record<string, JevQuestion>;

export type JevAnswer =
  | { type: "noul"; noul: number }
  | { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> }
  | { type: "score"; score: number; confidence: number; probabilities: Record<string, number> };

export type JevAnswers = Record<string, JevAnswer>;

/**
 * All screening needs from Jev: the answers to one request. Never throws for a
 * low probability; throws JevError for a failed call, a timeout, or a reply
 * missing an answer.
 */
export interface JevClassifier {
  ask(state: string | Record<string, unknown>, questions: Record<string, JevQuestion>, signal?: AbortSignal): Promise<JevAnswers>;
}

export class JevError extends Error {}

type JevResponse = { model?: string; answers?: Record<string, JevAnswer>; detail?: unknown; error?: { message?: string } };

/** The real classifier: one authenticated POST. */
export function typeSafeJev(apiKey: string, model = DEFAULT_JEV_MODEL): JevClassifier {
  return {
    async ask(state, questions, signal) {
      const res = await fetch(JEV_ENDPOINT, {
        method: "POST",
        signal,
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, state, questions }),
      });
      const body = (await res.json().catch(() => null)) as JevResponse | null;
      if (!res.ok) throw new JevError(`Jev returned ${res.status}: ${describe(body)}`);
      const answers = body?.answers;
      if (!answers) throw new JevError(`Jev gave no answers: ${describe(body)}`);
      for (const key of Object.keys(questions)) {
        if (!answers[key]) throw new JevError(`Jev answered no "${key}" (got: ${Object.keys(answers).join(", ") || "nothing"})`);
      }
      return answers;
    },
  };
}

function describe(body: JevResponse | null): string {
  if (!body) return "no body";
  if (body.error?.message) return body.error.message;
  if (body.detail) return JSON.stringify(body.detail).slice(0, 200);
  return JSON.stringify(body).slice(0, 200);
}
