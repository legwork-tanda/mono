import type { IntakeModel } from "./intake";
import type { RequestScreener } from "./screen";

export type Env = {
  ENVIRONMENT: string;
  ALLOWED_ORIGINS: string;
  /** Secret. Local: apps/api/.dev.vars. Deployed: `wrangler secret put ANTHROPIC_API_KEY`. */
  ANTHROPIC_API_KEY: string;
  /** Secret, optional. Photo understanding via OpenRouter; without it the intake model reads photos itself. */
  OPENROUTER_API_KEY?: string;
  /** OpenRouter model id for photo understanding. Defaults to GPT-6.2 Sol (fastest accurate one we measured). */
  VISION_MODEL?: string;
  /** OpenRouter model id for voice transcription; must accept audio. Defaults to Gemini. */
  TRANSCRIBE_MODEL?: string;
  /** OpenRouter model id for screening requests before intake (#98). Defaults to DEFAULT_SCREEN_MODEL. */
  SCREEN_MODEL?: string;
  /**
   * Tests only: a scripted screening classifier. Unset, screening calls
   * OpenRouter with OPENROUTER_API_KEY, and without that key it's skipped.
   */
  SCREENER?: RequestScreener;
  /** Tests only: how long screening waits on the classifier (SCREEN_TIMEOUT_MS by default). */
  SCREEN_TIMEOUT_MS?: number;
  /** Tests only: a scripted Claude for intake. Unset, intake calls Claude with ANTHROPIC_API_KEY. */
  INTAKE_MODEL?: IntakeModel;
  DB: D1Database;
  PHOTOS: R2Bucket;
};
