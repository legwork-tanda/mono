# Legwork (tradie-matching MVP)

Mobile-first web app: a homeowner photographs a problem, Claude asks a few follow-ups and produces a summary card with three tiered prices, and the job is broadcast in waves to nearby (mock, simulated) tradies. Full requirements are in [spec.md](spec.md); the pitch is in [README.md](README.md). Read spec.md before building any feature. The product name is not final.

## Stack
- Next.js (App Router) + TypeScript (strict), `src/` directory
- Supabase: database, realtime, file storage
- Claude API (`@anthropic-ai/sdk`), **server-side only**, one multimodal conversation for photo analysis and chat
- Leaflet + OpenStreetMap for maps (no API keys)
- Vitest for tests
- Auth: a single seeded demo user, no login screens

## Commands
- `npm run dev` start dev server
- `npm run build` production build
- `npm test` run Vitest
- `npm run lint` lint

## Architecture rules
- **The Job service owns every business rule** (`src/lib/job-service/`). UI screens and route handlers are thin and only call it. Never put a rule in the UI.
- The Job service takes four injected dependencies: a Claude client, a store (Supabase in the app, in-memory in tests), a clock, and a source of randomness. Never read `Date.now()` or `Math.random()` inside it directly.
- The model suggests; the service enforces: question cap (~4), per-trade price clamping, Low < Medium < High, severity 4-5 pre-selects High, safety flag forces High, malformed output retried once then falls back to asking in words.
- Simulated tradies must write to the same tables, through the same operations, that a real tradie app would use later.
- Job states: `draft → confirmed → searching → matched → en_route → in_progress → completed`; also `searching → no_match` and `(searching | matched within 2 min) → cancelled`. Reject invalid transitions.
- The Claude API key must never reach the browser.

## Testing
- Test only the Job service's public operations and assert on returned values and stored records. Never test internals.
- Use fakes: scripted fake Claude client, in-memory store, test-controlled clock and randomness. No real API calls in tests.
- UI, map animation and real Claude answer quality are checked by hand.

## Conventions
- Design for a phone-sized screen first.
- Supported trades: plumbing, electrical, carpentry/handyman, roofing/gutters.
- Out of scope for the MVP: tradie-facing app, payments, real auth, push notifications, invoices, road routing. See spec.md.

## Gotchas
- The repo lives in OneDrive. Exclude `node_modules` from sync to avoid slow installs and file locks.
- Copy `.env.example` to `.env.local` and fill in keys. Never commit `.env*` files.

## Plans
Save every plan Claude produces to `docs/plans/YYYY-MM-DD-<topic>.md`. This folder is gitignored and personal; never commit it or remove it from `.gitignore`.
