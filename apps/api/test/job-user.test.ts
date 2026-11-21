import { describe, expect, it } from "vitest";
import type { CreateJobResponse } from "@legwork/shared";
import { app } from "../src/index";
import type { Env } from "../src/env";
import { readJobUser } from "../src/jobs";
import { testDb } from "./d1";

const env = (): Env => ({
  ENVIRONMENT: "test",
  ALLOWED_ORIGINS: "http://localhost:3000",
  ANTHROPIC_API_KEY: "",
  DB: testDb().d1,
  PHOTOS: {} as R2Bucket,
});

const create = (e: Env, body: unknown) =>
  app.request("/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, e);

describe("the job's user", () => {
  it("is stored with the job and read back, one per poster", async () => {
    const e = env();
    const a = (await (await create(e, { description: "Leaking tap", user: { id: "user_aaaaaaaa", name: "Swift Wombat 12" } })).json()) as CreateJobResponse;
    const b = (await (await create(e, { description: "Leaking tap", user: { id: "user_bbbbbbbb", name: "Calm Quokka 40" } })).json()) as CreateJobResponse;
    expect(a.job.user).toEqual({ id: "user_aaaaaaaa", name: "Swift Wombat 12" });
    expect(b.job.user).toEqual({ id: "user_bbbbbbbb", name: "Calm Quokka 40" });

    const state = await app.request(`/jobs/${a.job.id}/state`, { headers: { Authorization: `Bearer ${a.token}` } }, e);
    expect(((await state.json()) as CreateJobResponse).job.user?.name).toBe("Swift Wombat 12");
  });

  it("is null when an older client sends none", async () => {
    const res = (await (await create(env(), { description: "Leaking tap" })).json()) as CreateJobResponse;
    expect(res.job.user).toBeNull();
  });

  it("ignores a malformed user and tidies the name", () => {
    expect(readJobUser({ id: "short", name: "x" })).toBeNull();
    expect(readJobUser({ id: "user_aaaaaaaa; DROP", name: "x" })).toBeNull();
    expect(readJobUser({ id: "user_aaaaaaaa", name: "   " })).toBeNull();
    expect(readJobUser("user_aaaaaaaa")).toBeNull();
    expect(readJobUser({ id: "user_aaaaaaaa", name: `  Swift\n Wombat ${"x".repeat(60)}` })?.name).toHaveLength(40);
  });
});
