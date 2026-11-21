// Opens the phone's maps app at the job, for the tradie's Navigate button.
// There's no street address: the intake never asks for one, so the pin is the
// customer's position (or their suburb). Unit numbers and access go in chat.

const isApple = () => typeof navigator !== "undefined" && /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent) && "ontouchend" in document;

export function mapsLink(location: { lat: number; lng: number } | null, suburb: string | null): string {
  if (location) {
    const at = `${location.lat},${location.lng}`;
    return isApple() ? `https://maps.apple.com/?daddr=${at}&dirflg=d` : `https://www.google.com/maps/dir/?api=1&destination=${at}&travelmode=driving`;
  }
  const q = encodeURIComponent(suburb ?? "Brisbane");
  return isApple() ? `https://maps.apple.com/?q=${q}` : `https://www.google.com/maps/search/?api=1&query=${q}`;
}
