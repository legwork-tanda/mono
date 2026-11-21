import { describe, expect, it } from "vitest";
import { rankBids, shrunkRating, type BidInput } from "@legwork/shared";

const PRICE = { min: 565, max: 715 }; // the range a burst-pipe job locked in

const bid = (over: Partial<BidInput> & { offerId: string }): BidInput => ({
  quote: 640,
  response: "accepted",
  sentAt: "2026-11-21T00:00:00.000Z",
  respondedAt: "2026-11-21T00:00:04.000Z",
  tradie: { rating: 4.8, reviewCount: 100, jobsDone: 200 },
  ...over,
});

describe("rankBids", () => {
  it("only lets a Pro who actually bid win", () => {
    const ranked = rankBids(
      [
        bid({ offerId: "cheap-but-silent", response: "pending", quote: 570, tradie: { rating: 5, reviewCount: 400, jobsDone: 900 } }),
        bid({ offerId: "declined", response: "declined", quote: 570, tradie: { rating: 5, reviewCount: 400, jobsDone: 900 } }),
        bid({ offerId: "the-bidder" }),
      ],
      PRICE,
    );
    expect(ranked.map((r) => r.offerId)).toEqual(["the-bidder"]);
  });

  it("shrinks rating by review volume, so six perfect reviews lose to a long record", () => {
    expect(shrunkRating(4.9, 6)).toBeLessThan(shrunkRating(4.7, 180));
    const ranked = rankBids(
      [
        bid({ offerId: "new", tradie: { rating: 4.9, reviewCount: 6, jobsDone: 40 } }),
        bid({ offerId: "proven", tradie: { rating: 4.7, reviewCount: 180, jobsDone: 300 } }),
      ],
      PRICE,
    );
    expect(ranked[0]!.offerId).toBe("proven");
  });

  it("flags a quote far below the range instead of rewarding it", () => {
    const [cheap] = rankBids([bid({ offerId: "lowball", quote: 300 })], PRICE);
    expect(cheap!.scopeCheck).toMatch(/confirm/i);
    // …and it does not beat an in-range quote from an otherwise equal Pro.
    const ranked = rankBids(
      [bid({ offerId: "lowball", quote: 300 }), bid({ offerId: "in-range", quote: 640 })],
      PRICE,
    );
    expect(ranked[0]!.offerId).toBe("in-range");
  });

  it("scores in-range quotes above quotes at the top of the range", () => {
    const ranked = rankBids(
      [bid({ offerId: "top", quote: 715 }), bid({ offerId: "middle", quote: 640 })],
      PRICE,
    );
    expect(ranked[0]!.offerId).toBe("middle");
  });

  it("gives a reason a customer can check, not a score", () => {
    const [first] = rankBids([bid({ offerId: "one" })], PRICE);
    expect(first!.reasons.length).toBeGreaterThan(0);
    expect(first!.reasons.length).toBeLessThanOrEqual(2);
    expect(first!.reasons.join(" ")).toMatch(/\$|reviews|jobs|min/);
    expect(first!.reasons.join(" ")).not.toMatch(/\d\.\d{3}/); // no raw scores leak
  });

  it("is stable across polls, and breaks ties on record then id", () => {
    const bids = [
      bid({ offerId: "b", tradie: { rating: 4.8, reviewCount: 100, jobsDone: 120 } }),
      bid({ offerId: "a", tradie: { rating: 4.8, reviewCount: 100, jobsDone: 120 } }),
      bid({ offerId: "c", tradie: { rating: 4.8, reviewCount: 100, jobsDone: 300 } }),
    ];
    const once = rankBids(bids, PRICE).map((r) => r.offerId);
    const twice = rankBids([...bids].reverse(), PRICE).map((r) => r.offerId);
    expect(once).toEqual(twice);
    expect(once).toEqual(["c", "a", "b"]);
  });

  it("returns nothing while no bid is in", () => {
    expect(rankBids([], PRICE)).toEqual([]);
    expect(rankBids([bid({ offerId: "x", response: "pending", quote: null })], PRICE)).toEqual([]);
  });
});
