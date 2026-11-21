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
    <section aria-label="The job" className={`${cardClass} space-y-3 p-[18px]`}>
      <div className="flex flex-wrap items-center gap-2">
        <TierBadge tier={tier} />
        <span className="lw-caption lw-strong lw-c2">{tradeLabel(writeUp.trade)}</span>
        <span className="lw-caption lw-c3">· Severity {writeUp.severity}/5</span>
        {writeUp.safety && (
          <span className="lw-badge">
            <Icon name={icons.warning} className="size-3.5" />
            Safety risk
          </span>
        )}
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="lw-headline">{writeUp.title}</h2>
        <p className="lw-headline lw-num shrink-0">{quote ? money(quote) : `${money(price.min)}–${money(price.max)}`}</p>
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
          <Icon name={icons.pin} className="size-4" />
          {writeUp.location ?? "Nearby"}
          {distanceKm !== undefined && ` · ~${Math.round(distanceKm)} km`}
        </span>
        <span className="inline-flex items-center gap-1">
          <Icon name={icons.clock} className="size-4" />
          {niceDate(date)}
        </span>
      </div>
    </section>
  );
}
