"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { TradieBookings, TradieInbox } from "@legwork/shared";
import type { IconName } from "@/components/icon-paths";
import { api, ApiRequestError } from "@/lib/api";
import { loadTradieSession, saveTradieSession, type TradieSession } from "@/lib/tradie-session";
import { buzz, useBuzzOnNew, usePoll } from "@/lib/use-poll";

type TradieState = {
  /** undefined until local storage has been read. */
  session: TradieSession | null | undefined;
  setSession: (s: TradieSession | null) => void;
  inbox: TradieInbox | null;
  bookings: TradieBookings | null;
  /** Fetch the inbox and bookings now (after a bid, a stage change…). */
  refresh: () => Promise<void>;
  /** A tradie API call with this phone's token. Signs out on 401. */
  call: <T>(path: string, init?: { method?: string; json?: unknown }) => Promise<T>;
  /** Online on this phone: offers take over the screen. Offline: they don't. */
  online: boolean;
  setOnline: (on: boolean) => void;
  toast: Toast | null;
  showToast: (text: string, icon?: IconName) => void;
};

export type Toast = { id: number; text: string; icon: IconName };

const ONLINE_KEY = "legwork.tradie.online";
const TOAST_MS = 3200;

const Ctx = createContext<TradieState | null>(null);

export function useTradie() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTradie outside TradieProvider");
  return ctx;
}

/** Buzzes when `n` goes up (a new message), not when it goes down (read). */
function useBuzzOnIncrease(n: number | null) {
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (n === null) return;
    if (last.current !== null && n > last.current) buzz();
    last.current = n;
  }, [n]);
}

export function TradieProvider({ children }: { children: React.ReactNode }) {
  const [session, setSessionState] = useState<TradieSession | null | undefined>(undefined);
  const [inbox, setInbox] = useState<TradieInbox | null>(null);
  const [bookings, setBookings] = useState<TradieBookings | null>(null);

  useEffect(() => setSessionState(loadTradieSession()), []);

  const setSession = useCallback((s: TradieSession | null) => {
    saveTradieSession(s);
    setSessionState(s);
    setInbox(null);
    setBookings(null);
  }, []);

  const token = session?.token;
  const call = useCallback(
    async <T,>(path: string, init: { method?: string; json?: unknown } = {}) => {
      if (!token) throw new ApiRequestError("Sign in first.", 401);
      try {
        return await api<T>(`/tradie${path}`, { token, method: init.method ?? (init.json === undefined ? "GET" : "POST"), json: init.json });
      } catch (e) {
        // The token was revoked (signed out on another tab): start again.
        if (e instanceof ApiRequestError && e.status === 401) setSession(null);
        throw e;
      }
    },
    [token, setSession],
  );

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const [i, b] = await Promise.all([call<TradieInbox>("/inbox"), call<TradieBookings>("/bookings")]);
      setInbox(i);
      setBookings(b);
    } catch {
      // A dropped poll; the next one will catch up.
    }
  }, [token, call]);

  usePoll(refresh, 2000, !!token);

  // New offers, new bookings (a win) and new messages all buzz the phone.
  const offerKeys = useMemo(() => inbox?.offers.filter((o) => o.state === "pending").map((o) => o.jobId) ?? null, [inbox]);
  const bookingKeys = useMemo(() => bookings?.bookings.map((b) => `${b.jobId}:${b.stage === "cancelled" ? "x" : "ok"}`) ?? null, [bookings]);
  useBuzzOnNew(offerKeys);
  useBuzzOnNew(bookingKeys);
  useBuzzOnIncrease(bookings?.unread ?? null);

  // Online lives on this phone only: the API has no presence yet.
  const [online, setOnlineState] = useState(true);
  useEffect(() => setOnlineState(localStorage.getItem(ONLINE_KEY) !== "off"), []);

  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const showToast = useCallback((text: string, icon: IconName = "check") => {
    clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), text, icon });
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const setOnline = useCallback(
    (on: boolean) => {
      localStorage.setItem(ONLINE_KEY, on ? "on" : "off");
      setOnlineState(on);
      showToast(on ? "You're online. Offers will come through." : "You're offline. You won't get new offers.", on ? "check" : "info");
    },
    [showToast],
  );

  // A sent bid leaves the inbox when the search books someone: it's either
  // in the bookings now (won) or gone (lost).
  const waiting = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    waiting.current = null;
  }, [token]);
  useEffect(() => {
    if (!inbox || !bookings) return;
    const now = new Map(inbox.offers.filter((o) => o.state === "bid_sent").map((o) => [o.jobId, o.title]));
    const before = waiting.current;
    waiting.current = now;
    if (!before) return;
    for (const [jobId, title] of before) {
      if (now.has(jobId)) continue;
      const won = bookings.bookings.find((b) => b.jobId === jobId);
      if (won) showToast(`You're booked · ${title}`, "bell");
      else showToast("They booked another tradie this time.", "info");
    }
  }, [inbox, bookings, showToast]);

  const value = useMemo(
    () => ({ session, setSession, inbox, bookings, refresh, call, online, setOnline, toast, showToast }),
    [session, setSession, inbox, bookings, refresh, call, online, setOnline, toast, showToast],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
