"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MESSAGE_MAX,
  TIER_INFO,
  tradeInfo,
  type JobMessage,
  type JobState,
  type JobWriteUp,
  type MatchOffer,
  type MatchState,
  type Tier,
  type TradieCard,
  tierForWhen,
  todayIn,
  whenForTier,
  whenLabel,
  type JobWhen,
} from "@legwork/shared";
import { api, streamMatch } from "@/lib/api";
import { Completion } from "./completion";
import { LiveMap } from "./live-map";
import { formatPriceRange } from "@legwork/shared";
import { buttonPrimary, buttonQuiet, buttonSecondary, cardClass, fieldClass, Icon, icons, Spinner, Walking } from "./ui";

/** Stages where the match changes on its own, so the screen follows it live. */
const isLive = (match: MatchState) => ["searching", "matched", "en_route", "in_progress"].includes(match.stage);

type Session = { id: string; token: string; uploadToken: string };

const money = (n: number) => `$${n.toLocaleString("en-AU")}`;
const firstName = (t: TradieCard) => t.name.split(" ")[0] ?? t.name;

// --- Bits ---------------------------------------------------------------------

const AVATAR_COLOURS = ["#245fd9", "#12805c", "#b54708", "#7a3fd6", "#c0362c", "#0e7490"];

export function Avatar({ tradie, size = "size-11" }: { tradie: TradieCard; size?: string }) {
  const initials = tradie.name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("");
  const colour = AVATAR_COLOURS[[...tradie.id].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLOURS.length];
  return (
    <span
      aria-hidden
      className={`${size} flex shrink-0 items-center justify-center rounded-full text-sm font-bold text-white`}
      style={{ background: colour }}
    >
      {initials}
    </span>
  );
}

export function Stars({ rating, count }: { rating: number; count?: number }) {
  return (
    <span className="inline-flex items-center gap-1 text-sm">
      <svg viewBox="0 0 20 20" className="size-4 text-amber-500" fill="currentColor" aria-hidden>
        <path d="M10 1.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L10 14.9l-5.2 2.7 1-5.8L1.5 7.7l5.9-.9L10 1.5z" />
      </svg>
      <span className="font-semibold">{rating.toFixed(1)}</span>
      {count !== undefined && <span className="text-muted">({count})</span>}
    </span>
  );
}

// --- Quotes ---------------------------------------------------------------------

/**
 * Medium and Low: quotes arrive over a short window. The best overall one (not
 * just the cheapest) is recommended and booked when the window closes, unless
 * the customer picks sooner.
 */
function Quotes({
  match,
  busy,
  onBook,
}: {
  match: MatchState;
  busy: boolean;
  onBook: (offerId: string) => void;
}) {
  const left = useCountdown(match.bidWindowEndsAt);
  const quotes = match.offers
    .filter((o) => o.response === "accepted" && o.quote !== null)
    .sort((a, b) => (a.id === match.recommendedOfferId ? -1 : b.id === match.recommendedOfferId ? 1 : a.quote! - b.quote!));
  if (quotes.length === 0) return null;

  return (
    <section aria-label="Quotes" className="space-y-3 animate-question">
      <p className="text-sm text-muted">
        {left !== null && left > 0 ? `More quotes may arrive. We'll book the recommended one in ${left}s unless you choose.` : "Booking the recommended quote…"}
      </p>
      <ul className="space-y-3">
        {quotes.map((o) => {
          const recommended = o.id === match.recommendedOfferId;
          return (
            <li key={o.id} className={`rounded-[24px] bg-white p-4 shadow-card ring-1 ${recommended ? "ring-2 ring-brand" : "ring-line"}`}>
              <div className="flex items-center gap-3">
                <Avatar tradie={o.tradie} size="size-12" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{o.tradie.name}</p>
                  <p className="mt-0.5 flex items-center gap-2 text-sm text-muted">
                    <Stars rating={o.tradie.rating} count={o.tradie.reviewCount} />
                    <span aria-hidden>·</span>
                    <span className="truncate">{o.tradie.business}</span>
                  </p>
                </div>
                <p className="text-lg font-semibold tabular-nums">{money(o.quote!)}</p>
              </div>
              {o.note && <p className="mt-2 text-sm text-muted text-pretty">{o.note}</p>}
              <div className="mt-3 flex items-center justify-between gap-3">
                {recommended ? <span className="rounded-full bg-brand-soft px-2.5 py-1 text-xs font-semibold text-brand">Recommended</span> : <span />}
                <button type="button" onClick={() => onBook(o.id)} disabled={busy} className={recommended ? buttonPrimary : buttonSecondary}>
                  Book {firstName(o.tradie)}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// --- Booked ---------------------------------------------------------------------

function useCountdown(until: string | null) {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!until) return setLeft(null);
    const tick = () => setLeft(Math.max(0, Math.round((Date.parse(until) - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [until]);
  return left;
}

// --- Demo controls ----------------------------------------------------------------

const DEMO_KEY = "legwork:demo";

/**
 * The presenter's controls (skip to the next stage, make the search fail) are
 * hidden from normal use. Turn them on by opening the page with `?demo=1`
 * (`?demo=0` turns them off) or by tapping the screen's heading five times
 * quickly. The choice is remembered on this device.
 */
function useDemoControls() {
  const [on, setOn] = useState(false);
  const taps = useRef<number[]>([]);

  useEffect(() => {
    const flag = new URLSearchParams(window.location.search).get("demo");
    let stored: string | null = null;
    try {
      if (flag === "1" || flag === "0") localStorage.setItem(DEMO_KEY, flag);
      stored = localStorage.getItem(DEMO_KEY);
    } catch {
      // Storage blocked (private mode): the URL flag still works for this visit.
    }
    setOn((flag ?? stored) === "1");
  }, []);

  const tap = useCallback(() => {
    const now = Date.now();
    taps.current = [...taps.current.filter((t) => now - t < 2000), now];
    if (taps.current.length < 5) return;
    taps.current = [];
    setOn((prev) => {
      try {
        localStorage.setItem(DEMO_KEY, prev ? "0" : "1");
      } catch {
        // Not remembered; fine for this visit.
      }
      return !prev;
    });
  }, []);

  return { on, tap };
}

/**
 * For a live tradie on the way: "Location unavailable" until they share it,
 * "Last seen N min ago" once it's over a minute old, otherwise the ETA.
 */
export function liveLocationText(match: MatchState): string | null {
  if (!match.liveTradie || match.stage !== "en_route") return null;
  if (match.locationStatus === "unavailable" || !match.tradieLocation) return "Location unavailable";
  if (match.locationStatus === "stale") return `Last seen ${Math.max(1, Math.round(match.tradieLocation.ageS / 60))} min ago`;
  return match.etaMinutes !== null ? `Arriving in about ${match.etaMinutes} min` : null;
}

// --- Messages -------------------------------------------------------------------

const clockTime = (iso: string) => new Date(iso).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });

/**
 * A chat with the booked tradie: the confirmed job pinned at the top, then the
 * messages. New ones arrive through the match stream, so this only sends.
 */
function MessageThread({
  match,
  writeUp,
  tradie,
  onSend,
  onClose,
}: {
  match: MatchState;
  writeUp: JobWriteUp;
  tradie: TradieCard;
  onSend: (text: string) => Promise<void>;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const name = firstName(tradie);
  const price = match.booked?.quote;

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [match.messages.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit() {
    const value = text.trim();
    if (!value || sending) return;
    setSending(true);
    setError(null);
    try {
      await onSend(value);
      setText("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={`Messages with ${tradie.name}`} className="fixed inset-0 z-50 flex flex-col bg-surface">
      <header className="flex items-center gap-3 border-b border-line bg-white px-4 py-3">
        <button type="button" onClick={onClose} aria-label="Back" className={buttonQuiet}>
          <Icon d={icons.back} />
        </button>
        <Avatar tradie={tradie} size="size-9" />
        <div className="min-w-0">
          <p className="truncate font-semibold">{tradie.name}</p>
          <p className="truncate text-xs text-muted">{tradie.business}</p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto max-w-xl space-y-3">
          {/* The confirmed job, pinned so both sides know what was agreed. */}
          <section aria-label="Your job" className="rounded-[20px] bg-white p-4 shadow-card ring-1 ring-line">
            <div className="flex items-baseline justify-between gap-3">
              <p className="font-semibold">{writeUp.title}</p>
              <p className="shrink-0 font-semibold tabular-nums">{price ? money(price) : formatPriceRange(match.price)}</p>
            </div>
            <p className="mt-1 text-sm text-muted text-pretty">{writeUp.summary}</p>
            {writeUp.details.length > 0 && (
              <dl className="mt-2 space-y-0.5 text-sm">
                {writeUp.details.map((d) => (
                  <div key={d.label} className="flex gap-2">
                    <dt className="text-faint">{d.label}</dt>
                    <dd className="min-w-0">{d.value}</dd>
                  </div>
                ))}
              </dl>
            )}
            <p className="mt-2 text-xs text-faint">
              {[writeUp.location, match.whenLabel ?? match.date].filter(Boolean).join(" · ")} · Price locked
            </p>
          </section>

          {match.messages.length === 0 && (
            <p className="py-6 text-center text-sm text-muted text-pretty">
              Let {name} know how to get in, where to park, or anything else that helps.
            </p>
          )}

          {match.messages.map((m: JobMessage) => {
            const mine = m.author === "customer";
            return (
              <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 ${mine ? "bg-brand text-white" : "bg-white ring-1 ring-line"}`}>
                  <p className="whitespace-pre-wrap break-words">{m.text}</p>
                  <p className={`mt-0.5 text-right text-[11px] ${mine ? "text-white/70" : "text-faint"}`}>{clockTime(m.createdAt)}</p>
                </div>
              </div>
            );
          })}
          <div ref={end} />
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="border-t border-line bg-white px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      >
        <div className="mx-auto max-w-xl">
          {error && <p role="alert" className="mb-2 text-sm text-danger">{error}</p>}
          {match.canMessage ? (
            <div className="flex items-end gap-2">
              <label htmlFor="message" className="sr-only">
                Message {name}
              </label>
              <textarea
                id="message"
                rows={1}
                value={text}
                maxLength={MESSAGE_MAX}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void submit();
                  }
                }}
                placeholder={`Message ${name}`}
                className={`${fieldClass} max-h-32 min-h-12 flex-1 resize-none`}
              />
              <button type="submit" disabled={sending || !text.trim()} aria-label="Send" className={`${buttonPrimary} size-12 shrink-0 px-0`}>
                {sending ? <Spinner /> : <Icon d={icons.send} />}
              </button>
            </div>
          ) : (
            <p className="text-center text-sm text-muted">
              {match.stage === "cancelled" ? "This job was cancelled, so messaging is closed." : "This job is done, so messaging is closed."}
            </p>
          )}
        </div>
      </form>
    </div>
  );
}

// --- Tracking ---------------------------------------------------------------------

const clock = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" }) : null;

/**
 * Parcel-style tracking: each step of the job with the time it happened. The
 * current step pulses; steps still to come are greyed out.
 */
function Tracking({
  match,
  worker,
  name,
  contacted,
  staleAt,
}: {
  match: MatchState;
  worker: string;
  name: string;
  contacted: number;
  /** Set while live updates are down: the last update's time ("" if unknown). */
  staleAt: string | null;
}) {
  const t = match.timeline;
  const steps = [
    {
      key: "finding",
      label: t.accepted ? `Sent to ${worker}s nearby` : `Finding a ${worker}`,
      detail: contacted > 0 ? `Waiting for one of ${contacted} nearby to accept` : "Sending your job to tradies nearby",
      at: t.posted,
    },
    { key: "accepted", label: name ? `${name} accepted` : "Tradie accepts", detail: "Getting ready to head over", at: t.accepted },
    {
      key: "onTheWay",
      label: "On the way",
      detail:
        match.etaMinutes === null
          ? null
          : staleAt !== null
            ? `About ${match.etaMinutes} min away${staleAt ? ` as of ${staleAt}` : ""} (not live)`
            : `About ${match.etaMinutes} min away`,
      at: t.onTheWay,
    },
    { key: "working", label: "Working on it", detail: null, at: t.working },
    { key: "done", label: "Done", detail: null, at: t.done },
  ];
  // The latest step reached is the live one; everything before it is done.
  const reached = steps.reduce((last, step, i) => (step.at ? i : last), 0);
  const current = match.stage === "completed" ? steps.length : reached;
  const done = (i: number) => i < current;

  return (
    <ol className="rounded-[24px] bg-white p-5 shadow-card ring-1 ring-line" aria-label="Job progress">
      {steps.map((step, i) => {
        const isDone = done(i);
        const isCurrent = i === current;
        const last = i === steps.length - 1;
        return (
          <li key={step.key} className="relative flex gap-3.5 pb-5 last:pb-0" aria-current={isCurrent ? "step" : undefined}>
            {!last && (
              <span
                aria-hidden
                className={`absolute top-6 bottom-0 left-[11px] w-0.5 rounded-full ${isDone ? "bg-brand" : "bg-line"}`}
              />
            )}
            <span
              aria-hidden
              className={`relative z-10 mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full ${
                isDone ? "bg-brand text-white" : isCurrent ? "bg-brand-soft ring-2 ring-brand" : "bg-white ring-2 ring-line"
              }`}
            >
              {isDone ? (
                <Icon d={icons.check} className="size-3.5 stroke-[3]" />
              ) : isCurrent ? (
                <span className="size-2 animate-pulse rounded-full bg-brand" />
              ) : null}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <p className={`font-semibold ${isDone || isCurrent ? "text-ink" : "text-faint"}`}>{step.label}</p>
                {(isDone || isCurrent) && clock(step.at) && <p className="shrink-0 text-sm text-faint tabular-nums">{clock(step.at)}</p>}
              </div>
              {isCurrent && step.detail && <p className="mt-0.5 text-sm text-muted">{step.detail}</p>}
              {isCurrent && step.key === "finding" && match.stage === "searching" && (
                <div className="mt-2">
                  <Walking label="Usually takes a minute or two" size="h-9" />
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// --- Searching again -----------------------------------------------------------------

/**
 * The time a retry at `tier` will use, worked out the way `/match/retry` does:
 * the job keeps its time if it still fits the tier (and an ASAP one is still
 * today), otherwise it moves to the tier's own: ASAP, tomorrow, or later this week.
 */
function retryWhen(match: MatchState, tier: Tier, nowMs: number): JobWhen {
  const stored = match.when;
  const keeps =
    tier === match.tier && tierForWhen(stored, nowMs) === tier && (!stored.asap || stored.date === todayIn(stored.timeZone, nowMs));
  return keeps ? stored : whenForTier(tier, nowMs, stored.timeZone);
}

/** "Tomorrow morning" reads as "tomorrow morning" mid-sentence. */
const midSentence = (label: string) => label.replace(/^(Today|Tomorrow)\b/, (w) => w.toLowerCase());

/** What a retry will do before the customer starts it: the time it will use and the range it will lock. */
function RetryOffer({
  match,
  writeUp,
  tier,
  busy,
  heading,
  onRetry,
}: {
  match: MatchState;
  writeUp: JobWriteUp;
  tier: Tier;
  busy: boolean;
  heading: string;
  onRetry: () => void;
}) {
  const nowMs = Date.now();
  const next = whenLabel(retryWhen(match, tier, nowMs), nowMs);
  const current = whenLabel(match.when, nowMs);
  const range = formatPriceRange(writeUp.prices[tier]);
  const moves = next !== current;
  return (
    <section aria-label={heading} className="rounded-[24px] bg-white p-4 shadow-card ring-1 ring-line">
      <p className="font-semibold">{heading}</p>
      <p className="mt-1 text-sm text-muted text-pretty">
        {moves ? `Needed ${midSentence(next)} instead of ${midSentence(current)}. ` : `Needed ${midSentence(next)}. `}
        The price range locks at {range}.
      </p>
      <button type="button" onClick={onRetry} disabled={busy} className={`${buttonPrimary} mt-3 w-full`}>
        Search again · {range}
      </button>
    </section>
  );
}

// --- View -------------------------------------------------------------------------

/**
 * Everything after the customer confirms: the live search (Uber), quotes to
 * choose from (Upwork), then the booked tradie on their way and the review.
 */
export function MatchView({
  session,
  state,
  initial,
  onNewJob,
  onScheduled,
}: {
  session: Session;
  state: JobState;
  initial: MatchState | null;
  onNewJob: () => void;
  /** After "Save for later": back home, where the job is listed as not booked. */
  onScheduled: (date: string) => void;
}) {
  const [match, setMatch] = useState<MatchState | null>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  // The live stream dropped: what's shown is the last update, not live.
  const [stale, setStale] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  /** Ends the stream's wait before reconnecting, for "Retry now". */
  const reconnectNow = useRef<() => void>(() => {});
  const writeUp = state.job.writeUp!;
  const worker = tradeInfo(writeUp.trade).worker;
  const live = !!match && isLive(match);
  // Free cancellation counts down once a tradie has accepted; the server rejects it after.
  const cancelLeft = useCountdown(match?.canCancel && match.stage === "matched" ? match.cancelUntil : null);
  const demoControls = useDemoControls();

  /**
   * Reads the job's match as it stands (never posts it again). True when it
   * worked. `quiet` leaves a failure unsaid, for when a notice already covers it.
   */
  const refresh = useCallback(async (quiet = false) => {
    try {
      setMatch(await api<MatchState>(`/jobs/${session.id}/match`, { token: session.token }));
      setUpdatedAt(Date.now());
      return true;
    } catch (e) {
      if (!quiet) setError((e as Error).message);
      return false;
    }
  }, [session]);

  useEffect(() => {
    if (!initial) void refresh().then((ok) => ok && setError(null));
  }, [refresh, initial]);

  async function reload() {
    setLoading(true);
    setError(null);
    await refresh();
    setLoading(false);
  }

  // While something is happening, follow it over one streamed request instead
  // of polling. Reopens if the server ends the stream while the job is still
  // live. After a dropped or silent connection the screen says the live info
  // is out of date, and it reconnects with a growing pause ("Retry now" skips it).
  useEffect(() => {
    if (!live) return;
    const controller = new AbortController();
    let attempt: AbortController | null = null;
    // The pause before reconnecting; back to short once updates flow again.
    let pause = 2000;
    const fresh = (next: MatchState) => {
      pause = 2000;
      setMatch(next);
      setUpdatedAt(Date.now());
      setStale(false);
    };
    // The browser knows the network went: don't wait for the stream to notice.
    const offline = () => {
      setStale(true);
      attempt?.abort();
    };
    window.addEventListener("offline", offline);
    void (async () => {
      while (!controller.signal.aborted) {
        attempt = new AbortController();
        const stop = () => attempt?.abort();
        controller.signal.addEventListener("abort", stop);
        try {
          const last = await streamMatch(session.id, session.token, fresh, attempt.signal);
          if (last && !isLive(last)) return;
        } catch {
          if (controller.signal.aborted) return;
          setStale(true);
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, pause);
            reconnectNow.current = () => {
              clearTimeout(timer);
              resolve();
            };
          });
          reconnectNow.current = () => {};
          pause = Math.min(pause * 2, 15_000);
        } finally {
          controller.signal.removeEventListener("abort", stop);
        }
      }
    })();
    return () => {
      controller.abort();
      window.removeEventListener("offline", offline);
      reconnectNow.current = () => {};
      setStale(false);
    };
  }, [live, session]);

  /** "Retry now": read the booking as it stands and reconnect straight away. */
  async function retryLive() {
    setBusy("reconnect");
    setError(null);
    // While offline the "Reconnecting…" notice already says it; no second error.
    if (await refresh(true)) setStale(false);
    reconnectNow.current();
    setBusy(null);
  }

  async function act(key: string, path: string, json?: unknown) {
    setBusy(key);
    setError(null);
    try {
      setMatch(await api<MatchState>(`/jobs/${session.id}${path}`, { method: "POST", token: session.token, json: json ?? {} }));
    } catch (e) {
      setError((e as Error).message);
      void refresh();
    } finally {
      setBusy(null);
    }
  }

  async function scheduleLater() {
    setBusy("schedule");
    setError(null);
    try {
      const next = await api<MatchState>(`/jobs/${session.id}/match/schedule`, { method: "POST", token: session.token, json: {} });
      setMatch(next);
      onScheduled(next.date);
    } catch (e) {
      setError((e as Error).message);
      void refresh();
    } finally {
      setBusy(null);
    }
  }

  if (!match) {
    if (!error || loading) return <Walking label={loading ? "Trying again…" : "Finding tradies near you…"} className="mt-6" />;
    // The first read failed. The job is already posted, so retrying only reads it again.
    return (
      <div className="space-y-4 animate-question" role="alert">
        <div>
          <h1 className="text-[1.75rem] leading-tight font-semibold tracking-[-0.015em]">We couldn&rsquo;t load your job</h1>
          <p className="mt-1.5 text-muted text-pretty">{error} Your job is still posted; trying again won&rsquo;t send it twice.</p>
        </div>
        <button type="button" autoFocus onClick={() => void reload()} className={`${buttonPrimary} w-full`}>
          Try again
        </button>
      </div>
    );
  }

  const contacted = match.offers.filter((o) => o.response !== "withdrawn").length;
  const booked = match.booked;
  const name = booked ? firstName(booked.tradie) : "";
  const fasterTier: Tier | null = match.tier === "low" ? "medium" : match.tier === "medium" ? "high" : null;
  // The map from the moment the search starts (the ping and the widening ring,
  // tradies popping in as they're offered) until the tradie arrives.
  // While they work, the pin stays at the home.
  const showMap = match.stage === "searching" || match.stage === "matched" || match.stage === "en_route" || match.stage === "in_progress";
  // Hide the button the moment the countdown runs out, before the next update arrives.
  const showCancel = match.canCancel && !(match.stage === "matched" && cancelLeft === 0);
  const price = booked?.quote ?? null;
  // A live tradie's real position: say so when it's missing or old.
  const liveWhere = liveLocationText(match);
  const lastClock = updatedAt ? clock(new Date(updatedAt).toISOString()) : null;

  const title =
    match.stage === "searching"
      ? `Finding your ${worker}`
      : match.stage === "no_match"
        ? `No ${worker}s free right now`
        : match.stage === "scheduled"
          ? "Saved, not booked"
          : match.stage === "matched"
          ? `${name} accepted your job`
          : match.stage === "en_route"
            ? `${name} is on the way`
            : match.stage === "in_progress"
              ? `${name} is working on it`
              : match.stage === "completed"
                ? "Job done"
                : "Job cancelled";

  const subtitle =
    match.stage === "searching"
      ? contacted > 0
        ? match.tier === "high"
          ? `Sent to ${contacted} ${worker}${contacted === 1 ? "" : "s"} nearby. The first to accept gets the job.`
          : `Sent to ${contacted} ${worker}${contacted === 1 ? "" : "s"} nearby. We'll recommend the best quote.`
        : `Sending your job to ${worker}s nearby.`
      : match.stage === "no_match"
        ? `We asked every ${worker} within 20 km and nobody could take it. ${fasterTier ? "Try a faster option, or save it and search again later." : "Save it and search again when it suits."}`
        : match.stage === "scheduled"
          ? `${writeUp.title}. No ${worker} is booked and we won't search again on our own. Start a new search when you're ready.`
        : match.stage === "en_route" && liveWhere
          ? liveWhere
        : match.stage === "en_route" && match.etaMinutes !== null
          ? stale
            ? `Last known: about ${match.etaMinutes} min away${lastClock ? ` at ${lastClock}` : ""}`
            : `Arriving in about ${match.etaMinutes} min`
          : match.stage === "cancelled"
            ? "No charge. You can post it again any time."
            : writeUp.title;

  return (
    <div className="space-y-5 animate-question">
      <div>
        {/* Five quick taps on the heading toggle the presenter's demo controls. */}
        <h1 onClick={demoControls.tap} className="text-[1.75rem] leading-tight font-semibold tracking-[-0.015em]">
          {title}
        </h1>
        <p className="mt-1.5 text-muted text-pretty">{subtitle}</p>
        {/* Not shown once the search has ended without anyone: nobody is coming, and a retry says its own time. */}
        {match.whenLabel && !["completed", "cancelled", "no_match", "scheduled"].includes(match.stage) && (
          <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-sm font-medium">
            <Icon d={icons.clock} className="size-4 text-muted" />
            Needed {match.when.asap ? "ASAP" : match.whenLabel}
          </p>
        )}
      </div>

      {showMap && (
        <div className={`${cardClass} overflow-hidden animate-question`}>
          <LiveMap match={match} location={writeUp.location} stale={stale} />
        </div>
      )}

      {stale && live && (
        <section role="status" className="flex flex-wrap items-start gap-3 rounded-[20px] bg-amber-50 p-4 ring-1 ring-amber-200 sm:flex-nowrap">
          <Spinner />
          <div className="min-w-0 flex-1 basis-[calc(100%-2.5rem)] sm:basis-auto">
            <p className="font-semibold">Reconnecting…</p>
            <p className="mt-0.5 text-sm text-muted text-pretty">
              Live tracking is paused. {match.stage === "en_route" ? "The arrival time and map" : "The details here"} show the last update
              {lastClock ? ` at ${lastClock}` : ""}, not where things are now.
            </p>
          </div>
          <button type="button" onClick={() => void retryLive()} disabled={!!busy} className={`${buttonSecondary} w-full shrink-0 sm:w-auto`}>
            Retry now
          </button>
        </section>
      )}

      {booked && match.stage !== "cancelled" && match.stage !== "completed" && (
        <section className="flex items-center gap-3 rounded-[24px] bg-white p-4 shadow-card ring-1 ring-line animate-question">
          <Avatar tradie={booked.tradie} size="size-12" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{booked.tradie.name}</p>
            <p className="mt-0.5 flex items-center gap-2 text-sm text-muted">
              <Stars rating={booked.tradie.rating} count={booked.tradie.reviewCount} />
              <span aria-hidden>·</span>
              <span className="truncate">{booked.tradie.business}</span>
            </p>
          </div>
          {price !== null && <p className="text-lg font-semibold tabular-nums">{money(price)}</p>}
        </section>
      )}

      {match.stage === "searching" && (
        <Quotes match={match} busy={!!busy} onBook={(offerId) => void act("choose", "/match/choose", { offerId })} />
      )}

      {booked && (match.canMessage || match.messages.length > 0) && (
        <button type="button" onClick={() => setChatOpen(true)} className={`${buttonSecondary} w-full`}>
          <Icon d={icons.chat} />
          {match.canMessage ? `Send a message to ${name}` : "View messages"}
          {match.messages.length > 0 && <span className="text-sm font-normal text-muted">· {match.messages.length}</span>}
        </button>
      )}

      {chatOpen && booked && (
        <MessageThread
          match={match}
          writeUp={writeUp}
          tradie={booked.tradie}
          onClose={() => setChatOpen(false)}
          onSend={async (text) => {
            setMatch(await api<MatchState>(`/jobs/${session.id}/messages`, { method: "POST", token: session.token, json: { text } }));
          }}
        />
      )}

      {match.stage === "completed" && booked && (
        <Completion session={session} state={state} match={match} booked={booked} onReviewed={setMatch} />
      )}

      {match.stage !== "cancelled" && match.stage !== "no_match" && match.stage !== "scheduled" && match.stage !== "completed" && (
        <Tracking match={match} worker={worker} name={name} contacted={contacted} staleAt={stale ? lastClock ?? "" : null} />
      )}

      {error && <p role="alert" className="text-sm text-danger">{error}</p>}

      {match.stage === "no_match" && (
        <div className="space-y-3">
          {fasterTier && (
            <RetryOffer
              match={match}
              writeUp={writeUp}
              tier={fasterTier}
              busy={!!busy}
              heading={`Try ${TIER_INFO[fasterTier].label}`}
              onRetry={() => void act("retry", "/match/retry", { tier: fasterTier })}
            />
          )}
          <div>
            <button type="button" onClick={() => void scheduleLater()} disabled={!!busy} aria-describedby="save-note" className={`${buttonSecondary} w-full`}>
              {busy === "schedule" && <Spinner />}
              Save for later
            </button>
            <p id="save-note" className="mt-2 text-center text-sm text-muted text-pretty">
              Saving doesn&rsquo;t book anyone or keep searching. Reopen it from home to search again.
            </p>
          </div>
        </div>
      )}

      {match.stage === "scheduled" && (
        <div className="space-y-3">
          <RetryOffer
            match={match}
            writeUp={writeUp}
            tier={match.tier}
            busy={!!busy}
            heading="Search again"
            onRetry={() => void act("retry", "/match/retry", { tier: match.tier })}
          />
          <button type="button" onClick={() => onScheduled(match.date)} disabled={!!busy} className={`${buttonSecondary} w-full`}>
            Keep it saved, not booked
          </button>
        </div>
      )}

      <div className="flex flex-col items-center gap-2">
        {showCancel && (
          <button type="button" onClick={() => void act("cancel", "/match/cancel")} disabled={!!busy} className={buttonQuiet}>
            {match.stage === "matched"
              ? `Cancel for free${cancelLeft !== null ? ` · ${Math.floor(cancelLeft / 60)}:${String(cancelLeft % 60).padStart(2, "0")} left` : ""}`
              : "Cancel job"}
          </button>
        )}
        {(match.stage === "completed" || match.stage === "cancelled") && (
          <button type="button" onClick={onNewJob} className={`${buttonSecondary} w-full`}>
            Post another job
          </button>
        )}
        {match.demo && live && (
          <p className="mt-2 flex items-center gap-2 text-xs text-faint">
            <span className="rounded-full bg-surface px-2 py-0.5 font-semibold">Sample tradies</span>
            {/* Presenter only (see useDemoControls): move to the next stage now. */}
            {/* A live tradie moves their own job, so Next stage is theirs alone. */}
            {demoControls.on && (match.stage === "searching" || !match.liveTradie) && (
              <button type="button" onClick={() => void act("advance", "/match/advance")} disabled={!!busy} className="font-semibold underline underline-offset-2 hover:text-muted">
                {match.stage === "searching" ? "Skip ahead" : "Next stage"}
              </button>
            )}
            {/* Demo: make this search end in no match (or put "#nomatch" in the description). */}
            {demoControls.on && match.stage === "searching" && (
              <button type="button" onClick={() => void act("no-match", "/match/demo-no-match")} disabled={!!busy} className="font-semibold underline underline-offset-2 hover:text-muted">
                No one accepts
              </button>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
