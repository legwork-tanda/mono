import type { Job, User } from "./types";

/**
 * The four swappable dependencies of the Job service.
 * Real implementations live in src/lib/{claude,store}; fakes live in tests/support.
 */

export type ClaudeContent =
  | { type: "text"; text: string }
  | { type: "image"; url: string };

export interface ClaudeMessage {
  role: "user" | "assistant";
  content: ClaudeContent[];
}

export interface ClaudeRequest {
  system: string;
  messages: ClaudeMessage[];
}

export interface ClaudeClient {
  /** Sends a conversation and returns the assistant's raw text reply. */
  complete(request: ClaudeRequest): Promise<string>;
}

export type NewJob = Omit<Job, "id">;

/**
 * Persistence. Grows one operation at a time as tickets need them.
 * Implemented by MemoryStore (tests) and SupabaseStore (app).
 */
export interface Store {
  getUser(id: string): Promise<User | null>;
  createJob(job: NewJob): Promise<Job>;
  getJob(id: string): Promise<Job | null>;
}

export interface Clock {
  now(): Date;
}

export interface Random {
  /** A number in [0, 1). */
  next(): number;
}

export interface JobServiceDeps {
  claude: ClaudeClient;
  store: Store;
  clock: Clock;
  random: Random;
}
