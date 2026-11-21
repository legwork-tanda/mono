"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useState } from "react";
import type { TradieJobView, TradieStageRequest } from "@legwork/shared";
import { money, StageBadge } from "@/components/tradie/bits";
import { JobSummary } from "@/components/tradie/job-summary";
import { SharingIndicator, useLocationShare } from "@/components/tradie/location-share";
import { PhotoGrid } from "@/components/tradie/photo-viewer";
import { TradieChat } from "@/components/tradie/tradie-chat";
import { useTradie } from "@/components/tradie/tradie-context";
import { buttonPrimary, buttonSecondary, Icon, icons, Spinner, Walking } from "@/components/ui";
import { mapsLink } from "@/lib/maps";
import { usePoll } from "@/lib/use-poll";

// A booked job: the details, Navigate, the one next stage button (On my way,
// Start job, Finish job), location sharing while on the way, and the chat.

const NEXT_LABEL: Record<TradieStageRequest["to"], string> = {
  en_route: "On my way",
  in_progress: "Start job",
  completed: "Finish job",
};

export default function BookedJobPage() {
  return (
    <Suspense fallback={<Walking label="Opening the job…" />}>
      <BookedJob />
    </Suspense>
  );
}

function BookedJob() {
  const jobId = useSearchParams().get("id") ?? "";
  const { call, session, bookings, refresh } = useTradie();
  const [view, setView] = useState<TradieJobView | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);

  const path = `/jobs/${encodeURIComponent(jobId)}`;
  const load = useCallback(async () => {
    if (!jobId) return setMissing(true);
    try {
      setView(await call<TradieJobView>(path));
    } catch (e) {
      if ((e as { status?: number }).status === 404) setMissing(true);
    }
  }, [call, path, jobId]);
  // Picks up a cancellation by the customer within a couple of seconds.
  usePoll(load, 2000, !missing && view?.job?.stage !== "completed" && view?.state !== "cancelled");

  const stage = view?.job?.stage;
  const share = useLocationShare(stage === "en_route", async (p) => {
    await call(`${path}/location`, { json: p });
  });

  async function advance(to: TradieStageRequest["to"]) {
    setBusy(true);
    setError(null);
    try {
      setView(await call<TradieJobView>(`${path}/stage`, { json: { to } satisfies TradieStageRequest }));
      void refresh();
    } catch (e) {
      setError((e as Error).message);
      void load();
    } finally {
      setBusy(false);
    }
  }

  if (missing) {
    return (
      <div className="space-y-4">
        <p className="text-lg font-semibold">This job isn&rsquo;t available.</p>
        <Link href="/tradie/jobs/" className={`${buttonSecondary} w-full`}>
          Back to my jobs
        </Link>
      </div>
    );
  }
  if (!view || !session) return <Walking label="Opening the job…" />;
  const job = view.job;
  const unread = bookings?.bookings.find((b) => b.jobId === jobId)?.unread ?? 0;

  return (
    <div className="space-y-5">
      <Link href="/tradie/jobs/" className="inline-flex items-center gap-1 text-sm font-semibold text-muted hover:text-ink">
        <Icon name={icons.back} className="size-4" /> My jobs
      </Link>

      {view.state === "cancelled" && (
        <div role="alert" className="rounded-[20px] bg-surface p-4 text-ink">
          <p className="font-semibold">{view.message}</p>
          <p className="text-sm">No need to go. It&rsquo;s been taken off your list.</p>
        </div>
      )}

      {!job ? (
        <p className="text-muted">{view.message}</p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <StageBadge stage={job.stage} />
            {job.quote !== null && <span className="text-lg font-semibold tabular-nums">{money(job.quote)}</span>}
          </div>

          {job.stage === "completed" ? (
            <div className="rounded-[20px] bg-surface p-4 text-ink">
              <p className="font-semibold">Job complete</p>
              <p className="text-sm">Nice work. The customer can now review you.</p>
            </div>
          ) : (
            view.state === "won" && (
              <section className="space-y-3" aria-label="Next step">
                <a href={mapsLink(job.location, job.writeUp.location)} target="_blank" rel="noreferrer" className={`${buttonSecondary} w-full`}>
                  <Icon name={icons.pin} />
                  Navigate
                </a>
                <SharingIndicator state={share} />
                {job.nextStage && (
                  <button type="button" onClick={() => void advance(job.nextStage!)} disabled={busy} className={`${buttonPrimary} w-full`}>
                    {busy && <Spinner />}
                    {NEXT_LABEL[job.nextStage]}
                  </button>
                )}
                {job.nextStage === "en_route" && (
                  <p className="text-center text-xs text-faint text-pretty">Your phone shares its location while you&rsquo;re on the way, so the customer can see you coming.</p>
                )}
                {error && (
                  <p role="alert" className="text-sm text-ink">
                    {error}
                  </p>
                )}
              </section>
            )
          )}

          <button type="button" onClick={() => setChatOpen(true)} className={`${buttonSecondary} w-full`}>
            <Icon name={icons.chat} />
            {job.canMessage ? "Message the customer" : "View messages"}
            {unread > 0 && <span className="rounded-full bg-ink px-2 text-xs font-bold text-canvas">{unread}</span>}
          </button>

          <JobSummary writeUp={job.writeUp} tier={job.tier} date={job.date} price={job.price} quote={job.quote} />
          <section aria-label="Photos" className="space-y-2">
            <h2 className="text-sm font-semibold">Photos</h2>
            <PhotoGrid photos={job.photos} token={session.token} />
          </section>
        </>
      )}

      {chatOpen && <TradieChat jobId={jobId} onClose={() => setChatOpen(false)} />}
    </div>
  );
}
