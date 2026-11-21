"use client";

import type { JobWriteUp, PriceRange, Tier } from "@legwork/shared";
import { cardClass, Icon, icons } from "@/components/ui";
import { money, niceDate, TierBadge, tradeLabel } from "./bits";

/** The confirmed summary card, as the customer approved it. */
export function JobSummary({
  writeUp,
  tier,
  date,
  price,
  quote,
  distanceKm,
  compact,
}: {
  writeUp: JobWriteUp;
  tier: Tier;
  date: string;
  price: PriceRange;
  quote?: number | null;
  distanceKm?: number;
  compact?: boolean;
}) {
  return (
    <section aria-label="The job" className={`${cardClass} space-y-3 p-4`}>
      <div className="flex flex-wrap items-center gap-2">
        <TierBadge tier={tier} />
        <span className="text-xs font-semibold text-muted">{tradeLabel(writeUp.trade)}</span>
        <span className="text-xs text-faint">· Severity {writeUp.severity}/5</span>
        {writeUp.safety && <span className="rounded-full bg-danger/10 px-2 py-0.5 text-xs font-semibold text-danger">Safety risk</span>}
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">{writeUp.title}</h2>
        <p className="shrink-0 font-semibold tabular-nums">{quote ? money(quote) : `${money(price.min)}–${money(price.max)}`}</p>
      </div>
      {!compact && <p className="text-sm text-muted text-pretty">{writeUp.summary}</p>}
      {!compact && writeUp.details.length > 0 && (
        <dl className="space-y-1 text-sm">
          {writeUp.details.map((d) => (
            <div key={d.label} className="flex gap-2">
              <dt className="shrink-0 text-faint">{d.label}</dt>
              <dd className="min-w-0">{d.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
        <span className="inline-flex items-center gap-1">
          <Icon d={icons.pin} className="size-4" />
          {writeUp.location ?? "Nearby"}
          {distanceKm !== undefined && ` · ~${Math.round(distanceKm)} km`}
        </span>
        <span className="inline-flex items-center gap-1">
          <Icon d={icons.clock} className="size-4" />
          {niceDate(date)}
        </span>
      </div>
    </section>
  );
}
