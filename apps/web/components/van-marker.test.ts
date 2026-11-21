import { describe, expect, it } from "vitest";
import { turnTo, vanSvg } from "./van-marker";

describe("turnTo", () => {
  it("takes the short way across north", () => {
    expect(turnTo(350, 10)).toBe(370);
    expect(turnTo(10, 350)).toBe(-10);
  });

  it("keeps turning from an unwrapped angle", () => {
    expect(turnTo(370, 20)).toBe(380);
    expect(turnTo(-10, 340)).toBe(-20);
  });

  it("never turns more than half way round", () => {
    for (let from = -720; from <= 720; from += 37) {
      for (let to = 0; to < 360; to += 13) {
        const next = turnTo(from, to);
        expect(Math.abs(next - from)).toBeLessThanOrEqual(180);
        expect((((next % 360) + 360) % 360).toFixed(6)).toBe(to.toFixed(6));
      }
    }
  });
});

describe("vanSvg", () => {
  it("is an image with a label", () => {
    expect(vanSvg()).toContain('role="img"');
    expect(vanSvg()).toContain(`aria-label="Tradie's van"`);
  });
});
