import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ChatTurn,
  Job,
  JobStatus,
  JobSummary,
  NewJob,
  Store,
  Tier,
  User,
} from "@/lib/job-service";

/** Store backed by the Supabase tables in supabase/migrations. */
export class SupabaseStore implements Store {
  constructor(private readonly db: SupabaseClient) {}

  async getUser(id: string): Promise<User | null> {
    const { data, error } = await this.db.from("users").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`Failed to load user ${id}: ${error.message}`);
    return data ? toUser(data) : null;
  }

  async createJob(job: NewJob): Promise<Job> {
    const { data, error } = await this.db.from("jobs").insert(fromJob(job)).select("*").single();
    if (error) throw new Error(`Failed to create job: ${error.message}`);
    return toJob(data);
  }

  async getJob(id: string): Promise<Job | null> {
    const { data, error } = await this.db.from("jobs").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`Failed to load job ${id}: ${error.message}`);
    return data ? toJob(data) : null;
  }
}

// Row mapping: the database uses snake_case, the domain uses camelCase.

interface UserRow {
  id: string;
  name: string;
  home_address: string;
  home_lat: number;
  home_lng: number;
}

interface JobRow {
  id: string;
  user_id: string;
  status: JobStatus;
  photos: string[];
  chat_transcript: Array<Omit<ChatTurn, "at"> & { at: string }>;
  summary: JobSummary | null;
  tier: Tier | null;
  required_date: string | null;
  locked_price_min: number | null;
  locked_price_max: number | null;
  tradie_id: string | null;
  created_at: string;
  stage_times: Record<string, string>;
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    name: row.name,
    homeAddress: { label: row.home_address, lat: row.home_lat, lng: row.home_lng },
  };
}

function toJob(row: JobRow): Job {
  return {
    id: row.id,
    userId: row.user_id,
    status: row.status,
    photos: row.photos,
    chatTranscript: row.chat_transcript.map((turn) => ({ ...turn, at: new Date(turn.at) })),
    summary: row.summary,
    tier: row.tier,
    requiredDate: row.required_date,
    lockedPrice:
      row.locked_price_min !== null && row.locked_price_max !== null
        ? { min: row.locked_price_min, max: row.locked_price_max }
        : null,
    tradieId: row.tradie_id,
    createdAt: new Date(row.created_at),
    stageTimes: Object.fromEntries(
      Object.entries(row.stage_times).map(([stage, at]) => [stage, new Date(at)]),
    ),
  };
}

function fromJob(job: NewJob): Omit<JobRow, "id"> {
  return {
    user_id: job.userId,
    status: job.status,
    photos: job.photos,
    chat_transcript: job.chatTranscript.map((turn) => ({ ...turn, at: turn.at.toISOString() })),
    summary: job.summary,
    tier: job.tier,
    required_date: job.requiredDate,
    locked_price_min: job.lockedPrice?.min ?? null,
    locked_price_max: job.lockedPrice?.max ?? null,
    tradie_id: job.tradieId,
    created_at: job.createdAt.toISOString(),
    stage_times: Object.fromEntries(
      Object.entries(job.stageTimes).map(([stage, at]) => [stage, at.toISOString()]),
    ),
  };
}
