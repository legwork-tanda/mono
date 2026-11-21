// Turns the browser's position into a suburb label like "Newtown 2042", so the
// "where" question answers itself, or takes one tap, instead of typing.

type PhotonProps = {
  district?: string;
  locality?: string;
  city?: string;
  name?: string;
  postcode?: string;
  countrycode?: string;
};

export class LocationError extends Error {}

function position(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) return reject(new LocationError("Your browser can't share your location."));
    navigator.geolocation.getCurrentPosition(resolve, (e) =>
      reject(
        new LocationError(
          e.code === e.PERMISSION_DENIED ? "Location is turned off for this site." : "We couldn't find where you are.",
        ),
      ),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 5 * 60 * 1000 },
    );
  });
}

/** The suburb (and postcode) the customer is standing in. */
export async function currentSuburb(): Promise<string> {
  const { coords } = await position();
  const res = await fetch(
    `https://photon.komoot.io/reverse?lon=${coords.longitude}&lat=${coords.latitude}&lang=en&limit=1`,
  ).catch(() => null);
  const json = res?.ok ? ((await res.json()) as { features?: { properties: PhotonProps }[] }) : null;
  const p = json?.features?.[0]?.properties;
  const suburb = p?.district ?? p?.locality ?? p?.city ?? p?.name;
  if (!p || !suburb) throw new LocationError("We couldn't work out your suburb.");
  if (p.countrycode && p.countrycode !== "AU") throw new LocationError("Looks like you're outside Australia.");
  return p.postcode ? `${suburb} ${p.postcode}` : suburb;
}

/** What the browser has already decided about sharing location with this site. */
export type GeoPermission = "granted" | "prompt" | "denied" | "unknown";

/**
 * Reads the geolocation permission without asking for it, so loading the step
 * never fires a prompt. "unknown" when the browser can't say.
 */
export async function geoPermission(): Promise<GeoPermission> {
  try {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) return "denied";
    if (!navigator.permissions?.query) return "unknown";
    const { state } = await navigator.permissions.query({ name: "geolocation" });
    return state === "granted" || state === "prompt" || state === "denied" ? state : "unknown";
  } catch {
    return "unknown";
  }
}

/** A way to answer "where": the last suburb, the current location, or typing it. */
export type WhereRoute = "last" | "locate" | "type";

export type WherePlan = {
  /** Look the suburb up and post it with no tap. */
  auto: boolean;
  /** The one primary button, or null when the typing box is the answer. */
  primary: "last" | "locate" | null;
  /** The other routes, shown as text links. */
  links: WhereRoute[];
  /** Open the typing box straight away. */
  typing: boolean;
};

/**
 * How the "where" step answers itself (#95, ADR 0002: least input to the goal).
 * With location already granted and no earlier answer being changed, it posts
 * the current suburb with no tap. Otherwise it offers exactly one primary
 * choice: the last suburb if there is one, else the current location. When
 * location is denied, blocked or the lookup failed, it falls back to the last
 * suburb, then typing.
 */
export function planWhere({
  permission,
  last,
  changing,
  failed,
}: {
  permission: GeoPermission;
  /** The earlier answer being changed, or the suburb from their last job. */
  last: string | null;
  /** The customer came back to change an earlier answer. */
  changing: boolean;
  /** Finding the suburb already failed on this step (denied, blocked, outside Australia, lookup). */
  failed: boolean;
}): WherePlan {
  const canLocate = permission !== "denied" && !failed;
  if (canLocate && permission === "granted" && !changing) {
    return { auto: true, primary: "locate", links: last ? ["last", "type"] : ["type"], typing: false };
  }
  const primary = last ? "last" : canLocate ? "locate" : null;
  const links: WhereRoute[] = [];
  if (canLocate && primary !== "locate") links.push("locate");
  if (primary !== null) links.push("type");
  return { auto: false, primary, links, typing: primary === null };
}

// The last suburb, so returning customers answer that question with one tap.
const SUBURB_KEY = "legwork.suburb";

export function lastSuburb(): string | null {
  try {
    return localStorage.getItem(SUBURB_KEY)?.trim() || null;
  } catch {
    return null;
  }
}

export function rememberSuburb(suburb: string) {
  try {
    localStorage.setItem(SUBURB_KEY, suburb);
  } catch {
    // Not remembered; nothing else changes.
  }
}
