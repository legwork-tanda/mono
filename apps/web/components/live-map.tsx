"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { GeoJSONSource, LngLatBoundsLike, Map as MlMap, Marker } from "maplibre-gl";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { MatchOffer, MatchState } from "@legwork/shared";
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
    if (OWN.includes(layer.id)) continue;
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

const OWN = ["radius-fill", "radius-line", "pulse-fill", "route-done", "route-halo", "route-line"];

/**
 * Our own layers: search rings in ink at low opacity, and the route as a thin
 * line in the text colour (ink on the light map, white on the dark) over a soft
 * halo in the road colour. The part already driven fades back.
 */
function paintOwn(map: MlMap) {
  const t = tokens();
  map.setPaintProperty("radius-fill", "fill-color", t.text);
  map.setPaintProperty("radius-line", "line-color", t.text);
  map.setPaintProperty("pulse-fill", "fill-color", t.text);
  map.setPaintProperty("route-done", "line-color", t.text3);
  map.setPaintProperty("route-halo", "line-color", t.road);
  map.setPaintProperty("route-line", "line-color", t.text);
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

/** The booked tradie's van, rotated by its marker to face the way it drives. */
function carEl() {
  const el = document.createElement("div");
  el.className = "lw-car";
  // Top-down white work van facing north, shaded like a rendered model (Uber-style);
  // the marker rotates it to the road's heading. It carries its own soft ground shadow.
  el.innerHTML = `<svg viewBox="0 0 56 104" width="28" height="52" aria-hidden="true">
    <defs>
      <filter id="lw-van-shadow" x="-30%" y="-20%" width="160%" height="140%">
        <feGaussianBlur stdDeviation="2.6"/>
      </filter>
      <filter id="lw-van-soft" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="1.6"/>
      </filter>
      <linearGradient id="lw-van-side" x1="0" x2="1" y1="0" y2="0">
        <stop offset="0" stop-color="#9aa3b0"/>
        <stop offset=".07" stop-color="#d5dae1"/>
        <stop offset=".2" stop-color="#f4f6f8"/>
        <stop offset=".55" stop-color="#ffffff"/>
        <stop offset=".85" stop-color="#e6e9ee"/>
        <stop offset=".95" stop-color="#c3c9d2"/>
        <stop offset="1" stop-color="#8d96a4"/>
      </linearGradient>
      <linearGradient id="lw-van-roof" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0" stop-color="#ffffff"/>
        <stop offset=".6" stop-color="#f3f5f8"/>
        <stop offset="1" stop-color="#dfe3e9"/>
      </linearGradient>
      <linearGradient id="lw-van-hood" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stop-color="#e4e8ed"/>
        <stop offset=".5" stop-color="#ffffff"/>
        <stop offset="1" stop-color="#eef1f4"/>
      </linearGradient>
      <linearGradient id="lw-van-glass" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stop-color="#3a4a63"/>
        <stop offset=".55" stop-color="#151e2d"/>
        <stop offset="1" stop-color="#0b1019"/>
      </linearGradient>
      <linearGradient id="lw-van-streak" x1="0" x2="1" y1="0" y2="0">
        <stop offset="0" stop-color="#fff" stop-opacity="0"/>
        <stop offset=".5" stop-color="#fff" stop-opacity=".35"/>
        <stop offset="1" stop-color="#fff" stop-opacity="0"/>
      </linearGradient>
    </defs>

    <!-- soft ground shadow -->
    <rect x="7" y="6" width="42" height="94" rx="11" fill="#0b1220" opacity=".55" filter="url(#lw-van-shadow)"/>

    <!-- tyres, just peeking past the body -->
    <g fill="#1a1d23">
      <rect x="6.6" y="15" width="4" height="13" rx="1.8"/>
      <rect x="45.4" y="15" width="4" height="13" rx="1.8"/>
      <rect x="6.6" y="76" width="4" height="13" rx="1.8"/>
      <rect x="45.4" y="76" width="4" height="13" rx="1.8"/>
    </g>

    <!-- mirrors -->
    <path d="M9.4 23.2 4.2 24.6Q3 27.6 4.8 28.2L9.4 27.6Z" fill="#20242b"/>
    <path d="M46.6 23.2 51.8 24.6Q53 27.6 51.2 28.2L46.6 27.6Z" fill="#20242b"/>

    <!-- body shell: short rounded nose, long boxy cargo body -->
    <path d="M28 3.5C37.5 3.5 43.6 5 45.4 9.5 46.6 12.6 47 16 47.2 20L47.6 94Q47.6 99.6 42.2 99.8 35 100.2 28 100.2 21 100.2 13.8 99.8 8.4 99.6 8.4 94L8.8 20C9 16 9.4 12.6 10.6 9.5 12.4 5 18.5 3.5 28 3.5Z"
      fill="url(#lw-van-side)"/>

    <!-- bonnet -->
    <path d="M12.2 9.8C14 6.6 19.8 5.6 28 5.6S42 6.6 43.8 9.8C44.8 11.6 45.2 13.6 45.4 16H10.6C10.8 13.6 11.2 11.6 12.2 9.8Z"
      fill="url(#lw-van-hood)"/>
    <path d="M18 7.2Q17 11.5 17.4 15.6M38 7.2Q39 11.5 38.6 15.6" stroke="#aab2bd" stroke-width=".45" fill="none" opacity=".4"/>

    <!-- headlights -->
    <path d="M11.2 9.6Q12.8 5.8 18 5.2L17.4 7.6Q14 8 12 10.6Z" fill="#cfd5dd"/>
    <path d="M44.8 9.6Q43.2 5.8 38 5.2L38.6 7.6Q42 8 44 10.6Z" fill="#cfd5dd"/>

    <!-- windscreen -->
    <path d="M10.4 28.2Q28 25.6 45.6 28.2L44.2 17.4Q28 15 11.8 17.4Z" fill="url(#lw-van-glass)"/>
    <path d="M15 17.2 21 16.6 16.6 27.4 12.6 27.8Z" fill="url(#lw-van-streak)"/>
    <!-- wipers -->
    <path d="M17 27.2 25.6 25.4M30 25.4 39 27.2" stroke="#0a0d12" stroke-width=".7" stroke-linecap="round"/>

    <!-- door glass along the cab sides -->
    <path d="M9.2 21.4 10.4 28.4V38.6H9.1Z" fill="#141b27"/>
    <path d="M46.8 21.4 45.6 28.4V38.6H46.9Z" fill="#141b27"/>

    <!-- roof panel with a soft bevel and stamped ribs -->
    <rect x="11" y="28.6" width="34" height="68.6" rx="4.2" fill="url(#lw-van-roof)" stroke="#cfd5dd" stroke-width=".6"/>
    <g stroke-linecap="round">
      <g stroke="#d3d8df" stroke-width=".9">
        <path d="M14 42H42M14 54H42M14 66H42M14 78H42M14 90H42"/>
      </g>
      <g stroke="#ffffff" stroke-width=".7">
        <path d="M14 43H42M14 55H42M14 67H42M14 79H42M14 91H42"/>
      </g>
    </g>
    <!-- glossy highlight down the roof -->
    <ellipse cx="24" cy="58" rx="6" ry="26" fill="#fff" opacity=".7" filter="url(#lw-van-soft)"/>

    <!-- tail lights and rear bumper -->
    <path d="M9 95.4Q9.4 98.6 12.6 99.2L13.6 97.4Q11 96.8 10.6 95Z" fill="#d8352a"/>
    <path d="M47 95.4Q46.6 98.6 43.4 99.2L42.4 97.4Q45 96.8 45.4 95Z" fill="#d8352a"/>
    <path d="M15 99.6Q28 100.6 41 99.6" stroke="#2a2f37" stroke-width="1.1" fill="none" stroke-linecap="round"/>
  </svg>`;
  return el;
}

// --- Component ------------------------------------------------------------------

export function LiveMap({
  match,
  location,
  stale = false,
  fill = false,
  inset,
  onBack,
  children,
}: {
  match: MatchState;
  location: string | null;
  /** Live updates are down: the tradie's pin and the ETA are the last known, so they're greyed and labelled. */
  stale?: boolean;
  /** Fills its scene (S05b, S08): one-finger panning, the controls under the top bar. */
  fill?: boolean;
  /** What covers the map: the sheet below it (phone) or beside it (desktop), kept clear when fitting. */
  inset?: { bottom: number; left: number };
  /** A back button before the status pill (tracking before the drive starts). */
  onBack?: () => void;
  /** Notices under the controls (reconnecting). */
  children?: ReactNode;
}) {
  const container = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const controls = useRef<HTMLDivElement>(null);
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
          // In a card, two fingers move the map so the page still scrolls; full screen, one does.
          cooperativeGestures: !fill,
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
        map.addLayer({ id: "pulse-fill", type: "fill", source: "pulse", paint: { "fill-opacity": 0.08 } });
        const round = { "line-cap": "round", "line-join": "round" } as const;
        map.addLayer({ id: "route-done", type: "line", source: "route-done", layout: round, paint: { "line-width": 2.5, "line-opacity": 0.35 } });
        map.addLayer({ id: "route-halo", type: "line", source: "route-left", layout: round, paint: { "line-width": 9, "line-blur": 2, "line-opacity": 0.9 } });
        map.addLayer({ id: "route-line", type: "line", source: "route-left", layout: round, paint: { "line-width": 3.5 } });
        paintOwn(map);
        home.current = new ml.Marker({ element: homeEl(), anchor: "bottom" }).setLngLat(origin).addTo(map);
        // The credit stays, folded to its small (i) until tapped.
        container.current?.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
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
    let frame = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = ((now - t0) % 2400) / 2400;
      pulse.setData(polygon(ring(origin, Math.max(0.05, match.radiusKm * p), 64)));
      map.setPaintProperty("pulse-fill", "fill-opacity", 0.14 * (1 - p));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
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
    if (!car.current) car.current = new ml.Marker({ element: carEl(), rotationAlignment: "map" }).setLngLat(route.coords[0]!).addTo(map);
    const draw = (t: number) => {
      const at = along(route, t);
      car.current?.setLngLat(at.point).setRotation(at.heading);
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
    // The same van, facing the way it last moved (or towards you before it has).
    if (!livePin.current) {
      livePin.current = new ml.Marker({ element: carEl(), rotationAlignment: "map" }).setLngLat(liveAt).addTo(map);
      if (origin) livePin.current.setRotation(heading(liveAt, origin));
    }
    const was = livePin.current.getLngLat();
    if (distance([was.lng, was.lat], liveAt) > 0.01) livePin.current.setRotation(heading([was.lng, was.lat], liveAt));
    livePin.current.setLngLat(liveAt);
    livePin.current.getElement().dataset.stale = String(match.locationStatus === "stale");
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
      let padding = { top: 76, bottom: 44, left: 44, right: 44 };
      if (fill && frame.current && controls.current) {
        // Clear of the top bar and controls above, and of the sheet below or beside.
        const top = controls.current.getBoundingClientRect().bottom - frame.current.getBoundingClientRect().top + 64; // room for the label over the home pin
        padding = { top, bottom: (inset?.bottom ?? 0) + 40, left: (inset?.left ?? 0) + 56, right: 56 };
        // A short screen with a tall sheet: never ask for more room than there is.
        const h = frame.current.clientHeight;
        if (padding.top + padding.bottom > h - 80) padding.bottom = Math.max(32, h - 80 - padding.top);
      }
      map.fitBounds(bounds(pts), { padding, maxZoom: 15, duration: animate && !reduceMotion() ? 900 : 0 });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [origin, route, match.radiusKm, liveKey, fill, inset?.bottom, inset?.left],
  );
  // A live tradie's pin refits the view when it first appears, not on every move.
  const view = `${originKey}|${route ? `route:${bookedId}` : liveAt ? `live:${bookedId}` : `radius:${match.radiusKm}`}`;
  const lastView = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || lastView.current === view) return;
    fit(lastView.current !== null);
    lastView.current = view;
  }, [ready, view, fit]);
  // The sheet settled at a new height (or the panel appeared): keep the view clear of it.
  const insetKey = `${inset?.bottom ?? 0},${inset?.left ?? 0}`;
  const lastInset = useRef(insetKey);
  useEffect(() => {
    if (!ready || lastInset.current === insetKey) return;
    lastInset.current = insetKey;
    fit(true);
  }, [ready, insetKey, fit]);

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
        ? { tone: "live", text: `Live · ${distance(liveAt, origin).toFixed(1)} km away` }
        : match.locationStatus === "stale" && match.tradieLocation
          ? { tone: "calm", text: `Last seen ${Math.max(1, Math.round(match.tradieLocation.ageS / 60))} min ago` }
          : { tone: "calm", text: "Location unavailable", sub: `${firstName} is on the way` };
  // The sheet and the pin's flag carry the minutes; the pill says it's live and how far.
  else if (match.stage === "en_route") status = { tone: "live", text: kmLeft !== null ? `Live · ${kmLeft.toFixed(1)} km away` : "Live" };
  else if (match.stage === "in_progress") status = { tone: "calm", text: `${firstName} has arrived` };
  else status = { tone: "calm", text: "No one free nearby" };

  const pill = (
    <div className={`lw-glass lw-glass--pill pointer-events-none flex items-center gap-2 pr-4 pl-3.5 ${fill ? "h-11 min-w-0" : "absolute top-3 left-3 h-10 max-w-[calc(100%-4.5rem)]"}`} role="status">
      <span className="relative flex size-2.5 shrink-0">
        {status.tone === "live" && <span className="absolute -inset-0.5 animate-ping rounded-full ring-2 ring-ink/30 motion-reduce:hidden" />}
        <span className={`lw-live-dot lw-live-dot--${status.tone}`} />
      </span>
      <span className="lw-subhead lw-ellipsis font-semibold tabular-nums">{status.text}</span>
      {status.sub && <span className="lw-subhead shrink-0 text-muted tabular-nums">· {status.sub}</span>}
    </div>
  );
  const recentre = (
    <button
      type="button"
      onClick={() => fit()}
      disabled={!ready}
      aria-label="Recentre map"
      className={`lw-glass lw-glass--circle text-ink ${fill ? "ml-auto" : "absolute top-3 right-3"} ${ready ? "" : "opacity-0"}`}
    >
      <Icon name={icons.locate} />
    </button>
  );

  return (
    <div
      ref={frame}
      data-stale={stale || undefined}
      className={`lw-map-frame w-full bg-[var(--lw-map-base)] ${fill ? "absolute inset-0" : "relative h-[340px] sm:h-[380px]"}`}
      // The map's credit sits just above the sheet, not under it.
      style={{ "--lw-map-inset": `${fill ? (inset?.bottom ?? 0) : 0}px` } as CSSProperties}
    >
      {/* Inline position: maplibre's own CSS sets .maplibregl-map { position: relative },
          which beats Tailwind's layered utilities and collapses the map to 0px tall. */}
      <div ref={container} style={{ position: "absolute", inset: 0 }} aria-label="Map of tradies near your job" role="region" />

      {!ready && !failed && <div className="absolute inset-0 animate-pulse bg-[var(--lw-map-base)] motion-reduce:animate-none" aria-hidden />}
      {failed && (
        <div className="lw-callout absolute inset-0 flex items-center justify-center p-6 text-center text-muted">
          The map couldn&rsquo;t load on this device. Updates still appear below.
        </div>
      )}

      {fill ? (
        <div ref={controls} className="lw-scene__controls">
          <div className="lw-scene__row">
            {onBack && (
              <button type="button" onClick={onBack} aria-label="Back to booking" className="lw-glass lw-glass--circle text-ink">
                <Icon name={icons.back} />
              </button>
            )}
            {pill}
            {recentre}
          </div>
          {children}
        </div>
      ) : (
        <>
          {pill}
          {ready && recentre}
        </>
      )}
    </div>
  );
}

const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
