// The two ways to reach Jev (#98): the native TypeSafe API, and OpenRouter's
// jev-router on the key the Worker already holds. The router adapter is tested
// against a stubbed fetch; the real requests are covered by scripts/eval-scope.ts.

import { afterEach, describe, expect, it, vi } from "vitest";
import { JevError, openRouterJev, readRouterAnswers, routerPrompt, routerSchema } from "../src/jev";
import { SCOPE_QUESTIONS } from "../src/scope";
import type { JevQuestions } from "../src/jev";

const questions: JevQuestions = { names_a_fault: SCOPE_QUESTIONS.names_a_fault!, trade: SCOPE_QUESTIONS.trade! };

describe("routerSchema", () => {
  it("asks for a number per noul and a number per option of a choice", () => {
    const schema = routerSchema(questions) as { properties: Record<string, { type: string; required?: string[] }>; required: string[] };
    expect(schema.properties.names_a_fault).toEqual({ type: "number" });
    expect(schema.properties.trade!.type).toBe("object");
    expect(schema.properties.trade!.required).toContain("no_listed_trade");
    expect(schema.required).toEqual(["names_a_fault", "trade"]);
  });

  it("refuses a question the router has no shape for", () => {
    expect(() => routerSchema({ size: { type: "score", instructions: "How big", criteria: ["small", "big"] } })).toThrow(JevError);
  });
});

describe("routerPrompt", () => {
  it("carries the criteria and the customer's words, and nothing that looks like an instruction from them", () => {
    const prompt = routerPrompt("tap wont stop dripping", questions);
    expect(prompt).toContain("no_listed_trade: Real work at a property");
    expect(prompt.trimEnd().endsWith("tap wont stop dripping")).toBe(true);
  });
});

describe("readRouterAnswers", () => {
  const reply = (over: Record<string, unknown> = {}) =>
    JSON.stringify({
      names_a_fault: 0.97,
      trade: { plumbing: 0.9, electrical: 0.02, no_listed_trade: 0.01, no_work: 0.01 },
      ...over,
    });

  it("reads the probabilities and takes the winning option", () => {
    const answers = readRouterAnswers(reply(), questions);
    expect(answers.names_a_fault).toEqual({ type: "noul", noul: 0.97 });
    expect(answers.trade).toMatchObject({ type: "choice", choice: "plumbing", confidence: 0.9 });
  });

  it("clamps a probability the model invented", () => {
    const answers = readRouterAnswers(reply({ names_a_fault: 1.4 }), questions);
    expect(answers.names_a_fault).toEqual({ type: "noul", noul: 1 });
  });

  it("treats a missing option as zero rather than failing the round", () => {
    const answers = readRouterAnswers(reply({ trade: { plumbing: 0.5 } }), questions);
    expect(answers.trade).toMatchObject({ choice: "plumbing" });
    expect((answers.trade as { probabilities: Record<string, number> }).probabilities.no_listed_trade).toBe(0);
  });

  it("throws when the reply is not the JSON the schema asked for", () => {
    expect(() => readRouterAnswers("I think it's a plumbing job.", questions)).toThrow(JevError);
    expect(() => readRouterAnswers(JSON.stringify({ trade: {} }), questions)).toThrow(/no number for "names_a_fault"/);
  });
});

describe("openRouterJev", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends one structured request carrying every question and reads the answers back", async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"names_a_fault":0.95,"trade":{"plumbing":0.88,"no_listed_trade":0.02}}' } }],
        }),
        { status: 200 },
      );
    });

    const answers = await openRouterJev("test-key").ask("tap wont stop dripping", questions);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain("openrouter.ai");
    expect(calls[0]!.body.model).toBe("typesafe/jev-router");
    expect(answers.names_a_fault).toEqual({ type: "noul", noul: 0.95 });
  });

  it("throws with the provider's reason when OpenRouter refuses", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: { message: "No credits" } }), { status: 402 }));
    await expect(openRouterJev("test-key").ask("tap dripping", questions)).rejects.toThrow(/402.*No credits/);
  });
});
