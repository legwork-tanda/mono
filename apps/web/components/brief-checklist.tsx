"use client";

import { useState, type ReactNode } from "react";
import { factSource, slotsLabel, slotWhen, tradeInfo, whenLabel, type FactSource, type JobWhen, type JobWriteUp, type Photo, type TimeSlot } from "@legwork/shared";
import { photoUrl } from "@/lib/api";
import { Icon, icons, Spinner } from "./ui";

/**
 * The deadline the Pro gets: the customer's date and window (#44). Short is
 * relative to today ("Tomorrow morning"); full is the fixed date the Pro reads.
 */
export function proDeadline(when: JobWhen, nowMs: number, windows: TimeSlot[] = []): { short: string; full: string } {
  // Several blocks offered (#65): all of them, earliest first.
  if (!when.asap && windows.length > 1) {
    return { short: slotsLabel(windows, nowMs, when.timeZone), full: windows.map((w) => whenLabel(slotWhen(w, when.timeZone))).join(" · ") };
  }
  return { short: whenLabel(when, nowMs), full: whenLabel(when) };
}

type Props = {
  writeUp: JobWriteUp;
  photos: Photo[];
  uploadToken: string;
  /** What the Pro is told about timing (see `proDeadline`). */
  deadline: { short: string; full: string };
  /** Set when danger replaced the customer's own answer: their answer and the reason, in one line. */
  whenNote?: string | null;
  /** Photos still uploading: shown as one chip until they're in (#79). */
  uploading?: number;
  /** Item keys a correction just changed ("where", "when", "photos", "detail-<label>"), briefly highlighted. */
  highlight?: ReadonlySet<string>;
  /** Starts the composer with words for a gap ("Tank size: "), so it's filled by saying it. */
  onSay?: (text: string) => void;
};

/** One thing the Pro receives (or a gap they would want filled). */
type Item = {
  key: string;
  /** The chip's text. */
  label: string;
  /** Gaps show as "+ label" and say how to fill them. */
  gap?: boolean;
  source?: FactSource;
  lead?: ReactNode;
  panel: ReactNode;
};

/**
 * What the tradie will get, as one row of compact items under the summary:
 * ticked when it goes out with the job, a quiet "+ Add" for an essential
 * nobody has settled. Tapping an item shows the exact value sent. Items the
 * assistant decided carry a ✦, so the customer can tell them from their own.
 * Nothing here is a form: every change is said in the composer below (#55).
 */
export function BriefChecklist({ writeUp, photos, uploadToken, deadline, whenNote, uploading = 0, highlight, onSay }: Props) {
  const [open, setOpen] = useState<string | null>(null);

  const items: Item[] = [
    {
      key: "what",
      label: "What",
      source: "inferred",
      panel: (
        <div className="space-y-1.5">
          <p className="text-sm text-muted">
            {tradeInfo(writeUp.trade).label}
            {factSource(writeUp.tradeSource) === "inferred" && <Guess />}
          </p>
          <p className="font-semibold">{writeUp.title}</p>
          <p>{writeUp.summary}</p>
          <Source source="inferred" note="Written by Legwork from what you told us." />
        </div>
      ),
    },
    writeUp.location
      ? {
          key: "where",
          label: writeUp.location,
          source: "given",
          lead: <Icon name={icons.pin} className="size-3.5 text-muted" />,
          panel: (
            <div className="space-y-1.5">
              <p className="font-semibold">{writeUp.location}</p>
              <Source source="given" note="The Pro gets the suburb, not your address." />
            </div>
          ),
        }
      : {
          key: "where",
          label: "Suburb",
          gap: true,
          panel: <GapPanel label="Suburb" say="It's in " onSay={onSay} />,
        },
    {
      key: "when",
      label: deadline.short,
      // A time danger chose is Legwork's call, not the customer's.
      source: whenNote ? "inferred" : "given",
      lead: <Icon name={icons.clock} className="size-3.5 text-muted" />,
      panel: (
        <div className="space-y-1.5">
          <p className="font-semibold">{deadline.full}</p>
          <p className="text-sm text-muted">{whenNote ?? "Pick how soon with the prices below."}</p>
        </div>
      ),
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
            <img key={p.id} src={photoUrl(p.path, uploadToken)} alt="" className="size-5 rounded-full object-cover ring-2 ring-glass grayscale" />
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
                className="lw-thumb size-16 ring-1 ring-line"
              />
            ))}
          </div>
        </div>
      ),
    });
  }

  for (const d of writeUp.details) {
    const source = factSource(d.source);
    items.push({
      key: `detail-${d.label}`,
      label: d.label,
      source,
      panel: (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-muted">{d.label}</p>
          <p className="font-semibold">{d.value}</p>
          <Source source={source} />
        </div>
      ),
    });
  }

  for (const label of writeUp.missing ?? []) {
    items.push({
      key: `missing-${label}`,
      label,
      gap: true,
      panel: <GapPanel label={label} say={`${label}: `} onSay={onSay} />,
    });
  }

  const current = items.find((item) => item.key === open);
  const guesses = items.some((item) => item.source === "inferred");

  return (
    <div className="mt-3">
      <ul
        aria-label="What the tradie gets"
        className="flex flex-wrap gap-1.5"
      >
        {items.map((item) => {
          const selected = item.key === open;
          return (
            <li key={item.key} className="min-w-0 max-w-full">
              <button
                type="button"
                aria-expanded={selected}
                onClick={() => setOpen(selected ? null : item.key)}
                className={`lw-chip lw-chip--compact max-w-full gap-1.5 px-2.5 text-[13px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-selected ${
                  highlight?.has(item.key) ? "animate-changed" : ""
                } ${item.gap ? "lw-chip--gap text-muted" : selected ? "is-selected" : ""}`}
              >
                {item.gap ? (
                  <span aria-hidden className="text-base leading-none">
                    +
                  </span>
                ) : (
                  <Icon name={icons.check} className="size-3.5 text-ink" />
                )}
                {item.lead}
                <span className="max-w-[9rem] truncate">{item.label}</span>
                {item.source === "inferred" && <Guess />}
                <span className="sr-only">{item.gap ? ", missing: tap to add" : ", the tradie gets this"}</span>
              </button>
            </li>
          );
        })}
        {uploading > 0 && (
          <li aria-live="polite">
            <span className="lw-chip lw-chip--compact lw-chip--gap gap-1.5 px-2.5 text-[13px] text-muted">
              <Spinner />
              Uploading {uploading === 1 ? "photo" : `${uploading} photos`}
            </span>
          </li>
        )}
      </ul>
      {guesses && !current && (
        <p className="lw-footnote mt-1.5 truncate text-faint">
          <span className="text-ink">✦</span> Legwork&apos;s guess · tap to see what the tradie gets
        </p>
      )}
      {current && (
        <div className="lw-inner lw-callout mt-2 p-3.5 animate-fade-in">
          {current.panel}
        </div>
      )}
    </div>
  );
}

/** The marker for a value the assistant decided rather than the customer. */
function Guess() {
  return (
    <span className="ml-0.5 text-[11px] text-ink" title="Legwork's guess">
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
          <span className="text-ink">✦</span> Legwork&apos;s guess from your photos or words. Check it&apos;s right.
        </>
      )}
    </p>
  );
}

/** An essential nobody has settled: say it below, and the composer starts the sentence. */
function GapPanel({ label, say, onSay }: { label: string; say: string; onSay?: (text: string) => void }) {
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted">A Pro usually asks about this. Say it below and they won&apos;t need to.</p>
      {onSay && (
        <button
          type="button"
          onClick={() => onSay(say)}
          className="lw-chip lw-press min-h-11 font-semibold"
        >
          <Icon name={icons.mic} className="size-4" />
          Add {label.toLowerCase()}
        </button>
      )}
    </div>
  );
}
