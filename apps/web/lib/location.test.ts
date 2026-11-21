import { describe, expect, it } from "vitest";
import { planWhere } from "./location";

const plan = (o: Partial<Parameters<typeof planWhere>[0]>) =>
  planWhere({ permission: "prompt", last: null, changing: false, failed: false, ...o });

describe("planWhere", () => {
  it("answers itself when location is already granted", () => {
    expect(plan({ permission: "granted" })).toEqual({ auto: true, primary: "locate", links: ["type"], typing: false });
    expect(plan({ permission: "granted", last: "Newtown 2042" })).toMatchObject({ auto: true, links: ["last", "type"] });
  });

  it("asks when granted but an earlier answer is being changed", () => {
    expect(plan({ permission: "granted", last: "Newtown 2042", changing: true })).toEqual({
      auto: false,
      primary: "last",
      links: ["locate", "type"],
      typing: false,
    });
  });

  it("offers the last suburb as the one primary choice when permission would prompt", () => {
    expect(plan({ permission: "prompt", last: "Newtown 2042" })).toEqual({
      auto: false,
      primary: "last",
      links: ["locate", "type"],
      typing: false,
    });
    expect(plan({ permission: "unknown", last: "Newtown 2042" })).toMatchObject({ auto: false, primary: "last" });
  });

  it("offers the current location when there's no previous suburb", () => {
    expect(plan({ permission: "prompt" })).toEqual({ auto: false, primary: "locate", links: ["type"], typing: false });
    expect(plan({ permission: "unknown" })).toMatchObject({ auto: false, primary: "locate" });
  });

  it("never offers location when it's denied: last suburb, then typing", () => {
    expect(plan({ permission: "denied", last: "Newtown 2042" })).toEqual({
      auto: false,
      primary: "last",
      links: ["type"],
      typing: false,
    });
    expect(plan({ permission: "denied" })).toEqual({ auto: false, primary: null, links: [], typing: true });
  });

  it("falls back to the last suburb, then typing, when the lookup fails", () => {
    for (const permission of ["granted", "prompt"] as const) {
      expect(plan({ permission, failed: true, last: "Newtown 2042" })).toEqual({
        auto: false,
        primary: "last",
        links: ["type"],
        typing: false,
      });
      expect(plan({ permission, failed: true })).toEqual({ auto: false, primary: null, links: [], typing: true });
    }
  });
});
