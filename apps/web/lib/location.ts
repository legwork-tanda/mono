// Turns the browser's position into a suburb label like "Newtown 2042", so the
// "where" question takes one tap instead of typing.

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

/**
 * The customer's position for placing the job, if the browser gives it within
 * `ms` (only asks when they've already allowed it, so confirming never stalls
 * on a prompt). Null otherwise; the API falls back to the suburb answer.
 */
export async function quickPosition(ms = 3000): Promise<{ lat: number; lng: number } | null> {
  if (typeof navigator === "undefined" || !("geolocation" in navigator)) return null;
  try {
    const status = await navigator.permissions?.query({ name: "geolocation" as PermissionName });
    if (status && status.state !== "granted") return null;
  } catch {
    // No permissions API (older Safari): try anyway, with the timeout.
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        clearTimeout(timer);
        resolve({ lat: p.coords.latitude, lng: p.coords.longitude });
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
      { enableHighAccuracy: false, timeout: ms, maximumAge: 5 * 60 * 1000 },
    );
  });
}
