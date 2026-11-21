"use client";

import { useEffect, useRef, useState } from "react";

/** How often a position is posted while on the way. */
export const EN_ROUTE_EVERY_MS = 5000;

export type ShareState = "off" | "asking" | "sharing" | "denied" | "unavailable";

/**
 * While `active`, watches the phone's position and posts the latest one about
 * every `everyMs`. Stops by itself when `active` turns off. On the way (every
 * 5 s) it moves the customer's pin; location is never needed to move the job
 * on, a denied prompt just means the customer sees "Location unavailable".
 */
export function useLocationShare(
  active: boolean,
  report: (p: { lat: number; lng: number }) => Promise<void>,
  everyMs = EN_ROUTE_EVERY_MS,
): ShareState {
  const [state, setState] = useState<ShareState>("off");
  const latest = useRef<{ lat: number; lng: number } | null>(null);
  const send = useRef(report);
  useEffect(() => {
    send.current = report;
  });

  useEffect(() => {
    if (!active) {
      setState("off");
      return;
    }
    if (typeof navigator === "undefined" || !("geolocation" in navigator) || !window.isSecureContext) {
      setState("unavailable");
      return;
    }
    setState("asking");
    let lastSent = 0;
    const post = () => {
      const p = latest.current;
      if (!p) return;
      lastSent = Date.now();
      void send.current(p).catch(() => {});
    };
    const watch = navigator.geolocation.watchPosition(
      (pos) => {
        latest.current = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setState("sharing");
        if (Date.now() - lastSent >= everyMs) post();
      },
      (err) => setState(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable"),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
    // Keep the position fresh even when the phone isn't moving.
    const timer = setInterval(post, everyMs);
    return () => {
      navigator.geolocation.clearWatch(watch);
      clearInterval(timer);
    };
  }, [active, everyMs]);

  return state;
}

export function SharingIndicator({ state, className = "" }: { state: ShareState; className?: string }) {
  if (state === "off") return null;
  const text = {
    asking: "Asking for your location…",
    sharing: "Sharing your location while you're on the way",
    denied: "Location is off, so they can't see you coming. You can still carry on.",
    unavailable: "Your location isn't available here (it needs HTTPS). You can still carry on.",
  }[state];
  const live = state === "sharing";
  return (
    <p role="status" className={`lw-inner lw-caption flex items-center gap-2.5 px-3 py-2 ${live ? "" : "lw-c2"} ${className}`}>
      <span className={`lw-live-dot ${live ? "lw-live-dot--ping" : "lw-live-dot--off"}`} aria-hidden />
      {text}
    </p>
  );
}
