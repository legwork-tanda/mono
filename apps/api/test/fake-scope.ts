// A scripted stand-in for the Jev scope gate (#98). Each call takes the next
// ScriptedScope: an answer map, an Error (thrown), or HANG (never answers).

import { TRADES } from "@legwork/shared";
import type { JevAnswer, JevAnswers, JevClassifier } from "../src/jev";

export const HANG = Symbol("hang");

export type ScriptedScope = Partial<{
  names_a_fault: number;
  asks_for_work: number;
  only_names_a_thing: number;
  not_a_request: number;
  too_big: number;
  about_finished_work: number;
  safety: number;
}> & { trade?: string; no_listed_trade?: number; no_work?: number };

export const answers = (s: ScriptedScope): JevAnswers => {
  const noul = (value = 0): JevAnswer => ({ type: "noul", noul: value });
  const probabilities: Record<string, number> = { no_listed_trade: s.no_listed_trade ?? 0, no_work: s.no_work ?? 0 };
  for (const trade of TRADES) probabilities[trade.id] = 0;
  probabilities[s.trade ?? "plumbing"] = 0.9;
  return {
    names_a_fault: noul(s.names_a_fault),
    asks_for_work: noul(s.asks_for_work),
    only_names_a_thing: noul(s.only_names_a_thing),
    not_a_request: noul(s.not_a_request),
    too_big: noul(s.too_big),
    about_finished_work: noul(s.about_finished_work),
    safety: noul(s.safety),
    trade: { type: "choice", choice: s.trade ?? "plumbing", confidence: 1, probabilities },
  };
};

export function fakeScope(...script: (ScriptedScope | Error | typeof HANG)[]) {
  const states: string[] = [];
  const classifier: JevClassifier = {
    async ask(state, _questions, signal) {
      states.push(typeof state === "string" ? state : JSON.stringify(state));
      const next = script.shift();
      if (next === undefined) throw new Error("fake scope: the script ran out");
      if (next === HANG) {
        return new Promise<JevAnswers>((_, reject) => signal?.addEventListener("abort", () => reject(new Error("aborted"))));
      }
      if (next instanceof Error) throw next;
      return answers(next);
    },
  };
  return { classifier, states, then: (...more: (ScriptedScope | Error | typeof HANG)[]) => script.push(...more) };
}
