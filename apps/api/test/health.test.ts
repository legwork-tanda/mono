import { describe, expect, it } from "vitest";
import { app } from "../src/index";
import type { Env } from "../src/env";

const env: Env = {
  ENVIRONMENT: "test",
  ALLOWED_ORIGINS: "http://localhost:3000",
  ANTHROPIC_API_KEY: "",
  DB: {} as D1Database,
  PHOTOS: {} as R2Bucket,
};

describe("api", () => {
  it("GET /health", async () => {
    const res = await app.request("/health", {}, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, service: "legwork-api", environment: "test" });
  });

  it("sets CORS for allowed origins only", async () => {
    const ok = await app.request("/health", { headers: { Origin: "http://localhost:3000" } }, env);
    expect(ok.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");

    const bad = await app.request("/health", { headers: { Origin: "https://evil.example" } }, env);
    expect(bad.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("404s unknown routes as JSON", async () => {
    const res = await app.request("/nope", {}, env);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });
});
