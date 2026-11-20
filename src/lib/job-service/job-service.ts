import { DemoUserMissingError, JobNotFoundError, ValidationError } from "./errors";
import type { JobServiceDeps } from "./ports";
import type { Address, Job } from "./types";

/** The single seeded demo account. Must match supabase/seed/seed.sql. */
export const DEMO_USER_ID = "00000000-0000-4000-8000-000000000001";

export interface HomeView {
  user: { id: string; name: string };
  homeAddress: Address;
}

export interface StartJobInput {
  /** Storage paths of the photos already uploaded. */
  photos: string[];
}

/**
 * The Job service owns every business rule about a job.
 * UI screens and route handlers only call these operations.
 */
export function createJobService(deps: JobServiceDeps) {
  const { store, clock } = deps;

  async function requireDemoUser() {
    const user = await store.getUser(DEMO_USER_ID);
    if (!user) throw new DemoUserMissingError();
    return user;
  }

  return {
    async getHome(): Promise<HomeView> {
      const user = await requireDemoUser();
      return {
        user: { id: user.id, name: user.name },
        homeAddress: user.homeAddress,
      };
    },

    async startJob(input: StartJobInput): Promise<Job> {
      if (input.photos.length === 0) {
        throw new ValidationError("A job needs at least one photo.");
      }
      const user = await requireDemoUser();
      const now = clock.now();
      return store.createJob({
        userId: user.id,
        status: "draft",
        photos: [...input.photos],
        chatTranscript: [],
        summary: null,
        tier: null,
        requiredDate: null,
        lockedPrice: null,
        tradieId: null,
        createdAt: now,
        stageTimes: { draft: now },
      });
    },

    async getJob(jobId: string): Promise<Job> {
      const job = await store.getJob(jobId);
      if (!job) throw new JobNotFoundError(jobId);
      return job;
    },
  };
}

export type JobService = ReturnType<typeof createJobService>;
