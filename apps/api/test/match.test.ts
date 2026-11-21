import { describe, expect, it } from "vitest";
import { defaultDate, guardPrices, priceLimitsFor, suggestedTier, type TierPrices } from "@legwork/shared";
import {
  canCancel,
  CANCEL_WINDOW_S,
  isEligible,
  NO_MATCH_AFTER_S,
  seeded,
  simulatedResponse,
  driveMinutes,
  etaMinutes,
  nextStage,
  STAGE_FOR_S,
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
    expect(suggestedTier(3, false)).toBeNull();
    expect(suggestedTier(1, false)).toBeNull();
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
  it("run matched, on the way, working, done, one at a time", () => {
    expect(nextStage("matched")).toBe("en_route");
    expect(nextStage("en_route")).toBe("in_progress");
    expect(nextStage("in_progress")).toBe("completed");
    for (const stage of ["completed", "cancelled", "searching", "no_match", "scheduled", null] as const) expect(nextStage(stage)).toBeNull();
  });

  it("the tradie only sets off once the free-cancel window has closed", () => {
    expect(STAGE_FOR_S.matched).toBe(CANCEL_WINDOW_S);
  });

  it("track the drive from 0 to 1 over about 30 seconds", () => {
    expect(travelled(-5)).toBe(0);
    expect(travelled(0)).toBe(0);
    expect(travelled(STAGE_FOR_S.en_route / 2)).toBeCloseTo(0.5);
    expect(travelled(STAGE_FOR_S.en_route)).toBe(1);
    expect(travelled(STAGE_FOR_S.en_route + 10)).toBe(1);
    expect(STAGE_FOR_S.en_route).toBe(30);
  });

  it("count the ETA down to zero as the tradie arrives", () => {
    const full = driveMinutes(6);
    expect(etaMinutes(6, 0)).toBe(full);
    expect(etaMinutes(6, 0.5)).toBe(Math.round(full / 2));
    expect(etaMinutes(6, 0.99)).toBe(0);
    expect(etaMinutes(6, 1)).toBe(0);
    expect(etaMinutes(6, 1.2)).toBe(0);
    let last = Infinity;
    for (let p = 0; p <= 1; p += 0.05) {
      expect(etaMinutes(6, p)).toBeLessThanOrEqual(last);
      last = etaMinutes(6, p);
    }
  });
});

describe("cancelling", () => {
  it("is allowed before a tradie is booked", () => {
    expect(canCancel("searching", null)).toBe(true);
    expect(canCancel("no_match", null)).toBe(true);
    expect(canCancel("scheduled", null)).toBe(true);
  });

  it("is free for two minutes after matching, then rejected", () => {
    expect(canCancel("matched", 0)).toBe(true);
    expect(canCancel("matched", CANCEL_WINDOW_S - 0.001)).toBe(true);
    expect(canCancel("matched", CANCEL_WINDOW_S)).toBe(false);
    expect(canCancel("matched", null)).toBe(false);
  });

  it("is rejected once the tradie has set off, whatever the time", () => {
    expect(canCancel("en_route", 10)).toBe(false);
    expect(canCancel("in_progress", 10)).toBe(false);
    expect(canCancel("completed", 10)).toBe(false);
    expect(canCancel("cancelled", 10)).toBe(false);
  });
});
