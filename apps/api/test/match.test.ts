import { describe, expect, it } from "vitest";
import { defaultDate, guardPrices, priceLimitsFor, suggestedTier, type TierPrices } from "@legwork/shared";
import {
  canCancel,
  CANCEL_WINDOW_S,
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
import { matchScore, priceValue, reliability, reputation, type JobNeed, type TradieSignals } from "../src/scoring";

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

describe("waves", () => {
  it("widens from 5 to 10 to 20 km over time, then repeats the last ring", () => {
    expect(waveAt(0)).toBe(1);
    expect(waveAt(7.9)).toBe(1);
    expect(waveAt(8)).toBe(2);
    expect(waveAt(16)).toBe(3);
    expect(waveAt(24)).toBe(4);
    expect(waveAt(NO_MATCH_AFTER_S + 100)).toBe(6);
  });

  it("puts each tradie in the first wave that reaches them", () => {
    expect(waveFor(4.9)).toBe(1);
    expect(waveFor(5.1)).toBe(2);
    expect(waveFor(19)).toBe(3);
    expect(waveFor(25)).toBeNull();
  });
});

describe("simulated tradies", () => {
  const tradie = { id: "t1", bidPropensity: 0.8, pricePosition: "mid", responseMinutes: 5 };

  it("are stable for the same job and tradie", () => {
    expect(seeded("a")).toBe(seeded("a"));
    expect(simulatedResponse("job", tradie, range(100, 200))).toEqual(simulatedResponse("job", tradie, range(100, 200)));
  });

  it("always quote inside the locked range, after 1.5 to 4.5 seconds", () => {
    for (const pricePosition of ["cheap", "mid", "premium"]) {
      for (let i = 0; i < 50; i++) {
        const r = simulatedResponse(`job-${i}`, { ...tradie, pricePosition }, range(120, 260));
        expect(r.quote).toBeGreaterThanOrEqual(120);
        expect(r.quote).toBeLessThanOrEqual(260);
        expect(r.delayS).toBeGreaterThanOrEqual(1.5);
        expect(r.delayS).toBeLessThanOrEqual(4.5);
      }
    }
  });

  it("bid as often as their propensity says", () => {
    const rate = (bidPropensity: number) =>
      Array.from({ length: 400 }, (_, i) => simulatedResponse(`job-${i}`, { ...tradie, bidPropensity }, range(100, 200)).bids).filter(Boolean).length / 400;
    expect(rate(0)).toBe(0);
    expect(rate(1)).toBe(1);
    expect(rate(0.5)).toBeGreaterThan(0.4);
    expect(rate(0.5)).toBeLessThan(0.6);
  });
});

describe("scoring", () => {
  const base: TradieSignals = {
    id: "t", skills: [], experienceYears: 10, maxSeverity: 5, availableNow: true, earliestStartHours: 0, distanceKm: 3, serviceRadiusKm: 20,
    licenceType: "QBCC Plumbing & Drainage", googleRating: 4.5, googleReviews: 50, legworkRating: 4.5, legworkReviews: 20, jobsCompleted: 100,
    cancellations: 0, noShows: 0, disputes: 0, onTimePct: 95, quoteAccuracyPct: 95, bidPropensity: 1,
  };
  const job: JobNeed = { trade: "plumbing", severity: 3, tier: "medium", text: "leaking tap", deadlineHours: 24 };

  it("scores price from the cheapest end of the locked range", () => {
    expect(priceValue(100, range(100, 200))).toBe(1);
    expect(priceValue(200, range(100, 200))).toBe(0);
    expect(priceValue(150, range(100, 200))).toBe(0.5);
    expect(priceValue(150, range(150, 150))).toBe(1);
  });

  it("does not let a few perfect reviews beat a long record", () => {
    const few = reputation({ ...base, googleRating: 5, googleReviews: 3, legworkRating: 0, legworkReviews: 0 });
    const many = reputation({ ...base, googleRating: 4.8, googleReviews: 180, legworkRating: 0, legworkReviews: 0 });
    expect(many).toBeGreaterThan(few);
  });

  it("starts a tradie with no history near average rather than at zero", () => {
    const fresh = { ...base, jobsCompleted: 0, googleReviews: 0, legworkReviews: 0 };
    expect(reputation(fresh)).toBeGreaterThan(0.3);
    expect(reliability(fresh)).toBeGreaterThan(0.7);
  });

  it("prefers a no-show-free record", () => {
    expect(reliability({ ...base, noShows: 5 })).toBeLessThan(reliability(base));
  });

  it("scores the same bid higher for a better tradie, without distance mattering", () => {
    const better = matchScore({ ...base, jobsCompleted: 400 }, job, 150, range(100, 200));
    expect(better).toBeGreaterThan(matchScore(base, job, 150, range(100, 200)));
    expect(matchScore({ ...base, distanceKm: 18 }, job, 150, range(100, 200))).toBe(matchScore(base, job, 150, range(100, 200)));
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
