"use client";

import { useEffect, useRef } from "react";

/**
 * Calls `fn` straight away and then every `ms` while the page is open, and
 * once more when the tab comes back into view. The tradie side has no push
 * channel; it polls about every 2 seconds instead.
 */
export function usePoll(fn: () => Promise<void> | void, ms = 2000, enabled = true) {
  const latest = useRef(fn);
  useEffect(() => {
    latest.current = fn;
  });

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      if (stopped) return;
      try {
        await latest.current();
      } finally {
        if (!stopped) timer = setTimeout(run, ms);
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        clearTimeout(timer);
        void run();
      }
    };
    void run();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [ms, enabled]);
}

/** A short buzz, where the phone supports it. */
export function buzz(pattern: number | number[] = [180, 80, 180]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Not supported (iOS Safari): nothing to do.
  }
}

/**
 * Buzzes when something new shows up in `keys` (a new offer, a new message),
 * but not for what was already there when the page opened.
 */
export function useBuzzOnNew(keys: string[] | null) {
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!keys) return;
    if (seen.current === null) {
      seen.current = new Set(keys);
      return;
    }
    const fresh = keys.filter((k) => !seen.current!.has(k));
    for (const k of keys) seen.current.add(k);
    if (fresh.length > 0) buzz();
  }, [keys]);
}
