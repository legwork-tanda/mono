"use client";

import { useEffect, useRef, useState } from "react";

/** How often a position is posted while on the way. */
const REPORT_EVERY_MS = 5000;

export type ShareState = "off" | "asking" | "sharing" | "denied" | "unavailable";

/**
 * While `active` (the job is on the way), watches the phone's position and
 * posts the latest one about every 5 seconds. Stops by itself when `active`
 * turns off (Start job). Location is never needed to move the job on: a
 * denied prompt just means the customer sees "Location unavailable".
 */
export function useLocationShare(active: boolean, report: (p: { lat: number; lng: number }) => Promise<void>): ShareState {
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
        if (Date.now() - lastSent >= REPORT_EVERY_MS) post();
      },
      (err) => setState(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable"),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
    // Keep the customer's pin fresh even when the phone isn't moving.
    const timer = setInterval(post, REPORT_EVERY_MS);
    return () => {
      navigator.geolocation.clearWatch(watch);
      clearInterval(timer);
    };
  }, [active]);

  return state;
}

export function SharingIndicator({ state }: { state: ShareState }) {
  if (state === "off") return null;
  const text = {
    asking: "Asking for your location…",
    sharing: "Sharing your location with the customer",
    denied: "Location is off, so the customer can't see you. You can still carry on.",
    unavailable: "Your location isn't available here (it needs HTTPS). You can still carry on.",
  }[state];
  const live = state === "sharing";
  return (
    <p role="status" className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold ${live ? "bg-accent-tint text-ink" : "bg-surface text-muted"}`}>
      <span className="relative flex size-2.5 shrink-0">
        {live && <span className="absolute inset-0 animate-ping rounded-full bg-accent opacity-60" />}
        <span className={`relative size-2.5 rounded-full ${live ? "bg-accent" : "bg-faint"}`} />
      </span>
      {text}
    </p>
  );
}
