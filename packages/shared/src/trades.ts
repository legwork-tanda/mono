// Supported trades and price guardrails. Adapted from the job service on
// Ivan's branch (src/lib/job-service/trades.ts), without the Supabase parts.

/**
 * The fixed list of supported trades. Adding a trade is a change here only.
 * Claude must pick a trade from this list.
 */
export const TRADES = [
  { id: "plumbing", label: "Plumbing", worker: "plumber" },
  { id: "electrical", label: "Electrical", worker: "electrician" },
  { id: "carpentry_handyman", label: "Carpentry / handyman", worker: "handyman" },
  { id: "roofing_gutters", label: "Roofing / gutters", worker: "roofer" },
  { id: "painting", label: "Painting", worker: "painter" },
  { id: "tiling", label: "Tiling", worker: "tiler" },
  { id: "locksmith", label: "Locksmith", worker: "locksmith" },
  { id: "appliance_repair", label: "Appliance repair", worker: "appliance technician" },
  { id: "plastering", label: "Plastering", worker: "plasterer" },
  { id: "fencing_landscaping", label: "Fencing / landscaping", worker: "landscaper" },
] as const;

export type TradeId = (typeof TRADES)[number]["id"];

export const TRADE_IDS = TRADES.map((t) => t.id) as unknown as readonly [TradeId, ...TradeId[]];

/** Trade used when a problem fits nothing on the list but a handyman could do it. */
export const FALLBACK_TRADE: TradeId = "carpentry_handyman";

export function isTradeId(value: string): value is TradeId {
  return TRADES.some((t) => t.id === value);
}

export function tradeInfo(trade: TradeId) {
  return TRADES.find((t) => t.id === trade) ?? TRADES.find((t) => t.id === FALLBACK_TRADE)!;
}

export interface PriceLimits {
  /** Lowest believable price for any tier, in dollars. */
  min: number;
  /** Highest believable price for any tier, in dollars. */
  max: number;
}

/** Used for any trade without its own limits. */
export const DEFAULT_PRICE_LIMITS: PriceLimits = { min: 80, max: 2000 };

/**
 * Per-trade overrides. Trades not listed use DEFAULT_PRICE_LIMITS.
 *
 * The max sits above the dearest same-day job in data/source/price-book.json
 * (and the Brisbane market it was built from), with headroom for the urgency
 * premium. A guard that clamps a real quote to a number the Pro cannot honour
 * is worse than no guard, so when a real job exceeds a cap, raise the cap.
 */
export const TRADE_PRICE_LIMITS: Partial<Record<TradeId, PriceLimits>> = {
  // Hot water replacement: $1,150–2,450 in the price book, $1,250–2,500 in market.
  plumbing: { min: 100, max: 3500 },
  // Switchboard upgrade: $1,350–2,900 in the price book, up to $3,850 in market.
  electrical: { min: 100, max: 4000 },
  // Storm damage tops out at $1,800 in the price book.
  roofing_gutters: { min: 150, max: 3000 },
  // Exterior wall: up to $2,200 in the price book.
  painting: { min: 80, max: 3000 },
  // Bathroom floor: up to $2,700 in the price book.
  tiling: { min: 80, max: 3500 },
  // Lockouts and deadlocks: up to $480 in the price book.
  locksmith: { min: 90, max: 600 },
  // Retaining wall: up to $2,600 in the price book.
  fencing_landscaping: { min: 80, max: 3500 },
};

export function priceLimitsFor(trade: TradeId): PriceLimits {
  return TRADE_PRICE_LIMITS[trade] ?? DEFAULT_PRICE_LIMITS;
}

/** Urgency tiers. Low: within the week, Medium: within 24 hours, High: ASAP. */
export const TIERS = ["low", "medium", "high"] as const;
export type Tier = (typeof TIERS)[number];

export const TIER_INFO: Record<Tier, { label: string; when: string; reason: string }> = {
  low: { label: "This week", when: "Within the week", reason: "Booked at standard rates when it suits the tradie." },
  medium: { label: "Tomorrow", when: "Within 24 hours", reason: "Next-day booking, so the tradie moves other work around." },
  high: { label: "ASAP", when: "As soon as possible", reason: "Same-day callout, often at after-hours rates." },
};

/** A price range in whole dollars, e.g. { min: 80, max: 100 }. */
export interface PriceRange {
  min: number;
  max: number;
}

export type TierPrices = Record<Tier, PriceRange>;

/** The smallest visible urgency premium between tiers: 5% of the tier below, at least $10. */
function tierStep(below: PriceRange): number {
  return Math.max(10, Math.round((below.max * 0.05) / 5) * 5);
}

/**
 * Makes model prices believable: each range is clamped to the trade's limits,
 * low never exceeds high, and the tiers rise strictly from Low to Medium to
 * High (both ends move up by at least a visible premium). A range only
 * collapses to a single price when the model gave a fixed price (min == max).
 */
export function guardPrices(trade: TradeId, prices: TierPrices): TierPrices {
  const { min, max } = priceLimitsFor(trade);
  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n / 5) * 5));
  // A range the model gave as a band stays a band, at least $5 wide.
  const width = (r: PriceRange) => (Math.round(r.min) === Math.round(r.max) ? 0 : 5);
  const fix = (r: PriceRange): PriceRange => {
    let a = clamp(Math.min(r.min, r.max));
    let b = clamp(Math.max(r.min, r.max));
    if (b - a < width(r)) {
      if (a + width(r) <= max) b = a + width(r);
      else a = b - width(r);
    }
    return { min: a, max: b };
  };

  const wLow = width(prices.low);
  const wMedium = width(prices.medium);
  const wHigh = width(prices.high);
  const low = fix(prices.low);
  const medium = fix(prices.medium);
  const high = fix(prices.high);

  // Push each tier up so both ends sit a visible premium above the tier below.
  const raise = (below: PriceRange, r: PriceRange, w: number) => {
    const step = tierStep(below);
    r.min = Math.max(r.min, below.min + step);
    r.max = Math.max(r.max, below.max + step, r.min + w);
  };
  raise(low, medium, wMedium);
  raise(medium, high, wHigh);

  // If that ran past the cap, pull the tiers back down from the top so they
  // still rise. With realistic caps this only happens to absurd model prices.
  high.max = Math.min(high.max, max);
  high.min = Math.min(high.min, high.max - wHigh);
  const lower = (r: PriceRange, above: PriceRange, w: number) => {
    const step = tierStep(r);
    r.max = Math.min(r.max, above.max - step);
    r.min = Math.min(r.min, above.min - step, r.max - w);
  };
  lower(medium, high, wMedium);
  lower(low, medium, wLow);
  return { low, medium, high };
}

/** How much each step of severity moves the price from the assistant's estimate. */
const SEVERITY_STEP = 0.15;

/**
 * Prices for a corrected trade (or, from older clients, severity), worked out
 * from the assistant's own estimate (`base`) and put back through the
 * guardrails for the new trade. Severity is internal: it never forces a tier.
 */
export function repriceTiers(
  base: { severity: number; prices: TierPrices },
  trade: TradeId,
  severity: number,
): TierPrices {
  const factor = Math.max(0.4, 1 + SEVERITY_STEP * (severity - base.severity));
  const scale = (r: PriceRange): PriceRange => ({ min: r.min * factor, max: r.max * factor });
  return guardPrices(trade, { low: scale(base.prices.low), medium: scale(base.prices.medium), high: scale(base.prices.high) });
}

// Phrases that mean immediate danger. Kept deliberately narrow so the banner
// means something; the write-up model can still flag cases these miss.
const DANGER = [
  /\b(smell|smells|smelling|smelt|whiff|stink)\w*\b[^.!?\n]{0,25}\bgas\b/i,
  /\bgas\b[^.!?\n]{0,25}\b(smell|leak|leaking|hiss|hissing)\w*/i,
  /\bspark(s|ing|ed)?\b/i,
  /\b(burning|burnt|melted|melting|scorch\w*|smok\w*)\b[^.!?\n]{0,30}\b(wire|wires|wiring|socket|outlet|switch|power ?point|plug|switchboard|fuse ?box)\b/i,
  /\b(wire|wires|wiring|socket|outlet|switch|power ?point|plug|switchboard|fuse ?box)\b[^.!?\n]{0,30}\b(burning|burnt|melted|melting|scorch\w*|smok\w*)\b/i,
  /\b(water|leak\w*|wet|flood\w*|drip\w*)\b[^.!?\n]{0,40}\b(electric\w*|power ?point|socket|outlet|switchboard|fuse ?box|light fitting|wiring|wires)\b/i,
  /\b(electric\w*|power ?point|socket|outlet|switchboard|fuse ?box|light fitting|wiring|wires)\b[^.!?\n]{0,40}\b(water|wet|flood\w*|drip\w*)\b/i,
  /\b(electric )?shocks?\b|\bgot a shock\b/i,
];
const NEGATED = /(\bno|\bnot|\bnever|\bwithout|n't)\s+(\w+\s+){0,2}$/i;

/**
 * True when what the customer wrote describes immediate danger: a smell of
 * gas, sparking or burning wiring, water near electrics. "I can smell gas" is
 * a reliable demo phrase. A phrase straight after "no" or "not" doesn't count.
 */
export function detectSafety(text: string): boolean {
  return DANGER.some((pattern) => {
    const re = new RegExp(pattern.source, "gi");
    for (const m of text.matchAll(re)) {
      if (!NEGATED.test(text.slice(Math.max(0, m.index - 25), m.index))) return true;
    }
    return false;
  });
}

/** The date a tier implies, as YYYY-MM-DD: High today, Medium tomorrow, Low later this week. */
export function defaultDate(tier: Tier, today: Date): string {
  const d = new Date(today);
  d.setDate(d.getDate() + (tier === "high" ? 0 : tier === "medium" ? 1 : 3));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Whole dollars as AUD, e.g. 1500 → "$1,500". */
export function formatMoney(n: number): string {
  return `$${n.toLocaleString("en-AU")}`;
}

/** A price range as "$300–$450", or a single price ("$1,500") when min equals max. */
export function formatPriceRange(r: PriceRange): string {
  return r.min === r.max ? formatMoney(r.min) : `${formatMoney(r.min)}–${formatMoney(r.max)}`;
}
