"use client";

import { useState, type ReactNode } from "react";
import {
  defaultDate,
  DETAIL_VALUE_MAX,
  factSource,
  SEVERITY_LABELS,
  TIER_INFO,
  tradeInfo,
  type FactSource,
  type JobWriteUp,
  type Photo,
  type Tier,
  type WriteUpEdit,
} from "@legwork/shared";
import { photoUrl } from "@/lib/api";
import { buttonPrimary, buttonQuiet, fieldClass, Icon, icons, Spinner } from "./ui";

/**
 * The deadline the Pro gets for a tier: the one place the checklist reads it
 * from, so it's easy to switch to a real date and window (#44).
 */
export function proDeadline(tier: Tier, now = new Date()): { short: string; full: string } {
  const date = new Date(`${defaultDate(tier, now)}T00:00:00`);
  const day = date.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
  return { short: TIER_INFO[tier].label, full: tier === "high" ? `${TIER_INFO[tier].when}, today` : `${TIER_INFO[tier].when}, by ${day}` };
}

type Props = {
  writeUp: JobWriteUp;
  photos: Photo[];
  uploadToken: string;
  /** What the Pro is told about timing (see `proDeadline`). */
  deadline: { short: string; full: string };
  onEdit: (edit: WriteUpEdit) => Promise<void>;
};

/** One thing the Pro receives (or a gap they would want filled). */
type Item = {
  key: string;
  /** The chip's text. */
  label: string;
  /** Gaps show as "+ label" and open an input. */
  gap?: boolean;
  source?: FactSource;
  tone?: "danger";
  lead?: ReactNode;
  panel: ReactNode;
};

const severityText = (n: number) => SEVERITY_LABELS[n] ?? `Severity ${n}`;

/**
 * What the tradie will get, as one row of compact items under the summary:
 * ticked when it goes out with the job, a quiet "+ Add" for an essential
 * nobody has settled. Tapping an item shows the exact value sent. Items the
 * assistant decided carry a ✦, so the customer can tell them from their own.
 */
export function BriefChecklist({ writeUp, photos, uploadToken, deadline, onEdit }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const details = writeUp.details.map((d) => ({ label: d.label, value: d.value }));
  const saveDetails = (next: { label: string; value: string }[]) => onEdit({ details: next });

  const items: Item[] = [
    {
      key: "what",
      label: "What",
      source: "inferred",
      panel: (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            {tradeInfo(writeUp.trade).label}
            <Guess />
          </p>
          <InlineEdit label="Title" value={writeUp.title} onSave={(title) => onEdit({ title })} />
          <InlineEdit label="What's needed" value={writeUp.summary} multiline onSave={(summary) => onEdit({ summary })} />
          <Source source="inferred" note="Written by Legwork from what you told us." />
        </div>
      ),
    },
    writeUp.location
      ? {
          key: "where",
          label: writeUp.location,
          source: "given",
          lead: <Icon d={icons.pin} className="size-3.5 text-muted" />,
          panel: (
            <div className="space-y-3">
              <InlineEdit label="Suburb" value={writeUp.location} onSave={(location) => onEdit({ location })} />
              <Source source="given" note="The Pro gets the suburb, not your address." />
            </div>
          ),
        }
      : {
          key: "where",
          label: "Suburb",
          gap: true,
          panel: <InlineEdit label="Suburb" value="" placeholder="Suburb or postcode" onSave={(location) => onEdit({ location })} />,
        },
    {
      key: "when",
      label: deadline.short,
      source: "given",
      lead: <Icon d={icons.clock} className="size-3.5 text-muted" />,
      panel: (
        <div className="space-y-1.5">
          <p className="font-medium">{deadline.full}</p>
          <p className="text-sm text-muted">Pick how soon with the prices below.</p>
        </div>
      ),
    },
    {
      key: "severity",
      label: severityText(writeUp.severity),
      source: factSource(writeUp.severitySource),
      tone: writeUp.severity >= 4 ? "danger" : undefined,
      panel: <SeverityPanel writeUp={writeUp} onEdit={onEdit} />,
    },
  ];

  if (photos.length > 0) {
    items.push({
      key: "photos",
      label: `${photos.length} photo${photos.length === 1 ? "" : "s"}`,
      source: "given",
      lead: (
        <span className="flex -space-x-1.5">
          {photos.slice(0, 3).map((p) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={p.id} src={photoUrl(p.path, uploadToken)} alt="" className="size-5 rounded-full object-cover ring-2 ring-white" />
          ))}
        </span>
      ),
      panel: (
        <div className="space-y-2">
          <p className="text-sm text-muted">The Pro gets all {photos.length === 1 ? "of it" : `${photos.length}`}.</p>
          <div className="flex flex-wrap gap-2">
            {photos.map((p, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={p.id}
                src={photoUrl(p.path, uploadToken)}
                alt={`Photo ${i + 1}`}
                className="size-16 rounded-xl object-cover ring-1 ring-line"
              />
            ))}
          </div>
        </div>
      ),
    });
  }

  writeUp.details.forEach((d, i) => {
    const source = factSource(d.source);
    items.push({
      key: `detail-${d.label}`,
      label: d.label,
      source,
      panel: (
        <div className="space-y-3">
          <InlineEdit
            key={d.value}
            label={d.label}
            value={d.value}
            onSave={(value) => saveDetails(details.map((x, j) => (j === i ? { ...x, value } : x)))}
            onRemove={() => saveDetails(details.filter((_, j) => j !== i))}
          />
          <Source source={source} />
        </div>
      ),
    });
  });

  for (const label of writeUp.missing ?? []) {
    items.push({
      key: `missing-${label}`,
      label,
      gap: true,
      panel: (
        <div className="space-y-2">
          <p className="text-sm text-muted">A Pro usually asks about this. Add it now and they won&apos;t need to.</p>
          <InlineEdit label={label} value="" placeholder="Type it here" onSave={(value) => saveDetails([...details, { label, value }])} />
        </div>
      ),
    });
  }

  const current = items.find((item) => item.key === open);
  const guesses = items.some((item) => item.source === "inferred");

  return (
    <div className="mt-4">
      <ul
        aria-label="What the tradie gets"
        className="relative -mx-5 flex gap-1.5 overflow-x-auto px-5 pb-0.5 [scrollbar-width:none] sm:-mx-6 sm:px-6 [&::-webkit-scrollbar]:hidden"
      >
        {items.map((item) => {
          const selected = item.key === open;
          return (
            <li key={item.key} className="shrink-0">
              <button
                type="button"
                aria-expanded={selected}
                onClick={() => setOpen(selected ? null : item.key)}
                className={`inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                  item.gap
                    ? "text-muted ring-1 ring-line ring-inset hover:text-ink"
                    : selected
                      ? "bg-brand-soft ring-1 ring-brand/30 ring-inset"
                      : "bg-surface hover:bg-line/60"
                } ${item.tone === "danger" ? "text-danger" : ""}`}
              >
                {item.gap ? (
                  <span aria-hidden className="text-base leading-none">
                    +
                  </span>
                ) : (
                  <Icon d={icons.check} className="size-3.5 text-success" />
                )}
                {item.lead}
                <span className="max-w-[9rem] truncate">{item.label}</span>
                {item.source === "inferred" && <Guess />}
                <span className="sr-only">{item.gap ? ", missing: tap to add" : ", the tradie gets this"}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {guesses && !current && (
        <p className="mt-1.5 truncate text-xs text-faint">
          <span className="text-brand">✦</span> Legwork&apos;s guess · tap to see what the tradie gets
        </p>
      )}
      {current && (
        <div className="mt-2 rounded-2xl bg-surface p-3.5 text-[15px] animate-fade-in">
          {current.panel}
        </div>
      )}
    </div>
  );
}

/** The marker for a value the assistant decided rather than the customer. */
function Guess() {
  return (
    <span className="ml-0.5 text-[11px] text-brand" title="Legwork's guess">
      ✦<span className="sr-only"> Legwork&apos;s guess</span>
    </span>
  );
}

function Source({ source, note }: { source: FactSource; note?: string }) {
  return (
    <p className="text-xs text-muted">
      {note ?? (source === "given" ? "From what you told us." : "")}
      {source === "inferred" && !note && (
        <>
          <span className="text-brand">✦</span> Legwork&apos;s guess from your photos or words. Check it&apos;s right.
        </>
      )}
    </p>
  );
}

function SeverityPanel({ writeUp, onEdit }: { writeUp: JobWriteUp; onEdit: Props["onEdit"] }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const source = factSource(writeUp.severitySource);
  return (
    <div className="space-y-2.5">
      <p className="text-sm text-muted">How serious it is. Changing it updates the prices.</p>
      <div className="flex gap-1.5" role="radiogroup" aria-label="How serious">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={n === writeUp.severity}
            aria-label={`${n}: ${severityText(n)}`}
            disabled={saving}
            onClick={async () => {
              if (n === writeUp.severity) return;
              setSaving(true);
              setError(null);
              try {
                await onEdit({ severity: n });
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setSaving(false);
              }
            }}
            className={`h-9 flex-1 rounded-lg text-sm font-semibold tabular-nums ring-1 ring-inset ${
              n === writeUp.severity ? "bg-white ring-2 ring-brand" : "ring-line hover:bg-white"
            }`}
          >
            {n}
          </button>
        ))}
      </div>
      <p className="font-medium">
        {writeUp.severity}/5 · {severityText(writeUp.severity)} {saving && <Spinner className="inline size-3.5" />}
      </p>
      {error && <p className="text-sm text-danger">{error}</p>}
      <Source
        source={source}
        note={source === "given" ? "You set this." : undefined}
      />
    </div>
  );
}

/** A value with Save (and optionally Remove) that writes straight to the job. */
function InlineEdit({
  label,
  value,
  placeholder,
  multiline = false,
  onSave,
  onRemove,
}: {
  label: string;
  value: string;
  placeholder?: string;
  multiline?: boolean;
  onSave: (value: string) => Promise<void>;
  onRemove?: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = draft.trim() !== value && draft.trim() !== "";
  const Field = multiline ? "textarea" : "input";
  const id = `brief-${label.replace(/\W+/g, "-").toLowerCase()}`;

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <label htmlFor={id} className="text-xs font-semibold text-muted">
        {label}
      </label>
      <Field
        id={id}
        value={draft}
        placeholder={placeholder}
        maxLength={multiline ? 1000 : DETAIL_VALUE_MAX}
        rows={multiline ? 3 : undefined}
        onChange={(e) => setDraft(e.target.value)}
        className={`${fieldClass} mt-1 py-2 text-[15px] ${multiline ? "resize-none" : ""}`}
      />
      {(changed || onRemove) && (
        <div className="mt-2 flex items-center gap-1">
          {changed && (
            <button type="button" disabled={busy} onClick={() => run(() => onSave(draft.trim()))} className={`${buttonPrimary} h-9 px-4 text-sm`}>
              {busy ? <Spinner /> : value ? "Save" : "Add"}
            </button>
          )}
          {onRemove && (
            <button type="button" disabled={busy} onClick={() => run(onRemove)} className={`${buttonQuiet} h-9`}>
              Remove
            </button>
          )}
        </div>
      )}
      {error && <p className="mt-1.5 text-sm text-danger">{error}</p>}
    </div>
  );
}
