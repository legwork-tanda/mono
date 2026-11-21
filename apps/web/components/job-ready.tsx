"use client";

import { useState } from "react";
import {
  defaultDate,
  SEVERITY_LABELS,
  TIER_INFO,
  TRADES,
  tradeInfo,
  type JobState,
  type Photo,
  formatPriceRange as priceRange,
  type Tier,
  type TradeId,
  type WriteUpEdit,
} from "@legwork/shared";
import { photoUrl } from "@/lib/api";
import { BriefChecklist, proDeadline } from "./brief-checklist";
import { buttonPrimary, buttonQuiet, fieldClass, Spinner } from "./ui";

type Session = { id: string; token: string; uploadToken: string };

type Props = {
  state: JobState;
  session: Session;
  confirming: boolean;
  onEdit: (edit: WriteUpEdit) => Promise<void>;
  onPhotosChange: (update: (photos: Photo[]) => Photo[]) => void;
  onConfirm: (tier: Tier, date: string) => void;
  onStartOver: () => void;
};

const TIER_ORDER: Tier[] = ["high", "medium", "low"];
const TIER_SHORT: Record<Tier, string> = { high: "Today", medium: "Tomorrow", low: "This week" };

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
const SEVERITY_OPTIONS = [1, 2, 3, 4, 5].map((n) => ({ value: n, label: `${n} – ${SEVERITY_LABELS[n]}` }));

/** The job, in one glance: what, where, when, how much. One button to find a tradie. */
export function JobReady({ state, session, confirming, onEdit, onConfirm, onStartOver }: Props) {
  const { job, photos } = state;
  const writeUp = job.writeUp!;
  const trade = tradeInfo(writeUp.trade);
  const safety = job.safety || writeUp.safety;
  const [picked, setPicked] = useState<Tier>(job.tier ?? "medium");
  // Follow the server when an edit changes the pre-selected tier.
  const [seenTier, setSeenTier] = useState(job.tier);
  if (job.tier !== seenTier) {
    setSeenTier(job.tier);
    if (job.tier) setPicked(job.tier);
  }
  // Dangerous jobs only go out as ASAP.
  const tier: Tier = safety ? "high" : picked;
  const [editing, setEditing] = useState(false);
  const cover = photos[0];

  return (
    <div className="animate-question space-y-5">
      {safety && <SafetyBanner />}

      <article className="overflow-hidden rounded-[24px] bg-white shadow-float ring-1 ring-line">
        {cover && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl(cover.path, session.uploadToken)} alt="" className="h-36 w-full object-cover sm:h-52" />
        )}
        <div className="p-5 sm:p-6">
          <p className="text-sm font-semibold text-brand">{trade.label}</p>
          <h1 className="mt-1 text-[1.625rem] leading-tight font-semibold tracking-[-0.015em] text-balance">{writeUp.title}</h1>
          <p className="mt-2 line-clamp-3 text-muted text-pretty">{writeUp.summary}</p>
          <BriefChecklist
            writeUp={writeUp}
            photos={photos}
            uploadToken={session.uploadToken}
            deadline={proDeadline(tier)}
            onEdit={onEdit}
          />
        </div>
      </article>

      <section aria-label="Price" className="rounded-[24px] bg-white p-5 shadow-card ring-1 ring-line sm:p-6">
        <p className="text-sm text-muted">Estimated price</p>
        {writeUp.priceReason && <p className="mt-0.5 text-sm text-pretty">{writeUp.priceReason}</p>}
        <div className="mt-4 space-y-2" role="radiogroup" aria-label="How soon">
          {TIER_ORDER.map((t) => {
            const locked = safety && t !== "high";
            const selected = t === tier;
            return (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={locked}
                onClick={() => setPicked(t)}
                className={`flex w-full items-start justify-between gap-4 rounded-2xl p-4 text-left ring-1 transition-all duration-150 ${
                  selected ? "bg-white ring-2 ring-brand shadow-card" : "bg-surface ring-transparent hover:ring-line"
                } ${locked ? "cursor-not-allowed opacity-45" : ""}`}
              >
                <span>
                  <span className="block text-sm font-semibold">
                    {TIER_SHORT[t]} <span className="font-normal text-muted">· {TIER_INFO[t].when}</span>
                  </span>
                  <span className="mt-0.5 block text-sm text-muted text-pretty">{TIER_INFO[t].reason}</span>
                </span>
                <span className="shrink-0 text-lg font-semibold tracking-tight tabular-nums">{priceRange(writeUp.prices[t])}</span>
              </button>
            );
          })}
        </div>
        {safety && <p className="mt-3 text-sm text-muted">Because this could be dangerous, it goes out as ASAP.</p>}
      </section>

      <button
        type="button"
        onClick={() => onConfirm(tier, defaultDate(tier, new Date()))}
        disabled={confirming}
        className={`${buttonPrimary} h-14 w-full rounded-2xl text-[17px]`}
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
