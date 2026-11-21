#!/usr/bin/env node
// Builds data/legwork-demo.json from the authored source files in data/source/.
//
// Why a builder and not one hand-written JSON: the price book has to stay the
// single source of truth for prices, tradie distance/bearing are derived from
// real suburb coordinates, and every invariant that would embarrass us in a
// demo (a job with no eligible tradie, prices that do not rise across tiers, a
// trade with no supply) is checked here rather than discovered on stage.
//
//   node data/build-demo-data.mjs
//
// Outputs:
//   data/legwork-demo.json   the dataset every surface reads
//   data/seed/d1.sql         additive seed for Blake's Cloudflare D1 schema
//   data/seed/supabase.sql   seed for Ivan's Postgres schema

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => JSON.parse(readFileSync(join(here, p), "utf8"));

const priceBook = read("source/price-book.json");
const suburbsFile = read("source/suburbs.json");
const tradiesFile = read("source/tradies.json");
const reviewsFile = read("source/reviews.json");
const jobsFile = read("source/demo-jobs.json");

const TRADES = Object.keys(priceBook.trades);
// Mirrors TRADE_PRICE_LIMITS in packages/shared/src/trades.ts on blakes-branch.
// Reported as warnings: the guardrails are the app's, the market is the market.
const GUARDS = {
  default: { min: 80, max: 2000 },
  plumbing: { min: 100, max: 1500 },
  electrical: { min: 100, max: 1500 },
  roofing_gutters: { min: 150, max: 3000 },
  locksmith: { min: 90, max: 600 },
};

const problems = [];
const warnings = [];

// ---------------------------------------------------------------- suburbs ---
// Service areas reference a few suburbs that are not demo centroids; add them.
const extraSuburbs = [
  { name: "Herston", postcode: "4006", lat: -27.4468, lng: 153.0246 },
  { name: "Norman Park", postcode: "4170", lat: -27.4786, lng: 153.0646 },
  { name: "Hemmant", postcode: "4174", lat: -27.4589, lng: 153.1221 },
  { name: "Zillmere", postcode: "4034", lat: -27.3631, lng: 153.0431 },
];
const suburbs = [...suburbsFile.suburbs];
for (const s of extraSuburbs) if (!suburbs.some((x) => x.name === s.name)) suburbs.push(s);
const byName = new Map(suburbs.map((s) => [s.name, s]));

const R = 6371;
const toRad = (d) => (d * Math.PI) / 180;
function distanceKm(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function bearingDeg(a, b) {
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

const home = jobsFile.demoHome;

// ---------------------------------------------------------------- reviews ---
// Deterministic, unique assignment: hash the tradie id, walk its trade pools.
function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
// Every Pro must carry the two most recent reviews, because the match card
// shows them. The bank is smaller than 3 x 40, so a line may appear under two
// Pros at most, and never twice under the same one.
const REVIEW_USES = 2;
const usage = new Map();
function reviewsFor(tradie) {
  // A 4.5 star tradie should not read like a 4.9 star one.
  const wantLow = tradie.reputation.google <= 4.6;
  const pools = [...new Set(tradie.trades)]
    .flatMap((t) => reviewsFile.bank.filter((r) => r.trade === t))
    .sort((a, b) => (wantLow ? a.stars - b.stars : b.stars - a.stars));
  const start = hash(tradie.id) % Math.max(1, pools.length);
  const order = [...pools.slice(start), ...pools.slice(0, start)];
  const picked = [];
  for (const r of order) {
    if (picked.length >= 3) break;
    if (picked.some((p) => p.text === r.text)) continue;
    const n = usage.get(r.text) ?? 0;
    if (n >= REVIEW_USES) continue;
    if (picked.length === 0 && !wantLow && r.stars < 4) continue;
    picked.push(r);
    usage.set(r.text, n + 1);
  }
  if (picked.length < 3) problems.push(`${tradie.id}: review bank exhausted (${picked.length}/3)`);
  return picked;
}

// ---------------------------------------------------------------- tradies ---
// A Pro's service area is the suburbs they picked plus everything inside their
// stated radius of home, which is how a real Pro sets it. Will's eligibility
// gate only asks "did this Pro select this area", so the radius has to produce
// honest coverage or the demo dead-ends in no_match.
const DEFAULT_RADIUS_KM = 12;
const tradies = tradiesFile.tradies.map((t) => {
  const home_ = byName.get(t.homeSuburb);
  if (!home_) problems.push(`${t.id}: homeSuburb "${t.homeSuburb}" not in suburbs.json`);
  for (const a of t.serviceAreas)
    if (!byName.has(a)) problems.push(`${t.id}: service area "${a}" not in suburbs.json`);
  const radius = t.serviceRadiusKm ?? DEFAULT_RADIUS_KM;
  const inRadius = home_ ? suburbs.filter((s) => distanceKm(home_, s) <= radius).map((s) => s.name) : [];
  const serviceAreas = [...new Set([...t.serviceAreas, ...inRadius])].sort();
  for (const tr of t.trades)
    if (!TRADES.includes(tr)) problems.push(`${t.id}: trade "${tr}" not supported`);

  const reviews = reviewsFor(t).map((r, i) => ({
    id: `${t.id}-r${i + 1}`,
    author: ["Kate M.", "Raj P.", "Olivia S.", "Michael T.", "Sophie W.", "James L.", "Priya K.", "Daniel H.", "Chloe B.", "Nathan R."][
      (hash(t.id) + i * 3) % 10
    ],
    stars: r.stars,
    text: r.text,
    weeksAgo: 2 + ((hash(t.id + i) % 40) | 0),
  }));

  return {
    id: t.id,
    name: t.name,
    business: t.business,
    trades: t.trades,
    skills: t.skills,
    experienceYears: t.experienceYears,
    maxSeverity: t.maxSeverity,
    availableNow: t.availableNow,
    earliestStartHours: t.earliestStartHours,
    responseMinutes: t.responseMinutes,
    homeSuburb: t.homeSuburb,
    location: home_ ? { lat: home_.lat, lng: home_.lng } : null,
    serviceAreas,
    serviceRadiusKm: radius,
    // Kept for blakes-branch, which seeds a fixed distance/bearing per mock tradie.
    distanceKm: home_ ? Math.round(distanceKm(home, home_) * 10) / 10 : null,
    bearing: home_ ? Math.round(bearingDeg(home, home_)) : null,
    licence: t.licence,
    insurance: t.insurance,
    reputation: t.reputation,
    reliability: t.reliability,
    bidPropensity: t.bidPropensity,
    pricePosition: t.pricePosition,
    vehicle: t.vehicle,
    // What blakes-branch columns expect, derived from the richer fields above.
    rating: t.reputation.google,
    reviewCount: t.reputation.googleReviews,
    jobsDone: t.reliability.jobsCompleted,
    reviews,
  };
});

// ------------------------------------------------------------------- jobs ---
const customers = jobsFile.customers;

// Tier bands must rise and must not overlap: the app hard-requires
// low.max < medium.min and medium.max < high.min (spec story 21). So only the
// book-ahead band is authored per archetype; the urgent bands are derived from
// its top end and rounded to the trade's quoting step.
const round = (n) => (n < 200 ? Math.ceil(n / 5) * 5 : Math.ceil(n / 10) * 10);
const roundTo5 = (n) => Math.round(n / 5) * 5;
// A percentage lift per step would compound into silly money on big jobs (a
// hot water swap quoted at 4k for being same-day). Real urgency pricing is a
// modest percentage plus a capped premium, so each step is +8% with a 25% band.
function tierPrices(arch, book) {
  const low = { min: arch.low[0], max: arch.low[1] };
  // Big scheduled work (a hot water unit, a switchboard) does not get 25% more
  // expensive for being same-day. Urgency there is a premium in dollars, not a
  // percentage.
  if (arch.fixed) {
    return {
      low,
      medium: { min: low.min + 100, max: low.max + 100 },
      high: { min: low.min + 240, max: low.max + 240 },
    };
  }
  // Otherwise move the whole band by the trade's own after-hours multiplier
  // (45% of it for within-24h, all of it for same-day). Shifting preserves the
  // width, which encodes how uncertain the job is; scaling the top end instead
  // turned a $480-900 fence into a $980-1230 "urgent" fence.
  const mid = (low.min + low.max) / 2;
  const premium = book.afterHoursMultiplier - 1;
  const shift = (k) => roundTo5(mid * premium * k);
  const m = shift(0.45);
  const h = shift(1);
  return {
    low,
    medium: { min: low.min + m, max: low.max + m },
    high: { min: low.min + h, max: low.max + h },
  };
}

const jobs = jobsFile.jobs.map((j) => {
  const pb = priceBook.trades[j.writeUp.trade];
  const arch = pb?.archetypes.find((a) => a.id === j.writeUp.archetype);
  if (!arch) problems.push(`${j.id}: archetype "${j.writeUp.archetype}" not in price book`);
  const prices = arch ? tierPrices(arch, pb) : null;
  const guard = GUARDS[j.writeUp.trade] ?? GUARDS.default;
  if (prices) {
    // Same rule as guardPrices() in packages/shared/src/trades.ts: each tier
    // starts at or above the one below and ends strictly above it. Bands may
    // overlap, which they should: real quotes do.
    if (
      prices.medium.min < prices.low.min ||
      prices.medium.max <= prices.low.max ||
      prices.high.min < prices.medium.min ||
      prices.high.max <= prices.medium.max
    )
      problems.push(`${j.id}: tiers do not rise (${arch.id})`);
    if (prices.high.max > guard.max)
      warnings.push(
        `${j.id}: ${j.writeUp.trade} high tier max $${prices.high.max} exceeds the app's guardrail max $${guard.max} — raise TRADE_PRICE_LIMITS.${j.writeUp.trade} or the app will clamp a real price`,
      );
  }
  const customer = customers.find((c) => c.id === j.customerId);
  const eligible = tradies.filter(
    (t) =>
      t.trades.includes(j.writeUp.trade) &&
      j.writeUp.severity <= t.maxSeverity &&
      (j.tier !== "high" || t.availableNow) &&
      customer &&
      t.serviceAreas.includes(customer.suburb),
  );
  if (eligible.length < 3) problems.push(`${j.id}: only ${eligible.length} eligible tradies in service area`);

  return {
    id: j.id,
    scenario: j.scenario,
    customerId: j.customerId,
    description: j.description,
    answers: j.answers,
    writeUp: { ...j.writeUp, prices },
    tier: j.tier,
    requiredDate: j.requiredDate,
    expectedPool: eligible.map((t) => t.id),
  };
});

// --------------------------------------------------------------- validate ---
for (const tr of TRADES) {
  const n = tradies.filter((t) => t.trades.includes(tr)).length;
  if (n < 3) problems.push(`trade "${tr}" has only ${n} tradies`);
}
const ids = new Set();
for (const t of tradies) {
  if (ids.has(t.id)) problems.push(`duplicate tradie id ${t.id}`);
  ids.add(t.id);
}
for (const t of tradies) {
  const seen = new Set();
  for (const r of t.reviews) {
    if (seen.has(r.text)) problems.push(`duplicate review text under ${t.id}`);
    seen.add(r.text);
  }
}
for (const [text, n] of usage) if (n > REVIEW_USES) problems.push(`review reused ${n}x: ${text.slice(0, 40)}`);

// ----------------------------------------------------------------- output ---
const dataset = {
  meta: {
    ...priceBook.meta,
    home,
    counts: {
      tradies: tradies.length,
      reviews: tradies.reduce((n, t) => n + t.reviews.length, 0),
      trades: TRADES.length,
      demoJobs: jobs.length,
      suburbs: suburbs.length,
    },
  },
  trades: TRADES.map((id) => ({
    id,
    // Labels mirror packages/shared/src/trades.ts.
    label: {
      plumbing: "Plumbing",
      electrical: "Electrical",
      carpentry_handyman: "Carpentry / handyman",
      roofing_gutters: "Roofing / gutters",
      painting: "Painting",
      tiling: "Tiling",
      locksmith: "Locksmith",
      appliance_repair: "Appliance repair",
      plastering: "Plastering",
      fencing_landscaping: "Fencing / landscaping",
    }[id],
    ...priceBook.trades[id],
  })),
  suburbs,
  customers,
  tradies,
  jobs,
};

mkdirSync(join(here, "seed"), { recursive: true });
writeFileSync(join(here, "legwork-demo.json"), JSON.stringify(dataset, null, 2) + "\n");

// ------------------------------------------------------------------- seed ---
const q = (v) => (v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const jq = (v) => `'${JSON.stringify(v).replace(/'/g, "''")}'`;

let d1 = `-- Generated by data/build-demo-data.mjs on ${new Date().toISOString()}
-- Idempotent: safe to re-run against a seeded local D1 (tradie-01..28 already exist
-- in migrations 0005 and 0007, so this replaces them rather than duplicating).
`;
for (const t of tradies) {
  d1 += `INSERT OR REPLACE INTO tradies (id, name, business, trades, max_severity, available_now, distance_km, bearing, rating, review_count, jobs_done) VALUES (${[
    q(t.id), q(t.name), q(t.business), jq(t.trades), t.maxSeverity, t.availableNow ? 1 : 0, t.distanceKm, t.bearing, t.rating, t.reviewCount, t.jobsDone,
  ].join(", ")});\n`;
  for (const r of t.reviews)
    d1 += `INSERT OR REPLACE INTO tradie_reviews (id, tradie_id, author, stars, text, created_at) VALUES (${[
      q(r.id), q(t.id), q(r.author), r.stars, q(r.text), q(new Date(Date.now() - r.weeksAgo * 7 * 864e5).toISOString()),
    ].join(", ")});\n`;
}
writeFileSync(join(here, "seed", "d1.sql"), d1);

let pg = `-- Generated by data/build-demo-data.mjs on ${new Date().toISOString()}
-- Targets Ivan's Supabase schema (supabase/migrations/20261121000001_init_schema.sql).
-- Tradie ids are stable text ids here; the Postgres schema uses uuid, so they are
-- inserted with a deterministic uuid namespace below.
`;
const uuid = (s) => {
  const h = (i) => ("00000000" + hash(s + i).toString(16)).slice(-8);
  return `${h(1)}-${h(2).slice(0, 4)}-4${h(3).slice(0, 3)}-a${h(4).slice(0, 3)}-${h(5)}${h(6).slice(0, 4)}`;
};
const tradieUuid = new Map(tradies.map((t) => [t.id, uuid(t.id)]));
for (const t of tradies)
  pg += `insert into tradies (id, name, trades, max_severity, available_now, lat, lng, avg_rating) values ('${tradieUuid.get(t.id)}', ${q(t.name)}, array[${t.trades.map(q).join(",")}], ${t.maxSeverity}, ${t.availableNow}, ${t.location.lat}, ${t.location.lng}, ${t.rating}) on conflict (id) do nothing;\n`;
for (const t of tradies)
  for (const r of t.reviews)
    pg += `insert into reviews (id, tradie_id, reviewer_name, stars, text, created_at) values ('${uuid(r.id)}', '${tradieUuid.get(t.id)}', ${q(r.author)}, ${r.stars}, ${q(r.text)}, '${new Date(Date.now() - r.weeksAgo * 7 * 864e5).toISOString()}') on conflict (id) do nothing;\n`;
writeFileSync(join(here, "seed", "supabase.sql"), pg);

// ------------------------------------------------------------------- report ---
console.log(
  `built data/legwork-demo.json — ${tradies.length} tradies, ${dataset.meta.counts.reviews} reviews, ${jobs.length} jobs, ${TRADES.length} trades, ${suburbs.length} suburbs`,
);
for (const t of TRADES)
  console.log(`  ${t.padEnd(22)} ${tradies.filter((x) => x.trades.includes(t)).length} tradies`);
for (const j of jobs) console.log(`  ${j.id} ${j.writeUp.trade.padEnd(20)} pool ${j.expectedPool.length}`);
if (warnings.length) {
  console.log("\nwarnings:");
  for (const w of warnings) console.log("  ! " + w);
}
if (problems.length) {
  console.error("\nPROBLEMS:");
  for (const p of problems) console.error("  x " + p);
  process.exit(1);
}
console.log("\nall invariants hold");
