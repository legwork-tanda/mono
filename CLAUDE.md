# Legwork (tradie-matching MVP)

Mobile-first web app: a homeowner photographs a problem, Claude asks a few follow-ups and produces a summary card with a price range per urgency tier, and the job is broadcast in waves to nearby (mock, simulated) tradies. Full requirements are in [spec.md](spec.md); the pitch and local setup are in [README.md](README.md). Read spec.md before building any feature. The product name is not final.

## Stack
- Next.js 16 (App Router) + React 19 + TypeScript (strict), `src/` directory. Next 16 has breaking changes from older versions: check `node_modules/next/dist/docs/` before using an API you're unsure of.
- Supabase: database, realtime, file storage. Hosted project, no local Docker.
- Claude API (`@anthropic-ai/sdk`), **server-side only**, one multimodal conversation for photo analysis and chat
- Leaflet + OpenStreetMap for maps (no API keys)
- Vitest for tests
- Auth: a single seeded demo user (`DEMO_USER_ID`), no login screens

## Commands
- `npm run dev` start dev server (http://localhost:3000)
- `npm test` run tests once (`npm run test:watch` to watch)
- `npm run typecheck` / `npm run lint` / `npm run build`
- `npm run db:push` apply new migrations and the seed to the linked Supabase project
- `npx supabase migration new <name>` create a new migration file

## Layout
- `src/lib/job-service/` the Job service: `job-service.ts` (operations), `ports.ts` (the four dependency interfaces), `types.ts`, `trades.ts` (trade list and price limits), `errors.ts`
- `src/lib/store/` `MemoryStore` (tests) and `SupabaseStore` (app)
- `src/lib/claude/`, `src/lib/supabase/` real adapters, server-only
- `src/lib/server/job-service.ts` `getJobService()` wires the real adapters; pages and route handlers call this
- `tests/support/` fakes and `makeTestService()`; `tests/job-service/` one file per operation
- `supabase/migrations/` schema, `supabase/seed/seed.sql` demo data

## Architecture rules
- **The Job service owns every business rule.** UI screens and route handlers are thin and only call it. Never put a rule in the UI.
- The Job service takes four injected dependencies: a Claude client, a store, a clock, and a source of randomness. Never read `Date.now()`, `new Date()` or `Math.random()` inside it directly.
- The model suggests; the service enforces: question cap (~4), price ranges clamped to per-trade limits, Low < Medium < High, severity 4-5 pre-selects High, safety flag forces High, malformed output retried once then falls back to asking in words.
- Simulated tradies must write to the same tables, through the same operations, that a real tradie app would use later.
- Job states: `draft → confirmed → searching → matched → en_route → in_progress → completed`; also `searching → no_match` and `(searching | matched within 2 min) → cancelled`. Reject invalid transitions.
- The Claude API key and the Supabase service-role key must never reach the browser. Modules that use them import `server-only`.
- Grow the `Store` interface one operation at a time, implementing it in both `MemoryStore` and `SupabaseStore`.

## Testing
- Write the tests first and see them fail, then implement.
- Test only the Job service's public operations and assert on returned values and stored records. Never test internals.
- Every test builds the service with `makeTestService()` from `tests/support/make-service.ts`: in-memory store, scripted `FakeClaudeClient` (`claudeSays.ask/summary/safety/malformed`), `FakeClock`, `FakeRandom`. No real API calls in tests.
- UI, map animation and real Claude answer quality are checked by hand.

## Database
- Schema changes are always new migration files (`npx supabase migration new <name>`), never edits in the Supabase dashboard and never edits to applied migrations.
- Trade ids live in both `src/lib/job-service/trades.ts` and the `is_valid_trade_list` SQL function. Change both together.
- The seed must stay safe to re-run (`on conflict do nothing`).

## Conventions
- Design for a phone-sized screen first.
- Out of scope for the MVP: tradie-facing app, payments, verification, real auth, push notifications, invoices, road routing, diagnostic fees. See spec.md.

## Gotchas
- The repo lives in OneDrive. Exclude `node_modules` from sync to avoid slow installs and file locks.
- On Windows, Vitest breaks ("failed to find the current suite") when the terminal path starts with lowercase `c:\`. Always run tests through `npm test`, which uses `scripts/vitest.mjs` to fix this, never `npx vitest` directly.
- Copy `.env.example` to `.env.local` and fill in keys. Never commit `.env*` files.

## Plans
Save every plan Claude produces to `docs/plans/YYYY-MM-DD-<topic>.md`. This folder is gitignored and personal; never commit it or remove it from `.gitignore`.
