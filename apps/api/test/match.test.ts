import { describe, expect, it } from "vitest";
import { defaultDate, guardPrices, priceLimitsFor, suggestedTier, type TierPrices } from "@legwork/shared";
import {
  canCancel,
  CANCEL_WINDOW_S,
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
