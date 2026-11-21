// Screening at the entry step (#98), on top of the in-intake screening in
// screen.test.ts and scope-gate.test.ts: checking words while the user types
// (POST /jobs/screen), checking a job before intake (POST /jobs/:id/screen),
// and a first round that declines before asking anything (declineAtEntry).

import { describe, expect, it } from "vitest";
import type { Answer, ApiError, CreateJobResponse, JobState, RoundEvent, ScreenResponse, Step } from "@legwork/shared";
import { app } from "../src/index";
import type { Env } from "../src/env";
import { CLARIFY_QUESTION, LOCATION_QUESTION, OUT_OF_SCOPE_QUESTIONS, REVISE_QUESTION, screenReason, URGENCY_QUESTION } from "../src/intake";
import { jevScopeGateOver } from "../src/scope";
import { testDb } from "./d1";
import { ask, fakeClaude, finish, type Scripted } from "./fake-claude";
import { fakeR2 } from "./fake-r2";
import { fakeScope, type ScriptedScope } from "./fake-scope";
import { fakeScreener, HANG, type ScreenScripted } from "./fake-screener";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

type Classifier = { gate: (ScriptedScope | Error)[] } | { screen: ScreenScripted[] } | null;

function setup(classifier: Classifier, ...script: Scripted[]) {
  const { d1, sqlite } = testDb();
  const claude = fakeClaude(...script);
  const scope = fakeScope(...(classifier && "gate" in classifier ? classifier.gate : []));
  const screener = fakeScreener(...(classifier && "screen" in classifier ? classifier.screen : []));
  const env: Env = {
    ENVIRONMENT: "test",
    ALLOWED_ORIGINS: "http://localhost:3000",
    ANTHROPIC_API_KEY: "",
    DB: d1,
    PHOTOS: fakeR2().bucket,
    INTAKE_MODEL: claude.model,
    SCOPE_GATE: classifier && "gate" in classifier ? jevScopeGateOver(scope.classifier) : undefined,
    SCREENER: classifier && "screen" in classifier ? screener.screener : undefined,
    SCREEN_TIMEOUT_MS: 50,
  };
  let token = "";
  let id = "";
  const call = (path: string, init: RequestInit = {}) =>
    app.request(path, { ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers } }, env);
  const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const lines = async (res: Response) =>
    (await res.text())
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as RoundEvent);

  return {
    claude,
    scope,
    screener,
    sqlite,
    async create(description: string) {
      const res = await app.request("/jobs", json({ description }), env);
      expect(res.status).toBe(201);
      const created = await res.json<CreateJobResponse>();
      token = created.token;
      id = created.job.id;
    },
    async upload(bytes: Uint8Array) {
      expect((await call(`/jobs/${id}/photos`, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: bytes })).status).toBe(201);
    },
    describe: (description: string) => call(`/jobs/${id}/description`, json({ description })),
    async check(description: string) {
      const res = await app.request("/jobs/screen", json({ description }), env);
      return { status: res.status, body: await res.json<ScreenResponse & ApiError>() };
    },
    async screen() {
      const res = await call(`/jobs/${id}/screen`, { method: "POST" });
      return { status: res.status, body: await res.json<ScreenResponse & ApiError>() };
    },
    /** A round as the apps start it today: no body. */
    next: async () => lines(await call(`/jobs/${id}/continue`, { method: "POST" })),
    /** A round that declines at the entry step. */
    enter: async () => lines(await call(`/jobs/${id}/continue`, json({ declineAtEntry: true }))),
    async answer(step: Step, answer: Answer) {
      const res = await call(`/jobs/${id}/steps/${step.id}/answer`, json({ answer }));
      expect(res.status).toBe(200);
      return res.json<JobState>();
    },
    state: async () => (await call(`/jobs/${id}/state`)).json<JobState>(),
    confirm: () => call(`/jobs/${id}/confirm`, json({ tier: "low", date: "2026-11-28" })),
    storedScreen: () => (sqlite.prepare("SELECT screen FROM jobs WHERE id = ?").get(id) as { screen: string | null }).screen,
  };
}

const prompts = (events: RoundEvent[]) => events.flatMap((e) => (e.type === "step" ? [e.step.prompt] : []));
const pool = { asks_for_work: 0.96, trade: "no_listed_trade", no_listed_trade: 0.96 } satisfies ScriptedScope;
const tap = { names_a_fault: 0.95 } satisfies ScriptedScope;
const ok: ScreenResponse = { ok: true, verdict: "work", reason: null, because: null, trade: "plumbing", safety: false };

describe("declining at the entry step (#98)", () => {
  it("declines before the suburb, then screens the revised words and starts intake", async () => {
    const t = setup({ gate: [pool, tap] }, ask(), finish());
    await t.create("need my pool cleaned");

    const events = await t.enter();
    const reason = screenReason("out_of_scope", "unlisted_trade")!;
    expect(reason).toBe(`${OUT_OF_SCOPE_QUESTIONS.unlisted_trade.prompt}. ${OUT_OF_SCOPE_QUESTIONS.unlisted_trade.helper}`);
    // Nothing asked, not even the suburb, and the intake model never ran.
    expect(events).toEqual([{ type: "error", error: reason, declined: true }]);
    expect(t.claude.requests).toHaveLength(0);
    const state = await t.state();
    expect(state.queue).toEqual([]);
    expect(state.history).toEqual([]);
    expect(state.job.writeUp).toBeNull();
    expect((await t.confirm()).status).toBe(409);
    expect(JSON.parse(t.storedScreen()!)).toMatchObject({ verdict: "out_of_scope", because: "unlisted_trade" });

    // No steps, so the description can still change; the new words are screened as a new request.
    expect((await t.describe("the back door won't close properly")).status).toBe(200);
    const first = await t.enter();
    expect(t.scope.states).toEqual(["need my pool cleaned", "the back door won't close properly"]);
    expect(prompts(first)).toEqual([LOCATION_QUESTION.prompt, URGENCY_QUESTION.prompt]);
    expect(t.claude.prompt(0)).toContain("the back door won't close properly");
  });

  it("uses the three-way screen's question copy as the reason", async () => {
    const t = setup({ screen: ["invalid", "unclear"] });
    await t.create("everything works, just testing");
    expect(await t.enter()).toEqual([{ type: "error", error: `${REVISE_QUESTION.prompt} ${REVISE_QUESTION.helper}`, declined: true }]);
    await t.describe("the sink");
    expect(await t.enter()).toEqual([{ type: "error", error: CLARIFY_QUESTION.prompt, declined: true }]);
    expect(t.claude.requests).toHaveLength(0);
  });

  it("lets vague words through when photos show the job", async () => {
    const t = setup({ screen: ["unclear"] }, ask(), finish());
    await t.create("fix this");
    await t.upload(JPEG);
    expect(prompts(await t.enter())).toEqual([LOCATION_QUESTION.prompt, URGENCY_QUESTION.prompt]);
  });

  it("keeps a failed check retryable, not declined, and stores nothing", async () => {
    const t = setup({ screen: [HANG, "work"] }, ask(), finish());
    await t.create("hot water's cactus");
    const events = await t.enter();
    expect(events).toEqual([{ type: "error", error: "We couldn't check your request just now. Your answers are saved. Try again." }]);
    expect(t.storedScreen()).toBeNull();
    expect((await t.state()).queue).toEqual([]);
    expect(prompts(await t.enter())).toEqual([LOCATION_QUESTION.prompt, URGENCY_QUESTION.prompt]);
  });

  it("only declines at entry when asked: without the flag the refusal is a question, as before", async () => {
    const t = setup({ gate: [pool] });
    await t.create("need my pool cleaned");
    expect(prompts(await t.next())).toEqual([LOCATION_QUESTION.prompt, OUT_OF_SCOPE_QUESTIONS.unlisted_trade.prompt]);
  });

  it("skips screening without a classifier key", async () => {
    const t = setup(null, ask(), finish());
    await t.create("Write me an essay about plumbing");
    expect((await t.screen()).body).toEqual({ ...ok, trade: null });
    expect((await t.check("Write me an essay about plumbing")).body).toEqual({ ...ok, trade: null });
    expect(prompts(await t.enter())).toEqual([LOCATION_QUESTION.prompt, URGENCY_QUESTION.prompt]);
  });
});

describe("POST /jobs/:id/screen (#98)", () => {
  it("gives the verdict and reason, stores it, and the first round reuses it", async () => {
    const t = setup({ gate: [{ asks_for_work: 0.9, too_big: 0.98 }, tap] }, ask(), finish());
    await t.create("rewire the whole house its 1960s");
    expect(await t.screen()).toEqual({
      status: 200,
      body: { ok: false, verdict: "out_of_scope", reason: screenReason("out_of_scope", "too_big"), because: "too_big", trade: null, safety: false },
    });
    expect((await t.state()).queue).toEqual([]);

    // A client that starts the round anyway gets main's refusal question, from the stored verdict.
    expect(prompts(await t.next())).toEqual([LOCATION_QUESTION.prompt, OUT_OF_SCOPE_QUESTIONS.too_big.prompt]);
    expect(t.scope.states).toHaveLength(1);
  });

  it("passes work with the gate's trade and safety flag, and the round doesn't screen again", async () => {
    const t = setup({ gate: [{ names_a_fault: 0.8, safety: 0.96 }] }, ask(), finish());
    await t.create("can smell gas near the oven");
    expect((await t.screen()).body).toEqual({ ...ok, safety: true });
    expect(prompts(await t.enter())).toEqual([LOCATION_QUESTION.prompt, URGENCY_QUESTION.prompt]);
    expect(t.scope.states).toHaveLength(1);
  });

  it("screens again when the photos change", async () => {
    const t = setup({ gate: [tap, tap] });
    await t.create("tap wont stop dripping");
    await t.screen();
    await t.screen();
    expect(t.scope.states).toHaveLength(1);
    await t.upload(JPEG);
    await t.screen();
    expect(t.scope.states).toEqual(["tap wont stop dripping", "tap wont stop dripping\n(1 photos attached, not shown)"]);
  });

  it("answers 503 and stores nothing when the check fails, then works on a retry", async () => {
    const t = setup({ screen: ['{"verdict": "probably fine"}', "work"] });
    await t.create("dunny's blocked");
    expect(await t.screen()).toEqual({ status: 503, body: { error: "We couldn't check your request just now. Try again." } });
    expect(t.storedScreen()).toBeNull();
    // The three-way screen picks no trade.
    expect((await t.screen()).body).toEqual({ ...ok, trade: null });
  });

  it("needs words or a photo, and is always ok once intake is past screening", async () => {
    const t = setup({ screen: ["work"] }, ask(), finish());
    await t.create("");
    expect((await t.screen()).status).toBe(400);
    await t.describe("tap drips");
    await t.next();
    expect((await t.screen()).body).toMatchObject({ ok: true });
    expect(t.screener.requests).toHaveLength(1);
  });
});

describe("POST /jobs/screen: checking while the user types (#98)", () => {
  it("checks words before a job exists, and answers the same words at once when they send", async () => {
    const t = setup({ gate: [{ only_names_a_thing: 0.9 }, tap] }, ask(), finish());
    expect(await t.check("The sink")).toEqual({
      status: 200,
      body: { ok: false, verdict: "unclear", reason: CLARIFY_QUESTION.prompt, because: null, trade: null, safety: false },
    });
    expect((await t.check(" The sink is blocked ")).body).toEqual(ok);
    expect(t.scope.states).toEqual(["The sink", "The sink is blocked"]);

    // Sent with those words and no photos: no second call, at /screen or in the round.
    await t.create("The sink is blocked");
    expect((await t.screen()).body).toEqual(ok);
    expect(prompts(await t.enter())).toEqual([LOCATION_QUESTION.prompt, URGENCY_QUESTION.prompt]);
    expect(t.scope.states).toHaveLength(2);
  });

  it("shares one classifier call between checks of the same words", async () => {
    const t = setup({ gate: [tap] });
    const [a, b] = await Promise.all([t.check("tap drips"), t.check("tap drips")]);
    expect(a.body).toEqual(ok);
    expect(b.body).toEqual(ok);
    expect(t.scope.states).toHaveLength(1);
  });

  it("needs words, and stays retryable when the check fails", async () => {
    const t = setup({ screen: [HANG, "work"] });
    expect((await t.check("  ")).status).toBe(400);
    expect((await t.check("tap drips")).status).toBe(503);
    expect((await t.check("tap drips")).body).toMatchObject({ ok: true });
    expect(t.screener.requests).toHaveLength(2);
  });
});
