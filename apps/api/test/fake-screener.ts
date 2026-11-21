// A scripted stand-in for the screening classifier (#98). Each call takes the
// next reply: a verdict is sent as {"verdict": ...}, any other string as-is
// (malformed output), an Error is thrown, and `HANG` never answers (a timeout).

import type { RequestScreener, ScreenVerdict } from "../src/screen";

export const HANG = Symbol("hang");

export type ScreenScripted = ScreenVerdict | string | Error | typeof HANG;

export function fakeScreener(...script: ScreenScripted[]) {
  const requests: { system: string; user: string }[] = [];
  const screener: RequestScreener = {
    async classify({ system, user, signal }) {
      requests.push({ system, user });
      const next = script.shift();
      if (next === undefined) throw new Error("fake screener: the script ran out");
      if (next === HANG) {
        return new Promise<string>((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
      }
      if (next instanceof Error) throw next;
      return next === "work" || next === "unclear" || next === "invalid" ? JSON.stringify({ verdict: next }) : next;
    },
  };
  return { screener, requests, then: (...more: ScreenScripted[]) => script.push(...more) };
}
