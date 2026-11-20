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
import { buttonPrimary, buttonQuiet, buttonSecondary, cardClass, fieldClass, Icon, icons, Spinner, Walking } from "./ui";

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

function QuoteRow({ offer, first, choosing, onChoose }: { offer: MatchOffer; first: boolean; choosing: boolean; onChoose: () => void }) {
  const t = offer.tradie;
  return (
    <li className="flex items-center gap-3 rounded-2xl bg-white p-3 pr-3.5 shadow-card ring-1 ring-line animate-question">
      <Avatar tradie={t} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 truncate font-semibold">
          {t.name}
          {first && <span className="rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-semibold text-success">Fastest</span>}
        </p>
        <p className="mt-0.5 flex items-center gap-2 text-sm text-muted">
          <Stars rating={t.rating} />
          <span aria-hidden>·</span>
          <span>{offer.distanceKm.toFixed(1)} km</span>
        </p>
      </div>
      <p className="text-lg font-semibold tabular-nums">{offer.quote !== null ? money(offer.quote) : ""}</p>
      <button type="button" onClick={onChoose} disabled={choosing} className={`${buttonPrimary} h-10 rounded-full px-4 text-sm`}>
        {choosing ? <Spinner /> : "Choose"}
      </button>
    </li>
  );
}

// --- Booked ---------------------------------------------------------------------

const STAGE_STEPS = [
  { stage: "matched", label: "Confirmed" },
  { stage: "en_route", label: "On the way" },
  { stage: "in_progress", label: "Working on it" },
  { stage: "completed", label: "Done" },
] as const;

function Timeline({ stage }: { stage: MatchState["stage"] }) {
  const current = STAGE_STEPS.findIndex((s) => s.stage === stage);
  return (
    <ol className="flex gap-2" aria-label="Job progress">
      {STAGE_STEPS.map((s, i) => (
        <li key={s.stage} className="min-w-0 flex-1" aria-current={i === current ? "step" : undefined}>
          <div className={`h-1 rounded-full ${i <= current ? "bg-brand" : "bg-line"}`} />
          <p className={`mt-2 truncate text-xs font-semibold ${i <= current ? "text-ink" : "text-faint"}`}>{s.label}</p>
        </li>
      ))}
    </ol>
  );
}

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

  const quotes = match.offers.filter((o) => o.response === "accepted").sort((a, b) => (a.respondedAt ?? "").localeCompare(b.respondedAt ?? ""));
  const contacted = match.offers.filter((o) => o.response !== "withdrawn").length;
  const booked = match.booked;
  const bookedName = booked ? firstName(booked.tradie) : "";
  const fasterTier: Tier | null = match.tier === "low" ? "medium" : match.tier === "medium" ? "high" : null;

  return (
    <div className="space-y-6 animate-question">
      {/* Headline */}
      <div>
        {match.stage === "searching" && (
          <>
            <h1 className="text-[1.75rem] leading-tight font-semibold tracking-[-0.015em]">
              {quotes.length > 0 ? "Pick your tradie" : `Finding a ${worker}`}
            </h1>
            <p className="mt-1.5 text-muted">
              {contacted > 0 ? `${contacted} nearby · ` : ""}
              {priceRange(match.price)}
            </p>
          </>
        )}
        {match.stage === "no_match" && (
          <>
            <h1 className="text-[1.75rem] leading-tight font-semibold tracking-[-0.015em]">No {worker}s free right now</h1>
            <p className="mt-2 text-muted text-pretty">We asked everyone within 20 km. Try a faster option, or search again.</p>
          </>
        )}
        {booked && match.stage !== "cancelled" && (
          <>
            <h1 className="text-[1.75rem] leading-tight font-semibold tracking-[-0.015em]">
              {match.stage === "matched" && `${bookedName} is booked`}
              {match.stage === "en_route" && `${bookedName} is on the way`}
              {match.stage === "in_progress" && `${bookedName} is on the job`}
              {match.stage === "completed" && "All done"}
            </h1>
            <p className="mt-2 text-muted">
              {match.etaMinutes !== null ? `${match.etaMinutes} min away · ` : ""}
              {money(booked.quote ?? match.price.min)}
            </p>
          </>
        )}
        {match.stage === "cancelled" && (
          <>
            <h1 className="text-[1.75rem] leading-tight font-semibold tracking-[-0.015em]">Job cancelled</h1>
            <p className="mt-2 text-muted">No charge. You can post it again any time.</p>
          </>
        )}
      </div>

      {match.stage !== "cancelled" && match.stage !== "completed" && (
        <div className={`${cardClass} overflow-hidden`}>
          <LiveMap match={match} location={writeUp.location} />
          {booked && (
            <div className="border-t border-line px-4 py-3.5">
              <Timeline stage={match.stage} />
            </div>
          )}
        </div>
      )}

      {error && <p role="alert" className="text-sm text-danger">{error}</p>}

      {/* Searching: quotes as they come in */}
      {match.stage === "searching" && (
        <section aria-label="Quotes" className="space-y-3">
          {quotes.length === 0 ? (
            <Walking label={`Asking ${worker}s nearby…`} />
          ) : (
            <ul className="space-y-3">
              {quotes.map((o, i) => (
                <QuoteRow
                  key={o.id}
                  offer={o}
                  first={i === 0}
                  choosing={busy === o.id}
                  onChoose={() => void act(o.id, "/match/choose", { offerId: o.id })}
                />
              ))}
            </ul>
          )}

        </section>
      )}

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

      {/* Booked: the tradie's card */}
      {booked && match.stage !== "cancelled" && (
        <section className="rounded-[24px] bg-white p-4 shadow-card ring-1 ring-line sm:p-5">
          <div className="flex items-center gap-3">
            <Avatar tradie={booked.tradie} size="size-12" />
            <div className="min-w-0 flex-1">
              <p className="text-lg font-semibold">{booked.tradie.name}</p>
              <div className="mt-0.5 flex items-center gap-2 text-sm text-muted">
                <Stars rating={booked.tradie.rating} count={booked.tradie.reviewCount} />
              </div>
            </div>
            <div className="text-right">
              <p className="text-xl font-semibold tabular-nums">{money(booked.quote ?? match.price.min)}</p>
              <p className="text-xs text-faint">agreed</p>
            </div>
          </div>
          {match.stage === "completed" && (
            <div className="mt-5 border-t border-line pt-5">
              {match.review ? (
                <div className="flex items-center gap-3 text-success">
                  <Icon d={icons.check} className="size-5 stroke-[2.5]" />
                  <p className="font-semibold">Thanks, your {match.review.stars}-star review is posted.</p>
                </div>
              ) : (
                <ReviewForm name={bookedName} onSubmit={(stars, text) => act("review", "/review", { stars, text })} />
              )}
            </div>
          )}
        </section>
      )}

      {/* Actions */}
      <div className="flex flex-col items-center gap-2">
        {match.canCancel && (
          <button type="button" onClick={() => void act("cancel", "/match/cancel")} disabled={!!busy} className={buttonQuiet}>
            {match.stage === "searching" || match.stage === "no_match"
              ? "Cancel search"
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
