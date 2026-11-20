import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export class MissingEnvError extends Error {
  constructor(readonly variable: string) {
    super(`${variable} is not set. Copy .env.example to .env.local and fill it in (see README).`);
    this.name = "MissingEnvError";
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new MissingEnvError(name);
  return value;
}

/**
 * Server-side Supabase client using the service-role key. Never import this
 * from a client component: the key bypasses row-level security.
 */
export function createServerSupabase(): SupabaseClient {
  return createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } },
  );
}
