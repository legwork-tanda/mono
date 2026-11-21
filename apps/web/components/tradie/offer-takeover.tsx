"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BID_NOTE_MAX, type TradieBidRequest, type TradieInboxItem, type TradieJobView } from "@legwork/shared";
import { FILL } from "@/components/icon-paths";
import { buttonPrimary, buttonSecondary, ErrorNote, Icon, icons, Spinner, Stepper } from "@/components/ui";
import { Countdown, mmss, money, niceDate, Qty, tradeLabel, useSecondsLeft } from "./bits";
import { PhotoViewer, tradiePhotoUrl } from "./photo-viewer";
import { useTradie } from "./tradie-context";
import type { IconName } from "@/components/icon-paths";

// T02 Job offer and T04 Your price (legwork-tradie v0.1), on the current API:
// the offer takes over the screen like a ride request, with the time left on
// a ring. Say yes, then set one quote inside the locked range and send the
// bid. T03 Pick times waits for the API to know about time windows.

/** The first unanswered offer takes over the screen while online. Others queue behind it. */
export function OfferTakeover() {
  const { inbox, online, session, showToast } = useTradie();
  const [answered, setAnswered] = useState<ReadonlySet<string>>(new Set());
  const offer = online ? inbox?.offers.find((o) => o.state === "pending" && !answered.has(o.jobId)) : undefined;

  // An offer that vanishes while it's open closed on the server (ran out, or someone else was booked).
  const shown = useRef<string | null>(null);
  useEffect(() => {
    const was = shown.current;
    shown.current = offer?.jobId ?? null;
    if (was && was !== offer?.jobId && online && !answered.has(was)) showToast("That offer closed.", "info");
  }, [offer?.jobId, online, answered, showToast]);

  const done = useCallback((jobId: string) => setAnswered((s) => new Set(s).add(jobId)), []);

  if (!offer || !session) return null;
  return <OfferSheet key={offer.jobId} offer={offer} token={session.token} onDone={done} />;
}

const reduceMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function OfferSheet({ offer, token, onDone }: { offer: TradieInboxItem; token: string; onDone: (jobId: string) => void }) {
  const { call, refresh, showToast } = useTradie();
  const path = `/jobs/${encodeURIComponent(offer.jobId)}`;
  const [view, setView] = useState<TradieJobView | null>(null);
  const [step, setStep] = useState<"offer" | "price">("offer");
  const { min, max } = offer.price;
  const [quote, setQuote] = useState(() => Math.min(max, Math.max(min, Math.round((min + max) / 2 / 5) * 5)));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"bid" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [photo, setPhoto] = useState<number | null>(null);
  const title = useRef<HTMLHeadingElement>(null);

  // The ring starts full when the offer opens; the server's respondsBy decides when it ends.
  const left = useSecondsLeft(offer.respondsBy);
  const [total] = useState(() => (offer.respondsBy ? Math.max(1, Math.round((Date.parse(offer.respondsBy) - Date.now()) / 1000)) : 1));

  const close = useCallback(
    (text: string, icon: IconName) => {
      setLeaving(true);
      const go = () => {
        showToast(text, icon);
        onDone(offer.jobId);
        void refresh();
      };
      if (reduceMotion()) go();
      else setTimeout(go, 220);
    },
    [offer.jobId, onDone, refresh, showToast],
  );

  useEffect(() => {
    let live = true;
    call<TradieJobView>(path)
      .then((v) => live && setView(v))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [call, path]);

  useEffect(() => title.current?.focus(), [step]);

  useEffect(() => {
    if (left === 0 && !busy && !leaving) close("Offer expired. You didn't answer in time.", "clock");
  }, [left, busy, leaving, close]);

  async function pass() {
    setBusy("decline");
    setError(null);
    try {
      await call(`${path}/decline`, { json: {} });
      close("Passed. You won't see this job again.", "info");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function bid() {
    setBusy("bid");
    setError(null);
    try {
      await call(`${path}/bid`, { json: { quote, note: note.trim() || null } satisfies TradieBidRequest });
      close("Bid sent. We'll tell you if they book.", "paper-plane-right");
    } catch (e) {
      setError(`Couldn't send. ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  const job = view?.job;
  const photos = job?.photos ?? [];
  const km = Math.max(1, Math.round(offer.distanceKm));

  return (
    <div className="lw-offer" role="dialog" aria-modal="true" aria-label="New job offer">
      <div className="lw-offer__map">
        <OfferMap />
      </div>
      <div className="lw-offer__frame">
        <div className="lw-float-controls flex justify-center">
          <span className="lw-glass lw-glass--pill lw-headline flex h-11 items-center gap-2 px-[18px] text-[15px]">
            <Icon name={icons.truck} className="size-[18px]" />
            {km} km away
          </span>
        </div>

        {/* No grabber: it can't be swiped away by accident. Pass is a button. */}
        <section className={`lw-glass lw-glass--sheet lw-tape-top lw-offer__sheet ${leaving ? "is-leaving" : ""} ${error ? "is-error" : ""}`}>
          <div key={step} className="animate-question">
            {step === "offer" ? (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="lw-caption lw-strong">New job · {tradeLabel(offer.trade)}</p>
                    <h2 ref={title} tabIndex={-1} className="lw-title-1 mt-1.5 outline-none">
                      {offer.title}
                    </h2>
                    <p className="lw-caption lw-c2 mt-1.5 flex items-center gap-1.5">
                      <Icon name={icons.pin} className="size-4 shrink-0" />
                      {offer.suburb ?? "Nearby"} · {km} km
                    </p>
                  </div>
                  {left !== null && <Countdown left={left} total={total} />}
                </div>

                <div className="lw-inner mt-4 px-4 py-3.5">
                  <p className="lw-footnote lw-c3">What they need</p>
                  {job ? (
                    <p className="lw-callout mt-1 text-pretty">{job.writeUp.summary}</p>
                  ) : (
                    <Spinner className="mt-2" />
                  )}
                  {photos.length > 0 && (
                    <div className="mt-2.5 flex gap-1.5">
                      {photos.map((p, i) => (
                        <button key={p.id} type="button" onClick={() => setPhoto(i)} className="lw-press size-11 overflow-hidden rounded-[var(--lw-radius-sm)]" aria-label={`Photo ${i + 1} of ${photos.length}`}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={tradiePhotoUrl(p, token)} alt="" className="size-full object-cover" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="lw-chips mt-3.5">
                  <span className="lw-chip lw-chip--compact">
                    <Icon name={icons.clock} />
                    {niceDate(offer.date) || "Any time"}
                  </span>
                  <span className="lw-chip lw-chip--compact lw-num">
                    Locked {money(min)}–{money(max)}
                  </span>
                </div>

                {error && <ErrorNote className="mt-3">{error}</ErrorNote>}

                <div className="mt-[18px] flex gap-2.5">
                  <button type="button" onClick={() => void pass()} disabled={!!busy || leaving} className={`${buttonSecondary} w-28 shrink-0`}>
                    {busy === "decline" ? "Passing…" : "Pass"}
                  </button>
                  <button type="button" onClick={() => setStep("price")} disabled={!!busy || leaving} className={`${buttonPrimary} flex-1`}>
                    Say yes
                  </button>
                </div>
                <p className="lw-footnote lw-c3 mt-2.5 text-center">You&rsquo;ll set your price next.</p>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <button type="button" onClick={() => setStep("offer")} className="lw-icon-btn -ml-2.5" aria-label="Back to the job">
                    <Icon name={icons.back} />
                  </button>
                  {left !== null && (
                    <span className="lw-caption lw-c2 flex items-center gap-1.5" role="timer" aria-label={`Closes in ${left} seconds`}>
                      <Icon name="clock-countdown" className="size-4" />
                      Closes in <b className="lw-num text-ink">{mmss(left)}</b>
                    </span>
                  )}
                </div>
                <Stepper steps={["Yes", "Price"]} current={1} className="mt-1.5" />

                <h2 ref={title} tabIndex={-1} className="lw-title-2 mt-[18px] outline-none">
                  Your price
                </h2>
                <div className="mt-3.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="lw-headline">Your quote</p>
                    <p className="lw-footnote lw-c3 lw-num">
                      Inside the locked range, {money(min)}–{money(max)}.
                    </p>
                  </div>
                  <Qty value={quote} min={min} max={max} step={5} onChange={setQuote} label="your quote" />
                </div>

                <div className="lw-divider mt-3" />
                <label htmlFor="bid-note" className="lw-headline mt-3 block">
                  Note <span className="lw-c3 font-normal">(optional)</span>
                </label>
                <textarea
                  id="bid-note"
                  rows={2}
                  value={note}
                  maxLength={BID_NOTE_MAX}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="I can come this afternoon and bring the parts."
                  className="lw-input mt-1.5 resize-none"
                />

                <div className="lw-inner mt-3.5 px-3.5 py-3" role="group" aria-label={`They see: ${money(quote)}, ${niceDate(offer.date)}${note.trim() ? `, ${note.trim()}` : ""}`}>
                  <p className="lw-footnote lw-c3">They see</p>
                  <p className="lw-callout mt-0.5">
                    <span className="lw-strong lw-num">{money(quote)}</span> · {niceDate(offer.date) || "Any time"}
                  </p>
                  {note.trim() && <p className="lw-caption lw-c2 mt-0.5 text-pretty">&ldquo;{note.trim()}&rdquo;</p>}
                </div>

                {error && <ErrorNote className="mt-3">{error}</ErrorNote>}

                <button type="button" onClick={() => void bid()} disabled={!!busy || leaving} className={`${buttonPrimary} mt-4 w-full`}>
                  {busy === "bid" ? "Sending…" : `Send bid · ${money(quote)}`}
                </button>
              </>
            )}
          </div>
        </section>
      </div>

      {photo !== null && <PhotoViewer photos={photos} token={token} start={photo} onClose={() => setPhoto(null)} />}
    </div>
  );
}

// Placeholder map art, as in the design: roads, the route from the van to the job's suburb.
const grid = (y: number) => (
  <g transform={`translate(0 ${y})`}>
    <path className="minor" d="M-20 140 L410 138" />
    <path className="minor" d="M-20 270 L410 268" />
    <path className="minor" d="M-20 400 L410 392" />
    <path className="minor" d="M128 -20 L134 460" />
    <path className="minor" d="M250 -20 L252 460" />
    <path className="minor" d="M-30 430 L170 -30" />
    <path className="road" d="M-20 80 L410 58" />
    <path className="road" d="M-20 205 L410 218" />
    <path className="road" d="M-20 335 L410 320" />
    <path className="road" d="M62 -20 L88 460" />
    <path className="road" d="M192 -20 L178 460" />
    <path className="road" d="M302 -20 L326 460" />
  </g>
);

function OfferMap() {
  return (
    <div className="absolute inset-0 mx-auto max-w-[440px]" aria-hidden>
      <svg className="lw-map" viewBox="0 -80 390 844" preserveAspectRatio="xMidYMid slice">
        <rect className="base" x="-400" y="-80" width="1190" height="844" />
        {grid(-420)}
        {grid(0)}
        {grid(420)}
        <path className="casing" d="M86 210 L182 214 L188 78 L305 60" />
        <path className="route" d="M86 210 L182 214 L188 78 L305 60" />
        {/* The job's suburb (not the exact address until booked). */}
        <circle cx="86" cy="210" r="17" fill="rgba(255,255,255,.7)" />
        <circle cx="86" cy="210" r="13" fill="#1D1D1F" />
        <circle cx="86" cy="210" r="5" fill="var(--lw-accent)" />
        {/* The tradie's van. */}
        <rect x="285" y="40" width="40" height="40" rx="12" fill="var(--lw-accent)" stroke="#1D1D1F" strokeWidth="2" />
        <path d={FILL.truck} fill="#1D1D1F" transform="translate(294 49) scale(0.0859)" />
      </svg>
    </div>
  );
}
