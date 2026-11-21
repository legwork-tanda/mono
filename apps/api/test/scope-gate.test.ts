// The Jev scope gate (#98), end to end: a scripted gate (fake-scope.ts) in front
// of a scripted Claude, through the real routes. The rule and the request itself
// are in scope.test.ts; the accuracy of the questions is measured by
// scripts/eval-scope.ts.

import { describe, expect, it } from "vitest";
import type { Answer, CreateJobResponse, JobState, RoundEvent, Step } from "@legwork/shared";
import { app } from "../src/index";
import type { Env } from "../src/env";
import { LOCATION_QUESTION, OUT_OF_SCOPE_QUESTIONS, REVISE_QUESTION, URGENCY_QUESTION } from "../src/intake";
import { jevScopeGateOver } from "../src/scope";
import { testDb } from "./d1";
import { ask, fakeClaude, finish, type Scripted } from "./fake-claude";
import { fakeR2 } from "./fake-r2";
import { fakeScope, HANG, type ScriptedScope } from "./fake-scope";

function setup(script: (ScriptedScope | Error | typeof HANG)[], ...claudeScript: Scripted[]) {
  const { d1, sqlite } = testDb();
  const claude = fakeClaude(...claudeScript);
  const scope = fakeScope(...script);
  const env: Env = {
    ENVIRONMENT: "test",
    ALLOWED_ORIGINS: "http://localhost:3000",
    ANTHROPIC_API_KEY: "",
    DB: d1,
    PHOTOS: fakeR2().bucket,
    INTAKE_MODEL: claude.model,
    SCOPE_GATE: jevScopeGateOver(scope.classifier),
  };
  let token = "";
  let id = "";
  const call = (path: string, init: RequestInit = {}) =>
    app.request(path, { ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers } }, env);
  const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  return {
    claude,
    scope,
    sqlite,
    get id() {
      return id;
    },
    async create(description: string) {
      const res = await app.request("/jobs", json({ description }), env);
      expect(res.status).toBe(201);
      const created = await res.json<CreateJobResponse>();
      token = created.token;
      id = created.job.id;
      return created;
    },
    async next() {
      const res = await call(`/jobs/${id}/continue`, { method: "POST" });
      return (await res.text())
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l) as RoundEvent);
    },
    async answer(step: Step, answer: Answer) {
      const res = await call(`/jobs/${id}/steps/${step.id}/answer`, json({ answer }));
      expect(res.status).toBe(200);
      return res.json<JobState>();
    },
    state: async () => (await call(`/jobs/${id}/state`)).json<JobState>(),
    storedScreen: () => JSON.parse((sqlite.prepare("SELECT screen FROM jobs WHERE id = ?").get(id) as { screen: string }).screen),
  };
}

const stepsOf = (events: RoundEvent[]) => events.flatMap((e) => (e.type === "step" ? [e.step] : []));
const prompts = (events: RoundEvent[]) => stepsOf(events).map((s) => s.prompt);
const finalState = (events: RoundEvent[]) => {
  const last = events.at(-1)!;
  if (last.type !== "state") throw new Error(`expected a state line, got ${JSON.stringify(last)}`);
  return last.state;
};
const queued = (state: JobState, prompt: string) => state.queue.find((s) => s.prompt === prompt)!;
const trade = OUT_OF_SCOPE_QUESTIONS.unlisted_trade.prompt;

describe("the scope gate in front of intake (#98)", () => {
  it("says plainly that pools are out of scope, then takes the job behind it", async () => {
    const t = setup([{ asks_for_work: 0.96, trade: "no_listed_trade", no_listed_trade: 0.96 }, { names_a_fault: 0.95 }], ask(), finish());
    await t.create("need my pool cleaned");

    const first = await t.next();
    // The suburb first, then the refusal; nothing planned or priced.
    expect(prompts(first)).toEqual([LOCATION_QUESTION.prompt, trade]);
    expect(t.claude.requests).toHaveLength(0);
    const state = finalState(first);
    expect(state.job.writeUp).toBeNull();
    expect(queued(state, trade)).toMatchObject({ type: "text" });
    // The reason is stored with the verdict, so the same words are explained again on a retry.
    expect(t.storedScreen()).toMatchObject({ verdict: "out_of_scope", because: "unlisted_trade" });

    // They take the hint and describe a real job: gated again, as a new request.
    await t.answer(queued(state, LOCATION_QUESTION.prompt), "Newtown");
    await t.answer(queued(state, trade), "the back door won't close properly");
    const second = await t.next();
    expect(t.scope.states[1]).toBe("the back door won't close properly");
    expect(prompts(second)).toEqual([URGENCY_QUESTION.prompt]);
    expect(t.claude.requests.length).toBeGreaterThan(0);
  });

  it("keeps a dangerous job a job, and records the safety flag", async () => {
    const t = setup([{ names_a_fault: 0.8, safety: 0.96 }], ask(), finish());
    await t.create("can smell gas near the oven");
    const events = await t.next();
    expect(prompts(events)).toEqual([LOCATION_QUESTION.prompt, URGENCY_QUESTION.prompt]);
    expect(t.storedScreen()).toMatchObject({ verdict: "work", safety: true });
  });

  it("asks for the job again once a blocked request is still out of scope", async () => {
    const t = setup([
      { asks_for_work: 0.9, trade: "no_listed_trade", no_listed_trade: 0.9 },
      { asks_for_work: 0.9, trade: "no_listed_trade", no_listed_trade: 0.9 },
    ]);
    await t.create("cockroaches everywhere in the kitchen");
    const state = finalState(await t.next());
    await t.answer(queued(state, trade), "also the garage");
    const second = await t.next();
    // Second time: no repeated refusal, the ordinary revise question.
    expect(prompts(second)).toContain(REVISE_QUESTION.prompt);
    expect(prompts(second)).not.toContain(trade);
  });

  it("gives the reason it blocked: too big, not the wrong kind of work", async () => {
    const t = setup([{ asks_for_work: 0.9, too_big: 0.98 }]);
    await t.create("rewire the whole house its 1960s");
    const events = await t.next();
    expect(prompts(events)).toEqual([LOCATION_QUESTION.prompt, OUT_OF_SCOPE_QUESTIONS.too_big.prompt]);
    expect(t.storedScreen()).toMatchObject({ because: "too_big" });
    // The words name the reason and say who is the right call instead.
    expect(OUT_OF_SCOPE_QUESTIONS.too_big.helper).toContain("builder");
  });

  it("gives the reason it blocked: a report on work already finished", async () => {
    const t = setup([{ about_finished_work: 0.93 }]);
    await t.create("need a quote for tiling done last month for insurance");
    const events = await t.next();
    expect(prompts(events)).toEqual([LOCATION_QUESTION.prompt, OUT_OF_SCOPE_QUESTIONS.about_finished_work.prompt]);
    expect(t.storedScreen()).toMatchObject({ because: "about_finished_work" });
    expect(OUT_OF_SCOPE_QUESTIONS.about_finished_work.helper).toContain("licence");
  });

  it("refuses in new words when the second request is out of scope for a different reason", async () => {
    const t = setup([
      { asks_for_work: 0.9, trade: "no_listed_trade", no_listed_trade: 0.9 },
      { asks_for_work: 0.9, too_big: 0.9 },
    ]);
    await t.create("need my pool cleaned");
    const state = finalState(await t.next());
    await t.answer(queued(state, trade), "actually rebuild the whole back deck");
    const second = await t.next();
    // Not the same wall again: the reason changed, so the words do too.
    expect(prompts(second)).toContain(OUT_OF_SCOPE_QUESTIONS.too_big.prompt);
    expect(prompts(second)).not.toContain(trade);
  });

  it("tells the customer the check failed, in words, and leaves the round retryable", async () => {
    const t = setup([new Error("Jev returned 503"), new Error("Jev returned 503")], ask(), finish());
    await t.create("tap wont stop dripping");
    const events = await t.next();
    expect(t.claude.requests).toHaveLength(0);
    const last = events.at(-1)!;
    expect(last.type).toBe("error");
    // Not "we couldn't work out the next question": the check is what failed.
    expect((last as { error: string }).error).toBe("We couldn't check your request just now. Your answers are saved. Try again.");
    // Nothing priced, and the job is still in intake.
    expect((await t.state()).job.status).toBe("intake");
  });

  it("does not surface a classifier that failed once", async () => {
    const t = setup([new Error("Jev returned 503"), { names_a_fault: 0.95 }], ask(), finish());
    await t.create("tap wont stop dripping");
    const events = await t.next();
    // The gate's own retry swallowed the first failure: the customer sees questions.
    expect(events.at(-1)!.type).toBe("state");
    expect(prompts(events)).toEqual([LOCATION_QUESTION.prompt, URGENCY_QUESTION.prompt]);
  });
});
