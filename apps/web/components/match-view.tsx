"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  TIER_INFO,
  tradeInfo,
  type JobState,
  type MatchOffer,
  type MatchState,
  type Tier,
  type TradieCard,
} from "@legwork/shared";
import { api } from "@/lib/api";
import { LiveMap } from "./live-map";
import { priceRange } from "./job-ready";
import { article, buttonPrimary, buttonQuiet, buttonSecondary, cardClass, fieldClass, Icon, icons, Spinner, Walking } from "./ui";

type Session = { id: string; token: string };

const money = (n: number) => `$${n.toLocaleString("en-AU")}`;
const firstName = (t: TradieCard) => t.name.split(" ")[0] ?? t.name;

// --- Bits ---------------------------------------------------------------------

const AVATAR_COLOURS = ["#245fd9", "#12805c", "#b54708", "#7a3fd6", "#c0362c", "#0e7490"];

function Avatar({ tradie, size = "size-11" }: { tradie: TradieCard; size?: string }) {
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

function Stars({ rating, count }: { rating: number; count?: number }) {
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

function ReviewForm({ name, onSubmit }: { name: string; onSubmit: (stars: number, text: string) => Promise<void> }) {
  const [stars, setStars] = useState(0);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!stars) return setError("Tap a star to rate.");
        setSaving(true);
        setError(null);
        try {
          await onSubmit(stars, text);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setSaving(false);
        }
      }}
      className="space-y-3"
    >
      <p className="font-semibold">How did {name} go?</p>
      <div className="flex gap-1" role="radiogroup" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={stars === n}
            aria-label={`${n} star${n === 1 ? "" : "s"}`}
            onClick={() => setStars(n)}
            className={`text-4xl leading-none transition-transform hover:scale-110 ${n <= stars ? "text-amber-500" : "text-line"}`}
          >
            ★
          </button>
        ))}
      </div>
      <label htmlFor="review" className="sr-only">
        Review
      </label>
      <textarea
        id="review"
        rows={3}
        value={text}
        maxLength={1000}
        onChange={(e) => setText(e.target.value)}
        placeholder="A few words for the next customer (optional)"
        className={`${fieldClass} resize-none`}
      />
      {error && <p className="text-sm text-danger">{error}</p>}
      <button type="submit" disabled={saving} className={`${buttonPrimary} w-full`}>
        {saving && <Spinner />}
        Post review
      </button>
    </form>
  );
}

// --- Tracking ---------------------------------------------------------------------

const clock = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" }) : null;

/**
 * Parcel-style tracking: each step of the job with the time it happened. The
 * current step pulses; steps still to come are greyed out.
 */
function Tracking({ match, worker, name, contacted }: { match: MatchState; worker: string; name: string; contacted: number }) {
  const t = match.timeline;
  const generic = `${article(worker)} ${worker}`;
  const who = name || generic.charAt(0).toUpperCase() + generic.slice(1);
  const bids = match.offers.filter((o) => o.response === "accepted" && o.quote !== null).length;
  const steps = [
    { key: "posted", label: "Job posted", detail: priceRange(match.price), at: t.posted },
    {
      key: "finding",
      label: t.accepted ? "Tradie found" : `Finding ${article(worker)} ${worker}`,
      detail: t.accepted
        ? null
        : bids > 0
          ? `${bids} bid${bids === 1 ? "" : "s"} in — comparing`
          : contacted > 0
            ? `Waiting for one of ${contacted} nearby to accept`
            : "Sending to tradies nearby",
      at: t.accepted ? t.posted : null,
    },
    { key: "accepted", label: `${who} accepted`, detail: null, at: t.accepted },
    { key: "onTheWay", label: "On the way", detail: match.etaMinutes !== null ? `About ${match.etaMinutes} min away` : null, at: t.onTheWay },
    { key: "working", label: "Working on it", detail: null, at: t.working },
    { key: "done", label: "Done", detail: null, at: t.done },
  ];
  // The step in progress is the first one without a time.
  const done = (i: number) => (i === 1 ? !!t.accepted : !!steps[i]!.at);
  const current = steps.findIndex((_, i) => !done(i));

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
                {isDone && clock(step.at) && <p className="shrink-0 text-sm text-faint tabular-nums">{clock(step.at)}</p>}
              </div>
              {isCurrent && step.detail && <p className="mt-0.5 text-sm text-muted">{step.detail}</p>}
              {isCurrent && step.key === "finding" && (
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
}: {
  session: Session;
  state: JobState;
  initial: MatchState | null;
  onNewJob: () => void;
}) {
  const [match, setMatch] = useState<MatchState | null>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const writeUp = state.job.writeUp!;
  const worker = tradeInfo(writeUp.trade).worker;
  const live = match && ["searching", "matched", "en_route", "in_progress"].includes(match.stage);
  const cancelLeft = useCountdown(match?.canCancel && match.stage !== "searching" && match.stage !== "no_match" ? match.cancelUntil : null);

  const refresh = useCallback(async () => {
    try {
      setMatch(await api<MatchState>(`/jobs/${session.id}/match`, { token: session.token }));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [session]);

  // Poll while something is happening.
  const liveRef = useRef(live);
  liveRef.current = live;
  useEffect(() => {
    if (!initial) void refresh();
    const timer = setInterval(() => {
      if (liveRef.current && !document.hidden) void refresh();
    }, 1500);
    return () => clearInterval(timer);
  }, [refresh, initial]);

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

  if (!match) return <Walking label="Finding tradies near you…" className="mt-6" />;

  const contacted = match.offers.filter((o) => o.response !== "withdrawn").length;
  const bids = match.offers.filter((o) => o.response === "accepted" && o.quote !== null);
  const booked = match.booked;
  // Legwork's own verdict on the bids, from Algorithm 2 (see shared/recommend).
  const pick = match.recommended;
  const name = booked ? firstName(booked.tradie) : "";
  const fasterTier: Tier | null = match.tier === "low" ? "medium" : match.tier === "medium" ? "high" : null;
  const onTheWay = match.stage === "en_route";
  const price = booked?.quote ?? null;

  const title =
    match.stage === "searching"
      ? `Finding your ${worker}`
      : match.stage === "no_match"
        ? `No ${worker}s free right now`
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
        ? bids.length > 0
          ? `${bids.length} bid${bids.length === 1 ? "" : "s"} in from ${contacted} asked. Comparing them — the best one gets the job, not the fastest.`
          : `Sent to ${contacted} ${worker}${contacted === 1 ? "" : "s"} nearby. We compare the bids and pick the best fit.`
        : `Sending your job to ${worker}s nearby.`
      : match.stage === "no_match"
        ? "We asked everyone within 20 km. Try a faster option, or search again."
        : match.stage === "en_route" && match.etaMinutes !== null
          ? `Arriving in about ${match.etaMinutes} min`
          : match.stage === "cancelled"
            ? "No charge. You can post it again any time."
            : writeUp.title;

  return (
    <div className="space-y-5 animate-question">
      <div>
        <h1 className="text-[1.75rem] leading-tight font-semibold tracking-[-0.015em]">{title}</h1>
        <p className="mt-1.5 text-muted text-pretty">{subtitle}</p>
      </div>

      {/* The map only once there's someone to watch: the tradie driving over. */}
      {onTheWay && (
        <div className={`${cardClass} overflow-hidden animate-question`}>
          <LiveMap match={match} location={writeUp.location} />
        </div>
      )}

      {booked && match.stage !== "cancelled" && (
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

      {/* Why this Pro and not another one. This is the product: no wall of
          quotes, one match with a reason the customer can check. */}
      {booked && match.stage !== "cancelled" && pick && pick.offerId === booked.id && pick.reasons.length > 0 && (
        <p className="-mt-1 flex items-start gap-2 px-1 text-sm text-muted animate-question">
          <Icon d={icons.check} className="mt-0.5 size-4 shrink-0 stroke-[2.5] text-success" />
          <span>
            <span className="font-semibold text-foreground">Chosen by Legwork</span> — {pick.reasons.join(" · ")}
          </span>
        </p>
      )}

      {match.stage !== "cancelled" && match.stage !== "no_match" && (
        <Tracking match={match} worker={worker} name={name} contacted={contacted} />
      )}

      {error && <p role="alert" className="text-sm text-danger">{error}</p>}

      {match.stage === "no_match" && (
        <div className="flex flex-col gap-3 sm:flex-row">
          {fasterTier && (
            <button type="button" onClick={() => void act("retry", "/match/retry", { tier: fasterTier })} disabled={!!busy} className={`${buttonPrimary} flex-1`}>
              Try {TIER_INFO[fasterTier].label} · {priceRange(writeUp.prices[fasterTier])}
            </button>
          )}
          <button type="button" onClick={() => void act("retry", "/match/retry", { tier: match.tier })} disabled={!!busy} className={`${buttonSecondary} flex-1`}>
            Search again
          </button>
        </div>
      )}

      {match.stage === "completed" && booked && (
        <section className="rounded-[24px] bg-white p-5 shadow-card ring-1 ring-line">
          {match.review ? (
            <div className="flex items-center gap-3 text-success">
              <Icon d={icons.check} className="size-5 stroke-[2.5]" />
              <p className="font-semibold">Thanks, your {match.review.stars}-star review is posted.</p>
            </div>
          ) : (
            <ReviewForm name={name} onSubmit={(stars, text) => act("review", "/review", { stars, text })} />
          )}
        </section>
      )}

      <div className="flex flex-col items-center gap-2">
        {match.canCancel && (
          <button type="button" onClick={() => void act("cancel", "/match/cancel")} disabled={!!busy} className={buttonQuiet}>
            {match.stage === "searching" || match.stage === "no_match"
              ? "Cancel job"
              : `Cancel for free${cancelLeft !== null ? ` · ${Math.floor(cancelLeft / 60)}:${String(cancelLeft % 60).padStart(2, "0")} left` : ""}`}
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
            <button type="button" onClick={() => void act("advance", "/match/advance")} disabled={!!busy} className="font-semibold underline underline-offset-2 hover:text-muted">
              Skip ahead
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
