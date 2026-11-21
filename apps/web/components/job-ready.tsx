"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_TIME_ZONE,
  factSource,
  TIER_INFO,
  tierForWhen,
  tradeInfo,
  whenDateRange,
  whenForTier,
  whenLabel,
  whenOptions,
  type CorrectedField,
  type CorrectionResponse,
  type JobEdit,
  type JobState,
  type JobWhen,
  type Photo,
  type Pushback,
  type PushbackRequest,
  formatPriceRange as priceRange,
  type Tier,
  type TradeId,
  type WhenInput,
} from "@legwork/shared";
import { photoUrl } from "@/lib/api";
import { uploadPhoto } from "@/lib/photos";
import { BriefChecklist, proDeadline } from "./brief-checklist";
import { Composer } from "./composer";
import { buttonPrimary, buttonQuiet, fieldClass, Spinner } from "./ui";

type Session = { id: string; token: string; uploadToken: string };

type Props = {
  state: JobState;
  session: Session;
  confirming: boolean;
  /** Tappable choices only: a time chip or a price row. */
  onEdit: (edit: JobEdit) => Promise<void>;
  /** Everything else is said: "Anything wrong? Just say it." (#55). Updates the state before resolving. */
  onCorrect: (text: string) => Promise<CorrectionResponse>;
  /** The answer to the slow-date line (#59). Updates the state before resolving. */
  onPushback: (answer: PushbackRequest["answer"]) => Promise<void>;
  onPhotosChange: (update: (photos: Photo[]) => Photo[]) => void;
  onConfirm: (tier: Tier, when: JobWhen) => void;
  onStartOver: () => void;
};

const TIER_ORDER: Tier[] = ["high", "medium", "low"];
/** What each price row covers, now that the time picked sets the tier (`tierForWhen`). */
const TIER_SHORT: Record<Tier, string> = { high: "ASAP or today", medium: "Tomorrow", low: "2+ days out" };
/** Why each tier costs what it does, short enough for one line on a phone (`TIER_INFO` has the long form). */
const TIER_WHY: Record<Tier, string> = { high: "Same-day callout", medium: "Next-day booking", low: "Standard rates" };

const sameWhen = (a: Omit<JobWhen, "timeZone">, b: Omit<JobWhen, "timeZone">) =>
  a.asap === b.asap && a.date === b.date && a.window?.start === b.window?.start && a.window?.end === b.window?.end;
const toInput = (w: Omit<JobWhen, "timeZone">): WhenInput => (w.asap ? { asap: true } : { date: w.date, window: w.window });

/**
 * When it's needed: the same dated options as "How soon?", one tap each, and
 * a date picker for anything else. Saving a new time moves the job to that
 * time's tier on the server, which reprices the button.
 */
function WhenPicker({ when, nowMs, locked, note, saving, onPick }: {
  when: JobWhen;
  nowMs: number;
  locked: boolean;
  /** One line under the chips: why the time isn't the customer's own, if it isn't. */
  note: string | null;
  saving: string | null;
  onPick: (input: WhenInput, key: string) => void;
}) {
  const options = whenOptions(nowMs, when.timeZone);
  const range = whenDateRange(nowMs, when.timeZone);
  const [picking, setPicking] = useState(false);
  // A day picked from the calendar isn't one of the quick options: show it as its own chip.
  const custom = options.some((o) => sameWhen(o, when)) ? null : when;
  const chips = [
    ...options.map((o) => ({ key: o.label, label: o.asap ? "ASAP" : o.label, value: o })),
    ...(custom ? [{ key: "custom", label: whenLabel(custom, nowMs), value: custom }] : []),
  ];

  return (
    <div>
      <p className="text-sm font-medium text-muted" id="when-label">
        When
      </p>
      <div
        className="-mx-4 mt-1 flex gap-2 overflow-x-auto px-4 py-0.5 [scrollbar-width:none] sm:-mx-6 sm:px-6 [&::-webkit-scrollbar]:hidden"
        role="radiogroup"
        aria-labelledby="when-label"
      >
        {chips.map((chip) => {
          const selected = saving ? saving === chip.key : sameWhen(chip.value, when);
          const disabled = locked && !chip.value.asap;
          return (
            <button
              key={chip.key}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled || !!saving}
              onClick={() => !selected && onPick(toInput(chip.value), chip.key)}
              className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium whitespace-nowrap ring-1 transition-colors duration-150 ${
                selected ? "bg-brand-soft text-ink ring-2 ring-brand" : "bg-surface ring-transparent hover:ring-line"
              } ${disabled ? "cursor-not-allowed opacity-45" : ""}`}
            >
              {saving === chip.key && <Spinner />}
              {chip.label}
            </button>
          );
        })}
        {!locked &&
          (picking ? (
            <input
              type="date"
              aria-label="Pick a date"
              autoFocus
              min={range.min}
              max={range.max}
              disabled={!!saving}
              onChange={(e) => {
                if (!e.target.value) return;
                setPicking(false);
                onPick({ date: e.target.value }, "custom");
              }}
              className={`${fieldClass} h-11 w-auto shrink-0 py-1.5 text-sm`}
            />
          ) : (
            <button
              type="button"
              onClick={() => setPicking(true)}
              disabled={!!saving}
              className="inline-flex min-h-11 shrink-0 items-center rounded-full px-3 text-sm font-semibold whitespace-nowrap text-brand hover:text-brand-strong"
            >
              Another date
            </button>
          ))}
      </div>
      {note && <p className="mt-1.5 text-sm text-pretty text-muted">{note}</p>}
    </div>
  );
}

/**
 * The one line when the chosen date is later than the job should wait (#59):
 * what waiting costs, and two answers. Asked once: either answer is final, and
 * the line goes when the server stops sending it. Not a dialog, not a warning.
 */
function SlowDateLine({ pushback, onAnswer }: { pushback: Pushback; onAnswer: (answer: PushbackRequest["answer"]) => Promise<void> }) {
  const [busy, setBusy] = useState<PushbackRequest["answer"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const answer = async (a: PushbackRequest["answer"]) => {
    setBusy(a);
    setError(null);
    try {
      await onAnswer(a);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const chip = "inline-flex min-h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold whitespace-nowrap transition-colors duration-150";
  return (
    <div className="mt-2" role="group" aria-label="Want it sooner?">
      <p className="text-[13px] leading-[1.35] text-pretty">{pushback.line}</p>
      <div className="mt-1.5 flex flex-wrap gap-2">
        <button type="button" disabled={!!busy} onClick={() => void answer("sooner")} className={`${chip} bg-brand text-white hover:bg-brand-strong`}>
          {busy === "sooner" && <Spinner />}
          {pushback.soonerLabel}
        </button>
        <button type="button" disabled={!!busy} onClick={() => void answer("keep")} className={`${chip} bg-surface text-ink ring-1 ring-line hover:ring-ink/30`}>
          {busy === "keep" && <Spinner />}
          {pushback.keepLabel}
        </button>
      </div>
      {error && <p className="mt-1.5 text-sm text-danger">{error}</p>}
    </div>
  );
}

/**
 * Shown for gas, sparking wiring, water near electrics and the like: during
 * the questions as soon as it's spotted, and at the top of the summary card.
 */
export function SafetyBanner() {
  return (
    <div role="alert" className="flex gap-3 rounded-2xl bg-danger/8 p-4 text-sm ring-1 ring-danger/20">
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-danger text-xs font-bold text-white">!</span>
      <div className="space-y-1.5 text-pretty">
        <p className="font-semibold text-danger">Get to safety first.</p>
        <p>
          This could be dangerous. Keep everyone away from it and, only if it&apos;s safe, turn off the gas or switch off at the mains.
        </p>
        <p>
          If anyone is at risk or there&apos;s a fire, call{" "}
          <a href="tel:000" className="font-semibold underline">
            000
          </a>
          . For storm or flood damage, call the SES on{" "}
          <a href="tel:132500" className="font-semibold whitespace-nowrap underline">
            132 500
          </a>
          .
        </p>
      </div>
    </div>
  );
}

/** The trade at the top of the card, with the ✦ marker while it's Legwork's guess. A wrong trade is said, not picked. */
function TradeLabel({ trade, source, changed }: { trade: TradeId; source: "given" | "inferred"; changed: boolean }) {
  return (
    <p className={`inline-flex items-center gap-1 rounded text-sm font-semibold text-brand ${changed ? "animate-changed" : ""}`}>
      {tradeInfo(trade).label}
      {source === "inferred" && (
        <span className="text-[11px]" title="Legwork's guess">
          ✦<span className="sr-only"> Legwork&apos;s guess</span>
        </span>
      )}
    </p>
  );
}

/** Plain names for what a correction changed, for the one-line reply. */
const FIELD_NAMES: Partial<Record<CorrectedField, string>> = {
  title: "the title",
  summary: "what's needed",
  trade: "the trade",
  location: "the suburb",
  when: "the time",
  photos: "the photos",
};

function listed(names: string[]) {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** The one line under the composer after a correction: what moved, or why nothing did. */
export function correctionReply(res: CorrectionResponse): string {
  const names = res.changed.flatMap((f) => (f === "details" ? res.changedDetails.map((d) => d.toLowerCase()) : FIELD_NAMES[f] ? [FIELD_NAMES[f]!] : []));
  const parts: string[] = [];
  if (names.length > 0) parts.push(`Updated ${listed([...new Set(names)])}${res.changed.includes("price") ? ", and the price" : ""}.`);
  else if (res.changed.includes("price")) parts.push("Updated the price.");
  if (res.reason) parts.push(res.reason);
  if (res.photoRequest) parts.push(`${res.photoRequest.replace(/\.$/, "")}: tap the photo button.`);
  return parts.join(" ");
}

type Changed = { fields: ReadonlySet<CorrectedField>; details: string[]; n: number };

/**
 * The job, in one glance: what, where, when, how much. One button to find a
 * tradie. Nothing on it is a form: the time and price are tapped, and anything
 * else is said in the one composer ("Anything wrong? Just say it."). A change
 * lands in place, is highlighted for a moment, and the button shows the new
 * price before it's tapped.
 */
export function JobReady({ state, session, confirming, onEdit, onCorrect, onPushback, onPhotosChange, onConfirm, onStartOver }: Props) {
  const { job, photos } = state;
  const writeUp = job.writeUp!;
  const trade = tradeInfo(writeUp.trade);
  const safety = job.safety || writeUp.safety;
  // The clock the options are dated from, moved on each time the card renders after a change.
  const nowMs = Date.now();
  const timeZone = job.when?.timeZone ?? DEFAULT_TIME_ZONE;
  // Dangerous jobs only go out as ASAP.
  const when: JobWhen = safety || !job.when ? whenForTier(safety ? "high" : (job.tier ?? "medium"), nowMs, timeZone) : job.when;
  // The tier is the price bucket for the time; the server keeps them together.
  const tier: Tier = safety ? "high" : (job.tier ?? tierForWhen(when, nowMs));
  const [saving, setSaving] = useState<string | null>(null);
  const [whenError, setWhenError] = useState<string | null>(null);
  const pickWhen = async (input: WhenInput, key: string) => {
    setSaving(key);
    setWhenError(null);
    try {
      await onEdit({ when: input });
    } catch (e) {
      setWhenError((e as Error).message);
    } finally {
      setSaving(null);
    }
  };
  /**
   * A price row picks the customer's own answer when it's priced in that tier,
   * otherwise the first quick option priced there. Either way their pick wins
   * on the server.
   */
  const pickTier = (t: Tier) => {
    const options = whenOptions(nowMs, timeZone);
    const own = job.customerWhen;
    if (own && tierForWhen(own, nowMs) === t && (own.asap || own.date >= whenDateRange(nowMs, timeZone).min)) {
      const chip = options.find((o) => sameWhen(o, own));
      return void pickWhen(toInput(own), chip?.label ?? "custom");
    }
    const option = options.find((o) => tierForWhen({ ...o, timeZone }, nowMs) === t);
    if (option) void pickWhen(toInput(option), option.label);
  };
  // Only danger forces the time, and it always says why in one line.
  const whenNote = job.whenOverride?.message ?? (safety ? "Because this could be dangerous, it goes out as ASAP." : null);
  const cover = photos[0];
  // Severity's only effect on this screen (#59): one line when the date is slower than the job should wait.
  const pushback = !safety && !saving ? job.pushback : null;

  // Correcting by talking: the reply line, and what to highlight for a moment.
  const [correcting, setCorrecting] = useState(false);
  const [reply, setReply] = useState<string | null>(null);
  const [changed, setChanged] = useState<Changed | null>(null);
  const [prefill, setPrefill] = useState<{ text: string; n: number } | null>(null);
  useEffect(() => {
    if (!changed) return;
    const timer = setTimeout(() => setChanged(null), 2600);
    return () => clearTimeout(timer);
  }, [changed]);
  const hl = (field: CorrectedField) => (changed?.fields.has(field) ? "animate-changed" : "");
  const checklistHighlight = new Set<string>();
  if (changed) {
    if (["title", "summary", "trade"].some((f) => changed.fields.has(f as CorrectedField))) checklistHighlight.add("what");
    if (changed.fields.has("location")) checklistHighlight.add("where");
    if (changed.fields.has("when")) checklistHighlight.add("when");
    if (changed.fields.has("photos")) checklistHighlight.add("photos");
    for (const label of changed.details) checklistHighlight.add(`detail-${label}`);
  }

  const correct = async (text: string) => {
    setCorrecting(true);
    setReply(null);
    try {
      const res = await onCorrect(text);
      setReply(correctionReply(res));
      if (res.changed.length > 0) setChanged((c) => ({ fields: new Set(res.changed), details: res.changedDetails, n: (c?.n ?? 0) + 1 }));
      // Keep the words when nothing changed, so they can be reworded.
      return res.changed.length > 0 || !!res.photoRequest;
    } catch (e) {
      setReply((e as Error).message);
      return false;
    } finally {
      setCorrecting(false);
    }
  };
  const addPhoto = async (file: File) => {
    setReply("Adding your photo…");
    try {
      const photo = await uploadPhoto(session.id, session.token, file);
      onPhotosChange((current) => [...current, photo]);
      setReply("Photo added. The Pro gets it with the job.");
      setChanged((c) => ({ fields: new Set<CorrectedField>(["photos"]), details: [], n: (c?.n ?? 0) + 1 }));
    } catch (e) {
      setReply((e as Error).message);
    }
  };

  return (
    <div className="animate-question space-y-3">
      {safety && <SafetyBanner />}

      <article className="overflow-hidden rounded-[24px] bg-white shadow-float ring-1 ring-line">
        {cover && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl(cover.path, session.uploadToken)} alt="" className="h-16 w-full object-cover sm:h-52" />
        )}
        <div className="p-4 sm:p-6">
          <TradeLabel trade={writeUp.trade} source={factSource(writeUp.tradeSource)} changed={!!changed?.fields.has("trade")} />
          <h1 className={`mt-0.5 rounded text-[1.375rem] leading-tight font-semibold tracking-[-0.015em] text-balance sm:text-[1.625rem] ${hl("title")}`}>
            {writeUp.title}
          </h1>
          <p className={`mt-1 line-clamp-2 rounded text-[15px] text-muted text-pretty sm:line-clamp-3 sm:text-base ${hl("summary")}`}>{writeUp.summary}</p>
          <BriefChecklist
            writeUp={writeUp}
            photos={photos}
            uploadToken={session.uploadToken}
            deadline={proDeadline(when, nowMs)}
            whenNote={job.whenOverride?.message ?? null}
            highlight={checklistHighlight}
            onSay={(text) => setPrefill((p) => ({ text, n: (p?.n ?? 0) + 1 }))}
          />
        </div>
      </article>

      <Composer variant="brief" busy={correcting} reply={reply} prefill={prefill} onSubmit={correct} onAttach={(file) => void addPhoto(file)} />

      <section aria-label="Price" className="rounded-[24px] bg-white p-4 shadow-card ring-1 ring-line sm:p-6">
        <WhenPicker
          when={when}
          nowMs={nowMs}
          locked={safety}
          note={whenNote}
          saving={saving}
          onPick={(input, key) => void pickWhen(input, key)}
        />
        {whenError && <p className="mt-2 text-sm text-danger">{whenError}</p>}
        {pushback ? (
          <SlowDateLine pushback={pushback} onAnswer={onPushback} />
        ) : (
          // While the line shows, it takes this line's place so the button stays on a phone's first screen.
          <p className="mt-2.5 truncate text-sm sm:mt-3 sm:line-clamp-2 sm:whitespace-normal">
            <span className="text-muted">Estimated price{writeUp.priceReason ? " · " : ""}</span>
            {writeUp.priceReason}
          </p>
        )}
        <div className="mt-2 space-y-1.5" role="radiogroup" aria-label="Price for how soon">
          {TIER_ORDER.map((t) => {
            const locked = safety && t !== "high";
            const selected = t === tier;
            return (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={locked || !!saving}
                onClick={() => !selected && pickTier(t)}
                title={TIER_INFO[t].reason}
                className={`flex min-h-12 w-full items-center justify-between gap-3 rounded-xl px-3.5 py-1.5 text-left ring-1 transition-all duration-150 ${
                  selected ? "bg-white ring-2 ring-brand shadow-card" : "bg-surface ring-transparent hover:ring-line"
                } ${locked ? "cursor-not-allowed opacity-45" : ""} ${selected ? hl("price") : ""}`}
              >
                <span className="min-w-0 leading-tight">
                  <span className="block truncate text-sm font-semibold">{TIER_SHORT[t]}</span>
                  <span className="block truncate text-xs text-muted">{TIER_WHY[t]}</span>
                </span>
                <span className="shrink-0 text-base font-semibold tracking-tight tabular-nums">{priceRange(writeUp.prices[t])}</span>
              </button>
            );
          })}
        </div>
      </section>

      <button
        type="button"
        onClick={() => onConfirm(tier, when)}
        disabled={confirming || !!saving || correcting}
        className={`${buttonPrimary} h-13 w-full rounded-2xl text-[17px]`}
      >
        {confirming && <Spinner />}
        Find a {trade.worker} · {priceRange(writeUp.prices[tier])}
      </button>

      <div className="flex justify-center">
        <button type="button" onClick={onStartOver} className={buttonQuiet}>
          Start over
        </button>
      </div>
    </div>
  );
}
