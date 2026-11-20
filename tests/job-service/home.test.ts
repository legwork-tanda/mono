import { describe, expect, it } from "vitest";
import { DemoUserMissingError } from "@/lib/job-service";
import { makeTestService } from "../support/make-service";
import { demoUser } from "../support/fixtures";

describe("getHome", () => {
  it("returns the signed-in demo user's name and saved home address", async () => {
    const { service } = makeTestService();

    const home = await service.getHome();

    expect(home.user).toEqual({ id: demoUser.id, name: "Alex Demo" });
    expect(home.homeAddress).toEqual({
      label: "12 Brunswick St, Fortitude Valley QLD 4006",
      lat: -27.4575,
      lng: 153.0355,
    });
  });

  it("fails clearly when the demo user has not been seeded", async () => {
    const { service } = makeTestService({ users: [] });

    await expect(service.getHome()).rejects.toBeInstanceOf(DemoUserMissingError);
  });

  it("does not call Claude", async () => {
    const { service, claude } = makeTestService();

    await service.getHome();

    expect(claude.calls).toHaveLength(0);
  });
});
