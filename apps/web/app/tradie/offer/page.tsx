"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { BID_NOTE_MAX, type TradieBidRequest, type TradieJobView } from "@legwork/shared";
import { money, TimeLeft } from "@/components/tradie/bits";
import { JobSummary } from "@/components/tradie/job-summary";
import { PhotoGrid } from "@/components/tradie/photo-viewer";
import { QuoteInput } from "@/components/tradie/quote-input";
import { useTradie } from "@/components/tradie/tradie-context";
import { buttonPrimary, buttonSecondary, cardClass, fieldClass, Icon, icons, Spinner, Walking } from "@/components/ui";
import { usePoll } from "@/lib/use-poll";

// One offer: the summary card, the photos full size, the tier, date, locked
// range, suburb and distance, and the time left. Bid inside the range (with an
// optional note) or pass. Then: bid sent, and won or lost.

export default function OfferPage() {
  return (
    <Suspense fallback={<Walking label="Opening the offer…" />}>
      <Offer />
    </Suspense>
  );
}

function Offer() {
  const jobId = useSearchParams().get("job") ?? "";
  const { call, session, refresh } = useTradie();
  const router = useRouter();
  const [view, setView] = useState<TradieJobView | null>(null);
  const [missing, setMissing] = useState(false);
  const [quote, setQuote] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"bid" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!jobId) return setMissing(true);
    try {
      const v = await call<TradieJobView>(`/jobs/${encodeURIComponent(jobId)}`);
      setView(v);
      // Start the slider in the middle of the range.
      if (v.job) {
        const { min, max } = v.job.price;
        setQuote((q) => q ?? Math.min(max, Math.max(min, Math.round((min + max) / 2 / 5) * 5)));
      }
    } catch (e) {
      if ((e as { status?: number }).status === 404) setMissing(true);
    }
  }, [call, jobId]);

  // Keep the state fresh while they look: someone else may win, or it may lapse.
  usePoll(load, 2000, !missing && view?.state !== "won" && view?.state !== "lost" && view?.state !== "lapsed");

  // Won: straight to the booked job.
  useEffect(() => {
    if (view?.state === "won") {
      void refresh();
      const t = setTimeout(() => router.replace(`/tradie/job/?id=${encodeURIComponent(jobId)}`), 1600);
      return () => clearTimeout(t);
    }
  }, [view?.state, jobId, router, refresh]);

  async function act(kind: "bid" | "decline") {
    setBusy(kind);
    setError(null);
    try {
      const next =
        kind === "bid"
          ? await call<TradieJobView>(`/jobs/${encodeURIComponent(jobId)}/bid`, { json: { quote: quote!, note: note.trim() || null } satisfies TradieBidRequest })
          : await call<TradieJobView>(`/jobs/${encodeURIComponent(jobId)}/decline`, { json: {} });
      setView(next);
      void refresh();
    } catch (e) {
      setError((e as Error).message);
      void load();
    } finally {
      setBusy(null);
    }
  }

  if (missing) {
    return (
      <div className="space-y-4">
        <p className="text-lg font-semibold">This offer isn&rsquo;t available.</p>
        <Link href="/tradie/inbox/" className={`${buttonSecondary} w-full`}>
          Back to offers
        </Link>
      </div>
    );
  }
  if (!view || !session) return <Walking label="Opening the offer…" />;

  const job = view.job;
  return (
    <div className="space-y-5">
      <Link href="/tradie/inbox/" className="inline-flex items-center gap-1 text-sm font-semibold text-muted hover:text-ink">
        <Icon d={icons.back} className="size-4" /> Offers
      </Link>

      {view.state === "won" && (
        <Banner tone="success" title="You got the job!" text="Opening your booking…" />
      )}
      {view.state === "lost" && <Banner tone="muted" title="You didn't get this one" text={view.message ?? ""} />}
      {view.state === "lapsed" && <Banner tone="muted" title="Offer closed" text={view.message ?? ""} />}
      {view.state === "bid_sent" && (
        <Banner
          tone="brand"
          title={`Bid sent · ${job?.quote !== null && job?.quote !== undefined ? money(job.quote) : ""}`}
          text="Waiting on the customer. We'll tell you straight away if you win."
          live
        />
      )}

      {job && (
        <>
          <JobSummary writeUp={job.writeUp} tier={job.tier} date={job.date} price={job.price} distanceKm={job.distanceKm} />
          <section aria-label="Photos" className="space-y-2">
            <h2 className="text-sm font-semibold">Photos</h2>
            <PhotoGrid photos={job.photos} token={session.token} />
          </section>
          <p className="text-xs text-faint">The exact address is shared once you&rsquo;re booked.</p>
        </>
      )}

      {view.state === "pending" && job && quote !== null && (
        <section className={`${cardClass} space-y-4 p-4`} aria-label="Your bid">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Send a quote</h2>
            <TimeLeft until={job.respondsBy} />
          </div>
          <QuoteInput range={job.price} value={quote} onChange={setQuote} />
          <div>
            <label htmlFor="note" className="text-sm font-semibold">
              Note <span className="font-normal text-faint">(optional)</span>
            </label>
            <textarea
              id="note"
              rows={2}
              value={note}
              maxLength={BID_NOTE_MAX}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. I can come this afternoon and carry the parts."
              className={`${fieldClass} mt-1.5 resize-none`}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <div className="flex gap-3">
            <button type="button" onClick={() => void act("decline")} disabled={!!busy} className={`${buttonSecondary} flex-1`}>
              {busy === "decline" && <Spinner />}
              Pass
            </button>
            <button type="button" onClick={() => void act("bid")} disabled={!!busy} className={`${buttonPrimary} flex-[2]`}>
              {busy === "bid" && <Spinner />}
              Bid {money(quote)}
            </button>
          </div>
        </section>
      )}

      {(view.state === "lost" || view.state === "lapsed") && (
        <Link href="/tradie/inbox/" className={`${buttonSecondary} w-full`}>
          Back to offers
        </Link>
      )}
    </div>
  );
}

function Banner({ tone, title, text, live }: { tone: "success" | "brand" | "muted"; title: string; text: string; live?: boolean }) {
  const colours = { success: "bg-success-soft text-success", brand: "bg-brand-soft text-brand", muted: "bg-surface text-muted" }[tone];
  return (
    <div role="status" className={`flex items-start gap-3 rounded-[20px] p-4 animate-question ${colours}`}>
      {live && (
        <span className="relative mt-1.5 flex size-2.5 shrink-0">
          <span className="absolute inset-0 animate-ping rounded-full bg-brand opacity-60" />
          <span className="relative size-2.5 rounded-full bg-brand" />
        </span>
      )}
      <div>
        <p className="font-semibold">{title}</p>
        {text && <p className="text-sm opacity-90">{text}</p>}
      </div>
    </div>
  );
}
