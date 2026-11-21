# Demo data

Everything the demo needs to look real, in one JSON file, generated from small authored sources so prices and personas stay consistent.

```
data/
  source/
    price-book.json    Brisbane price anchors per trade, and job archetypes
    tradies.json       the supply side: 40 Pros, with the fields matching needs
    reviews.json       90 review lines, assigned so none repeat
    suburbs.json       53 real Brisbane suburbs with coordinates
    demo-jobs.json     8 ready-made jobs (intake answers + write-up) + 8 customers
  build-demo-data.mjs  assembles and validates → legwork-demo.json + seed SQL
  rank-demo.mjs        runs Will's two algorithms over the data and prints the result
  legwork-demo.json    THE ARTEFACT. Everything reads this.
  seed/d1.sql          seed for apps/api on blakes-branch (Cloudflare D1)
  seed/supabase.sql    seed for Ivan's Supabase schema
```

Regenerate:

```bash
node data/build-demo-data.mjs     # rebuilds legwork-demo.json and both seed files
node data/rank-demo.mjs           # every job
node data/rank-demo.mjs demo-04   # one job
```

`build-demo-data.mjs` exits non-zero if any invariant breaks — a job with fewer than three eligible Pros, a trade with thin supply, tier prices that do not rise, a service area that is not a real suburb, a duplicated review. Do not work around it; fix the source.

## What is in legwork-demo.json

| key | what it is |
|---|---|
| `meta` | currency, region, the four price sources it was built from, and counts |
| `trades` | the 10 trade ids from `packages/shared/src/trades.ts`, each with hourly, callout, after-hours multiplier and job archetypes |
| `suburbs` | real Brisbane suburb centroids |
| `customers` | 8 fictional customers with real addresses-shaped detail |
| `tradies` | 40 Pros. The original 28 ids are kept, so seeding over `migrations/0005` and `0007` replaces rather than duplicates |
| `jobs` | 8 demo jobs: description, intake answers, write-up, tier, prices, and the ids of every eligible Pro |

### Why the tradie record has more fields than the current schema

Will's matching PDF asks for things the `tradies` table does not hold. Each extra field exists to feed one of them:

| field | feeds |
|---|---|
| `skills[]`, `experienceYears` | job fit — "the right type of Pro for the exact work, not just the broad trade" |
| `licence`, `insurance` | the eligibility gate ("required credential verified") and trust |
| `serviceAreas[]`, `serviceRadiusKm` | the gate's area check. The radius is expanded at build time into the suburb list, because the gate asks "did this Pro select this area" |
| `earliestStartHours`, `availableNow` | availability in both algorithms |
| `reliability{onTimePct, quoteAccuracyPct, cancellations, noShows, disputes, jobsCompleted}` | reliability, which the PDF says should move from Google to Legwork's own evidence |
| `reputation{google, googleReviews, legwork, legworkReviews}` | reputation, volume-adjusted (see `rank-demo.mjs`) |
| `bidPropensity` | the PDF's small signal so invitations are not wasted |
| `pricePosition` | how a simulated Pro quotes |
| `reviews[]` | the two most recent, which the match card shows |

`rating`, `reviewCount`, `jobsDone`, `distanceKm` and `bearing` are kept because `blakes-branch` reads them. `rating` is the Google rating, which is what the PDF says reputation starts from.

## Pricing model, and the one setting it disagrees with

Each archetype has an authored book-ahead band (e.g. a burst pipe is $300–450). The two urgent tiers shift that whole band by the trade's own after-hours multiplier: 45% of it for within 24 hours, all of it for same-day. Bands keep their width, because the width is how uncertain the job is. Work that is inherently scheduled and large (hot water unit, switchboard, retaining wall) gets a flat dollar premium instead — a same-day hot water replacement costs $240 more, not 30% more.

**Finding for the team:** `TRADE_PRICE_LIMITS.plumbing` in `packages/shared/src/trades.ts` caps prices at $1500. A hot water replacement is $1150–1890 in this data and $1250–2500 in the Brisbane market. `guardPrices()` will clamp a real quote to $1500 and the customer will see a price the Pro cannot honour. Either raise the plumbing cap to $3000 or drop hot water work from the archetypes. The build prints this as a warning every run.

## Running the matching engine on it

`rank-demo.mjs` implements Algorithm 1 (gate, then fit / reputation / reliability / availability / bid propensity) and Algorithm 2 (price against a private anchor / fit / reputation / reliability / availability / bid quality) from `Legwork_Matching_Algorithms.pdf`.

The PDF names the signals but not the weights. The weights at the top of each function are a proposal, in one place, meant to be argued with. Example output for demo-01:

```
gate: 4 eligible / 40 in the network
Algorithm 1 — who gets invited
  Hollis Plumbing Co   0.877  fit 0.82 rep 0.80 rel 0.89 avail 1.00 bid 0.99
  Patel Plumbing       0.827  fit 0.62 rep 0.87 rel 0.93 avail 1.00 bid 0.86
Algorithm 2 — 3 of 4 bid
  Patel Plumbing       $645  0.875  · in line with the anchor
→ match: Sam Patel at $645, 4 min typical reply
```

Note what that output shows about the two-algorithm split: the highest invite score (Hollis) is not the winner, because Patel's delivery record and job fit beat it on the bid. That is the PDF's point, and it is only visible with data rich enough to separate the two.

## Open items

- **Photos.** A judge describing their own problem is the demo. The 8 canned jobs have no images, so the fallback path (venue wifi dies, upload breaks) needs either two phone photos of a real burst pipe and a real fence, or the intake has to run without a photo. Cheapest fix: take two photos of something broken at the venue and attach them to demo-01 and demo-06.
- **Intake answers are keyed by prompt text.** If `apps/api/src/intake.ts` changes its fixed prompts, `demo-jobs.json` answers stop lining up. They are for testing and fallback, not for the live path.
- **Business names are fictional on purpose.** Real Brisbane tradie rates went into the price book; real business names did not go onto fake ratings.
