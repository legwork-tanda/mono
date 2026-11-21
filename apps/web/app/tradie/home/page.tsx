"use client";

import Link from "next/link";
import { useState } from "react";
import type { TradieBooking, TradieInboxItem, TradieJobView } from "@legwork/shared";
import { Mark } from "@/components/mark";
import { ACTIVE_STAGES, DateTile, money, NEXT_STAGE, niceDate, STAGE_ACTION, tradeLabel } from "@/components/tradie/bits";
import { SharingIndicator, useLocationShare } from "@/components/tradie/location-share";
import { useTradie } from "@/components/tradie/tradie-context";
import { buttonPrimary, ErrorNote, Icon, icons, Walking } from "@/components/ui";

// T01 Dashboard and T05 Offer sent (legwork-tradie v0.1): the online switch,
// today's numbers, the next job with its one yellow action, what's coming up
// (bids in flight with the tape marker), and the searching bar. Offers take
// over the screen from the shell.

/**
 * Sample numbers for the demo: the API doesn't track earnings or how often a
 * tradie says yes yet. The rating is real.
 */
const SAMPLE = { today: 420, jobsDone: 3, unpaid: 95, yesRate: 92, week: 1840 };

const jobHref = (jobId: string) => `/tradie/job/?id=${encodeURIComponent(jobId)}`;

/** On the way or at the job first, then the soonest booked. */
const byUrgency = (a: TradieBooking, b: TradieBooking) => {
  const live = (x: TradieBooking) => (x.stage === "matched" ? 1 : 0);
  return live(a) - live(b) || a.date.localeCompare(b.date);
};

export default function TradieHome() {
  const { session, inbox, bookings, online, setOnline } = useTradie();
  if (!session) return null;

  const active = (bookings?.bookings.filter((b) => ACTIVE_STAGES.has(b.stage)) ?? []).sort(byUrgency);
  const next = active[0];
  const later = active.slice(1);
  const recent = bookings?.bookings.filter((b) => !ACTIVE_STAGES.has(b.stage)) ?? [];
  const sent = inbox?.offers.filter((o) => o.state === "bid_sent") ?? [];
  const today = new Date().toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
  const { rating, reviewCount } = session.tradie;

  return (
    <div className="lw-screen">
      <header className="lw-appbar">
        <button
          type="button"
          role="switch"
          aria-checked={online}
          aria-label="Online"
          onClick={() => setOnline(!online)}
          className="lw-glass lw-glass--pill flex h-11 items-center gap-2.5 py-1.5 pr-1.5 pl-3 text-[15px] font-semibold"
        >
          <Mark className="h-[17px] w-auto" />
          <span aria-hidden>{online ? "Online" : "Offline"}</span>
          <span className={`lw-switch ${online ? "is-on" : ""}`} aria-hidden />
        </button>
        <Link href="/tradie/me/" className="lw-glass lw-glass--circle lw-press" aria-label="Your profile">
          <Icon name={icons.user} />
        </Link>
      </header>

      <main className="lw-screen__body gap-3 pb-28">
        <section aria-label="Today" className="lw-glass px-[18px] pt-4 pb-[18px] animate-question">
          <div className="flex justify-between gap-3">
            <span className="lw-caption lw-c2">Today</span>
            <span className="lw-caption lw-c2">{today}</span>
          </div>
          <p className="lw-figure mt-1.5" aria-label={`Earned today, ${money(SAMPLE.today)}`}>
            {money(SAMPLE.today)}
          </p>
          <p className="lw-caption lw-c2 mt-1.5">
            {SAMPLE.jobsDone} jobs done · {money(SAMPLE.unpaid)} still to be paid
          </p>
          <div className="mt-3.5 grid grid-cols-3 gap-2">
            <Stat label="Rating">
              {reviewCount > 0 ? (
                <span className="inline-flex items-center gap-1">
                  {rating.toFixed(1)} <Icon name="star" fill className="size-3.5" />
                </span>
              ) : (
                "New"
              )}
            </Stat>
            <Stat label="Said yes">{SAMPLE.yesRate}%</Stat>
            <Stat label="This week">{money(SAMPLE.week)}</Stat>
          </div>
        </section>

        {next && <NextJob key={next.jobId} job={next} />}

        <section aria-label="Coming up">
          <h2 className="lw-section-label">Coming up</h2>
          <div className="lw-glass px-3.5 py-1">
            {!bookings || !inbox ? (
              <div className="py-3">
                <Walking label="Checking your jobs…" size="size-8" />
              </div>
            ) : sent.length + later.length === 0 ? (
              <p className="lw-caption lw-c2 py-4">{next ? "Nothing else booked yet." : "No jobs booked yet. Stay online to get offers."}</p>
            ) : (
              <ul>
                {sent.map((o, i) => (
                  <li key={o.jobId}>
                    {i > 0 && <div className="lw-divider" />}
                    <SentRow offer={o} />
                  </li>
                ))}
                {later.map((b, i) => (
                  <li key={b.jobId}>
                    {(i > 0 || sent.length > 0) && <div className="lw-divider" />}
                    <BookingRow booking={b} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {recent.length > 0 && (
          <section aria-label="Recent">
            <h2 className="lw-section-label">Recent</h2>
            <ul className="lw-glass px-3.5 py-1">
              {recent.map((b, i) => (
                <li key={b.jobId}>
                  {i > 0 && <div className="lw-divider" />}
                  <BookingRow booking={b} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>

      <div role="status" className="lw-glass lw-glass--pill lw-tradie-status flex h-[52px] items-center gap-3 px-5">
        <span className={`lw-live-dot ${online ? "lw-live-dot--ping" : "lw-live-dot--off"}`} aria-hidden />
        <span className={`lw-subhead min-w-0 flex-1 truncate ${online ? "" : "lw-c2"}`}>
          {online ? `Looking for ${session.tradie.trades.map(tradeLabel).join(", ").toLowerCase()} jobs` : "You're offline. No new offers."}
        </span>
        {online && <span className="lw-caption lw-c3 lw-num">{session.tradie.radiusKm} km</span>}
      </div>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="lw-inner px-3 py-2.5">
      <p className="lw-headline lw-num">{children}</p>
      <p className="lw-footnote lw-c3">{label}</p>
    </div>
  );
}

/** The next booked job: tape along the top (it's booked) and its one yellow action. */
function NextJob({ job }: { job: TradieBooking }) {
  const { call, refresh, showToast } = useTradie();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const path = `/jobs/${encodeURIComponent(job.jobId)}`;
  const to = NEXT_STAGE[job.stage];
  const action = to ? STAGE_ACTION[to] : null;

  // While on the way, the user sees the van move on their map.
  const share = useLocationShare(job.stage === "en_route", async (p) => {
    await call(`${path}/location`, { json: p });
  });

  async function advance() {
    if (!to || !action) return;
    setBusy(true);
    setError(null);
    try {
      await call<TradieJobView>(`${path}/stage`, { json: { to } });
      showToast(action.done);
      void refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const eyebrow = job.stage === "en_route" ? "On the way" : job.stage === "in_progress" ? "At the job" : `Next · ${niceDate(job.date)}`;

  return (
    <section aria-label="Next job" className={`lw-glass lw-tape-top px-[18px] pt-[22px] pb-4 animate-question ${error ? "is-error" : ""}`}>
      <Link href={jobHref(job.jobId)} className="block">
        <div className="flex items-center justify-between gap-3">
          <span className="lw-caption lw-strong">{eyebrow}</span>
          <span className="lw-caption lw-c2">{tradeLabel(job.trade)}</span>
        </div>
        <h2 className="lw-title-3 mt-1.5">{job.title}</h2>
        <p className="lw-caption lw-c2">{job.suburb ?? "Address in the job details"}</p>
      </Link>
      {share !== "off" && <SharingIndicator state={share} className="mt-3" />}
      <div className="mt-3.5 flex gap-2.5">
        {action && (
          <button type="button" onClick={() => void advance()} disabled={busy} className={`${buttonPrimary} flex-1`}>
            <Icon name={action.icon} />
            {busy ? "Sending…" : action.label}
          </button>
        )}
        <Link href={jobHref(job.jobId)} className="lw-glass lw-glass--circle lw-press relative" aria-label={job.unread > 0 ? `Messages, ${job.unread} unread` : "Messages"}>
          <Icon name={icons.chat} />
          {job.unread > 0 && <span className="lw-count absolute -top-1 -right-1">{job.unread}</span>}
        </Link>
      </div>
      {error && <ErrorNote className="mt-3">{error}</ErrorNote>}
    </section>
  );
}

/** A bid in flight: the tape marker and the landed paper plane, as on the user's "Request sent" row. */
function SentRow({ offer }: { offer: TradieInboxItem }) {
  return (
    <div className="lw-li lw-tape-marker animate-question" aria-label={`Bid sent, ${offer.title}, waiting for a reply`}>
      <span className="lw-initials lw-initials--accent lw-sent-icon">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/legwork-sent-plane.svg" alt="" width={24} height={24} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="lw-headline truncate text-base">Bid sent · waiting for a reply</p>
        <p className="lw-caption lw-c2 truncate">
          {offer.title} · {niceDate(offer.date)}
        </p>
      </div>
      {offer.quote !== null && <span className="lw-caption lw-strong lw-num">{money(offer.quote)}</span>}
    </div>
  );
}

function BookingRow({ booking: b }: { booking: TradieBooking }) {
  const booked = ACTIVE_STAGES.has(b.stage);
  const sub = b.message ?? [b.suburb, niceDate(b.date)].filter(Boolean).join(" · ");
  return (
    <Link href={jobHref(b.jobId)} className={`lw-li lw-press ${booked ? "lw-tape-marker" : ""}`}>
      <DateTile date={b.date} />
      <div className="min-w-0 flex-1">
        <p className={`lw-headline truncate text-base ${booked ? "" : "lw-c2"}`}>{b.title}</p>
        <p className="lw-caption lw-c2 truncate">{b.stage === "completed" ? `Done · ${sub}` : sub}</p>
      </div>
      {b.unread > 0 ? (
        <span className="lw-count" aria-label={`${b.unread} unread`}>
          {b.unread}
        </span>
      ) : (
        <Icon name={icons.caretRight} className="lw-c3 size-4" />
      )}
    </Link>
  );
}
