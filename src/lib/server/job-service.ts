import "server-only";
import { createJobService, mathRandom, systemClock, type ClaudeClient } from "@/lib/job-service";
import { AnthropicClaudeClient } from "@/lib/claude/anthropic-client";
import { SupabaseStore } from "@/lib/store/supabase-store";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * Claude is created on first use, so pages that don't talk to Claude
 * (like the home screen) work without an ANTHROPIC_API_KEY.
 */
const lazyClaude: ClaudeClient = (() => {
  let client: AnthropicClaudeClient | null = null;
  return {
    complete(request) {
      client ??= new AnthropicClaudeClient();
      return client.complete(request);
    },
  };
})();

/** The Job service wired to the real Supabase store, Claude, clock and randomness. */
export function getJobService() {
  return createJobService({
    store: new SupabaseStore(createServerSupabase()),
    claude: lazyClaude,
    clock: systemClock,
    random: mathRandom,
  });
}
