"use client";

import { useState } from "react";
import {
  DEFAULT_TIME_ZONE,
  factSource,
  SEVERITY_LABELS,
  TIER_INFO,
  tierForWhen,
  TRADES,
  tradeInfo,
  whenDateRange,
  whenForTier,
  whenLabel,
  whenOptions,
  type JobEdit,
  type JobState,
  type JobWhen,
  type Photo,
  formatPriceRange as priceRange,
  type Tier,
  type TradeId,
  type WhenInput,
} from "@legwork/shared";
import { photoUrl } from "@/lib/api";
import { BriefChecklist, proDeadline } from "./brief-checklist";
import { buttonPrimary, buttonQuiet, fieldClass, Spinner } from "./ui";

type Session = { id: string; token: string; uploadToken: string };

type Props = {
  state: JobState;
  session: Session;
  confirming: boolean;
  onEdit: (edit: JobEdit) => Promise<void>;
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

/** A field of the job that turns into an input when edited. */
function EditField({
  label,
  value,
  multiline = false,
  onSave,
}: {
  label: string;
  value: string;
  multiline?: boolean;
  onSave: (value: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = draft.trim() !== value;
  const Field = multiline ? "textarea" : "input";

  return (
    <div>
      <label className="text-sm font-medium text-muted" htmlFor={`edit-${label}`}>
        {label}
      </label>
      <div className="mt-1.5 flex items-start gap-2">
        <Field
          id={`edit-${label}`}
          value={draft}
          rows={multiline ? 3 : undefined}
          onChange={(e) => setDraft(e.target.value)}
          className={`${fieldClass} ${multiline ? "resize-none" : ""}`}
        />
        {changed && (
          <button
            type="button"
            disabled={saving}
            onClick={async () => {
              if (!draft.trim()) return setError("This can't be empty.");
              setSaving(true);
              setError(null);
              try {
                await onSave(draft.trim());
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setSaving(false);
              }
            }}
            className={`${buttonPrimary} h-12 shrink-0 px-4 text-sm`}
          >
            {saving ? <Spinner /> : "Save"}
          </button>
        )}
      </div>
      {error && <p className="mt-1.5 text-sm text-danger">{error}</p>}
    </div>
  );
}

/** A dropdown that saves as soon as it changes. */
function EditSelect<T extends string | number>({
  label,
  value,
  options,
  onSave,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onSave: (value: T) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = `edit-${label}`;

  return (
    <div>
      <label className="text-sm font-medium text-muted" htmlFor={id}>
        {label}
      </label>
      <div className="mt-1.5 flex items-center gap-2">
        <select
          id={id}
          value={String(value)}
          disabled={saving}
          onChange={async (e) => {
            const next = options.find((o) => String(o.value) === e.target.value);
            if (!next) return;
            setSaving(true);
            setError(null);
            try {
              await onSave(next.value);
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setSaving(false);
            }
          }}
          className={fieldClass}
        >
          {options.map((o) => (
            <option key={String(o.value)} value={String(o.value)}>
              {o.label}
            </option>
          ))}
        </select>
        {saving && <Spinner />}
      </div>
      {error && <p className="mt-1.5 text-sm text-danger">{error}</p>}
    </div>
  );
}

const TRADE_OPTIONS = TRADES.map((t) => ({ value: t.id as TradeId, label: t.label }));

/**
 * The trade at the top of the card, with the ✦ marker while it's Legwork's
 * guess. It's a dropdown in place, so a wrong trade is fixed with one tap;
 * changing it reprices the tiers.
 */
function TradeLabel({ trade, source, onSave }: { trade: TradeId; source: "given" | "inferred"; onSave: (trade: TradeId) => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <label className="relative -my-2.5 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-brand">
        <span className="sr-only">Trade</span>
        <select
          value={trade}
          disabled={saving}
          onChange={async (e) => {
            const next = e.target.value as TradeId;
            setSaving(true);
            setError(null);
            try {
              await onSave(next);
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setSaving(false);
            }
          }}
          className="absolute inset-0 cursor-pointer opacity-0"
        >
          {TRADE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {tradeInfo(trade).label}
        {source === "inferred" && (
          <span className="text-[11px]" title="Legwork's guess">
            ✦<span className="sr-only"> Legwork&apos;s guess</span>
          </span>
        )}
        {saving ? <Spinner className="size-3.5" /> : <span aria-hidden className="text-xs text-muted">▾</span>}
      </label>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
const SEVERITY_OPTIONS = [1, 2, 3, 4, 5].map((n) => ({ value: n, label: `${n} – ${SEVERITY_LABELS[n]}` }));

/** The job, in one glance: what, where, when, how much. One button to find a tradie. */
export function JobReady({ state, session, confirming, onEdit, onConfirm, onStartOver }: Props) {
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
   * A price row picks the customer's own answer when it's priced in that tier
   * (so a lower row undoes a severity override), otherwise the first quick
   * option priced there. Either way their pick wins on the server.
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
  // Why the time isn't the customer's own, in one line; a dangerous job always says why it's ASAP.
  const whenNote = job.whenOverride?.message ?? (safety ? "Because this could be dangerous, it goes out as ASAP." : null);
  const [editing, setEditing] = useState(false);
  const cover = photos[0];

  return (
    <div className="animate-question space-y-3">
      {safety && <SafetyBanner />}

      <article className="overflow-hidden rounded-[24px] bg-white shadow-float ring-1 ring-line">
        {cover && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl(cover.path, session.uploadToken)} alt="" className="h-20 w-full object-cover sm:h-52" />
        )}
        <div className="p-4 sm:p-6">
          <TradeLabel trade={writeUp.trade} source={factSource(writeUp.tradeSource)} onSave={(trade) => onEdit({ trade })} />
          <h1 className="mt-0.5 text-[1.375rem] leading-tight font-semibold tracking-[-0.015em] text-balance sm:text-[1.625rem]">{writeUp.title}</h1>
          <p className="mt-1 line-clamp-2 text-[15px] text-muted text-pretty sm:line-clamp-3 sm:text-base">{writeUp.summary}</p>
          <BriefChecklist
            writeUp={writeUp}
            photos={photos}
            uploadToken={session.uploadToken}
            deadline={proDeadline(when, nowMs)}
            whenNote={job.whenOverride?.message ?? null}
            onEdit={onEdit}
          />
        </div>
      </article>

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
        <p className="mt-3 line-clamp-2 text-sm text-pretty">
          <span className="text-muted">Estimated price{writeUp.priceReason ? " · " : ""}</span>
          {writeUp.priceReason}
        </p>
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
                } ${locked ? "cursor-not-allowed opacity-45" : ""}`}
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
        disabled={confirming || !!saving}
        className={`${buttonPrimary} h-13 w-full rounded-2xl text-[17px]`}
      >
        {confirming && <Spinner />}
        Find a {trade.worker} · {priceRange(writeUp.prices[tier])}
      </button>

      {editing ? (
        <section className="space-y-4 rounded-[24px] bg-white p-5 ring-1 ring-line animate-fade-in">
          <EditSelect label="Trade" value={writeUp.trade} options={TRADE_OPTIONS} onSave={(trade) => onEdit({ trade })} />
          <EditField label="Title" value={writeUp.title} onSave={(title) => onEdit({ title })} />
          <EditField label="What's needed" value={writeUp.summary} multiline onSave={(summary) => onEdit({ summary })} />
          <EditSelect label="Severity" value={writeUp.severity} options={SEVERITY_OPTIONS} onSave={(severity) => onEdit({ severity })} />
          <EditField label="Suburb" value={writeUp.location ?? ""} onSave={(location) => onEdit({ location })} />
          <p className="text-sm text-muted">Changing the trade or severity updates the prices.</p>
          <button type="button" onClick={() => setEditing(false)} className={`${buttonQuiet} -ml-3`}>
            Done
          </button>
        </section>
      ) : (
        <div className="flex justify-center gap-2">
          <button type="button" onClick={() => setEditing(true)} className={buttonQuiet}>
            Edit details
          </button>
          <button type="button" onClick={onStartOver} className={buttonQuiet}>
            Start over
          </button>
        </div>
      )}
    </div>
  );
}
