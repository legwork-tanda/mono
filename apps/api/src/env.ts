export type Env = {
  ENVIRONMENT: string;
  ALLOWED_ORIGINS: string;
  /** Secret. Local: apps/api/.dev.vars. Deployed: `wrangler secret put ANTHROPIC_API_KEY`. */
  ANTHROPIC_API_KEY: string;
  /** Secret, optional. Photo understanding via OpenRouter; without it the intake model reads photos itself. */
  OPENROUTER_API_KEY?: string;
  /** OpenRouter model id for photo understanding. Defaults to Gemini. */
  VISION_MODEL?: string;
  DB: D1Database;
  PHOTOS: R2Bucket;
};
