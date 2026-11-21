"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
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
import { BottomSheet } from "./bottom-sheet";
import { buttonPrimary, buttonSecondary, ErrorNote, Icon, icons, linkButton, Stepper, TapeLoader, Walking } from "./ui";

/** Stages where the match changes on its own, so the screen follows it live. */
const isLive = (match: MatchState) => ["searching", "matched", "en_route", "in_progress"].includes(match.stage);

type Session = { id: string; token: string; uploadToken: string };

const money = (n: number) => `$${n.toLocaleString("en-AU")}`;
const firstName = (t: TradieCard) => t.name.split(" ")[0] ?? t.name;

// --- Bits ---------------------------------------------------------------------

/** Initials in a glass circle (no photos for tradies yet). Monochrome: no colour per tradie. */
export function Avatar({ tradie, size = "size-11" }: { tradie: TradieCard; size?: string }) {
  const initials = tradie.name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("");
  return (
    <span aria-hidden className={`lw-initials ${size}`}>
      {initials}
    </span>
  );
}

/** The rating in ink: stars are never yellow (under 3:1 on light glass). */
export function Stars({ rating, count }: { rating: number; count?: number }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Icon name="star" fill className="size-3.5 text-ink" />
      <span className="font-semibold text-ink tabular-nums">{rating.toFixed(1)}</span>
      {count !== undefined && <span className="tabular-nums">({count})</span>}
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
    <section aria-label="Quotes" className="space-y-2.5 animate-question">
      <p className="lw-caption text-muted" aria-live="polite">
        {left !== null && left > 0
          ? `More quotes may arrive. We'll book the recommended one in ${left}s unless you choose.`
          : "Booking the recommended quote…"}
      </p>
      <ul className="lw-stack">
        {quotes.map((o) => {
          const recommended = o.id === match.recommendedOfferId;
          return (
            <li key={o.id} className={`lw-inner lw-option ${recommended ? "shadow-[inset_0_0_0_2px_var(--lw-selected)]" : ""}`}>
              <div className="flex items-center gap-3">
                <Avatar tradie={o.tradie} />
                <div className="min-w-0 flex-1">
                  <p className="lw-headline">{o.tradie.name}</p>
                  <p className="lw-caption mt-0.5 flex items-center gap-2 text-muted">
                    <Stars rating={o.tradie.rating} count={o.tradie.reviewCount} />
                    <span aria-hidden>·</span>
                    <span className="truncate">{o.tradie.business}</span>
                  </p>
                </div>
                <p className="lw-title-3 tabular-nums">{money(o.quote!)}</p>
              </div>
              {o.note && <p className="lw-inner lw-caption mt-3 px-3.5 py-3 text-pretty">{o.note}</p>}
              <div className="mt-3 flex items-center justify-between gap-3">
                {recommended ? (
                  <span className="lw-tag">
                    <Icon name="sparkle" fill className="size-3" />
                    Recommended
                  </span>
                ) : (
                  <span />
                )}
                <button
                  type="button"
                  onClick={() => onBook(o.id)}
                  disabled={busy}
                  className={`${recommended ? buttonPrimary : buttonSecondary} lw-btn--compact`}
                >
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

/**
 * Marks the page while a scene (the map, the booked photo) or the messages
 * cover it: the page behind stops scrolling and rubber-banding, and the top
 * bar's glass goes dark on the photo (app/styles/match.css).
 */
function useSceneLock(scene: "map" | "photo" | "messages" | null) {
  useEffect(() => {
    const root = document.documentElement;
    if (!scene) return;
    root.dataset.lwScene = scene;
    return () => {
      delete root.dataset.lwScene;
    };
  }, [scene]);
}

/**
 * The visible part of the screen, which shrinks when the on-screen keyboard
 * opens (iOS Safari doesn't resize the layout for it). The messages page
 * follows it so the composer stays just above the keyboard.
 */
function useVisualViewport(el: RefObject<HTMLElement | null>) {
  const [keyboard, setKeyboard] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    const node = el.current;
    if (!vv || !node) return;
    const update = () => {
      node.style.setProperty("--lw-vv-top", `${vv.offsetTop}px`);
      node.style.setProperty("--lw-vv-height", `${vv.height}px`);
      setKeyboard(window.innerHeight - vv.height > 120);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, [el]);
  return keyboard;
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
  const root = useRef<HTMLDivElement>(null);
  const keyboard = useVisualViewport(root);
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
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label={`Messages with ${tradie.name}`}
      className="lw-messages"
      data-keyboard={keyboard || undefined}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="lw-messages__panel">
        <div className="lw-backdrop absolute" aria-hidden>
          <div className="lw-bg lw-bg--blur">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/photos/hands-pipe.jpg" alt="" style={{ objectPosition: "50% 40%" }} />
          </div>
        </div>
        <header className="lw-messages__head lw-glass lw-glass--bar relative z-[1] flex items-center gap-3 px-3">
          <button type="button" onClick={onClose} aria-label="Back" className="lw-icon-btn">
            <Icon name={icons.back} />
          </button>
          <Avatar tradie={tradie} size="size-10" />
          <div className="min-w-0">
            <p className="lw-headline truncate">{tradie.name}</p>
            <p className="lw-footnote truncate text-faint">{tradie.business}</p>
          </div>
        </header>

        <div className="lw-messages__list relative px-3.5">
          <div className="lw-stack">
            {/* The confirmed job, pinned so both sides know what was agreed. */}
            <section aria-label="Your job" className="lw-glass p-4">
              <div className="flex items-baseline justify-between gap-3">
                <p className="lw-headline">{writeUp.title}</p>
                <p className="lw-headline shrink-0 tabular-nums">{price ? money(price) : formatPriceRange(match.price)}</p>
              </div>
              <p className="lw-caption mt-1 text-muted text-pretty">{writeUp.summary}</p>
              {writeUp.details.length > 0 && (
                <dl className="mt-2">
                  {writeUp.details.map((d) => (
                    <div key={d.label} className="lw-kv py-2">
                      <dt className="lw-kv__k">{d.label}</dt>
                      <dd className="lw-kv__v min-w-0">{d.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
              <p className="lw-footnote mt-2 text-faint">
                {[writeUp.location, match.whenLabel ?? match.date].filter(Boolean).join(" · ")} · Price locked
              </p>
            </section>

            {match.messages.length === 0 && (
              <p className="lw-caption px-4 py-6 text-center text-muted text-pretty">
                Let {name} know how to get in, where to park, or anything else that helps.
              </p>
            )}

            {match.messages.map((m: JobMessage) => {
              const mine = m.author === "customer";
              return (
                <div key={m.id} className={`lw-bubble animate-fade-in ${mine ? "lw-bubble--out" : "lw-glass lw-bubble--in"}`}>
                  <p className="whitespace-pre-wrap break-words">{m.text}</p>
                  <p className={`lw-footnote mt-0.5 text-right tabular-nums ${mine ? "opacity-75" : "text-faint"}`}>{clockTime(m.createdAt)}</p>
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
          className="lw-messages__composer relative"
        >
          {error && <ErrorNote className="mb-2 px-2">{error}</ErrorNote>}
          {match.canMessage ? (
            <div className="lw-glass lw-composer h-auto min-h-14 rounded-[28px] py-1.5">
              <label htmlFor="message" className="sr-only">
                Message {name}
              </label>
              <textarea
                id="message"
                rows={1}
                value={text}
                maxLength={MESSAGE_MAX}
                onChange={(e) => setText(e.target.value)}
                onFocus={() => setTimeout(() => end.current?.scrollIntoView({ block: "end" }), 300)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void submit();
                  }
                }}
                enterKeyHint="send"
                placeholder={`Message ${name}`}
                className="lw-placeholder lw-callout field-sizing-content max-h-32 min-w-0 flex-1 resize-none bg-transparent py-2 outline-none"
              />
              <button
                type="submit"
                disabled={sending || !text.trim()}
                aria-label={sending ? "Sending" : "Send"}
                className="lw-icon-btn lw-icon-btn--accent lw-press disabled:bg-[var(--lw-glass-inner)] disabled:text-disabled"
              >
                <Icon name={icons.send} fill />
              </button>
            </div>
          ) : (
            <p className="lw-caption text-center text-muted">
              {match.stage === "cancelled" ? "This job was cancelled, so messaging is closed." : "This job is done, so messaging is closed."}
            </p>
          )}
        </form>
      </div>
    </div>
  );
}

// --- Tracking ---------------------------------------------------------------------

const clock = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" }) : null);

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
    <ol aria-label="Job progress">
      {steps.map((step, i) => {
        const isDone = done(i);
        const isCurrent = i === current;
        return (
          <li key={step.key} className="lw-status items-start" aria-current={isCurrent ? "step" : undefined}>
            <span aria-hidden className={`lw-dot mt-px ${isDone ? "lw-dot--done" : isCurrent ? "lw-dot--now" : "lw-dot--wait opacity-60"}`}>
              {isDone && <Icon name={icons.check} className="size-3" />}
            </span>
            <div className="min-w-0">
              <div className="flex items-baseline justify-between gap-3">
                <p className={isDone || isCurrent ? "font-semibold text-ink" : "text-faint"}>{step.label}</p>
                {(isDone || isCurrent) && clock(step.at) && <p className="lw-footnote shrink-0 text-faint tabular-nums">{clock(step.at)}</p>}
              </div>
              {isCurrent && step.detail && <p className="lw-caption mt-0.5 text-muted">{step.detail}</p>}
              {isCurrent && step.key === "finding" && match.stage === "searching" && (
                <p className="lw-footnote mt-0.5 text-faint">Usually takes a minute or two</p>
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
  searching = false,
  heading,
  onRetry,
}: {
  match: MatchState;
  writeUp: JobWriteUp;
  tier: Tier;
  busy: boolean;
  /** This retry is under way: the label says so instead of a spinner. */
  searching?: boolean;
  heading: string;
  onRetry: () => void;
}) {
  const nowMs = Date.now();
  const next = whenLabel(retryWhen(match, tier, nowMs), nowMs);
  const current = whenLabel(match.when, nowMs);
  const range = formatPriceRange(writeUp.prices[tier]);
  const moves = next !== current;
  return (
    <section aria-label={heading} className="lw-glass p-[18px]">
      <p className="lw-title-3">{heading}</p>
      <p className="lw-caption mt-1 text-muted text-pretty">
        {moves ? `Needed ${midSentence(next)} instead of ${midSentence(current)}. ` : `Needed ${midSentence(next)}. `}
        The price range locks at {range}.
      </p>
      <button type="button" onClick={onRetry} disabled={busy} className={`${buttonPrimary} mt-4 w-full`}>
        {searching ? "Searching…" : `Search again · ${range}`}
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
  // Booked, not driving yet: the booked card (S07) until "Track" opens the map.
  const [tracking, setTracking] = useState(false);
  // What the sheet covers, so the map keeps the pins clear of it.
  const [mapInset, setMapInset] = useState<{ bottom: number; left: number } | undefined>(undefined);
  const quoteCount = match ? match.offers.filter((o) => o.response === "accepted" && o.quote !== null).length : 0;
  const scene: "map" | "photo" | null = !match
    ? null
    : match.stage === "searching" || match.stage === "en_route" || match.stage === "in_progress" || (match.stage === "matched" && tracking)
      ? "map"
      : match.stage === "matched" && match.booked
        ? "photo"
        : null;
  useSceneLock(scene ?? (chatOpen ? "messages" : null));

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
      <div className="lw-page animate-question pt-4" role="alert">
        <div className="lw-glass is-error p-[18px]">
          <h1 className="lw-title-2">We couldn&rsquo;t load your job</h1>
          <p className="lw-caption mt-1.5 font-semibold text-pretty">{error} Your job is still posted; trying again won&rsquo;t send it twice.</p>
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
  // Hide the button the moment the countdown runs out, before the next update arrives.
  const showCancel = match.canCancel && !(match.stage === "matched" && cancelLeft === 0);
  const price = booked?.quote ?? null;
  // A live tradie's real position: say so when it's missing or old.
  const liveWhere = liveLocationText(match);
  const lastClock = updatedAt ? clock(new Date(updatedAt).toISOString()) : null;
  const needed = match.whenLabel ? `Needed ${match.when.asap ? "ASAP" : match.whenLabel}` : null;

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
    match.stage === "no_match"
      ? `We asked every ${worker} within 20 km and nobody could take it. ${fasterTier ? "Try a faster option, or save it and search again later." : "Save it and search again when it suits."}`
      : match.stage === "scheduled"
        ? `${writeUp.title}. No ${worker} is booked and we won't search again on our own. Start a new search when you're ready.`
        : match.stage === "matched"
          ? "Getting ready to head over"
          : match.stage === "en_route" && liveWhere
            ? liveWhere
            : match.stage === "en_route" && match.etaMinutes !== null
              ? stale
                ? `Last known: about ${match.etaMinutes} min away${lastClock ? ` at ${lastClock}` : ""}`
                : `Arriving in about ${match.etaMinutes} min`
              : match.stage === "cancelled"
                ? "No charge. You can post it again any time."
                : writeUp.title;

  // The job's own stepper once someone is booked: Booked › On the way › Arrived › Done.
  const jobStep =
    match.stage === "matched" ? 0 : match.stage === "en_route" ? 1 : match.stage === "in_progress" ? 2 : match.stage === "completed" ? 3 : null;
  const searching = match.stage === "searching";
  const cancelLabel =
    match.stage === "matched" || (booked && cancelLeft !== null)
      ? `Cancel for free${cancelLeft !== null ? ` · ${Math.floor(cancelLeft / 60)}:${String(cancelLeft % 60).padStart(2, "0")} left` : ""}`
      : searching
        ? "Cancel request"
        : "Cancel job";
  const cancel = showCancel ? (
    <CancelControl label={cancelLabel} searching={searching} link={!searching} busy={!!busy} onCancel={() => void act("cancel", "/match/cancel")} />
  ) : null;

  const errorNote = error && (
    <div role="alert" className="lw-inner px-3.5 py-3 shadow-[inset_0_0_0_2px_var(--lw-error-ring)]">
      <ErrorNote>{error}</ErrorNote>
    </div>
  );

  const demoRow = match.demo && live && (
    <div className="flex flex-wrap items-center gap-2">
      <span className="lw-badge text-muted">Sample tradies</span>
      {/* Presenter only (see useDemoControls): move to the next stage now. */}
      {/* A live tradie moves their own job, so Next stage is theirs alone. */}
      {demoControls.on && (match.stage === "searching" || !match.liveTradie) && (
        <button
          type="button"
          onClick={() => void act("advance", "/match/advance")}
          disabled={!!busy}
          className={`${buttonSecondary} lw-btn--compact`}
        >
          {match.stage === "searching" ? "Skip ahead" : "Next stage"}
        </button>
      )}
      {/* Demo: make this search end in no match (or put "#nomatch" in the description). */}
      {demoControls.on && match.stage === "searching" && (
        <button
          type="button"
          onClick={() => void act("no-match", "/match/demo-no-match")}
          disabled={!!busy}
          className={`${buttonSecondary} lw-btn--compact`}
        >
          No one accepts
        </button>
      )}
    </div>
  );

  const messageButton = booked && (match.canMessage || match.messages.length > 0) && (
    <button type="button" onClick={() => setChatOpen(true)} className={`${buttonSecondary} w-full`}>
      <Icon name={icons.chat} />
      {match.canMessage ? `Message ${name}` : "View messages"}
      {match.messages.length > 0 && <span className="text-muted tabular-nums">· {match.messages.length}</span>}
    </button>
  );

  const thread = chatOpen && booked && (
    <MessageThread
      match={match}
      writeUp={writeUp}
      tradie={booked.tradie}
      onClose={() => setChatOpen(false)}
      onSend={async (text) => {
        setMatch(await api<MatchState>(`/jobs/${session.id}/messages`, { method: "POST", token: session.token, json: { text } }));
      }}
    />
  );

  // --- The map with its sheet (S05b while searching, S08 once booked) ---
  if (scene === "map") {
    return (
      <>
        <div className="lw-scene">
          <LiveMap
            fill
            match={match}
            location={writeUp.location}
            stale={stale}
            inset={mapInset}
            onBack={match.stage === "matched" ? () => setTracking(false) : undefined}
          >
            {stale && live && (
              <section
                role="status"
                className="lw-scene__notice lw-glass is-error flex items-center gap-3 rounded-[var(--lw-radius-lg)] py-2.5 pr-2 pl-3.5"
              >
                <Icon name={icons.warningCircle} className="size-5 shrink-0 self-start mt-0.5" />
                <div className="min-w-0 flex-1">
                  <p className="lw-subhead font-bold">Reconnecting…</p>
                  <p className="lw-footnote mt-0.5 text-muted text-pretty">
                    Live tracking is paused. {match.stage === "en_route" ? "The arrival time and map" : "The details here"} show the last update
                    {lastClock ? ` at ${lastClock}` : ""}, not where things are now.
                  </p>
                </div>
                <button type="button" onClick={() => void retryLive()} disabled={!!busy} className={`${buttonSecondary} lw-btn--compact shrink-0`}>
                  {busy === "reconnect" ? "Retrying…" : "Retry now"}
                </button>
              </section>
            )}
          </LiveMap>

          <BottomSheet key={searching ? "request" : "live"} label={searching ? "Your request" : "Your booking"} onSettle={setMapInset}>
            {searching ? (
              <>
                <div onClick={demoControls.tap}>
                  <h1 className="lw-title-2">{title}</h1>
                  <p className="lw-caption mt-1 text-muted">{[writeUp.title, needed].filter(Boolean).join(" · ")}</p>
                </div>
                <TapeLoader />
                <ul aria-label="Request status" aria-live="polite">
                  <StatusRow done={contacted > 0}>
                    {contacted > 0 ? `Sent to ${contacted} ${worker}${contacted === 1 ? "" : "s"} nearby` : `Sending your job to ${worker}s nearby`}
                  </StatusRow>
                  {match.radiusKm > 5 && <StatusRow done>Still looking. We&rsquo;ve widened the search to {match.radiusKm} km.</StatusRow>}
                  {match.tier === "high" ? (
                    <StatusRow done={false}>Waiting for a yes…</StatusRow>
                  ) : quoteCount === 0 ? (
                    <StatusRow done={false}>Waiting for quotes…</StatusRow>
                  ) : (
                    <StatusRow done>{quoteCount === 1 ? "1 quote in" : `${quoteCount} quotes in`}</StatusRow>
                  )}
                </ul>
                <Quotes match={match} busy={!!busy} onBook={(offerId) => void act("choose", "/match/choose", { offerId })} />
                <div className="lw-divider" />
                <div>
                  <p className="lw-callout flex items-start gap-2.5 tabular-nums">
                    <Icon name={icons.receipt} className="mt-px size-5 shrink-0" />
                    <span>
                      <span className="font-semibold">{formatPriceRange(match.price)} locked</span>
                      <span className="text-muted"> · nothing charged yet</span>
                    </span>
                  </p>
                  <p className="lw-footnote mt-1.5 text-faint">
                    {match.tier === "high" ? "The first to accept gets the job." : "We'll recommend the best quote."} Usually takes a minute or two.
                  </p>
                </div>
                {cancel}
              </>
            ) : (
              <>
                <div className="flex items-start gap-3" onClick={demoControls.tap}>
                  <div className="min-w-0 flex-1">
                    <h1 className="lw-title-2">{title}</h1>
                    <p className="lw-callout mt-1 text-muted text-pretty">{subtitle}</p>
                    {needed && <p className="lw-footnote mt-1 text-faint">{needed}</p>}
                  </div>
                  {match.stage === "en_route" && match.etaMinutes !== null && (
                    <p
                      className="shrink-0 text-right"
                      aria-label={stale ? `Last known, about ${match.etaMinutes} minutes away. Not live.` : `About ${match.etaMinutes} minutes away`}
                    >
                      <span className={`lw-title-2 block tabular-nums ${stale ? "text-faint" : ""}`}>{match.etaMinutes} min</span>
                      <span className="lw-footnote text-faint">{stale ? "not live" : "away"}</span>
                    </p>
                  )}
                </div>
                {jobStep !== null && <Stepper steps={["Booked", "On the way", "Arrived", "Done"]} current={jobStep} />}
                <div className="lw-divider" />
                {booked && <TradieRow tradie={booked.tradie} price={price} />}
                {messageButton}
                {cancel}
                <Tracking match={match} worker={worker} name={name} contacted={contacted} staleAt={stale ? (lastClock ?? "") : null} />
              </>
            )}
            {errorNote}
            {demoRow}
          </BottomSheet>
        </div>
        {thread}
      </>
    );
  }

  // --- Booked, not driving yet (S07): the booked card on a sharp photo ---
  if (scene === "photo" && booked) {
    return (
      <>
        <div className="lw-scene lw-scene--photo">
          <div className="lw-bg" aria-hidden>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/photos/hands-spanner.jpg" alt="" style={{ objectPosition: "50% 40%" }} />
          </div>
          <div className="lw-shade" aria-hidden />
          <div className="lw-scene__scroll">
            <section aria-labelledby="booked-title" className="lw-booked lw-glass lw-tape-top flex flex-col gap-3.5 px-[18px] pt-[26px] pb-[18px]">
              <div className="flex items-center gap-3.5" onClick={demoControls.tap}>
                <span className="lw-done-badge" aria-hidden>
                  <Icon name={icons.check} className="size-6" />
                </span>
                <h1 id="booked-title" className="lw-title-1" aria-live="polite">
                  You&rsquo;re booked.
                </h1>
              </div>
              <p className="lw-callout text-muted text-pretty">
                {name} accepted your job and is getting ready. We&rsquo;ll message you when {name} is on the way.
              </p>
              <div className="lw-inner px-3.5 py-1">
                <TradieRow tradie={booked.tradie} price={price} />
              </div>
              <p className="lw-footnote flex justify-between gap-3 text-muted tabular-nums">
                <span>{price !== null ? `${money(price)} quoted · price locked` : `Price locked at ${formatPriceRange(match.price)}`}</span>
                {match.whenLabel && <span className="text-right">{match.when.asap ? "ASAP" : match.whenLabel}</span>}
              </p>
              <button type="button" onClick={() => setTracking(true)} className={`${buttonPrimary} w-full`}>
                Track {name}
              </button>
              {messageButton}
              {cancel}
              {errorNote}
              {demoRow}
            </section>
          </div>
        </div>
        {thread}
      </>
    );
  }

  // --- After the search or the job: no match, saved, done, cancelled ---
  return (
    <>
      <div className="lw-page animate-question pt-2">
        <div className="px-2 pt-2 pb-1">
          {/* Five quick taps on the heading toggle the presenter's demo controls. */}
          <h1 onClick={demoControls.tap} className="lw-title-1">
            {title}
          </h1>
          {match.stage !== "completed" && <p className="lw-callout mt-1.5 text-muted text-pretty">{subtitle}</p>}
          {match.stage === "completed" && <Stepper className="mt-3" steps={["Booked", "On the way", "Arrived", "Done"]} current={3} />}
        </div>

        {match.stage === "completed" && booked && (
          <>
            <Completion session={session} state={state} match={match} booked={booked} onReviewed={setMatch} />
            {messageButton}
          </>
        )}

        {errorNote}

        {match.stage === "no_match" && (
          <div className="lw-stack">
            {fasterTier && (
              <RetryOffer
                match={match}
                writeUp={writeUp}
                tier={fasterTier}
                busy={!!busy}
                searching={busy === "retry"}
                heading={`Try ${TIER_INFO[fasterTier].label}`}
                onRetry={() => void act("retry", "/match/retry", { tier: fasterTier })}
              />
            )}
            <div>
              <button
                type="button"
                onClick={() => void scheduleLater()}
                disabled={!!busy}
                aria-describedby="save-note"
                className={`${buttonSecondary} w-full`}
              >
                {busy === "schedule" ? "Saving…" : "Save for later"}
              </button>
              <p id="save-note" className="lw-footnote mt-2 px-4 text-center text-muted text-pretty">
                Saving doesn&rsquo;t book anyone or keep searching. Reopen it from home to search again.
              </p>
            </div>
          </div>
        )}

        {match.stage === "scheduled" && (
          <div className="lw-stack">
            <RetryOffer
              match={match}
              writeUp={writeUp}
              tier={match.tier}
              busy={!!busy}
              searching={busy === "retry"}
              heading="Search again"
              onRetry={() => void act("retry", "/match/retry", { tier: match.tier })}
            />
            <button type="button" onClick={() => onScheduled(match.date)} disabled={!!busy} className={`${buttonSecondary} w-full`}>
              Keep it saved, not booked
            </button>
          </div>
        )}

        <div className="flex flex-col items-center gap-2">
          {cancel}
          {(match.stage === "completed" || match.stage === "cancelled") && (
            // Cancelled, or done and reviewed: the only way on, so it's the yellow pill. Otherwise the review's button is.
            <button
              type="button"
              onClick={onNewJob}
              className={`${match.stage === "cancelled" || match.review ? buttonPrimary : buttonSecondary} w-full`}
            >
              Post another job
            </button>
          )}
        </div>
      </div>
      {thread}
    </>
  );
}

/** One line of the request's status: a yellow tick when done, an empty ring while waiting. */
function StatusRow({ done, children }: { done: boolean; children: ReactNode }) {
  return (
    <li className="lw-status">
      <span aria-hidden className={`lw-dot ${done ? "lw-dot--done" : "lw-dot--wait"}`}>
        {done && <Icon name={icons.check} className="size-3" />}
      </span>
      <span>
        <span className="sr-only">{done ? "Done: " : "Waiting: "}</span>
        {children}
      </span>
    </li>
  );
}

/** The booked tradie: initials, name, rating and business, and the price. */
function TradieRow({ tradie, price }: { tradie: TradieCard; price: number | null }) {
  return (
    <div className="lw-li">
      <Avatar tradie={tradie} />
      <div className="min-w-0 flex-1">
        <p className="lw-headline truncate">{tradie.name}</p>
        <p className="lw-caption mt-0.5 flex items-center gap-2 text-muted">
          <Stars rating={tradie.rating} count={tradie.reviewCount} />
          <span aria-hidden>·</span>
          <span className="truncate">{tradie.business}</span>
        </p>
      </div>
      {price !== null && <p className="lw-title-3 shrink-0 tabular-nums">{money(price)}</p>}
    </div>
  );
}

/**
 * Cancel, asked once more before it goes (S05b: "Cancel this request?").
 * A secondary pill while searching, a link once booked. Never red.
 */
function CancelControl({
  label,
  searching,
  link,
  busy,
  onCancel,
}: {
  label: string;
  searching: boolean;
  link: boolean;
  busy: boolean;
  onCancel: () => void;
}) {
  const [asking, setAsking] = useState(false);
  if (asking) {
    return (
      <div role="alertdialog" aria-labelledby="cancel-title" aria-describedby="cancel-body" className="lw-inner w-full animate-fade-in p-4">
        <p id="cancel-title" className="lw-headline">
          {searching ? "Cancel this request?" : "Cancel this job?"}
        </p>
        <p id="cancel-body" className="lw-caption mt-0.5 text-muted">
          {searching ? "Nothing has been charged." : "It's free while the countdown runs."}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" autoFocus onClick={() => setAsking(false)} className={`${buttonSecondary} lw-btn--compact`}>
            {searching ? "Keep waiting" : "Keep it"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setAsking(false);
              onCancel();
            }}
            className={`${buttonSecondary} lw-btn--compact font-semibold`}
          >
            {searching ? "Cancel request" : "Cancel job"}
          </button>
        </div>
      </div>
    );
  }
  return link ? (
    <button
      type="button"
      onClick={() => setAsking(true)}
      disabled={busy}
      className={`${linkButton} mx-auto inline-flex min-h-11 items-center tabular-nums`}
    >
      {label}
    </button>
  ) : (
    <button type="button" onClick={() => setAsking(true)} disabled={busy} className={`${buttonSecondary} w-full tabular-nums`}>
      {label}
    </button>
  );
}
