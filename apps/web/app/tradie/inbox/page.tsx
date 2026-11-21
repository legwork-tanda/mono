"use client";

import Link from "next/link";
import { OfferCard } from "@/components/tradie/offer-card";
import { useTradie } from "@/components/tradie/tradie-context";
import { Walking } from "@/components/ui";

// New offers within a couple of seconds of being sent (the shell polls), and
// the phone buzzes when one arrives. Lapsed and lost offers drop off.

export default function TradieInboxPage() {
  const { inbox, session } = useTradie();
  const pending = inbox?.offers.filter((o) => o.state === "pending") ?? [];
  const waiting = inbox?.offers.filter((o) => o.state === "bid_sent") ?? [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[1.75rem] leading-tight font-semibold tracking-[-0.015em]">Offers</h1>
        <p className="mt-1 text-muted">
          {session?.tradie.trades.length ? `Jobs within ${session.tradie.radiusKm} km that need you.` : "Jobs near you."}
        </p>
        {session && (
          <Link href="/tradie/me/" className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:text-brand-strong">
            ★ {session.tradie.rating.toFixed(1)} · See your reviews
          </Link>
        )}
      </div>

      {!inbox ? (
        <Walking label="Checking for jobs…" />
      ) : inbox.offers.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-[20px] border border-dashed border-line px-6 py-12 text-center">
          <span className="relative flex size-3">
            <span className="absolute inset-0 animate-ping rounded-full bg-brand opacity-50" />
            <span className="relative size-3 rounded-full bg-brand" />
          </span>
          <p className="font-semibold">Waiting for jobs</p>
          <p className="text-sm text-muted text-pretty">Keep this open. New offers show up here and your phone buzzes.</p>
        </div>
      ) : (
        <>
          {pending.length > 0 && (
            <section className="space-y-3" aria-label="New offers">
              {pending.map((o) => (
                <OfferCard key={o.jobId} offer={o} />
              ))}
            </section>
          )}
          {waiting.length > 0 && (
            <section className="space-y-3" aria-label="Waiting on the customer">
              <h2 className="text-sm font-semibold text-muted">Waiting on the customer</h2>
              {waiting.map((o) => (
                <OfferCard key={o.jobId} offer={o} />
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}
