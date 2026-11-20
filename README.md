**Legwork**
Tanda hackathon team

**Overview**
An Uber-style platform connecting customers with verified, available tradespeople in minutes, at transparent, upfront prices.
Customers describe their job, receive an estimated price range, and are matched with a suitable tradie. No calling around, comparing quotes or negotiating prices.

**The Problem**
**Customers** struggle to find reliable tradies, wait for callbacks, face uncertain pricing and often don’t even know what the price of a job should be.
**Tradies** waste time and money buying leads, quoting unsuccessful jobs and managing inconsistent workloads.

**How It Works**
For customers:
1 Describe: Take or upload photos. An AI assistant (Claude) looks at them and asks a few short follow-up questions to work out the trade, the problem and how severe it is.
2 Book: Choose urgency and date required and see an upfront price range (e.g. $80-$100), estimated by Claude.
3 Match: Get automatically assigned a verified tradie, with their profile and ETA.
4 Track: Approve any additional costs before work proceeds.
5 Pay: Payment is processed on completion, followed by two-way ratings.

For tradies:
1 Verify their identity, licence and insurance.
2 Set service areas, job preferences and availability - either manage their calendar in the app or on a third party.
3 Receive relevant, pre-priced job offers (subject to seeing the site).
4 Accept jobs, complete work and request approval for scope changes.
5 Get paid securely and reliably, minus the platform commission.

**Smart Matching**
Jobs are offered to small groups of suitable tradies, rather than broadcast to everyone.
The matching algorithm considers:
• Eligibility: Licensing, insurance, service area and availability.
• Suitability: Skills, experience, distance, equipment and ETA.
• Performance: Ratings, reliability, cancellations, complaints and pricing accuracy.
• Market conditions: Local demand, supply, urgency and workload.
• Price: The tradie submits a quote for the job and the algorithm compares that to known market values.
Emergency jobs prioritise response time; flexible bookings prioritise quality and price reliability. New tradies receive opportunities to establish a track record.

**Dynamic Pricing**
Customers see an estimated price range before confirming.
Pricing considers job type, estimated labour and materials, location, travel, urgency, demand and GST.
Clear jobs receive tighter ranges; uncertain jobs may require a diagnostic fee and an approved on-site quote. Additional work always requires customer approval.
Pricing begins with regional rate-based estimates and evolves into data-driven predictions using completed job histories.

**Trust & Safety**
• Verified licences, insurance and identities.
• Ongoing credential and insurance checks.
• Transparent pricing and approved variations.
• Secure payments and dispute resolution.
• Two-way ratings and performance-based matching.

**Hackathon MVP Scope**
The full vision is above. The MVP is described in [spec.md](spec.md) and covers the customer side only, with simulated tradies.
Built in the MVP: photo-first job reporting with the AI assistant, price ranges per urgency tier, required date, filtered and widening-wave matching (the fastest tradie to accept gets the job), live map, messaging, completion and reviews.
Designed but not built yet: tradie counter-offers (capped at 20% above the quoted range), customer approval of extra costs, and tradie ratings of customers.
Not in the MVP: payments, tradie verification, the tradie-facing app and diagnostic fees.

**Core Value Proposition**
For customers: A reliable tradie, at a fair price, without the hassle.
For tradies: More confirmed jobs, less quoting, no wasted lead fees.
The vision: Become Australia's default way to book a tradie - as simple as ordering an Uber.

**Running Locally**

You need:

- Node.js 20 or newer (`node -v` to check)
- A free Supabase account at https://supabase.com
- An Anthropic API key from https://console.anthropic.com (optional for now: only needed once the photo chat is built)

If the repo is inside OneDrive, right-click the `node_modules` folder after installing and choose "Free up space" or exclude it from sync, otherwise installs are slow and files can lock.

1.  Install dependencies

    npm install

2.  Create a Supabase project
    - On https://supabase.com/dashboard click "New project". Pick a name, a region close to you (e.g. Sydney) and a database password. Save the password; you need it in step 4.
    - Wait for the project to finish setting up (about 2 minutes).

3.  Add your keys
    - Copy `.env.example` to a new file called `.env.local` in the project root.
    - In the Supabase dashboard, open Project Settings → API (or the "Connect" button) and copy:
      - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
      - `anon` / publishable key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
      - `service_role` / secret key → `SUPABASE_SERVICE_ROLE_KEY` (keep this one secret: it bypasses all security rules)
    - Optional: put your Anthropic key in `ANTHROPIC_API_KEY`.

4.  Create the database tables, photo buckets and demo data. The database is set up from the migration files in `supabase/migrations/` and the demo data in `supabase/seed/`, so everyone gets an identical database:

        npx supabase login
        npx supabase link --project-ref <your-project-ref>
        npm run db:push

    - `login` opens your browser to sign in to Supabase.
    - The project ref is the random id in your dashboard URL: `https://supabase.com/dashboard/project/<project-ref>`.
    - `link` and `db:push` ask for the database password from step 2.
    - When asked "Do you want to push these migrations?", answer `Y`.

    Afterwards the dashboard should show 6 tables in Table Editor (users, tradies, jobs, offers, messages, reviews), 2 buckets in Storage (job-photos, review-photos), 15 tradies and the demo user "Alex Demo".

5.  Start the app

        npm run dev

    Open http://localhost:3000. You should see "Hi Alex" and the demo home address. For a phone-sized view, open your browser's developer tools and turn on device mode (Ctrl+Shift+M in Chrome).

6.  Run the tests

        npm test

    The tests use an in-memory database and a fake Claude, so they need no keys or internet.

7.  Run the web app

        npm run dev

    This would run and provide the barebones of the website, no button clickable yet

Changing the database later:

    npx supabase migration new <short_description>   # creates supabase/migrations/<timestamp>_<short_description>.sql
    npm run db:push                                   # applies it to your Supabase project

Never change tables by hand in the dashboard, and never edit a migration that has already been pushed. Always add a new one, so everyone's database stays the same.

Troubleshooting:

- The home page says "Almost there": a key is missing from `.env.local` or the seed wasn't applied. The message names what's missing. Fix it, restart `npm run dev`, then refresh.
- `db:push` fails with a password error: rerun it and type the database password from step 2. Reset it under Project Settings → Database if you've lost it.
- `db:push` says "failed to connect to postgres ... 127.0.0.1:54322": it's trying a local Docker database. Use `npm run db:push` (which passes `--remote`), not `npx supabase db push` on its own.
- Tests fail with "Vitest failed to find the current suite": run them with `npm test`, not `npx vitest`.
