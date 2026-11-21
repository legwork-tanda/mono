import type { IntakeModel } from "./intake";

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
  /** Tests only: a scripted Claude for intake. Unset, intake calls Claude with ANTHROPIC_API_KEY. */
  INTAKE_MODEL?: IntakeModel;
  DB: D1Database;
  PHOTOS: R2Bucket;
};
