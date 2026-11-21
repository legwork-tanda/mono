/**
 * The booked tradie's van on the live map: a top-down tradie van, nose up,
 * that turns to face the way it's driving. Yellow body, ink outline and
 * glass, a ladder on the roof rack, on a glass disc with a soft ground shadow.
 * A ring breathes out from it while it's live; when updates stop it goes grey
 * with a dashed ring and a "Last seen" tag (no colour change).
 *
 * The geometry is drawn on a 24 × 40 grid (1 unit = 1 CSS px at the default
 * size) so every line lands on the pixel grid. iOS draws the same shapes in
 * apps/ios/Legwork/Views/Match/VanMarker.swift; keep the two in step.
 * Styles: .lw-map-van in app/styles/match.css.
 */

/** The 24 × 40 drawing, nose at the top (heading 0 is north). */
export const VAN_VIEWBOX = "0 0 24 40";

export const VAN_PATHS = {
  /** Body: a rounder nose (bonnet) and squarer rear doors. */
  body: "M9 1.5H15A6 6 0 0 1 21 7.5V35.5A3 3 0 0 1 18 38.5H6A3 3 0 0 1 3 35.5V7.5A6 6 0 0 1 9 1.5Z",
  /** Wing mirrors, either side of the cab. */
  mirrors: "M1.5 10.25A1 1 0 0 1 2.5 9.25H3.5V12.25H2.5A1 1 0 0 1 1.5 11.25Z M20.5 9.25H21.5A1 1 0 0 1 22.5 10.25V11.25A1 1 0 0 1 21.5 12.25H20.5Z",
  /** Windscreen: curved along the top, raked in at the sides. */
  windscreen: "M5.25 8.75Q12 6.25 18.75 8.75L17.75 13.25Q12 12.25 6.25 13.25Z",
  /** Roof rack: two crossbars, front and back (stroked). */
  rack: "M5.5 17H18.5M5.5 34.5H18.5",
  /** The ladder strapped to the rack: two rails and four rungs (stroked). */
  ladder: "M8.5 16V35.5M15.5 16V35.5M8.5 21H15.5M8.5 24.5H15.5M8.5 28H15.5M8.5 31.5H15.5",
  /** Rear doors' split line. */
  doors: "M12 36.5V38.5",
} as const;

/** The van as SVG markup. Fills use classes so CSS can grey it out when stale. */
export function vanSvg(label = "Tradie's van") {
  const p = VAN_PATHS;
  return (
    `<svg class="lw-map-van__car" viewBox="${VAN_VIEWBOX}" width="24" height="40" role="img" aria-label="${label}">` +
    `<path class="lw-map-van__ink" d="${p.mirrors}"/>` +
    `<path class="lw-map-van__paint" d="${p.body}" stroke-width="1.5" stroke-linejoin="round"/>` +
    `<path class="lw-map-van__ink" d="${p.windscreen}"/>` +
    `<path class="lw-map-van__line" d="${p.rack} ${p.ladder} ${p.doors}" fill="none" stroke-width="1.25" stroke-linecap="round"/>` +
    `</svg>`
  );
}

/** The marker element MapLibre positions. Turn it with `turnVan`. */
export function vanEl(label = "Tradie's van") {
  const el = document.createElement("div");
  el.className = "lw-map-van";
  el.innerHTML =
    `<span class="lw-map-van__halo" aria-hidden="true"></span>` +
    `<span class="lw-map-van__body">${vanSvg(label)}</span>` +
    `<span class="lw-map-van__seen">Last seen</span>`;
  return el;
}

/**
 * The angle to rotate to so the van takes the short way round: from 350° to
 * 10° it turns +20° (to 370°), not -340°. `from` is the last angle shown
 * (unwrapped, so it can run past 360); `to` is a compass heading.
 */
export function turnTo(from: number, to: number) {
  const delta = ((((to - from) % 360) + 540) % 360) - 180;
  return from + delta;
}

/**
 * Face the van along `heading` (compass degrees). The turn eases in CSS; the
 * first heading is set without a turn, so a new van doesn't spin into place.
 */
export function turnVan(el: HTMLElement, heading: number) {
  if (!Number.isFinite(heading)) return;
  const car = el.querySelector<SVGElement>(".lw-map-van__car");
  if (!car) return;
  const last = Number(el.dataset.heading);
  const next = Number.isFinite(last) ? turnTo(last, heading) : heading;
  if (Number.isFinite(last) && Math.abs(next - last) < 0.5) return;
  el.dataset.heading = String(next);
  car.style.setProperty("--lw-van-heading", `${next}deg`);
  if (!el.dataset.turning) requestAnimationFrame(() => (el.dataset.turning = "true"));
}
