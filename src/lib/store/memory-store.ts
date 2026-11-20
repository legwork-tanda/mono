import type { Job, NewJob, Store, User } from "@/lib/job-service";

/**
 * In-memory Store used by tests. Returns copies so callers can't mutate stored
 * records by accident, the same as a real database.
 */
export class MemoryStore implements Store {
  private readonly users = new Map<string, User>();
  private readonly jobs = new Map<string, Job>();
  private nextJobNumber = 1;

  constructor(seed: { users?: User[] } = {}) {
    for (const user of seed.users ?? []) this.users.set(user.id, structuredClone(user));
  }

  async getUser(id: string): Promise<User | null> {
    const user = this.users.get(id);
    return user ? structuredClone(user) : null;
  }

  async createJob(input: NewJob): Promise<Job> {
    const job: Job = { ...structuredClone(input), id: `job-${this.nextJobNumber++}` };
    this.jobs.set(job.id, job);
    return structuredClone(job);
  }

  async getJob(id: string): Promise<Job | null> {
    const job = this.jobs.get(id);
    return job ? structuredClone(job) : null;
  }
}
