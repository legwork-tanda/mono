/**
 * The fixed list of supported trades. Adding a trade is a change here only.
 * Claude must pick a trade from this list (see spec.md "Supported trades").
 */
export const TRADES = [
  { id: "plumbing", label: "Plumbing" },
  { id: "electrical", label: "Electrical" },
  { id: "carpentry_handyman", label: "Carpentry / handyman" },
  { id: "roofing_gutters", label: "Roofing / gutters" },
  { id: "painting", label: "Painting" },
  { id: "tiling", label: "Tiling" },
  { id: "locksmith", label: "Locksmith" },
  { id: "appliance_repair", label: "Appliance repair" },
  { id: "plastering", label: "Plastering" },
  { id: "fencing_landscaping", label: "Fencing / landscaping" },
] as const;

export type TradeId = (typeof TRADES)[number]["id"];

/** Trade used when a problem fits nothing on the list but a handyman could do it. */
export const FALLBACK_TRADE: TradeId = "carpentry_handyman";

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

export function isTradeId(value: string): value is TradeId {
  return TRADES.some((t) => t.id === value);
}

export function priceLimitsFor(trade: TradeId): PriceLimits {
  return TRADE_PRICE_LIMITS[trade] ?? DEFAULT_PRICE_LIMITS;
}
