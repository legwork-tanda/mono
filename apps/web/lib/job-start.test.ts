import { describe, expect, it, vi } from "vitest";
import type { Photo } from "@legwork/shared";
import { JobDraft, type StartDeps } from "./job-start";
import type { Session } from "./session";

const file = (name: string) => new File(["x"], name, { type: "image/jpeg" });

/** Fake requests: uploads of the file names in `failing` fail until they're taken out. */
function fakeDeps(opts: { failCreate?: number } = {}) {
  let created = 0;
  let createFailures = opts.failCreate ?? 0;
  const failing = new Set<string>();
  const deps = {
    create: vi.fn(async (): Promise<Session> => {
      if (createFailures > 0) {
        createFailures--;
        throw new Error("Couldn't reach Legwork.");
      }
      created++;
      return { id: `job${created}`, token: "t", uploadToken: "u" };
    }),
    upload: vi.fn(async (s: Session, f: File): Promise<Photo> => {
      if (failing.has(f.name)) {
        throw new Error("Upload failed.");
      }
      return { id: `${s.id}/${f.name}`, path: `/p/${f.name}` } as Photo;
    }),
    removePhoto: vi.fn(async () => undefined),
    describe: vi.fn(async () => undefined),
  } satisfies StartDeps;
  return { deps, failing };
}

describe("JobDraft", () => {
  it("creates one job and uploads each photo once", async () => {
    const { deps } = fakeDeps();
    const job = new JobDraft(deps);
    const a = file("a.jpg");
    job.attach(a);
    const { session, photos, failed } = await job.prepare("Leaking tap", [a]);
    expect(session.id).toBe("job1");
    expect(photos).toHaveLength(1);
    expect(failed.size).toBe(0);
    expect(deps.create).toHaveBeenCalledTimes(1);
    expect(deps.upload).toHaveBeenCalledTimes(1);
    expect(deps.describe).toHaveBeenCalledWith(session, "Leaking tap");
  });

  it("reports the failed photo and retries only it, on the same job", async () => {
    const { deps, failing } = fakeDeps();
    const job = new JobDraft(deps);
    const a = file("a.jpg");
    const b = file("b.jpg");
    failing.add("b.jpg");
    job.attach(a);
    job.attach(b);

    const first = await job.prepare("Paint two rooms", [a, b]);
    expect([...first.failed.keys()]).toEqual([b]);
    // Nothing starts while a photo is missing: the description waits.
    expect(deps.describe).not.toHaveBeenCalled();

    failing.delete("b.jpg");
    const second = await job.prepare("Paint two rooms", [a, b]);
    expect(second.failed.size).toBe(0);
    expect(second.session.id).toBe("job1");
    expect(second.photos.map((p) => p.id)).toEqual(["job1/a.jpg", "job1/b.jpg"]);
    expect(deps.create).toHaveBeenCalledTimes(1);
    expect(deps.upload.mock.calls.filter(([, f]) => f === a)).toHaveLength(1);
    expect(deps.describe).toHaveBeenCalledTimes(1);
  });

  it("retries a single photo on its own", async () => {
    const { deps, failing } = fakeDeps();
    const job = new JobDraft(deps);
    const a = file("a.jpg");
    failing.add("a.jpg");
    job.attach(a);
    await expect(job.retry(a)).rejects.toThrow("Upload failed.");
    failing.delete("a.jpg");
    await job.retry(a);
    const { failed, photos } = await job.prepare("", [a]);
    expect(failed.size).toBe(0);
    expect(photos).toHaveLength(1);
    // Two sends from retry (the first after the failed attach) and none from prepare.
    expect(deps.upload).toHaveBeenCalledTimes(3);
  });

  it("creates the job again after a failed create, without a duplicate", async () => {
    const { deps } = fakeDeps({ failCreate: 1 });
    const job = new JobDraft(deps);
    await expect(job.prepare("Install a fan", [])).rejects.toThrow("Couldn't reach Legwork.");
    const { session } = await job.prepare("Install a fan", []);
    expect(session.id).toBe("job1");
    await job.prepare("Install a fan", []);
    expect(deps.create).toHaveBeenCalledTimes(2);
    // Created with the description, so it isn't sent again.
    expect(deps.describe).not.toHaveBeenCalled();
  });

  it("keeps the job when the description request fails, and sends it again", async () => {
    const { deps } = fakeDeps();
    deps.describe.mockRejectedValueOnce(new Error("Server error"));
    const job = new JobDraft(deps);
    job.attach(file("a.jpg"));
    await expect(job.prepare("Fix the gate", [])).rejects.toThrow("Server error");
    await job.prepare("Fix the gate", []);
    expect(deps.create).toHaveBeenCalledTimes(1);
    expect(deps.describe).toHaveBeenCalledTimes(2);
  });

  it("uploads photos again when the early draft job couldn't be created", async () => {
    const { deps } = fakeDeps({ failCreate: 1 });
    const job = new JobDraft(deps);
    const a = file("a.jpg");
    job.attach(a);
    const { session, failed, photos } = await job.prepare("", [a]);
    expect(failed.size).toBe(0);
    expect(photos).toHaveLength(1);
    expect(session.id).toBe("job1");
  });

  it("deletes a removed photo from the job", async () => {
    const { deps } = fakeDeps();
    const job = new JobDraft(deps);
    const a = file("a.jpg");
    job.attach(a);
    job.remove(a);
    await vi.waitFor(() => expect(deps.removePhoto).toHaveBeenCalledTimes(1));
    const { photos } = await job.prepare("Tap", []);
    expect(photos).toHaveLength(0);
  });
});
