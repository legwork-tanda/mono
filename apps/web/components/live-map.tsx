"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { GeoJSONSource, LngLatBoundsLike, Map as MlMap, Marker } from "maplibre-gl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MatchOffer, MatchState } from "@legwork/shared";
import { FILL } from "./icon-paths";
import { Icon, icons } from "./ui";

/**
 * The live map under the matching flow, Uber style: real streets, the job's
 * suburb as the pin, the search radius sweeping out while we look, and once
 * booked, the tradie's car driving the actual road route to you.
 *
 * Map tiles: OpenFreeMap (OSM data, no key). Geocoding: Photon. Routing: the
 * public OSRM server. All three are free and fine for a demo; swap for a paid
 * provider (Mapbox, Google, HERE) before real traffic.
 */

type LngLat = [number, number];
type Route = { coords: LngLat[]; cum: number[]; km: number };

const STYLE_URL = "https://tiles.openfreemap.org/styles/positron";
const SYDNEY: LngLat = [151.2093, -33.8688];
const AUSTRALIA_BBOX = "112,-44,154,-10";
const EARTH_KM = 6371;

// --- Theme --------------------------------------------------------------------
// The map takes its colours from the --lw-map-* tokens (legwork-tokens.css), read
// at runtime so it follows light and dark (layout.tsx switches data-theme on <html>).

function tokens() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    base: v("--lw-map-base", "#ECECEF"),
    road: v("--lw-map-road", "#FFFFFF"),
    minor: v("--lw-map-road-minor", "#F7F7F9"),
    route: v("--lw-map-route", "#FFE37A"),
    casing: v("--lw-map-route-casing", "#1D1D1F"),
    text: v("--lw-text", "#1D1D1F"),
    text3: v("--lw-text-3", "#5E5E63"),
  };
}

const MAJOR = /motorway|trunk|primary|secondary|highway|major/;
const ROADISH = /road|street|highway|bridge|tunnel|motorway|trunk|primary|secondary|tertiary|minor|service|path|track|rail|transport/;

/** Recolours the base style (OpenFreeMap Positron) with the map tokens, monochrome. */
function paintBase(map: MlMap) {
  const t = tokens();
  const set = (id: string, prop: string, value: unknown) => {
    try {
      map.setPaintProperty(id, prop, value);
    } catch {
      // A layer without that property; leave it.
    }
  };
  for (const layer of map.getStyle()?.layers ?? []) {
    if (["radius-fill", "radius-line", "pulse-fill", "route-done", "route-casing", "route-line"].includes(layer.id)) continue;
    const id = layer.id;
    if (layer.type === "background") set(id, "background-color", t.base);
    else if (layer.type === "fill") {
      set(id, "fill-color", /water/.test(id) ? t.minor : /building/.test(id) ? t.minor : t.base);
      set(id, "fill-outline-color", t.minor);
    } else if (layer.type === "line") {
      set(id, "line-color", ROADISH.test(id) ? (MAJOR.test(id) ? t.road : t.minor) : t.minor);
    } else if (layer.type === "symbol") {
      set(id, "text-color", t.text3);
      set(id, "text-halo-color", t.base);
      set(id, "icon-opacity", 0);
    }
  }
}

/** Our own layers: search rings in ink at low opacity, the route yellow over an ink casing. */
function paintOwn(map: MlMap) {
  const t = tokens();
  map.setPaintProperty("radius-fill", "fill-color", t.text);
  map.setPaintProperty("radius-line", "line-color", t.text);
  map.setPaintProperty("pulse-fill", "circle-color", t.text);
  map.setPaintProperty("route-done", "line-color", t.text3);
  map.setPaintProperty("route-casing", "line-color", t.casing);
  map.setPaintProperty("route-line", "line-color", t.route);
}

// --- Geometry -------------------------------------------------------------------

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** The point `km` away from `from` on a compass bearing. */
function offset([lng, lat]: LngLat, km: number, bearing: number): LngLat {
  const d = km / EARTH_KM;
  const b = rad(bearing);
  const p1 = rad(lat);
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = rad(lng) + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [deg(l2), deg(p2)];
}

function distance(a: LngLat, b: LngLat) {
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
}

function heading(a: LngLat, b: LngLat) {
  const y = Math.sin(rad(b[0] - a[0])) * Math.cos(rad(b[1]));
  const x = Math.cos(rad(a[1])) * Math.sin(rad(b[1])) - Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(rad(b[0] - a[0]));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

function ring(center: LngLat, km: number, steps = 96): LngLat[] {
  return Array.from({ length: steps + 1 }, (_, i) => offset(center, km, (i / steps) * 360));
}

function toRoute(coords: LngLat[]): Route {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1]! + distance(coords[i - 1]!, coords[i]!));
  return { coords, cum, km: cum[cum.length - 1]! };
}

/** Where along the route `t` (0 to 1) is, which way the car faces, and the line split there. */
function along(route: Route, t: number) {
  const { coords, cum, km } = route;
  const target = km * Math.min(1, Math.max(0, t));
  let i = 1;
  while (i < coords.length - 1 && cum[i]! < target) i++;
  const a = coords[i - 1]!;
  const b = coords[i]!;
  const seg = cum[i]! - cum[i - 1]!;
  const f = seg > 0 ? Math.min(1, Math.max(0, (target - cum[i - 1]!) / seg)) : 0;
  const point: LngLat = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  return { point, heading: heading(a, b), done: [...coords.slice(0, i), point], left: [point, ...coords.slice(i)] };
}

function bounds(points: LngLat[]): LngLatBoundsLike {
  let [w, s, e, n] = [180, 90, -180, -90];
  for (const [x, y] of points) {
    w = Math.min(w, x);
    e = Math.max(e, x);
    s = Math.min(s, y);
    n = Math.max(n, y);
  }
  return [
    [w, s],
    [e, n],
  ];
}

const line = (coords: LngLat[]) => ({ type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: coords } });
const polygon = (coords: LngLat[]) => ({ type: "Feature" as const, properties: {}, geometry: { type: "Polygon" as const, coordinates: [coords] } });
const empty = { type: "FeatureCollection" as const, features: [] };

// --- Location services (cached per page) ------------------------------------------

const geocodes = new Map<string, Promise<LngLat | null>>();
function geocode(place: string) {
  let hit = geocodes.get(place);
  if (!hit) {
    hit = fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(place)}&limit=1&lang=en&bbox=${AUSTRALIA_BBOX}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { features?: { geometry: { coordinates: LngLat } }[] } | null) => j?.features?.[0]?.geometry.coordinates ?? null)
      .catch(() => null);
    geocodes.set(place, hit);
  }
  return hit;
}

const OSRM = "https://router.project-osrm.org";
const snaps = new Map<string, Promise<LngLat>>();
/** Nudge a simulated tradie onto the nearest road, so nobody's parked in the harbour. */
function snap(key: string, p: LngLat) {
  let hit = snaps.get(key);
  if (!hit) {
    hit = fetch(`${OSRM}/nearest/v1/driving/${p[0]},${p[1]}?number=1`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { waypoints?: { location: LngLat }[] } | null) => j?.waypoints?.[0]?.location ?? p)
      .catch(() => p);
    snaps.set(key, hit);
  }
  return hit;
}

const routes = new Map<string, Promise<Route>>();
function drive(key: string, from: LngLat, to: LngLat) {
  let hit = routes.get(key);
  if (!hit) {
    hit = fetch(`${OSRM}/route/v1/driving/${from[0]},${from[1]};${to[0]},${to[1]}?overview=full&geometries=geojson`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { routes?: { geometry: { coordinates: LngLat[] } }[] } | null) => {
        const coords = j?.routes?.[0]?.geometry.coordinates;
        return toRoute(coords && coords.length > 1 ? [from, ...coords, to] : [from, to]);
      })
      .catch(() => toRoute([from, to]));
    routes.set(key, hit);
  }
  return hit;
}

// --- Marker elements -------------------------------------------------------------

const initials = (name: string) =>
  name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("");

function homeEl() {
  const el = document.createElement("div");
  el.className = "lw-map-home";
  el.innerHTML = `<span class="lw-map-home__label"></span><span class="lw-map-home__pin"></span>`;
  return el;
}

function tradieEl(o: MatchOffer) {
  const el = document.createElement("div");
  el.className = "lw-map-tradie";
  el.textContent = initials(o.tradie.name);
  el.title = o.tradie.name;
  return el;
}

/** The booked tradie's van: a yellow rounded square with an ink ring and a truck. */
function vanEl() {
  const el = document.createElement("div");
  el.className = "lw-map-van";
  el.innerHTML = `<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="${FILL.truck}"/></svg>`;
  return el;
}

// --- Component ------------------------------------------------------------------

export function LiveMap({
  match,
  location,
  stale = false,
}: {
  match: MatchState;
  location: string | null;
  /** Live updates are down: the tradie's pin and the ETA are the last known, so they're greyed and labelled. */
  stale?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const lib = useRef<typeof import("maplibre-gl") | null>(null);
  const home = useRef<Marker | null>(null);
  const car = useRef<Marker | null>(null);
  const pins = useRef(new Map<string, Marker>());
  const shown = useRef(0);

  // undefined while the suburb lookup is in flight.
  const [suburbAt, setSuburbAt] = useState<LngLat | null | undefined>(undefined);
  const [gps, setGps] = useState<LngLat | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [placed, setPlaced] = useState<Record<string, LngLat>>({});
  const [route, setRoute] = useState<Route | null>(null);

  const searching = match.stage === "searching";
  const booked = match.booked;
  const bookedId = booked?.id;
  const visible = booked ? [] : match.offers.filter((o) => o.response !== "withdrawn");

  // 1. Where the job is: the suburb they typed, sharpened to their exact spot
  // if the browser shares it and it's in that area (they may not be at the job).
  useEffect(() => {
    let live = true;
    void (location ? geocode(location) : Promise.resolve(null)).then((p) => live && setSuburbAt(p));
    return () => {
      live = false;
    };
  }, [location]);

  useEffect(() => {
    if (!("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (p) => setGps([p.coords.longitude, p.coords.latitude]),
      () => {}, // Declined or unavailable: the suburb will do.
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5 * 60 * 1000 },
    );
  }, []);

  // A booked job knows exactly where it is (saved at confirm).
  const jobAt = match.jobLocation;
  const origin = useMemo<LngLat | null>(() => {
    if (jobAt) return [jobAt.lng, jobAt.lat];
    if (gps && (!suburbAt || distance(gps, suburbAt) < 30)) return gps;
    if (suburbAt === undefined) return null;
    return suburbAt ?? SYDNEY;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gps, suburbAt, jobAt?.lat, jobAt?.lng]);
  const precise = origin !== null && (origin === gps || !!jobAt);
  const originKey = origin?.join(",") ?? "";

  useEffect(() => {
    if (ready && origin) home.current?.setLngLat(origin);
  }, [ready, origin]);

  // 2. The map itself, once we know where to point it.
  useEffect(() => {
    if (!origin || !container.current || mapRef.current) return;
    let cancelled = false;
    void import("maplibre-gl").then((ml) => {
      if (cancelled || !container.current) return;
      lib.current = ml;
      let map: MlMap;
      try {
        map = new ml.Map({
          container: container.current,
          style: STYLE_URL,
          center: origin,
          zoom: 12,
          attributionControl: { compact: true },
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
          cooperativeGestures: true,
          fadeDuration: 0,
        });
      } catch {
        setFailed(true);
        return;
      }
      map.touchZoomRotate.disableRotation();
      mapRef.current = map;
      map.on("load", () => {
        map.addSource("radius", { type: "geojson", data: empty });
        map.addSource("pulse", { type: "geojson", data: empty });
        map.addSource("route-left", { type: "geojson", data: empty });
        map.addSource("route-done", { type: "geojson", data: empty });
        paintBase(map);
        map.addLayer({ id: "radius-fill", type: "fill", source: "radius", paint: { "fill-opacity": 0.05 } });
        map.addLayer({ id: "radius-line", type: "line", source: "radius", paint: { "line-width": 1.5, "line-opacity": 0.35, "line-dasharray": [2, 2] } });
        // The sweep is a circle whose radius and opacity are animated as paint properties,
        // so a frame never re-tiles geometry (setData every frame stalled phones).
        map.addLayer({ id: "pulse-fill", type: "circle", source: "pulse", paint: { "circle-opacity": 0, "circle-radius": 0, "circle-pitch-alignment": "map" } });
        map.addLayer({ id: "route-done", type: "line", source: "route-done", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-width": 4, "line-opacity": 0.5 } });
        map.addLayer({ id: "route-casing", type: "line", source: "route-left", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-width": 9 } });
        map.addLayer({ id: "route-line", type: "line", source: "route-left", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-width": 5 } });
        paintOwn(map);
        home.current = new ml.Marker({ element: homeEl(), anchor: "bottom" }).setLngLat(origin).addTo(map);
        setReady(true);
      });
      map.on("error", (e) => {
        // A missing tile isn't fatal; a style that won't load is.
        if (!map.isStyleLoaded() && !map.loaded() && String(e.error?.message ?? "").includes("style")) setFailed(true);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [origin]);

  // Light or dark changed: recolour the map from the tokens.
  useEffect(() => {
    if (!ready) return;
    const observer = new MutationObserver(() => {
      const map = mapRef.current;
      if (!map) return;
      paintBase(map);
      paintOwn(map);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, [ready]);

  useEffect(
    () => () => {
      mapRef.current?.remove();
      mapRef.current = null;
    },
    [],
  );

  // 3. Put each tradie on a real road.
  const offerKey = visible.map((o) => o.id).join(",");
  useEffect(() => {
    if (!origin) return;
    let live = true;
    const offers = booked ? [booked] : visible;
    void Promise.all(offers.map(async (o) => [o.id, await snap(`${o.id}@${originKey}`, offset(origin, o.distanceKm, o.bearing))] as const)).then(
      (pairs) => live && setPlaced((prev) => ({ ...prev, ...Object.fromEntries(pairs) })),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin, originKey, offerKey, booked?.id]);

  // 4. The booked tradie's drive (simulated tradies only; a live tradie's real
  // position is drawn instead, below).
  const liveTradie = match.liveTradie;
  const start = booked && !liveTradie ? placed[booked.id] : undefined;
  useEffect(() => {
    if (!origin || !bookedId || !start) return setRoute(null);
    let live = true;
    void drive(`${bookedId}@${start.join(",")}@${originKey}`, start, origin).then((r) => live && setRoute(r));
    return () => {
      live = false;
    };
  }, [origin, originKey, bookedId, start]);

  // Search radius, and the sweep pulsing out to it.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !origin) return;
    const radius = map.getSource("radius") as GeoJSONSource;
    const pulse = map.getSource("pulse") as GeoJSONSource;
    radius.setData(searching ? polygon(ring(origin, match.radiusKm)) : empty);
    pulse.setData(empty);
    if (!searching || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    pulse.setData({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: origin } });
    // Metres per screen pixel at the job's latitude (512px tiles), so the circle reaches the radius ring.
    const metresPerPx = () => (40_075_016.686 * Math.cos(rad(origin[1]))) / (512 * 2 ** map.getZoom());
    let frame = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = ((now - t0) % 2400) / 2400;
      map.setPaintProperty("pulse-fill", "circle-radius", (match.radiusKm * 1000 * p) / metresPerPx());
      map.setPaintProperty("pulse-fill", "circle-opacity", 0.14 * (1 - p));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      // The map may already be gone (unmount).
      try {
        map.setPaintProperty("pulse-fill", "circle-opacity", 0);
      } catch {
        // Removed with the map.
      }
    };
  }, [ready, origin, searching, match.radiusKm]);

  // Tradie pins while searching.
  useEffect(() => {
    const map = mapRef.current;
    const ml = lib.current;
    if (!ready || !map || !ml) return;
    const keep = new Set<string>();
    for (const o of visible) {
      const at = placed[o.id];
      if (!at) continue;
      keep.add(o.id);
      let pin = pins.current.get(o.id);
      if (!pin) {
        pin = new ml.Marker({ element: tradieEl(o) }).setLngLat(at).addTo(map);
        pins.current.set(o.id, pin);
      }
      pin.setLngLat(at);
      pin.getElement().dataset.state = o.response;
    }
    for (const [id, pin] of pins.current) {
      if (!keep.has(id)) {
        pin.remove();
        pins.current.delete(id);
      }
    }
  });

  // The car, eased along the route between polls.
  useEffect(() => {
    const map = mapRef.current;
    const ml = lib.current;
    if (!ready || !map || !ml) return;
    const done = map.getSource("route-done") as GeoJSONSource;
    const left = map.getSource("route-left") as GeoJSONSource;
    if (!route || !bookedId) {
      car.current?.remove();
      car.current = null;
      done.setData(empty);
      left.setData(empty);
      return;
    }
    // A new car (first load, or a reload mid-journey) starts where the server
    // says the tradie is, from the en_route time, rather than driving from the start.
    const fresh = !car.current;
    if (!car.current) car.current = new ml.Marker({ element: vanEl() }).setLngLat(route.coords[0]!).addTo(map);
    const draw = (t: number) => {
      const at = along(route, t);
      car.current?.setLngLat(at.point);
      done.setData(line(at.done));
      left.setData(t >= 1 ? empty : line(at.left));
    };
    const from = shown.current;
    const to = match.travelled;
    if (fresh || Math.abs(to - from) < 0.001 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      shown.current = to;
      draw(to);
      return;
    }
    let frame = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / 1400);
      shown.current = from + (to - from) * k;
      draw(shown.current);
      if (k < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [ready, route, bookedId, match.travelled]);

  // A live tradie's real position while they're on the way.
  const livePin = useRef<Marker | null>(null);
  const liveAt: LngLat | null = liveTradie && match.tradieLocation ? [match.tradieLocation.lng, match.tradieLocation.lat] : null;
  const liveKey = liveAt?.join(",") ?? "";
  useEffect(() => {
    const map = mapRef.current;
    const ml = lib.current;
    if (!ready || !map || !ml) return;
    if (!liveAt || !booked) {
      livePin.current?.remove();
      livePin.current = null;
      return;
    }
    if (!livePin.current) livePin.current = new ml.Marker({ element: tradieEl(booked) }).setLngLat(liveAt).addTo(map);
    livePin.current.setLngLat(liveAt);
    livePin.current.getElement().dataset.state = match.locationStatus === "stale" ? "declined" : "accepted";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, liveKey, booked?.id, match.locationStatus]);

  // The ETA flag on your pin.
  useEffect(() => {
    const label = home.current?.getElement().querySelector<HTMLElement>(".lw-map-home__label");
    if (!label) return;
    const text =
      match.stage === "en_route" && match.etaMinutes !== null
        ? stale
          ? `${match.etaMinutes} min (last seen)`
          : `${match.etaMinutes} min`
        : match.stage === "in_progress"
          ? "Arrived"
          : precise
            ? "Your location"
            : (location ?? "Your job");
    label.textContent = text;
    label.dataset.eta = String(match.stage === "en_route");
  }, [ready, match.stage, match.etaMinutes, location, precise, stale]);

  // Keep the camera on what matters, refitting only when that changes.
  const fit = useCallback(
    (animate = true) => {
      const map = mapRef.current;
      if (!map || !origin) return;
      const pts: LngLat[] = route
        ? [...route.coords, origin]
        : liveAt
          ? [liveAt, origin, ...ring(origin, 0.5)]
          : ring(origin, Math.max(2, match.radiusKm));
      map.fitBounds(bounds(pts), { padding: { top: 76, bottom: 44, left: 44, right: 44 }, maxZoom: 15, duration: animate ? 900 : 0 });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [origin, route, match.radiusKm, liveKey],
  );
  // A live tradie's pin refits the view when it first appears, not on every move.
  const view = `${originKey}|${route ? `route:${bookedId}` : liveAt ? `live:${bookedId}` : `radius:${match.radiusKm}`}`;
  const lastView = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || lastView.current === view) return;
    fit(lastView.current !== null);
    lastView.current = view;
  }, [ready, view, fit]);

  // --- Overlay ---
  const pending = visible.filter((o) => o.response === "pending").length;
  const quoted = visible.filter((o) => o.response === "accepted").length;
  const kmLeft = route ? route.km * (1 - match.travelled) : null;
  const firstName = booked?.tradie.name.split(" ")[0] ?? "";

  let status: { tone: "live" | "calm" | "stale"; text: string; sub?: string };
  if (stale) status = { tone: "stale", text: "Reconnecting…", sub: match.stage === "en_route" ? `last seen ${match.etaMinutes ?? "–"} min away` : "not live" };
  else if (searching) status = { tone: "live", text: `Searching ${match.radiusKm} km`, sub: quoted ? `${quoted} quoted` : pending ? `${pending} deciding` : undefined };
  else if (match.stage === "matched") status = { tone: "calm", text: `${firstName} is getting ready`, sub: kmLeft !== null ? `${kmLeft.toFixed(1)} km away` : undefined };
  else if (match.stage === "en_route" && liveTradie)
    status =
      match.locationStatus === "live" && liveAt && origin
        ? { tone: "live", text: `${match.etaMinutes ?? "–"} min away`, sub: `${distance(liveAt, origin).toFixed(1)} km` }
        : match.locationStatus === "stale" && match.tradieLocation
          ? { tone: "calm", text: `Last seen ${Math.max(1, Math.round(match.tradieLocation.ageS / 60))} min ago` }
          : { tone: "calm", text: "Location unavailable", sub: `${firstName} is on the way` };
  else if (match.stage === "en_route") status = { tone: "live", text: `${match.etaMinutes ?? "–"} min away`, sub: kmLeft !== null ? `${kmLeft.toFixed(1)} km` : undefined };
  else if (match.stage === "in_progress") status = { tone: "calm", text: `${firstName} has arrived` };
  else status = { tone: "calm", text: "No one free nearby" };

  return (
    <div data-stale={stale || undefined} className="lw-map-frame relative h-[340px] w-full bg-[var(--lw-map-base)] sm:h-[380px]">
      {/* Inline position: maplibre's own CSS sets .maplibregl-map { position: relative },
          which beats Tailwind's layered utilities and collapses the map to 0px tall. */}
      <div ref={container} style={{ position: "absolute", inset: 0 }} aria-label="Map of tradies near your job" role="region" />

      {!ready && !failed && <div className="absolute inset-0 animate-pulse bg-[var(--lw-map-base)]" aria-hidden />}
      {failed && (
        <div className="lw-callout absolute inset-0 flex items-center justify-center p-6 text-center text-muted">
          The map couldn&rsquo;t load on this device. Updates still appear below.
        </div>
      )}

      {/* Status pill */}
      <div className="lw-glass lw-glass--pill pointer-events-none absolute top-3 left-3 flex h-10 max-w-[calc(100%-4.5rem)] items-center gap-2 pr-4 pl-3.5">
        <span className="relative flex size-2.5 shrink-0">
          {status.tone === "live" && <span className="absolute -inset-0.5 animate-ping rounded-full ring-2 ring-ink/30" />}
          <span className={`lw-live-dot lw-live-dot--${status.tone}`} />
        </span>
        <span className="lw-ellipsis text-[15px] font-semibold">{status.text}</span>
        {status.sub && <span className="shrink-0 text-sm text-muted">· {status.sub}</span>}
      </div>

      {/* Recentre */}
      {ready && (
        <button type="button" onClick={() => fit()} aria-label="Recentre map" className="lw-glass lw-glass--circle absolute top-3 right-3 text-ink">
          <Icon name={icons.locate} />
        </button>
      )}
    </div>
  );
}
