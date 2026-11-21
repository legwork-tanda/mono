import { describe, expect, it } from "vitest";
import { MESSAGE_MAX, type ApiError, type JobWriteUp, type MatchStage, type MatchState } from "@legwork/shared";
import { app } from "../src/index";
import type { Env } from "../src/env";
import { hashToken, newToken } from "../src/auth";
import { canMessage, validateMessage } from "../src/match";
import { testDb } from "./d1";

const writeUp: JobWriteUp = {
  title: "Fix leaking tap",
  trade: "plumbing",
  summary: "Kitchen mixer drips.",
  location: "Newtown",
  details: [],
  severity: 2,
  safety: false,
  prices: { low: { min: 120, max: 180 }, medium: { min: 160, max: 240 }, high: { min: 220, max: 340 } },
  priceReason: "Washer swap.",
};

/** A confirmed job at `stage`, booked with tradie-01 unless it's still searching. */
async function setup(stage: MatchStage) {
  const { d1, sqlite } = testDb();
  const env: Env = { ENVIRONMENT: "test", ALLOWED_ORIGINS: "http://localhost:3000", ANTHROPIC_API_KEY: "", DB: d1, PHOTOS: {} as R2Bucket };
  const token = newToken();
  const uploadToken = newToken();
  const at = new Date().toISOString();
  const booked = stage !== "searching";

  sqlite
    .prepare(
      `INSERT INTO jobs (id, description, status, token_hash, upload_token_hash, write_up, tier, required_date, price_min, price_max,
         stage, search_started_at, matched_offer_id, matched_at, created_at, updated_at)
       VALUES ('job-1', 'Leaking tap', 'open', ?, ?, ?, 'low', '2026-11-24', 120, 180, ?, ?, ?, ?, ?, ?)`,
    )
    .run(await hashToken(token), await hashToken(uploadToken), JSON.stringify(writeUp), stage, at, booked ? "offer-1" : null, booked ? at : null, at, at);
  if (booked) {
    sqlite
      .prepare("INSERT INTO offers (id, job_id, tradie_id, wave, sent_at, response, quote, responded_at) VALUES ('offer-1', 'job-1', 'tradie-01', 1, ?, 'accepted', 150, ?)")
      .run(at, at);
  }

  const send = (text: unknown, as = token) =>
    app.request(
      "/jobs/job-1/messages",
      { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${as}` }, body: JSON.stringify({ text }) },
      env,
    );
  const match = async () => (await app.request("/jobs/job-1/match", { headers: { Authorization: `Bearer ${token}` } }, env)).json<MatchState>();
  const stored = () => sqlite.prepare("SELECT author, text FROM messages WHERE job_id = 'job-1' ORDER BY created_at, rowid").all();
  return { send, match, stored, sqlite, uploadToken };
}

describe("messaging the tradie", () => {
  it("is only allowed once a tradie is booked", () => {
    expect(canMessage("searching", null)).toBe(false);
    expect(canMessage("no_match", null)).toBe(false);
    expect(canMessage("matched", "offer-1")).toBe(true);
    expect(canMessage("en_route", "offer-1")).toBe(true);
    // Read-only once the job is done (tradie-spec: both sides, from booked until completed).
    expect(canMessage("in_progress", "offer-1")).toBe(true);
    expect(canMessage("completed", "offer-1")).toBe(false);
    expect(canMessage("cancelled", "offer-1")).toBe(false);
  });

  it("trims messages and rejects empty or long ones", () => {
    expect(validateMessage("  Gate code 1234 ")).toEqual({ value: "Gate code 1234" });
    expect(validateMessage("   ")).toHaveProperty("error");
    expect(validateMessage(42)).toHaveProperty("error");
    expect(validateMessage("x".repeat(MESSAGE_MAX + 1))).toHaveProperty("error");
  });

  it("rejects a message before a match and stores nothing", async () => {
    const { send, stored, match } = await setup("searching");
    const res = await send("Are you close?");
    expect(res.status).toBe(409);
    expect(((await res.json()) as ApiError).error).toMatch(/accepted/);
    expect(stored()).toHaveLength(0);
    expect((await match()).canMessage).toBe(false);
  });

  it("rejects a message once the job is cancelled", async () => {
    const { send, stored } = await setup("cancelled");
    expect((await send("Still coming?")).status).toBe(409);
    expect(stored()).toHaveLength(0);
  });

  it("sends, stores and returns messages in order, and they survive a reload", async () => {
    const { send, match, stored } = await setup("matched");
    const first = await send(" Side gate is unlocked ");
    expect(first.status).toBe(201);
    const after = (await first.json()) as MatchState;
    expect(after.canMessage).toBe(true);
    expect(after.messages.map((m) => [m.author, m.text])).toEqual([["customer", "Side gate is unlocked"]]);

    expect((await send("Dog is friendly")).status).toBe(201);
    expect(stored()).toEqual([
      { author: "customer", text: "Side gate is unlocked" },
      { author: "customer", text: "Dog is friendly" },
    ]);
    // A fresh read (as after a reload) has the whole thread.
    expect((await match()).messages.map((m) => m.text)).toEqual(["Side gate is unlocked", "Dog is friendly"]);
  });

  it("keeps messages apart from the assistant transcript", async () => {
    const { send, sqlite } = await setup("matched");
    await send("Park in the driveway");
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM steps WHERE job_id = 'job-1'").get()).toEqual({ n: 0 });
  });

  it("rejects empty messages and the photo-only upload link", async () => {
    const { send, stored, uploadToken } = await setup("matched");
    expect((await send("  ")).status).toBe(400);
    expect((await send("Hi", uploadToken)).status).toBe(401);
    expect(stored()).toHaveLength(0);
  });
});
