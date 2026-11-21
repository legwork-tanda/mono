// The scope gate (#98): the rule, and the request it sends. The accuracy of the
// questions themselves is measured against the labelled set by
// scripts/eval-scope.ts, which needs the network; these tests pin the rule.

import { describe, expect, it } from "vitest";
import { decideScope, jevScopeGateOver, scopeState } from "../src/scope";
import { answers, fakeScope } from "./fake-scope";

describe("decideScope", () => {
  it("calls a symptom with a tradie's words a job, and names the trade", () => {
    const result = decideScope(answers({ names_a_fault: 0.97, trade: "plumbing" }));
    expect(result).toMatchObject({ verdict: "work", trade: "plumbing", safety: false, because: "a_job" });
  });

  it("calls a request to install something a job even with nothing broken", () => {
    expect(decideScope(answers({ asks_for_work: 0.96, trade: "electrical" })).verdict).toBe("work");
  });

  it("blocks real work no listed trade does", () => {
    const result = decideScope(answers({ asks_for_work: 0.95, trade: "no_listed_trade", no_listed_trade: 0.96 }));
    expect(result).toMatchObject({ verdict: "out_of_scope", trade: null, because: "unlisted_trade" });
  });

  it("blocks a project too big for one tradie", () => {
    expect(decideScope(answers({ asks_for_work: 0.9, too_big: 0.98 })).because).toBe("too_big");
  });

  it("blocks a report on work already finished", () => {
    expect(decideScope(answers({ names_a_fault: 0.05, about_finished_work: 0.93 })).because).toBe("about_finished_work");
  });

  it("blocks spam and nonsense", () => {
    const result = decideScope(answers({ not_a_request: 0.96, only_names_a_thing: 0.07, trade: "no_work", no_work: 1 }));
    expect(result).toMatchObject({ verdict: "invalid", because: "not_a_request" });
  });

  it("asks for the job when the words only name a thing", () => {
    expect(decideScope(answers({ names_a_fault: 0.25, asks_for_work: 0.26, only_names_a_thing: 0.93 })).verdict).toBe("unclear");
  });

  it("does not block a bare noun on one weak signal", () => {
    // "my fence" scores 0.83 on not_a_request and 0.81 on only_names_a_thing: a
    // fragment, not spam. Blocking here would refuse a customer who then says
    // the fence blew over.
    const result = decideScope(answers({ not_a_request: 0.83, only_names_a_thing: 0.81, trade: "no_work", no_work: 0.93 }));
    expect(result).toMatchObject({ verdict: "unclear", because: "only_names_a_thing" });
  });

  it("keeps a dangerous job a job, and flags it", () => {
    // Gas near the oven: the platform's most urgent work, not a refusal.
    const result = decideScope(answers({ names_a_fault: 0.71, safety: 0.96, trade: "plumbing" }));
    expect(result).toMatchObject({ verdict: "work", trade: "plumbing", safety: true });
  });

  it("blocks before it passes: an unlisted trade wins over a clear fault", () => {
    // "possums in the roof" reads as a fault and as an unlisted trade. Blocking
    // has to win, or the job is priced against a trade that cannot do it.
    const result = decideScope(answers({ names_a_fault: 0.9, asks_for_work: 0.9, trade: "no_listed_trade", no_listed_trade: 0.9 }));
    expect(result).toMatchObject({ verdict: "out_of_scope", because: "unlisted_trade" });
  });

  it("refuses to read a trade out of a field where no trade won", () => {
    // No listed trade above 0.4 and the catch-all under its bar: a job, but
    // with no trade to price it as. Better an empty trade than a wrong one.
    const result = decideScope(answers({ names_a_fault: 0.9, trade: "no_work", no_work: 0.3, no_listed_trade: 0.3 }));
    expect(result).toMatchObject({ verdict: "work", trade: null });
  });
});

describe("scopeState", () => {
  it("carries the description, the clarify reply and the photo count, and nothing else", () => {
    expect(scopeState({ text: "the sink", reply: "it leaks", photoCount: 2 })).toBe(
      "the sink\n(asked what they'd like fixed or installed, they replied: it leaks)\n(2 photos attached, not shown)",
    );
    expect(scopeState({ text: "tap dripping", photoCount: 0 })).toBe("tap dripping");
  });
});

describe("jevScopeGateOver", () => {
  it("asks Jev once per request, with every question in one call", async () => {
    const { classifier, states } = fakeScope({ names_a_fault: 0.97 });
    const result = await jevScopeGateOver(classifier).assess({ text: "tap wont stop dripping", photoCount: 0 });
    expect(states).toHaveLength(1);
    expect(states[0]).toBe("tap wont stop dripping");
    expect(result.verdict).toBe("work");
  });

  it("throws rather than guessing when Jev does not answer, and says what failed", async () => {
    // Two errors: the gate retries once before giving up.
    const { classifier } = fakeScope(new Error("Jev returned 503"), new Error("Jev returned 503"));
    await expect(jevScopeGateOver(classifier).assess({ text: "tap dripping", photoCount: 0 })).rejects.toThrow(/could not answer: Jev returned 503/);
  });

  it("tries twice before giving up, so one hiccup does not reach the customer", async () => {
    const { classifier, states } = fakeScope(new Error("Jev returned 503"), { names_a_fault: 0.95 });
    const result = await jevScopeGateOver(classifier).assess({ text: "tap wont stop dripping", photoCount: 0 });
    expect(states).toHaveLength(2);
    expect(result.verdict).toBe("work");
  });

});
