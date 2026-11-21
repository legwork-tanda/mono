// Live tradies: real people playing tradies through the tradie view. Anyone
// can become one in seconds. They're given a generated profile (name,
// business, 1–3 trades) they can shuffle, pick their skills and radius, and
// get a believable record (rating, reliability, reviews) so they compete with
// the simulated tradies by the same rules. See tradie-spec.md.

import { TRADES, TRADIE_TRADES_MAX, tradeInfo, type TradeId, type TradieProfile, type TradieReview } from "@legwork/shared";
import { hashToken } from "./auth";
import { SUBURBS } from "./geocode";
import { liveLicence } from "./licences";
import { seeded } from "./match";

type Rand = () => number;

const FIRST_NAMES = [
  "Jake", "Liam", "Noah", "Ethan", "Mia", "Chloe", "Jack", "Ruby", "Oscar", "Isla", "Lachlan", "Harper", "Cooper", "Zara", "Riley",
  "Tahlia", "Mason", "Ava", "Hamish", "Sienna", "Darcy", "Priya", "Tom", "Mei", "Callum", "Grace", "Kai", "Sophie", "Archie", "Ella",
  "Ben", "Leilani", "Max", "Aisha", "Josh", "Ivy", "Raj", "Matilda", "Finn", "Nadia",
];
const SURNAMES = [
  "Morrison", "Nguyen", "O'Brien", "Kelly", "Walsh", "Patel", "Murphy", "Campbell", "Fraser", "Reid", "McKenzie", "Doyle", "Hughes",
  "Barrett", "Singh", "Chen", "Russo", "Kowalski", "Bennett", "Fitzgerald", "Harding", "Lawson", "Duncan", "Byrne", "Carter",
  "Henderson", "Quinn", "Sullivan", "Tran", "Wallace", "Gallagher", "Pearce", "Moretti", "Ellis", "Brennan", "Hayes", "Novak",
  "Ryan", "Stewart", "Ward",
];
const PLACES = ["Northside", "Southside", "Bayside", "Riverside", "Brightside", "Coastal", "Valley", "Hillside"];

/** What each trade's business is called, from a surname, a suburb or a place. */
const BUSINESS: Record<TradeId, string[]> = {
  plumbing: ["{surname} Plumbing & Gas", "{suburb} Plumbing", "{place} Plumbers", "{surname} Plumbing Co."],
  electrical: ["{surname} Electrical", "{suburb} Sparks", "{place} Electrical", "{surname} Power & Lighting"],
  carpentry_handyman: ["{surname} & Sons Carpentry", "{suburb} Handyman", "{place} Carpentry", "Handy {first}"],
  roofing_gutters: ["{surname} Roofing", "{place} Roof & Gutter", "{suburb} Gutters"],
  painting: ["{surname} Painting", "{place} Painting", "{suburb} Painters"],
  tiling: ["{surname} Tiling", "{place} Tiles", "{suburb} Tiling Co."],
  locksmith: ["{surname} Locksmiths", "{suburb} Lock & Key", "{place} Locks"],
  appliance_repair: ["{surname} Appliance Repairs", "{place} Appliance Care", "{suburb} Appliance Fix"],
  plastering: ["{surname} Plastering", "{place} Plaster & Patch", "{suburb} Plasterers"],
  fencing_landscaping: ["{surname} Fencing & Landscapes", "{place} Landscaping", "{suburb} Fence & Garden"],
};
const MULTI_TRADE = ["{surname} Trade Services", "{place} Home Services", "{surname} Maintenance", "{suburb} Property Care"];

const pick = <T>(rand: Rand, list: readonly T[]) => list[Math.min(list.length - 1, Math.floor(rand() * list.length))]!;
const between = (rand: Rand, lo: number, hi: number) => lo + rand() * (hi - lo);
const intBetween = (rand: Rand, lo: number, hi: number) => Math.floor(between(rand, lo, hi + 1 - 1e-9));

export type Draft = { username: string; business: string; trades: TradeId[] };

/**
 * A generated profile: a person's name, 1–3 trades and a business to match.
 * `taken` holds lowercased names already in use; the draft never repeats one.
 */
export function draftProfile(rand: Rand, taken: ReadonlySet<string>, trades?: TradeId[], keepName?: string): Draft {
  // Keeping a name they were already given (they're picking trades): the
  // business follows from the name and trades alone, so it doesn't jump about.
  const kept = keepName?.trim();
  if (kept && /^[A-Za-z'-]+ [A-Za-z'-]+\d*$/.test(kept) && !taken.has(kept.toLowerCase())) {
    return draftFresh(seededRand(`${kept}|${(trades ?? []).join(",")}`), taken, trades, kept);
  }
  const fresh = draftFresh(rand, taken, trades);
  // With their trades already picked, the business comes from the name and trades, as above.
  return trades ? draftFresh(seededRand(`${fresh.username}|${trades.join(",")}`), taken, trades, fresh.username) : fresh;
}

/** A repeatable random sequence for a key (mulberry32 seeded by FNV-1a). */
function seededRand(key: string): Rand {
  let a = Math.floor(seeded(key) * 2 ** 32);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function draftFresh(rand: Rand, taken: ReadonlySet<string>, trades?: TradeId[], fixedName?: string): Draft {
  let username = "";
  let first = "";
  let surname = "";
  if (fixedName) {
    [first, surname] = fixedName.split(" ") as [string, string];
    username = fixedName;
  }
  for (let i = 0; i < 20 && !fixedName; i++) {
    first = pick(rand, FIRST_NAMES);
    surname = pick(rand, SURNAMES);
    username = `${first} ${surname}`;
    if (!taken.has(username.toLowerCase())) break;
  }
  // Still clashing (a busy room, or an unlucky draw): add a number.
  for (let n = 2; taken.has(username.toLowerCase()); n++) username = `${first} ${surname}${n}`;

  let chosen = trades;
  if (!chosen) {
    const count = 1 + Math.floor(rand() * TRADIE_TRADES_MAX);
    const pool: TradeId[] = TRADES.map((t) => t.id);
    chosen = [];
    while (chosen.length < count) {
      const t = pick(rand, pool);
      if (!chosen.includes(t)) chosen.push(t);
      else pool.splice(pool.indexOf(t), 1);
      if (pool.length === 0) break;
    }
  }
  const pattern = chosen.length === 1 ? pick(rand, BUSINESS[chosen[0]!]) : pick(rand, MULTI_TRADE);
  const business = pattern
    .replace("{surname}", surname.replace(/\d+$/, ""))
    .replace("{first}", first)
    .replace("{suburb}", pick(rand, SUBURBS).name)
    .replace("{place}", pick(rand, PLACES));
  return { username, business, trades: chosen };
}

/** The columns a new live tradie gets, besides who they are and what they do. */
export type GeneratedProfile = {
  rating: number;
  google_rating: number;
  google_reviews: number;
  legwork_rating: number;
  legwork_reviews: number;
  jobs_completed: number;
  jobs_done: number;
  cancellations: number;
  no_shows: number;
  disputes: number;
  on_time_pct: number;
  quote_accuracy_pct: number;
  experience_years: number;
  distance_km: number;
  bearing: number;
  service_radius_km: number;
  max_severity: number;
  available_now: number;
  earliest_start_hours: number;
  response_minutes: number;
  bid_propensity: number;
  price_position: string;
  demo: number;
};

/**
 * A believable record for a new live tradie: a rating between 4.3 and 4.9, a
 * delivery record whose reliability score lands near that rating's band, and
 * a distance from the job inside their radius and close enough (≤ 8 km) to be
 * reached in the early waves. Matching uses this, not their real GPS.
 */
export function generateProfile(radiusKm: number, rand: Rand): GeneratedProfile {
  const rating = Math.round(between(rand, 4.3, 4.9) * 10) / 10;
  // Reliability target on the same scale (4.3/5 = 0.86 … 4.9/5 = 0.98).
  const target = rating / 5;
  const jobsCompleted = intBetween(rand, 20, 120);
  const cancellations = intBetween(rand, 0, 2);
  const noShows = rand() < 0.2 ? 1 : 0;
  const bad = cancellations + 2 * noShows;
  const record = (jobsCompleted + 5 * 0.9) / (jobsCompleted + bad + 5);
  // reliability = 0.5 * record + 0.5 * pct (on-time and quote accuracy alike).
  const pct = Math.round(Math.min(0.99, Math.max(0.85, (target - 0.5 * record) / 0.5)) * 100);
  const googleReviews = intBetween(rand, 15, 60);
  const legworkReviews = intBetween(rand, 3, 10);
  const maxKm = Math.min(radiusKm, 8);
  return {
    rating,
    google_rating: rating,
    google_reviews: googleReviews,
    legwork_rating: rating,
    legwork_reviews: legworkReviews,
    jobs_completed: jobsCompleted,
    jobs_done: jobsCompleted,
    cancellations,
    no_shows: noShows,
    disputes: 0,
    on_time_pct: pct,
    quote_accuracy_pct: Math.min(99, pct + intBetween(rand, -1, 1)),
    experience_years: intBetween(rand, 3, 20),
    distance_km: Math.round(between(rand, 1, maxKm) * 10) / 10,
    bearing: Math.round(between(rand, 0, 360)),
    service_radius_km: radiusKm,
    max_severity: 5,
    available_now: 1,
    earliest_start_hours: 0,
    response_minutes: 5,
    bid_propensity: 0.9,
    price_position: "mid",
    demo: 0,
  };
}

/** Names in use by signed-in live tradies, lowercased. */
export async function takenNames(db: D1Database): Promise<Set<string>> {
  const rows = (await db.prepare("SELECT lower(username) AS name FROM tradies WHERE username IS NOT NULL").all<{ name: string }>()).results;
  return new Set(rows.map((r) => r.name));
}

/** The skills seeded tradies in these trades list, for the sign-up picker. */
export async function skillOptions(db: D1Database, trades: readonly TradeId[]): Promise<string[]> {
  const rows = (await db.prepare("SELECT trades, skills FROM tradies WHERE demo = 1").all<{ trades: string; skills: string }>()).results;
  const skills = new Set<string>();
  for (const row of rows) {
    const theirs = JSON.parse(row.trades) as TradeId[];
    if (theirs.some((t) => trades.includes(t))) for (const s of JSON.parse(row.skills) as string[]) skills.add(s);
  }
  return [...skills].sort();
}

export type LiveTradieRow = {
  id: string;
  name: string;
  username: string | null;
  business: string;
  trades: string;
  skills: string;
  service_radius_km: number;
  rating: number;
  review_count: number;
  jobs_done: number;
  distance_km: number;
  demo: number;
};

/** The tradie's profile with their reviews, newest first. */
export async function loadProfile(db: D1Database, row: LiveTradieRow): Promise<TradieProfile> {
  const reviews = (
    await db
      .prepare("SELECT author, stars, text FROM tradie_reviews WHERE tradie_id = ? ORDER BY created_at DESC LIMIT 20")
      .bind(row.id)
      .all<{ author: string; stars: number; text: string }>()
  ).results;
  return { ...toProfile(row), reviews: reviews.map((r): TradieReview => ({ author: r.author, stars: r.stars, text: r.text, photos: [] })) };
}

const toProfile = (row: LiveTradieRow): Omit<TradieProfile, "reviews"> => ({
  id: row.id,
  username: row.username ?? row.name,
  business: row.business,
  trades: JSON.parse(row.trades) as TradeId[],
  skills: JSON.parse(row.skills) as string[],
  radiusKm: row.service_radius_km,
  rating: row.rating,
  reviewCount: row.review_count,
  jobsDone: row.jobs_done,
});

/** The signed-in live tradie this token belongs to, or null. */
export async function tradieFromToken(db: D1Database, token: string | null): Promise<LiveTradieRow | null> {
  if (!token) return null;
  return db
    .prepare("SELECT * FROM tradies WHERE token_hash = ? AND demo = 0 AND username IS NOT NULL")
    .bind(await hashToken(token))
    .first<LiveTradieRow>();
}

/**
 * Stores a new live tradie and copies three good reviews from seeded tradies
 * in the same trades, so their card looks lived-in. Fails (unique index) if
 * the name was claimed meanwhile.
 */
export async function createLiveTradie(
  db: D1Database,
  input: { username: string; business: string; trades: TradeId[]; skills: string[]; radiusKm: number; tokenHash: string },
  rand: Rand,
  now: number,
): Promise<string> {
  const id = `live-${crypto.randomUUID()}`;
  const p = generateProfile(input.radiusKm, rand);
  const marks = input.trades.map(() => "EXISTS (SELECT 1 FROM json_each(t.trades) WHERE value = ?)").join(" OR ");
  const reviews = (
    await db
      .prepare(`SELECT r.author, r.stars, r.text FROM tradie_reviews r JOIN tradies t ON t.id = r.tradie_id WHERE t.demo = 1 AND r.stars >= 4 AND (${marks})`)
      .bind(...input.trades)
      .all<{ author: string; stars: number; text: string }>()
  ).results;
  // Three at random, without repeats.
  const chosen: typeof reviews = [];
  const pool = [...reviews];
  while (chosen.length < 3 && pool.length > 0) chosen.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]!);

  const row: Record<string, string | number> = {
    id,
    name: input.username,
    username: input.username,
    token_hash: input.tokenHash,
    business: input.business,
    trades: JSON.stringify(input.trades),
    skills: JSON.stringify(input.skills),
    licence_type: liveLicence(input.trades),
    ...p,
    review_count: p.google_reviews + chosen.length,
  };
  const cols = Object.keys(row);
  await db.batch([
    db.prepare(`INSERT INTO tradies (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).bind(...Object.values(row)),
    ...chosen.map((r, i) =>
      db
        .prepare("INSERT INTO tradie_reviews (id, tradie_id, job_id, author, stars, text, created_at) VALUES (?, ?, NULL, ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), id, r.author, r.stars, r.text, new Date(now - (i + 1) * 9 * 864e5).toISOString()),
    ),
  ]);
  return id;
}

/** A readable label for what they do: "Plumbing · Electrical". */
export const tradesLabel = (trades: readonly TradeId[]) => trades.map((t) => tradeInfo(t).label).join(" · ");
