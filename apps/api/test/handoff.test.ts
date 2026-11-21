import { describe, expect, it } from "vitest";
import type { ApiError, HandoffResponse, JobState, RedeemHandoffResponse } from "@legwork/shared";
import { app } from "../src/index";
import type { Env } from "../src/env";
import { hashToken, newToken } from "../src/auth";
import { testDb } from "./d1";

/** A job in intake, with its owner and upload tokens. */
async function setup() {
  const { d1, sqlite } = testDb();
  const env: Env = { ENVIRONMENT: "test", ALLOWED_ORIGINS: "http://localhost:3000", ANTHROPIC_API_KEY: "", DB: d1, PHOTOS: {} as R2Bucket };
  const token = newToken();
  const uploadToken = newToken();
  const at = new Date().toISOString();
  for (const id of ["job-1", "job-2"]) {
    sqlite
      .prepare(
        `INSERT INTO jobs (id, description, status, token_hash, upload_token_hash, created_at, updated_at)
         VALUES (?, 'Leaking tap', 'intake', ?, ?, ?, ?)`,
      )
      .run(id, await hashToken(id === "job-1" ? token : newToken()), await hashToken(uploadToken + id), at, at);
  }
  // job-1's upload token is `uploadToken` itself.
  sqlite.prepare("UPDATE jobs SET upload_token_hash = ? WHERE id = 'job-1'").run(await hashToken(uploadToken));

  const create = (as: string, jobId = "job-1") =>
    app.request(`/jobs/${jobId}/handoff`, { method: "POST", headers: { Authorization: `Bearer ${as}` } }, env);
  const redeem = (body: unknown) =>
    app.request("/handoff", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, env);
  const state = (as: string) => app.request("/jobs/job-1/state", { headers: { Authorization: `Bearer ${as}` } }, env);
  const code = async () => ((await (await create(token)).json()) as HandoffResponse).code;
  return { env, sqlite, token, uploadToken, create, redeem, state, code };
}

describe("phone handoff", () => {
  it("gives the phone owner access once, with its own token", async () => {
    const { token, create, redeem, state, sqlite } = await setup();

    const res = await create(token);
    expect(res.status).toBe(201);
    const handoff = (await res.json()) as HandoffResponse;
    const ttl = new Date(handoff.expiresAt).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(4 * 60 * 1000);
    expect(ttl).toBeLessThanOrEqual(5 * 60 * 1000);

    // Only the hash is stored.
    const rows = sqlite.prepare("SELECT code_hash FROM handoffs").all() as { code_hash: string }[];
    expect(rows).toEqual([{ code_hash: await hashToken(handoff.code) }]);

    const redeemed = await redeem({ jobId: "job-1", code: handoff.code });
    expect(redeemed.status).toBe(200);
    const phone = (await redeemed.json()) as RedeemHandoffResponse;
    expect(phone.jobId).toBe("job-1");
    expect(phone.token).not.toBe(token);

    // The phone can do everything the owner can; the desktop still can too.
    const fromPhone = await state(phone.token);
    expect(fromPhone.status).toBe(200);
    expect(((await fromPhone.json()) as JobState).job.id).toBe("job-1");
    expect((await state(token)).status).toBe(200);
    // And can hand off again itself.
    expect((await create(phone.token)).status).toBe(201);

    // A second redeem of the same code fails.
    const again = await redeem({ jobId: "job-1", code: handoff.code });
    expect(again.status).toBe(410);
    expect(((await again.json()) as ApiError).error).toMatch(/scan the qr code again/i);
  });

  it("rejects an expired code", async () => {
    const { redeem, code, sqlite } = await setup();
    const c = await code();
    sqlite.prepare("UPDATE handoffs SET expires_at = ?").run(new Date(Date.now() - 1000).toISOString());
    expect((await redeem({ jobId: "job-1", code: c })).status).toBe(410);
    expect(sqlite.prepare("SELECT token_hash FROM handoffs").get()).toEqual({ token_hash: null });
  });

  it("rejects a wrong code, a code for another job, and a missing code", async () => {
    const { redeem, code } = await setup();
    const c = await code();
    expect((await redeem({ jobId: "job-1", code: newToken() })).status).toBe(410);
    expect((await redeem({ jobId: "job-2", code: c })).status).toBe(410);
    expect((await redeem({ jobId: "job-1" })).status).toBe(400);
    expect((await redeem({ jobId: "job-1", code: "" })).status).toBe(400);
    // None of those used it up.
    expect((await redeem({ jobId: "job-1", code: c })).status).toBe(200);
  });

  it("only lets the owner make a code", async () => {
    const { create, uploadToken } = await setup();
    const res = await create(uploadToken);
    expect(res.status).toBe(401);
    expect((await create(newToken())).status).toBe(404);
    expect((await create(uploadToken, "job-2")).status).toBe(404);
  });

  it("doesn't let a phone token from one job open another", async () => {
    const { redeem, code, env } = await setup();
    const phone = (await (await redeem({ jobId: "job-1", code: await code() })).json()) as RedeemHandoffResponse;
    const other = await app.request("/jobs/job-2/state", { headers: { Authorization: `Bearer ${phone.token}` } }, env);
    expect(other.status).toBe(404);
  });

  it("clears expired, unused codes when making a new one", async () => {
    const { code, sqlite } = await setup();
    await code();
    sqlite.prepare("UPDATE handoffs SET expires_at = ?").run(new Date(Date.now() - 1000).toISOString());
    await code();
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM handoffs").get()).toEqual({ n: 1 });
  });
});
