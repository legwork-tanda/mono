"use client";

import { useState } from "react";
import {
  defaultDate,
  TIER_INFO,
  tradeInfo,
  type JobState,
  type Photo,
  type PriceRange,
  type Tier,
  type WriteUpEdit,
} from "@legwork/shared";
import { photoUrl } from "@/lib/api";
import { buttonPrimary, buttonQuiet, fieldClass, Icon, icons, Spinner } from "./ui";

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

const money = (n: number) => `$${n.toLocaleString("en-AU")}`;
export const priceRange = (r: PriceRange) => `${money(r.min)}–${money(r.max)}`;

const TIER_ORDER: Tier[] = ["high", "medium", "low"];
const TIER_SHORT: Record<Tier, string> = { high: "Today", medium: "Tomorrow", low: "This week" };

/** Shown for gas, sparking wiring, water near electrics and the like. */
function SafetyBanner() {
  return (
    <div role="alert" className="flex gap-3 rounded-2xl bg-danger/8 p-4 text-sm">
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-danger text-xs font-bold text-white">!</span>
      <p className="text-pretty">
        <span className="font-semibold text-danger">This could be dangerous.</span> Keep away from it and switch off at the mains if
        it&apos;s safe. If anyone is at risk, call{" "}
        <a href="tel:000" className="font-semibold underline">
          000
        </a>
        .
      </p>
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

/** The job, in one glance: what, where, when, how much. One button to find a tradie. */
export function JobReady({ state, session, confirming, onEdit, onConfirm, onStartOver }: Props) {
  const { job, photos } = state;
  const writeUp = job.writeUp!;
  const trade = tradeInfo(writeUp.trade);
  const [tier, setTier] = useState<Tier>(job.tier ?? "medium");
  const [editing, setEditing] = useState(false);
  const cover = photos[0];

  return (
    <div className="animate-question space-y-5">
      <article className="overflow-hidden rounded-[24px] bg-white shadow-float ring-1 ring-line">
        {cover && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl(cover.path, session.uploadToken)} alt="" className="h-44 w-full object-cover sm:h-52" />
        )}
        <div className="p-5 sm:p-6">
          <p className="text-sm font-semibold text-brand">{trade.label}</p>
          <h1 className="mt-1 text-[1.625rem] leading-tight font-semibold tracking-[-0.015em] text-balance">{writeUp.title}</h1>
          <p className="mt-2 line-clamp-3 text-muted text-pretty">{writeUp.summary}</p>
          <div className="mt-4 flex flex-wrap gap-2 text-sm">
            {writeUp.location && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 font-medium">
                <Icon d={icons.pin} className="size-4 text-muted" />
                {writeUp.location}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 font-medium">
              <Icon d={icons.clock} className="size-4 text-muted" />
              {TIER_INFO[tier].when}
            </span>
          </div>
        </div>
      </article>

      {writeUp.safety && <SafetyBanner />}

      <section aria-label="Price" className="rounded-[24px] bg-white p-5 shadow-card ring-1 ring-line sm:p-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-sm text-muted">Estimated price</p>
            <p className="mt-0.5 text-3xl font-semibold tracking-tight tabular-nums">{priceRange(writeUp.prices[tier])}</p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-1 rounded-full bg-surface p-1" role="radiogroup" aria-label="How soon">
          {TIER_ORDER.map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={t === tier}
              onClick={() => setTier(t)}
              className={`h-10 rounded-full text-sm font-semibold transition-all duration-150 ${
                t === tier ? "bg-white text-ink shadow-card" : "text-muted hover:text-ink"
              }`}
            >
              {TIER_SHORT[t]}
            </button>
          ))}
        </div>
      </section>

      <button
        type="button"
        onClick={() => onConfirm(tier, defaultDate(tier, new Date()))}
        disabled={confirming}
        className={`${buttonPrimary} h-14 w-full rounded-2xl text-[17px]`}
      >
        {confirming && <Spinner />}
        Find a {trade.worker}
      </button>

      {editing ? (
        <section className="space-y-4 rounded-[24px] bg-white p-5 ring-1 ring-line animate-fade-in">
          <EditField label="Title" value={writeUp.title} onSave={(title) => onEdit({ title })} />
          <EditField label="What's needed" value={writeUp.summary} multiline onSave={(summary) => onEdit({ summary })} />
          <EditField label="Suburb" value={writeUp.location ?? ""} onSave={(location) => onEdit({ location })} />
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
