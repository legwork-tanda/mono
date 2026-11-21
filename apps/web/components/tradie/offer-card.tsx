"use client";

import Link from "next/link";
import type { TradieInboxItem } from "@legwork/shared";
import { cardClass, Icon, icons } from "@/components/ui";
import { money, niceDate, TierBadge, TimeLeft, tradeLabel } from "./bits";

/** One offer in the inbox: enough to tell at a glance whether it's worth opening. */
export function OfferCard({ offer }: { offer: TradieInboxItem }) {
  return (
    <Link href={`/tradie/offer/?job=${encodeURIComponent(offer.jobId)}`} className={`${cardClass} block p-4 transition-shadow hover:shadow-float animate-question`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <TierBadge tier={offer.tier} />
          <span className="text-xs font-semibold text-muted">{tradeLabel(offer.trade)}</span>
        </div>
        {offer.state === "pending" ? (
          <TimeLeft until={offer.respondsBy} />
        ) : (
          <span className="text-sm font-semibold text-ink">Bid sent · {offer.quote !== null ? money(offer.quote) : ""}</span>
        )}
      </div>
      <p className="mt-2 text-lg font-semibold">{offer.title}</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
        <span className="inline-flex items-center gap-1">
          <Icon name={icons.pin} className="size-4" />
          {offer.suburb ?? "Nearby"} · ~{Math.round(offer.distanceKm)} km
        </span>
        <span className="inline-flex items-center gap-1">
          <Icon name={icons.clock} className="size-4" />
          {niceDate(offer.date)}
        </span>
      </div>
      <p className="mt-3 text-base font-semibold tabular-nums">
        {money(offer.price.min)}–{money(offer.price.max)} <span className="text-sm font-normal text-muted">locked range</span>
      </p>
    </Link>
  );
}
