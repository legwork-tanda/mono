// Cancelling, the stages after matching and the drive, driven through time
// against the test database (#15, #16, #17). Routes read the fake clock.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiError, JobWriteUp, MatchStage, MatchState } from "@legwork/shared";
import { app } from "../src/index";
import type { Env } from "../src/env";
import { hashToken, newToken } from "../src/auth";
import { CANCEL_WINDOW_S, driveMinutes, STAGE_FOR_S } from "../src/match";
import { advanceStage, loadMatch, tick, type MatchJobRow } from "../src/matching";
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

/** The search starts here; the job is matched 10 s later. */
const T0 = Date.parse("2026-11-21T10:00:00.000Z");
const MATCHED = T0 + 10_000;
const afterMatch = (s: number) => MATCHED + s * 1000;
const iso = (ms: number) => new Date(ms).toISOString();
const KM = 6;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

/** A confirmed job: searching with offers out, or booked with `near` at MATCHED. */
async function setup(stage: Extract<MatchStage, "searching" | "matched" | "scheduled"> = "matched") {
  const { d1, sqlite } = testDb();
  const env: Env = { ENVIRONMENT: "test", ALLOWED_ORIGINS: "http://localhost:3000", ANTHROPIC_API_KEY: "", DB: d1, PHOTOS: {} as R2Bucket };
  sqlite.exec("DELETE FROM tradie_reviews; DELETE FROM tradies;");
  const insert = sqlite.prepare(
    "INSERT INTO tradies (id, name, business, trades, max_severity, available_now, distance_km, bearing, rating, review_count, jobs_done) VALUES (?, ?, 'Biz', '[\"plumbing\"]', 5, 1, ?, 90, 4.5, 10, 20)",
  );
  insert.run("near", "Near Smith", KM);
  insert.run("other", "Other Smith", 4);

  const token = newToken();
  const booked = stage === "matched";
  sqlite
    .prepare(
      `INSERT INTO jobs (id, description, status, token_hash, upload_token_hash, write_up, tier, required_date, price_min, price_max,
         stage, search_started_at, matched_offer_id, matched_at, scheduled_at, created_at, updated_at)
       VALUES ('job-1', 'Leaking tap', 'open', ?, ?, ?, 'low', '2026-11-24', 120, 180, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      await hashToken(token),
      await hashToken(newToken()),
      JSON.stringify(writeUp),
      stage,
      iso(T0),
      booked ? "offer-near" : null,
      booked ? iso(MATCHED) : null,
      stage === "scheduled" ? iso(T0) : null,
      iso(T0),
      iso(T0),
    );
  const offer = sqlite.prepare("INSERT INTO offers (id, job_id, tradie_id, wave, sent_at, response, quote, responded_at) VALUES (?, 'job-1', ?, 1, ?, ?, ?, ?)");
  if (booked) {
    offer.run("offer-near", "near", iso(T0), "accepted", 150, iso(MATCHED));
    offer.run("offer-other", "other", iso(T0), "withdrawn", null, null);
  } else if (stage === "searching") {
    offer.run("offer-near", "near", iso(T0), "pending", null, null);
    offer.run("offer-other", "other", iso(T0), "accepted", 160, iso(T0 + 3000));
  }

  const row = () => sqlite.prepare("SELECT * FROM jobs WHERE id = 'job-1'").get() as unknown as MatchJobRow;
  const offers = () => sqlite.prepare("SELECT id, response FROM offers WHERE job_id = 'job-1' ORDER BY id").all() as { id: string; response: string }[];
  const request = (path: string, json?: unknown) =>
    app.request(
      `/jobs/job-1${path}`,
      json === undefined
        ? { headers: { Authorization: `Bearer ${token}` } }
        : { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(json) },
      env,
    );
  const match = async () => (await request("/match")).json<MatchState>();
  const post = (path: string, json: unknown = {}) => request(path, json);
  /** Moves the fake clock to `ms` and reads the job through the API. */
  const at = async (ms: number) => {
    vi.setSystemTime(ms);
    return match();
  };
  const stream = (query: string) => app.request(`/jobs/job-1/match/stream${query}`, { headers: { Authorization: `Bearer ${token}` } }, env);
  return { d1, sqlite, row, offers, match, post, at, stream };
}

describe("cancelling (#15)", () => {
  it("while searching withdraws every outstanding offer and records the time", async () => {
    const { post, offers, row } = await setup("searching");
    vi.setSystemTime(T0 + 2000);
    const res = await post("/match/cancel");
    expect(res.status).toBe(200);
    const match = await res.json<MatchState>();
    expect(match.stage).toBe("cancelled");
    expect(match.canCancel).toBe(false);
    expect(offers().map((o) => o.response)).toEqual(["withdrawn", "withdrawn"]);
    expect(row().cancelled_at).toBe(iso(T0 + 2000));
  });

  it("a cancelled search stays cancelled: no new waves, no accept", async () => {
    const { post, at, offers } = await setup("searching");
    await post("/match/cancel");
    const later = await at(T0 + 60_000);
    expect(later.stage).toBe("cancelled");
    expect(offers().every((o) => o.response === "withdrawn")).toBe(true);
  });

  it("a job saved for later can be cancelled", async () => {
    const { post, match } = await setup("scheduled");
    expect((await match()).canCancel).toBe(true);
    const res = await post("/match/cancel");
    expect(res.status).toBe(200);
    expect((await res.json<MatchState>()).stage).toBe("cancelled");
  });

  // The tradie sets off STAGE_FOR_S.matched after accepting and starts work
  // once the drive is done, which is before the two-minute window closes. So
  // free cancelling runs through the drive and ends when work starts.
  const WORK_STARTS_S = STAGE_FOR_S.matched + STAGE_FOR_S.en_route;

  it("sets off quickly instead of waiting out the cancel window", async () => {
    const { at } = await setup();
    expect(STAGE_FOR_S.matched).toBeLessThan(CANCEL_WINDOW_S);
    expect((await at(afterMatch(STAGE_FOR_S.matched - 1))).stage).toBe("matched");
    expect((await at(afterMatch(STAGE_FOR_S.matched))).stage).toBe("en_route");
  });

  it("counts down to when work starts, the earlier of that and two minutes", async () => {
    const { at } = await setup();
    expect(WORK_STARTS_S).toBeLessThan(CANCEL_WINDOW_S);
    for (const s of [0, STAGE_FOR_S.matched - 1, STAGE_FOR_S.matched + 5, WORK_STARTS_S - 1]) {
      const match = await at(afterMatch(s));
      expect(match.canCancel).toBe(true);
      expect(match.cancelUntil).toBe(iso(afterMatch(WORK_STARTS_S)));
    }
  });

  it("is free while the tradie drives over, and the booking's offer is withdrawn", async () => {
    const { post, at, offers } = await setup();
    expect((await at(afterMatch(STAGE_FOR_S.matched + 5))).stage).toBe("en_route");
    const res = await post("/match/cancel");
    expect(res.status).toBe(200);
    const match = await res.json<MatchState>();
    expect(match.stage).toBe("cancelled");
    expect(match.canMessage).toBe(false);
    expect(offers().find((o) => o.id === "offer-near")!.response).toBe("withdrawn");
  });

  it("is rejected once work has started, even inside two minutes", async () => {
    const { post, at, row } = await setup();
    const match = await at(afterMatch(WORK_STARTS_S));
    expect(match.stage).toBe("in_progress");
    expect(match.canCancel).toBe(false);
    const res = await post("/match/cancel");
    expect(res.status).toBe(409);
    expect(((await res.json()) as ApiError).error).toMatch(/too late/);
    expect(row().cancelled_at).toBeNull();
  });

  it("is rejected after two minutes even if the tradie is still driving", async () => {
    const { post, d1, sqlite, row } = await setup();
    // A long drive: set off just before the window closes.
    sqlite.prepare("UPDATE jobs SET stage = 'en_route', en_route_at = ? WHERE id = 'job-1'").run(iso(afterMatch(CANCEL_WINDOW_S - 5)));
    vi.setSystemTime(afterMatch(CANCEL_WINDOW_S));
    const match = await tick(d1, row(), afterMatch(CANCEL_WINDOW_S));
    expect(match.stage).toBe("en_route");
    expect((await post("/match/cancel")).status).toBe(409);
  });

  it("is rejected from later stages", async () => {
    const { post, at } = await setup();
    for (const [s, stage] of [
      [WORK_STARTS_S + 1, "in_progress"],
      [WORK_STARTS_S + STAGE_FOR_S.in_progress + 1, "completed"],
    ] as const) {
      expect((await at(afterMatch(s))).stage).toBe(stage);
      expect((await post("/match/cancel")).status).toBe(409);
    }
  });
});

describe("stages (#16)", () => {
  it("timers move the job on in order, each stamped when its timer ran out", async () => {
    const { d1, row } = await setup();
    const enRoute = afterMatch(STAGE_FOR_S.matched);
    const working = enRoute + STAGE_FOR_S.en_route * 1000;
    const done = working + STAGE_FOR_S.in_progress * 1000;

    expect((await tick(d1, row(), enRoute - 1)).stage).toBe("matched");
    expect((await tick(d1, row(), enRoute)).stage).toBe("en_route");
    expect((await tick(d1, row(), working - 1)).stage).toBe("en_route");
    expect((await tick(d1, row(), working + 500)).stage).toBe("in_progress");
    expect((await tick(d1, row(), done + 2000)).stage).toBe("completed");

    const job = row();
    expect(job.en_route_at).toBe(iso(enRoute));
    expect(job.in_progress_at).toBe(iso(working));
    expect(job.completed_at).toBe(iso(done));
  });

  it("a late read catches up through every stage due", async () => {
    const { d1, row } = await setup();
    const job = await tick(d1, row(), afterMatch(3600));
    expect(job.stage).toBe("completed");
    expect(row().en_route_at).toBe(iso(afterMatch(STAGE_FOR_S.matched)));
    expect(row().completed_at).toBe(iso(afterMatch(STAGE_FOR_S.matched + STAGE_FOR_S.en_route + STAGE_FOR_S.in_progress)));
  });

  it("the timeline shows the recorded times", async () => {
    const { at, row } = await setup();
    const match = await at(afterMatch(1000));
    const job = row();
    expect(match.timeline).toEqual({
      posted: iso(T0),
      accepted: iso(MATCHED),
      onTheWay: job.en_route_at,
      working: job.in_progress_at,
      done: job.completed_at,
    });
  });

  it("the demo control advances one stage at a time, now, through the same operation", async () => {
    const { post, row } = await setup();
    const steps: MatchStage[] = ["en_route", "in_progress", "completed"];
    for (const [i, stage] of steps.entries()) {
      vi.setSystemTime(afterMatch(5 + i));
      const res = await post("/match/advance");
      expect(res.status).toBe(200);
      expect((await res.json<MatchState>()).stage).toBe(stage);
    }
    expect(row().en_route_at).toBe(iso(afterMatch(5)));
    expect(row().in_progress_at).toBe(iso(afterMatch(6)));
    expect(row().completed_at).toBe(iso(afterMatch(7)));
    // Nothing comes after completed.
    expect((await post("/match/advance")).status).toBe(409);
  });

  it("a timer picks up from the stage the demo control reached", async () => {
    const { post, at } = await setup();
    vi.setSystemTime(afterMatch(5));
    await post("/match/advance");
    expect((await at(afterMatch(5 + STAGE_FOR_S.en_route) - 1)).stage).toBe("en_route");
    expect((await at(afterMatch(5 + STAGE_FOR_S.en_route))).stage).toBe("in_progress");
  });

  it("rejects skipping a stage, going back, or staying put", async () => {
    const { post, row } = await setup();
    vi.setSystemTime(afterMatch(5));
    for (const to of ["in_progress", "completed", "matched", "searching", "cancelled", "nonsense"]) {
      const res = await post("/match/advance", { to });
      expect(res.status).toBe(409);
    }
    expect(row().stage).toBe("matched");
    expect(row().en_route_at).toBeNull();
    expect((await post("/match/advance", { to: "en_route" })).status).toBe(200);
    expect((await post("/match/advance", { to: "en_route" })).status).toBe(409);
  });

  it("won't advance a job that isn't booked", async () => {
    const { d1, row, post } = await setup("searching");
    expect(await advanceStage(d1, row(), "en_route", T0)).toMatchObject({ ok: false, error: "invalid_transition" });
    expect((await post("/match/advance", { to: "matched" })).status).toBe(409);
    expect(row().stage).toBe("searching");
  });

  it("rejects a transition from a stage the job has already left", async () => {
    const { d1, row } = await setup();
    const stale = row();
    expect((await advanceStage(d1, stale, "en_route", afterMatch(1))).ok).toBe(true);
    expect(await advanceStage(d1, stale, "en_route", afterMatch(2))).toMatchObject({ ok: false });
    expect(row().en_route_at).toBe(iso(afterMatch(1)));
  });
});

describe("the drive (#17)", () => {
  const setOff = afterMatch(STAGE_FOR_S.matched);
  const drive = (s: number) => setOff + s * 1000;

  it("goes from 0 to 1 over the en_route stage while the ETA counts down to 0", async () => {
    const { at } = await setup();
    const before = await at(setOff - 1000);
    expect(before.travelled).toBe(0);
    expect(before.etaMinutes).toBe(driveMinutes(KM));

    const start = await at(drive(0));
    expect(start.stage).toBe("en_route");
    expect(start.travelled).toBe(0);
    expect(start.etaMinutes).toBe(driveMinutes(KM));

    const half = await at(drive(STAGE_FOR_S.en_route / 2));
    expect(half.travelled).toBeCloseTo(0.5);
    expect(half.etaMinutes).toBe(Math.round(driveMinutes(KM) / 2));

    let last = Infinity;
    for (let s = 0; s < STAGE_FOR_S.en_route; s++) {
      const m = await at(drive(s));
      expect(m.etaMinutes!).toBeLessThanOrEqual(last);
      last = m.etaMinutes!;
    }
    const nearly = await at(drive(STAGE_FOR_S.en_route) - 500);
    expect(nearly.stage).toBe("en_route");
    expect(nearly.etaMinutes).toBe(0);

    const arrived = await at(drive(STAGE_FOR_S.en_route));
    expect(arrived.stage).toBe("in_progress");
    expect(arrived.travelled).toBe(1);
    expect(arrived.etaMinutes).toBe(0);
  });

  it("resumes from the en_route time after a reload, however long since the last read", async () => {
    const { d1, row, at } = await setup();
    await at(drive(1));
    // Nothing reads the job for a while (the page was closed), then it reopens.
    const reopened = await loadMatch(d1, await tick(d1, row(), drive(12)), drive(12));
    expect(reopened.travelled).toBeCloseTo(12 / STAGE_FOR_S.en_route);
    expect((await at(drive(12))).travelled).toBeCloseTo(12 / STAGE_FOR_S.en_route);
  });

  it("jumps to the home when the demo control skips to in_progress", async () => {
    const { post, at } = await setup();
    expect((await at(drive(5))).travelled).toBeCloseTo(5 / STAGE_FOR_S.en_route);
    const res = await post("/match/advance");
    const match = await res.json<MatchState>();
    expect(match.stage).toBe("in_progress");
    expect(match.travelled).toBe(1);
    expect(match.etaMinutes).toBe(0);
  });

  it("starts the drive from when the demo control sent the tradie off", async () => {
    const { post, at } = await setup();
    vi.setSystemTime(afterMatch(3));
    expect((await (await post("/match/advance")).json<MatchState>()).travelled).toBe(0);
    expect((await at(afterMatch(3 + 6))).travelled).toBeCloseTo(6 / STAGE_FOR_S.en_route);
  });
});

describe("match stream heartbeat (#80)", () => {
  const read = async (res: Response, ms: number) => {
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    let text = "";
    const stop = performance.now() + ms; // Date is frozen here
    for (;;) {
      const left = stop - performance.now();
      if (left <= 0) break;
      const next = await Promise.race([reader.read(), new Promise<null>((r) => setTimeout(() => r(null), left))]);
      if (!next || next.done) break;
      text += next.value;
    }
    await reader.cancel().catch(() => {});
    return text;
  };

  it("sends empty lines while nothing changes when asked, and only the state otherwise", async () => {
    const { stream } = await setup();
    vi.setSystemTime(afterMatch(1));
    const beating = await read(await stream("?heartbeat=1"), 2_500);
    const lines = beating.split("\n");
    expect((JSON.parse(lines[0]!) as MatchState).stage).toBe("matched");
    expect(lines.slice(1, -1).length).toBeGreaterThanOrEqual(1);
    expect(lines.slice(1, -1).every((l) => l === "")).toBe(true);

    const plain = await read(await stream(""), 1_500);
    expect(plain.split("\n").filter((l) => l === "").length).toBe(1); // just the trailing newline
  }, 10_000);
});
