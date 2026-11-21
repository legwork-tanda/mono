// Places a job from the customer's suburb answer ("New Farm 4005", "New Farm"
// or "4005") when the browser didn't share a position. Uses the demo's
// Brisbane suburb list, so it needs no network call. Unknown places return null.

import suburbsFile from "../../../data/source/suburbs.json";
import type { LatLng } from "@legwork/shared";

type Suburb = { name: string; postcode: string; lat: number; lng: number };

export const SUBURBS: readonly Suburb[] = (suburbsFile as { suburbs: Suburb[] }).suburbs;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

export function geocodeSuburb(answer: string | null | undefined): LatLng | null {
  if (!answer) return null;
  const text = norm(answer);
  if (!text) return null;
  const at = (s: Suburb): LatLng => ({ lat: s.lat, lng: s.lng });

  // The longest suburb name found in the answer, so "New Farm" beats "Farm".
  const byName = SUBURBS.filter((s) => ` ${text} `.includes(` ${norm(s.name)} `)).sort((a, b) => b.name.length - a.name.length)[0];
  if (byName) return at(byName);

  const postcode = text.match(/\b(\d{4})\b/)?.[1];
  const byPostcode = postcode ? SUBURBS.find((s) => s.postcode === postcode) : undefined;
  return byPostcode ? at(byPostcode) : null;
}

/** Valid coordinates, or null. */
export function readLatLng(lat: unknown, lng: unknown): LatLng | null {
  if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}
