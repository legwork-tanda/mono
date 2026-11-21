// Which trades each licence type allows. Tradies register with a free-text
// licence type; their scope comes from here, not from what they claim. Licences
// are seeded for now (registration is out of scope), and nothing checks they're
// genuine or unexpired.

import { isTradeId, type TradeId } from "@legwork/shared";

export const LICENCE_GRANTS: Record<string, readonly TradeId[]> = {
  "QBCC Plumbing, Drainage & Gas": ["plumbing"],
  "QBCC Plumbing & Drainage": ["plumbing"],
  "QLD Electrical Licence (Full)": ["electrical"],
  "QLD Electrical Licence (Full) + Contractor": ["electrical"],
  "QBCC Low Rise (site supervision not required)": ["carpentry_handyman"],
  "QBCC Low Rise": ["carpentry_handyman", "painting", "fencing_landscaping"],
  "QBCC Carpentry (Open)": ["carpentry_handyman", "fencing_landscaping"],
  "QBCC Roofing (Open)": ["roofing_gutters"],
  "QBCC Painting (Open)": ["painting"],
  "QBCC Tiling (Open)": ["tiling"],
  "QBCC Plastering (Open)": ["plastering"],
  "QBCC Landscaping (Open)": ["fencing_landscaping"],
  "QLD Security Provider (Locksmith) + Police Check": ["locksmith"],
  "Electrical appliance service (restricted)": ["appliance_repair"],
};

/**
 * Live tradies (people playing tradies in the demo) get a licence that grants
 * exactly the trades they do: "Legwork live: plumbing,electrical". Nothing
 * checks it, as with the seeded ones.
 */
export const LIVE_LICENCE_PREFIX = "Legwork live: ";

export const liveLicence = (trades: readonly TradeId[]) => `${LIVE_LICENCE_PREFIX}${trades.join(",")}`;

function liveTrades(licenceType: string): TradeId[] {
  return licenceType
    .slice(LIVE_LICENCE_PREFIX.length)
    .split(",")
    .map((t) => t.trim())
    .filter(isTradeId);
}

/** True when the licence type grants the trade. An unknown or missing licence grants nothing. */
export function licenceGrants(licenceType: string | null, trade: TradeId) {
  if (!licenceType) return false;
  if (licenceType.startsWith(LIVE_LICENCE_PREFIX)) return liveTrades(licenceType).includes(trade);
  return LICENCE_GRANTS[licenceType]?.includes(trade) ?? false;
}
