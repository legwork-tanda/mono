import { describe, expect, it } from "vitest";
import { defaultDate, guardPrices, priceLimitsFor, suggestedTier, type TierPrices } from "@legwork/shared";
import {
  canCancel,
  CANCEL_WINDOW_S,
  isEligible,
  NO_MATCH_AFTER_S,
  seeded,
  simulatedResponse,
  skipToNextStage,
  STAGE_AFTER_MATCH_S,
  stageAfterMatch,
  travelled,
  waveAt,
  waveFor,
} from "../src/match";
import { toWriteUp } from "../src/intake";

const range = (min: number, max: number) => ({ min, max });

describe("guardPrices", () => {
  it("clamps every range to the trade's limits", () => {
    const { min, max } = priceLimitsFor("locksmith");
    const prices = guardPrices("locksmith", { low: range(5, 20), medium: range(30, 40), high: range(900, 5000) });
    for (const r of Object.values(prices)) {
      expect(r.min).toBeGreaterThanOrEqual(min);
      expect(r.max).toBeLessThanOrEqual(max);
    }
  });

  it("keeps low <= high within a range, and rising tiers", () => {
    const prices = guardPrices("plumbing", { low: range(300, 200), medium: range(150, 180), high: range(160, 170) });
    expect(prices.low.min).toBeLessThanOrEqual(prices.low.max);
    expect(prices.medium.min).toBeGreaterThanOrEqual(prices.low.min);
    expect(prices.medium.max).toBeGreaterThan(prices.low.max);
    expect(prices.high.min).toBeGreaterThanOrEqual(prices.medium.min);
    expect(prices.high.max).toBeGreaterThan(prices.medium.max);
  });

  it("leaves sensible prices alone (rounded to $5)", () => {
    const sensible: TierPrices = { low: range(120, 180), medium: range(160, 240), high: range(220, 340) };
    expect(guardPrices("plumbing", sensible)).toEqual(sensible);
  });
});

describe("tier and date", () => {
  it("pre-selects ASAP for severe or unsafe problems", () => {
    expect(suggestedTier(5, false)).toBe("high");
    expect(suggestedTier(4, false)).toBe("high");
    expect(suggestedTier(2, true)).toBe("high");
    expect(suggestedTier(3, false)).toBe("medium");
    expect(suggestedTier(1, false)).toBe("low");
  });

  it("defaults the date from the tier", () => {
    const today = new Date(2026, 10, 21);
    expect(defaultDate("high", today)).toBe("2026-11-21");
    expect(defaultDate("medium", today)).toBe("2026-11-22");
    expect(defaultDate("low", today)).toBe("2026-11-24");
  });
});

describe("toWriteUp", () => {
  it("rounds severity into 1 to 5 and guards prices", () => {
    const writeUp = toWriteUp({
      title: " Fix tap ",
      trade: "plumbing",
      summary: "Leaks.",
      location: " ",
      details: [{ label: "Tap", value: "Mixer" }, { label: " ", value: "x" }],
      severity: 7.4,
      safety: false,
      prices: { low: range(10, 20), medium: range(10, 20), high: range(10, 20) },
      price_reason: "Washer swap.",
    });
    expect(writeUp.severity).toBe(5);
    expect(writeUp.location).toBeNull();
    expect(writeUp.details).toHaveLength(1);
    expect(writeUp.prices.low.min).toBeGreaterThanOrEqual(priceLimitsFor("plumbing").min);
  });
});

describe("eligibility", () => {
  const tradie = { id: "t", trades: ["plumbing" as const], maxSeverity: 4, availableNow: false, distanceKm: 3 };
  const job = { trade: "plumbing" as const, severity: 3, tier: "low" as const };

  it("needs the right trade and enough severity", () => {
    expect(isEligible(tradie, job)).toBe(true);
    expect(isEligible(tradie, { ...job, trade: "electrical" })).toBe(false);
    expect(isEligible(tradie, { ...job, severity: 5 })).toBe(false);
  });

  it("only contacts tradies free right now for ASAP", () => {
    expect(isEligible(tradie, { ...job, tier: "high" })).toBe(false);
    expect(isEligible({ ...tradie, availableNow: true }, { ...job, tier: "high" })).toBe(true);
  });
});

describe("waves", () => {
  it("widens from 5 to 10 to 20 km, about 15 seconds apart", () => {
    expect(waveAt(0)).toBe(1);
    expect(waveAt(14.9)).toBe(1);
    expect(waveAt(15)).toBe(2);
    expect(waveAt(29.9)).toBe(2);
    expect(waveAt(30)).toBe(3);
    expect(waveAt(NO_MATCH_AFTER_S + 100)).toBe(3);
  });

  it("puts each tradie in the first wave that reaches them", () => {
    expect(waveFor(4.9)).toBe(1);
    expect(waveFor(5.1)).toBe(2);
    expect(waveFor(19)).toBe(3);
    expect(waveFor(25)).toBeNull();
  });
});

describe("simulated tradies", () => {
  it("are stable for the same job and tradie", () => {
    expect(seeded("a")).toBe(seeded("a"));
    expect(simulatedResponse("job", "t1", range(100, 200))).toEqual(simulatedResponse("job", "t1", range(100, 200)));
  });

  it("always quote inside the locked range, after 3 to 10 seconds", () => {
    for (let i = 0; i < 50; i++) {
      const r = simulatedResponse(`job-${i}`, "t1", range(120, 260));
      expect(r.quote).toBeGreaterThanOrEqual(120);
      expect(r.quote).toBeLessThanOrEqual(260);
      expect(r.delayS).toBeGreaterThanOrEqual(3);
      expect(r.delayS).toBeLessThanOrEqual(10);
    }
  });
});

describe("stages after matching", () => {
  it("run matched, on the way, working, done", () => {
    expect(stageAfterMatch(0)).toBe("matched");
    expect(stageAfterMatch(STAGE_AFTER_MATCH_S.en_route)).toBe("en_route");
    expect(stageAfterMatch(STAGE_AFTER_MATCH_S.in_progress)).toBe("in_progress");
    expect(stageAfterMatch(STAGE_AFTER_MATCH_S.completed + 1)).toBe("completed");
  });

  it("track the drive from 0 to 1", () => {
    expect(travelled(0)).toBe(0);
    expect(travelled(STAGE_AFTER_MATCH_S.in_progress)).toBe(1);
    expect(travelled((STAGE_AFTER_MATCH_S.en_route + STAGE_AFTER_MATCH_S.in_progress) / 2)).toBeCloseTo(0.5);
  });

  it("skip ahead exactly to the next stage", () => {
    expect(stageAfterMatch(1 + skipToNextStage("matched", 1))).toBe("en_route");
    expect(skipToNextStage("completed", 100)).toBe(0);
  });
});

describe("cancelling", () => {
  it("is free before a match and for two minutes after", () => {
    expect(canCancel("searching", null)).toBe(true);
    expect(canCancel("no_match", null)).toBe(true);
    expect(canCancel("matched", CANCEL_WINDOW_S - 1)).toBe(true);
    expect(canCancel("en_route", CANCEL_WINDOW_S + 1)).toBe(false);
    expect(canCancel("in_progress", 10)).toBe(false);
    expect(canCancel("completed", 10)).toBe(false);
  });
});
