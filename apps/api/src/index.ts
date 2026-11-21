import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { ApiError, HealthResponse } from "@legwork/shared";
import type { Env } from "./env";
import { jobs } from "./jobs";
import { transcribe } from "./transcribe";

const app = new Hono<{ Bindings: Env }>();

app.use("*", logger());

app.use("*", (c, next) => {
  const allowed = c.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim());
  return cors({
    origin: (origin) => (allowed.includes(origin) ? origin : null),
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
    maxAge: 86400,
  })(c, next);
});

app.get("/health", (c) =>
  c.json<HealthResponse>({
    ok: true,
    service: "legwork-api",
    environment: c.env.ENVIRONMENT,
    time: new Date().toISOString(),
  }),
);

app.route("/jobs", jobs);
app.route("/transcribe", transcribe);

app.notFound((c) => c.json<ApiError>({ error: "Not found" }, 404));

app.onError((err, c) => {
  console.error(err);
  return c.json<ApiError>({ error: "Internal server error" }, 500);
});

export default {
  fetch: app.fetch,

  // Background "legwork" lives here: cron triggers, queues, etc.
  // Enable a schedule in wrangler.jsonc: "triggers": { "crons": ["*/15 * * * *"] }
  async scheduled(_controller, _env, _ctx) {},
} satisfies ExportedHandler<Env>;

export { app };
