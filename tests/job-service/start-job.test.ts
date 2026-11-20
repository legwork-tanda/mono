import { describe, expect, it } from "vitest";
import { JobNotFoundError, ValidationError } from "@/lib/job-service";
import { makeTestService } from "../support/make-service";
import { demoUser } from "../support/fixtures";

const photos = ["job-photos/close-up.jpg", "job-photos/wide.jpg"];

describe("startJob", () => {
  it("creates a draft job for the demo user with the given photos", async () => {
    const { service } = makeTestService({ now: "2026-11-21T09:30:00.000Z" });

    const job = await service.startJob({ photos });

    expect(job.id).toBeTruthy();
    expect(job.userId).toBe(demoUser.id);
    expect(job.status).toBe("draft");
    expect(job.photos).toEqual(photos);
    expect(job.createdAt).toEqual(new Date("2026-11-21T09:30:00.000Z"));
  });

  it("stores the job so it can be read back", async () => {
    const { service } = makeTestService();

    const created = await service.startJob({ photos });
    const loaded = await service.getJob(created.id);

    expect(loaded).toEqual(created);
  });

  it("starts with nothing decided yet", async () => {
    const { service } = makeTestService();

    const job = await service.startJob({ photos });

    expect(job.chatTranscript).toEqual([]);
    expect(job.summary).toBeNull();
    expect(job.tier).toBeNull();
    expect(job.requiredDate).toBeNull();
    expect(job.lockedPrice).toBeNull();
    expect(job.tradieId).toBeNull();
  });

  it("rejects a job with no photos", async () => {
    const { service } = makeTestService();

    await expect(service.startJob({ photos: [] })).rejects.toBeInstanceOf(ValidationError);
  });

  it("does not call Claude when the job is created", async () => {
    const { service, claude } = makeTestService();

    await service.startJob({ photos });

    expect(claude.calls).toHaveLength(0);
  });
});

describe("getJob", () => {
  it("fails clearly for an unknown job id", async () => {
    const { service } = makeTestService();

    await expect(service.getJob("does-not-exist")).rejects.toBeInstanceOf(JobNotFoundError);
  });
});
