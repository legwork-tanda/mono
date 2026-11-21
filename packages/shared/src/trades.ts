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

/** Per-trade overrides. Trades not listed use DEFAULT_PRICE_LIMITS. */
export const TRADE_PRICE_LIMITS: Partial<Record<TradeId, PriceLimits>> = {
  plumbing: { min: 100, max: 1500 },
  electrical: { min: 100, max: 1500 },
  roofing_gutters: { min: 150, max: 3000 },
  locksmith: { min: 90, max: 600 },
};

export function priceLimitsFor(trade: TradeId): PriceLimits {
  return TRADE_PRICE_LIMITS[trade] ?? DEFAULT_PRICE_LIMITS;
}

/** Urgency tiers. Low: within the week, Medium: within 24 hours, High: ASAP. */
export const TIERS = ["low", "medium", "high"] as const;
export type Tier = (typeof TIERS)[number];

export const TIER_INFO: Record<Tier, { label: string; when: string }> = {
  low: { label: "This week", when: "Within the week" },
  medium: { label: "Tomorrow", when: "Within 24 hours" },
  high: { label: "ASAP", when: "As soon as possible" },
};

/** A price range in whole dollars, e.g. { min: 80, max: 100 }. */
export interface PriceRange {
  min: number;
  max: number;
}

export type TierPrices = Record<Tier, PriceRange>;

/**
 * Makes model prices believable: each range is clamped to the trade's limits,
 * low never exceeds high, and the tiers rise from Low to Medium to High.
 */
export function guardPrices(trade: TradeId, prices: TierPrices): TierPrices {
  const { min, max } = priceLimitsFor(trade);
  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n / 5) * 5));
  const fix = (r: PriceRange): PriceRange => {
    const a = clamp(Math.min(r.min, r.max));
    const b = clamp(Math.max(r.min, r.max));
    return { min: a, max: b };
  };

  const low = fix(prices.low);
  const medium = fix(prices.medium);
  const high = fix(prices.high);
  // Each tier starts at or above the one below and ends strictly above it, within limits.
  medium.min = Math.max(medium.min, low.min);
  medium.max = Math.min(max, Math.max(medium.max, low.max + 10, medium.min));
  high.min = Math.max(high.min, medium.min);
  high.max = Math.min(max, Math.max(high.max, medium.max + 10, high.min));
  return { low, medium, high };
}

/** Severity 4 to 5 (or anything unsafe) pre-selects ASAP. */
export function suggestedTier(severity: number, safety: boolean): Tier {
  return safety || severity >= 4 ? "high" : severity >= 3 ? "medium" : "low";
}

/** The date a tier implies, as YYYY-MM-DD: High today, Medium tomorrow, Low later this week. */
export function defaultDate(tier: Tier, today: Date): string {
  const d = new Date(today);
  d.setDate(d.getDate() + (tier === "high" ? 0 : tier === "medium" ? 1 : 3));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
