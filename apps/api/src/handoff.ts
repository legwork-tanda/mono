import { Hono } from "hono";
import type { ApiError, HandoffResponse, RedeemHandoffRequest, RedeemHandoffResponse } from "@legwork/shared";
import { hashToken, newToken } from "./auth";
import type { Env } from "./env";

// Continue on your phone (#33). The desktop (the owner) asks for a handoff
// code and shows it in a QR code. The phone redeems it once, within a few
// minutes, for an owner token of its own. Codes and tokens are random 256-bit
// values stored only as SHA-256 hashes.

export const HANDOFF_TTL_MS = 5 * 60 * 1000;

/** A fresh handoff code for the job. Clears the job's expired, unused codes on the way. */
export async function createHandoff(db: D1Database, jobId: string, at = new Date()): Promise<HandoffResponse> {
  const code = newToken();
  const createdAt = at.toISOString();
  const expiresAt = new Date(at.getTime() + HANDOFF_TTL_MS).toISOString();
  await db.batch([
    db.prepare("DELETE FROM handoffs WHERE job_id = ? AND used_at IS NULL AND expires_at <= ?").bind(jobId, createdAt),
    db
      .prepare("INSERT INTO handoffs (code_hash, job_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
      .bind(await hashToken(code), jobId, createdAt, expiresAt),
  ]);
  return { code, expiresAt };
}

/** Whether `tokenHash` is an owner token a handoff issued for this job. */
export async function isHandoffToken(db: D1Database, jobId: string, tokenHash: string) {
  return !!(await db
    .prepare("SELECT 1 FROM handoffs WHERE job_id = ? AND token_hash = ?")
    .bind(jobId, tokenHash)
    .first());
}

export const handoff = new Hono<{ Bindings: Env }>();

// Redeems a code. No bearer token: the code is the credential. A wrong, used
// or expired code all get the same answer.
handoff.post("/", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Partial<RedeemHandoffRequest> | null;
  if (typeof body?.jobId !== "string" || typeof body.code !== "string" || !body.code) {
    return c.json<ApiError>({ error: "This link isn't complete. Scan the QR code again." }, 400);
  }

  const token = newToken();
  // One conditional update, so two phones racing for one code can't both win.
  const result = await c.env.DB.prepare(
    `UPDATE handoffs SET used_at = ?, token_hash = ?
     WHERE code_hash = ? AND job_id = ? AND used_at IS NULL AND expires_at > ?`,
  )
    .bind(new Date().toISOString(), await hashToken(token), await hashToken(body.code), body.jobId, new Date().toISOString())
    .run();
  if (result.meta.changes !== 1) {
    return c.json<ApiError>({ error: "This code has expired or was already used. Scan the QR code again." }, 410);
  }
  return c.json<RedeemHandoffResponse>({ jobId: body.jobId, token });
});
