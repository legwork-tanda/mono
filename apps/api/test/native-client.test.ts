// The iOS app (apps/ios) calls the API with URLSession, which sends no Origin
// header. CORS only applies to browsers, so those requests must go through
// untouched, while browser origins stay limited to ALLOWED_ORIGINS.

import { describe, expect, it } from "vitest";
import type { CreateJobResponse, JobState } from "@legwork/shared";
import { app } from "../src/index";
import type { Env } from "../src/env";
import { testDb } from "./d1";

const makeEnv = (): Env => ({
  ENVIRONMENT: "test",
  ALLOWED_ORIGINS: "http://localhost:3000",
  ANTHROPIC_API_KEY: "",
  DB: testDb().d1,
  PHOTOS: {} as R2Bucket,
});

describe("native clients (no Origin header)", () => {
  it("can read /health without any CORS headers", async () => {
    const res = await app.request("/health", {}, makeEnv());
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("can create a job and read its state with the bearer token", async () => {
    const env = makeEnv();
    const created = await app.request(
      "/jobs",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ description: "Leaking tap" }) },
      env,
    );
    expect(created.status).toBe(201);
    expect(created.headers.get("Access-Control-Allow-Origin")).toBeNull();
    const body = (await created.json()) as CreateJobResponse;
    expect(body.token).toBeTruthy();

    const state = await app.request(`/jobs/${body.job.id}/state`, { headers: { Authorization: `Bearer ${body.token}` } }, env);
    expect(state.status).toBe(200);
    expect(((await state.json()) as JobState).job.description).toBe("Leaking tap");
  });

  it("still refuses CORS to browser origins that aren't allowed", async () => {
    const res = await app.request("/health", { headers: { Origin: "https://evil.example" } }, makeEnv());
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});
