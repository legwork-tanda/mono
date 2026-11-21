import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ApiError, HealthResponse } from "@legwork/shared";
import { redactUrl } from "./auth";
import type { Env } from "./env";
import { handoff } from "./handoff";
import { jobs } from "./jobs";
import { reviews } from "./reviews";
import { tradie } from "./tradie";
import { transcribe } from "./transcribe";

const app = new Hono<{ Bindings: Env }>();

// Request log: method, path, status and time. Credentials in the query
// (photo URLs carry `?t=`) are redacted, so tokens never reach the logs.
app.use("*", async (c, next) => {
  const started = Date.now();
  const path = redactUrl(c.req.url);
  console.log(`<-- ${c.req.method} ${path}`);
  await next();
  console.log(`--> ${c.req.method} ${path} ${c.res.status} ${Date.now() - started}ms`);
});

app.use("*", (c, next) => {
  // A WebSocket upgrade (GET /jobs/:id/live) isn't a CORS request, and its
  // 101 response's headers can't be changed. The token in the URL is the check.
  if (c.req.header("Upgrade")?.toLowerCase() === "websocket") return next();
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

app.route("/handoff", handoff);
app.route("/jobs", jobs);
app.route("/reviews", reviews);
app.route("/transcribe", transcribe);
app.route("/tradie", tradie);

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
export { JobLive } from "./live";
