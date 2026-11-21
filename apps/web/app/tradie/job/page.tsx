"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useState } from "react";
import type { TradieJobView, TradieStageRequest } from "@legwork/shared";
import { JOB_STEPS, jobStep, money, STAGE_ACTION } from "@/components/tradie/bits";
import { JobSummary } from "@/components/tradie/job-summary";
import { SharingIndicator, useLocationShare } from "@/components/tradie/location-share";
import { PhotoGrid } from "@/components/tradie/photo-viewer";
import { TradieChat } from "@/components/tradie/tradie-chat";
import { useTradie } from "@/components/tradie/tradie-context";
import { buttonPrimary, buttonSecondary, ErrorNote, Icon, icons, Stepper, Walking } from "@/components/ui";
import { mapsLink } from "@/lib/maps";
import { usePoll } from "@/lib/use-poll";

// A booked job: the job stepper, Navigate, the one next stage button (I'm on
// my way, I'm at the door, Finish job), location sharing while on the way,
// messages, and the job's details and photos.

export default function BookedJobPage() {
  return (
    <Suspense fallback={<Loading />}>
      <BookedJob />
    </Suspense>
  );
}

function Loading() {
  return (
    <div className="lw-screen items-center justify-center">
      <Walking label="Opening the job…" />
    </div>
  );
}

function Screen({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="lw-screen">
      <header className="lw-appbar">
        <Link href="/tradie/home/" className="lw-glass lw-glass--circle lw-press" aria-label="Back to your dashboard">
          <Icon name={icons.back} />
        </Link>
        <h1 className="lw-headline min-w-0 flex-1 truncate text-center">{title}</h1>
        <span className="size-11 shrink-0" aria-hidden />
      </header>
      <main className="lw-screen__body gap-3">{children}</main>
    </div>
  );
}

function BookedJob() {
  const jobId = useSearchParams().get("id") ?? "";
  const { call, session, bookings, refresh, showToast } = useTradie();
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
  // Picks up a cancellation by the user within a couple of seconds.
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
      showToast(STAGE_ACTION[to].done);
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
      <Screen title="Job">
        <section className="lw-glass p-[18px]">
          <p className="lw-headline">This job isn&rsquo;t available.</p>
          <Link href="/tradie/home/" className={`${buttonSecondary} mt-4 w-full`}>
            Back to your dashboard
          </Link>
        </section>
      </Screen>
    );
  }
  if (!view || !session) return <Loading />;
  const job = view.job;
  const unread = bookings?.bookings.find((b) => b.jobId === jobId)?.unread ?? 0;
  const action = job?.nextStage ? STAGE_ACTION[job.nextStage] : null;

  return (
    <Screen title={job?.writeUp.title ?? "Job"}>
      {view.state === "cancelled" && (
        <section role="alert" className="lw-glass is-error p-[18px]">
          <p className="lw-headline">{view.message}</p>
          <p className="lw-caption lw-c2 mt-0.5">No need to go. It&rsquo;s been taken off your list.</p>
        </section>
      )}

      {!job ? (
        <p className="lw-callout lw-c2">{view.message}</p>
      ) : (
        <>
          <section aria-label="Where the job is up to" className={`lw-glass px-[18px] pt-[22px] pb-[18px] ${view.state === "won" ? "lw-tape-top" : ""}`}>
            <div className="flex items-baseline justify-between gap-3">
              <p className="lw-caption lw-strong">{job.stage === "completed" ? "Job complete" : "Booked"}</p>
              {job.quote !== null && <p className="lw-headline lw-num">{money(job.quote)}</p>}
            </div>
            <Stepper steps={JOB_STEPS} current={jobStep(job.stage)} className="mt-3" />

            {job.stage === "completed" ? (
              <p className="lw-caption lw-c2 mt-3">Nice work. They can review you now.</p>
            ) : (
              view.state === "won" && (
                <div className="mt-4 space-y-3">
                  {share !== "off" && <SharingIndicator state={share} />}
                  {job.nextStage && action && (
                    <button type="button" onClick={() => void advance(job.nextStage!)} disabled={busy} className={`${buttonPrimary} w-full`}>
                      <Icon name={action.icon} />
                      {busy ? "Sending…" : action.label}
                    </button>
                  )}
                  {job.nextStage === "en_route" && (
                    <p className="lw-footnote lw-c3 text-center text-pretty">Your phone shares its location while you&rsquo;re on the way, so they can see you coming.</p>
                  )}
                  {error && <ErrorNote>{error}</ErrorNote>}
                  <div className="flex gap-2.5">
                    <a href={mapsLink(job.location, job.writeUp.location)} target="_blank" rel="noreferrer" className={`${buttonSecondary} flex-1`}>
                      <Icon name={icons.pin} />
                      Navigate
                    </a>
                    <MessagesButton unread={unread} canMessage={job.canMessage} onClick={() => setChatOpen(true)} />
                  </div>
                </div>
              )
            )}
            {(job.stage === "completed" || view.state !== "won") && (
              <div className="mt-4">
                <MessagesButton unread={unread} canMessage={job.canMessage} onClick={() => setChatOpen(true)} />
              </div>
            )}
          </section>

          <JobSummary writeUp={job.writeUp} tier={job.tier} date={job.date} price={job.price} quote={job.quote} />
          <section aria-label="Photos" className="lw-glass p-[18px]">
            <h2 className="lw-headline mb-2.5">Photos</h2>
            <PhotoGrid photos={job.photos} token={session.token} />
          </section>
        </>
      )}

      {chatOpen && <TradieChat jobId={jobId} onClose={() => setChatOpen(false)} />}
    </Screen>
  );
}

function MessagesButton({ unread, canMessage, onClick }: { unread: number; canMessage: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`${buttonSecondary} flex-1`}>
      <Icon name={icons.chat} />
      {canMessage ? "Message" : "Messages"}
      {unread > 0 && (
        <span className="lw-count" aria-label={`${unread} unread`}>
          {unread}
        </span>
      )}
    </button>
  );
}
