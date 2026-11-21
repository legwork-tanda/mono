"use client";

import Link from "next/link";
import { niceDate, StageBadge, tradeLabel } from "@/components/tradie/bits";
import { useTradie } from "@/components/tradie/tradie-context";
import { cardClass, Walking } from "@/components/ui";

// The jobs this tradie has won: what's coming up, what they're on, and recent
// finished or cancelled ones, each with unread messages.

export default function TradieJobsPage() {
  const { bookings } = useTradie();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[1.75rem] leading-tight font-semibold tracking-[-0.015em]">My jobs</h1>
        <p className="mt-1 text-muted">Jobs you&rsquo;ve won. Tap one to head there or message the customer.</p>
      </div>

      {!bookings ? (
        <Walking label="Loading your jobs…" />
      ) : bookings.bookings.length === 0 ? (
        <div className="rounded-[20px] border border-dashed border-line px-6 py-12 text-center">
          <p className="font-semibold">No jobs yet</p>
          <p className="mt-1 text-sm text-muted">Win an offer and it shows up here.</p>
          <Link href="/tradie/inbox/" className="mt-3 inline-block text-sm font-semibold text-ink underline underline-offset-2">
            See offers
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {bookings.bookings.map((b) => (
            <li key={b.jobId}>
              <Link href={`/tradie/job/?id=${encodeURIComponent(b.jobId)}`} className={`${cardClass} flex items-center gap-3 p-4 transition-shadow hover:shadow-float ${b.stage === "cancelled" ? "opacity-70" : ""}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <StageBadge stage={b.stage} />
                    <span className="text-xs font-semibold text-muted">{tradeLabel(b.trade)}</span>
                  </div>
                  <p className="mt-1.5 truncate font-semibold">{b.title}</p>
                  <p className="truncate text-sm text-muted">
                    {b.message ?? [b.suburb, niceDate(b.date)].filter(Boolean).join(" · ")}
                  </p>
                </div>
                {b.unread > 0 && (
                  <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-ink px-2 text-xs font-bold text-canvas" aria-label={`${b.unread} unread`}>
                    {b.unread}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
