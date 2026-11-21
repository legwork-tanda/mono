"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  DEFAULT_TIME_ZONE,
  factSource,
  sameSlot,
  slotsLabel,
  slotWhen,
  TIER_INFO,
  tierForWhen,
  tradeInfo,
  whenForTier,
  whenLabel,
  whenOptions,
  type TimeSlot,
  type WhenCalendar,
  type CorrectedField,
  type CorrectionResponse,
  type JobEdit,
  type JobState,
  type JobWhen,
  type Photo,
  type Pushback,
  type PushbackRequest,
  formatPriceRange as priceRange,
  type Tier,
  type TradeId,
  type WhenInput,
  type BookingRule,
} from "@legwork/shared";
import { photoUrl } from "@/lib/api";
import { settlingReason, type BriefQueue } from "@/lib/brief-queue";
import { BriefChecklist, proDeadline } from "./brief-checklist";
import { Composer } from "./composer";
import { useFocusOnMount } from "./question-step";
import { buttonPrimary, buttonQuiet, ErrorNote, Icon, icons, linkButton } from "./ui";
import { WhenCalendarPicker, type WhenPick } from "./when-calendar";

type Session = { id: string; token: string; uploadToken: string };

type Props = {
  state: JobState;
  session: Session;
  confirming: boolean;
  /** Tappable choices only: a time chip or a price row. Updates the state before resolving. */
  onEdit: (edit: JobEdit, kind: "when" | "price") => Promise<void>;
  /** Everything else is said: "Anything wrong? Just say it." (#55). Updates the state before resolving. */
  onCorrect: (text: string) => Promise<CorrectionResponse>;
  /** The answer to the slow-date line (#59). Updates the state before resolving. */
  onPushback: (answer: PushbackRequest["answer"]) => Promise<void>;
  /**
   * Every change above runs through this, one at a time (#79). The brief reads
   * it to say what's saving and to hold Find until everything has landed.
   */
  briefQueue: BriefQueue;
  /** Uploads a photo said in the composer. It's in `state.photos` once this resolves. */
  onAddPhoto: (file: File) => Promise<Photo>;
  onConfirm: (tier: Tier, when: JobWhen) => void;
  /** Send failed: the brief stays, ringed, with this under the button (S04 "Send fails"). */
  confirmError?: string | null;
};

const TIER_ORDER: Tier[] = ["high", "medium", "low"];
/** What each price row covers, now that the time picked sets the tier (`tierForWhen`). */
const TIER_SHORT: Record<Tier, string> = { high: "ASAP or today", medium: "Tomorrow", low: "Two or more days out" };

const toInput = (w: Omit<JobWhen, "timeZone">): WhenInput => (w.asap ? { asap: true } : { date: w.date, window: w.window });

const sameSlots = (a: TimeSlot[], b: TimeSlot[]) => a.length === b.length && a.every((x, i) => sameSlot(x, b[i]!));

/**
 * When it's needed, on one line: ASAP or the blocks offered, and "Change",
 * which opens the same calendar as "How soon?" (#65). Saving moves the job to
 * the earliest block's tier on the server, which reprices the button.
 */
function WhenPicker({ when, windows, remembered, calendar, nowMs, locked, note, saving, busy, onSave }: {
  when: JobWhen;
  windows: TimeSlot[];
  /** The blocks to bring back when the customer switches from ASAP to blocks. */
  remembered: TimeSlot[];
  calendar: WhenCalendar | null;
  nowMs: number;
  locked: boolean;
  /** One line under the time: why it isn't the customer's own, if it isn't. */
  note: string | null;
  saving: string | null;
  /** Another brief change is landing: the time can be changed once it has. */
  busy: boolean;
  onSave: (pick: WhenPick) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<WhenPick>({ asap: when.asap, slots: windows });
  const label = when.asap ? "ASAP" : windows.length > 0 ? slotsLabel(windows, nowMs, when.timeZone) : whenLabel(when, nowMs);
  const openPicker = () => {
    setPick({ asap: when.asap, slots: windows.length > 0 ? windows : remembered });
    setOpen(true);
  };
  const unchanged = pick.asap ? when.asap : !when.asap && sameSlots(pick.slots, windows);
  const ready = pick.asap || pick.slots.length > 0;
  const done = async () => {
    if (unchanged) return setOpen(false);
    if (await onSave(pick)) setOpen(false);
  };

  return (
    <div>
      <div className="flex min-h-11 items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="lw-kv__k" id="when-label">
            When
          </p>
          <p className="lw-kv__v truncate" aria-labelledby="when-label">
            {saving === "when" ? <span className="text-muted">Saving…</span> : label}
          </p>
        </div>
        {!locked && calendar && !open && (
          <button
            type="button"
            onClick={openPicker}
            disabled={busy}
            className={`${linkButton} inline-flex min-h-11 shrink-0 items-center px-1`}
          >
            Change
          </button>
        )}
      </div>
      {open && calendar && (
        <div className="mt-2 flex flex-col gap-2.5">
          <WhenCalendarPicker calendar={calendar} value={pick} onChange={setPick} disabled={busy} />
          <p className="lw-subhead truncate text-center font-semibold">{pick.asap ? "ASAP" : pick.slots.length > 0 ? slotsLabel(pick.slots, nowMs, calendar.timeZone) : "Pick ASAP, or any times that suit"}</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setOpen(false)} disabled={!!saving} className={`${buttonQuiet} flex-1`}>
              Cancel
            </button>
            <button type="button" onClick={() => void done()} disabled={!ready || busy} className="lw-chip lw-press h-11 flex-1 justify-center font-semibold">
              {saving === "when" ? "Saving…" : "Done"}
            </button>
          </div>
        </div>
      )}
      {note && <p className="lw-caption mt-0.5 text-pretty text-muted">{note}</p>}
    </div>
  );
}

/**
 * The one line when the chosen date is later than the job should wait (#59):
 * what waiting costs, and two answers. Asked once: either answer is final, and
 * the line goes when the server stops sending it. Not a dialog, not a warning.
 */
function SlowDateLine({ pushback, held, onAnswer }: { pushback: Pushback; held: boolean; onAnswer: (answer: PushbackRequest["answer"]) => Promise<void> }) {
  const [busy, setBusy] = useState<PushbackRequest["answer"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const answer = async (a: PushbackRequest["answer"]) => {
    setBusy(a);
    setError(null);
    try {
      await onAnswer(a);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const chip = "lw-chip lw-chip--compact";
  return (
    <div className="mt-2" role="group" aria-label="Want it sooner?">
      <p className="lw-caption text-pretty">{pushback.line}</p>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {/* Glass chips, the sooner one in bold (as on iOS): Send request is this screen's one yellow pill. */}
        <button type="button" disabled={!!busy || held} onClick={() => void answer("sooner")} className={`${chip} font-semibold`}>
          {busy === "sooner" ? "Saving…" : pushback.soonerLabel}
        </button>
        <button type="button" disabled={!!busy || held} onClick={() => void answer("keep")} className={chip}>
          {busy === "keep" ? "Saving…" : pushback.keepLabel}
        </button>
      </div>
      {error && <ErrorNote className="mt-1.5">{error}</ErrorNote>}
    </div>
  );
}

/**
 * Shown for gas, sparking wiring, water near electrics and the like: during
 * the questions as soon as it's spotted, and at the top of the summary card.
 */
export function SafetyBanner() {
  return (
    <div role="alert" className="lw-note lw-note--ink">
      <Icon name="warning" fill />
      <div className="space-y-1.5 text-pretty">
        <p className="font-semibold">Get to safety first.</p>
        <p>
          This could be dangerous. Keep everyone away from it and, only if it&apos;s safe, turn off the gas or switch off at the mains.
        </p>
        <p>
          If anyone is at risk or there&apos;s a fire, call{" "}
          <a href="tel:000" className="font-semibold underline">
            000
          </a>
          . For storm or flood damage, call the SES on{" "}
          <a href="tel:132500" className="font-semibold whitespace-nowrap underline">
            132 500
          </a>
          .
        </p>
      </div>
    </div>
  );
}

/** The trade at the top of the card, with the ✦ marker while it's Legwork's guess. A wrong trade is said, not picked. */
function TradeLabel({ trade, source, changed }: { trade: TradeId; source: "given" | "inferred"; changed: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded ${changed ? "animate-changed" : ""}`}>
      {tradeInfo(trade).label}
      {source === "inferred" && (
        <span className="text-[11px]" title="Legwork's guess">
          ✦<span className="sr-only"> Legwork&apos;s guess</span>
        </span>
      )}
    </span>
  );
}

/** Plain names for what a correction changed, for the one-line reply. */
const FIELD_NAMES: Partial<Record<CorrectedField, string>> = {
  title: "the title",
  summary: "what's needed",
  trade: "the trade",
  location: "the suburb",
  when: "the time",
  photos: "the photos",
};

function listed(names: string[]) {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** The one line under the composer after a correction: what moved, or why nothing did. */
export function correctionReply(res: CorrectionResponse): string {
  const names = res.changed.flatMap((f) => (f === "details" ? res.changedDetails.map((d) => d.toLowerCase()) : FIELD_NAMES[f] ? [FIELD_NAMES[f]!] : []));
  const parts: string[] = [];
  if (names.length > 0) parts.push(`Updated ${listed([...new Set(names)])}${res.changed.includes("price") ? ", and the price" : ""}.`);
  else if (res.changed.includes("price")) parts.push("Updated the price.");
  if (res.reason) parts.push(res.reason);
  if (res.photoRequest) parts.push(`${res.photoRequest.replace(/\.$/, "")}: tap the photo button.`);
  return parts.join(" ");
}

type Changed = { fields: ReadonlySet<CorrectedField>; details: string[]; n: number };

/**
 * The one line by Find (#77): how the search will book, for the tier the time
 * picked, before the customer starts it. From the API's `booking` rule (the
 * constants matching uses); an older API gets the same rule without the timer.
 */
export function bookingLine(tier: Tier, worker: string, booking: BookingRule | null | undefined): string {
  const instant = booking ? booking.instant.includes(tier) : tier === "high";
  if (instant) return `The first ${worker} to accept is booked straight away.`;
  return booking
    ? `Pick from quotes, or the best is booked ${booking.bidWindowS}s after the first.`
    : "Pick from quotes, or the best one is booked for you.";
}

/**
 * The job, in one glance: what, where, when, how much. One button to find a
 * tradie. Nothing on it is a form: the time and price are tapped, and anything
 * else is said in the one composer ("Anything wrong? Just say it."). A change
 * lands in place, is highlighted for a moment, and the button shows the new
 * price before it's tapped.
 */
export function JobReady({ state, session, confirming, confirmError = null, onEdit, onCorrect, onPushback, briefQueue, onAddPhoto, onConfirm }: Props) {
  const { job, photos } = state;
  const writeUp = job.writeUp!;
  const trade = tradeInfo(writeUp.trade);
  const safety = job.safety || writeUp.safety;
  // The clock the options are dated from, moved on each time the card renders after a change.
  const nowMs = Date.now();
  const timeZone = job.when?.timeZone ?? DEFAULT_TIME_ZONE;
  // Dangerous jobs only go out as ASAP.
  const when: JobWhen = safety || !job.when ? whenForTier(safety ? "high" : (job.tier ?? "medium"), nowMs, timeZone) : job.when;
  // The tier is the price bucket for the time; the server keeps them together.
  const tier: Tier = safety ? "high" : (job.tier ?? tierForWhen(when, nowMs));
  const calendar = state.calendar ?? null;
  // Which time or price row is being saved, so it shows as picked straight away.
  const [saving, setSaving] = useState<string | null>(null);
  // Brief changes still landing, oldest first (#79). Nothing else can change the brief, and Find waits, while any are.
  const pending = useSyncExternalStore(briefQueue.subscribe, () => briefQueue.pending, () => briefQueue.pending);
  const busy = pending.length > 0;
  const correcting = pending.some((t) => t.kind === "correct");
  const uploading = pending.filter((t) => t.kind === "photo").length;
  const [whenError, setWhenError] = useState<string | null>(null);
  // The blocks offered last, kept while the job is on ASAP so switching back doesn't lose them (#65).
  const [remembered, setRemembered] = useState<TimeSlot[]>(job.windows);
  useEffect(() => {
    if (job.windows.length > 0) setRemembered(job.windows);
  }, [job.windows]);
  const save = async (edit: JobEdit, key: string) => {
    setSaving(key);
    setWhenError(null);
    try {
      await onEdit(edit, key === "when" ? "when" : "price");
      return true;
    } catch (e) {
      setWhenError((e as Error).message);
      return false;
    } finally {
      setSaving(null);
    }
  };
  const saveWhen = (pick: WhenPick, key = "when") => save(pick.asap ? { when: { asap: true } } : { windows: pick.slots }, key);
  /**
   * A price row picks a time priced in that tier: ASAP for the top one, the
   * blocks offered when their earliest is priced there, otherwise the first
   * block on the calendar that is. Prices always follow the earliest block.
   */
  const pickTier = (t: Tier) => {
    if (t === "high") return void saveWhen({ asap: true, slots: remembered }, t);
    const tierOf = (slot: TimeSlot) => tierForWhen(slotWhen(slot, timeZone), nowMs);
    if (remembered[0] && tierOf(remembered[0]) === t && calendar?.days.some((d) => d.date === remembered[0]!.date)) {
      return void saveWhen({ asap: false, slots: remembered }, t);
    }
    const first = calendar?.days.flatMap((d) => d.blocks.map((b) => ({ date: d.date, start: b.start, end: b.end }))).find((slot) => tierOf(slot) === t);
    if (first) return void saveWhen({ asap: false, slots: [first] }, t);
    // No calendar (an older API): the first quick option priced there.
    const option = whenOptions(nowMs, timeZone).find((o) => tierForWhen({ ...o, timeZone }, nowMs) === t);
    if (option) void save({ when: toInput(option) }, t);
  };
  // Only danger forces the time, and it always says why in one line.
  const whenNote = job.whenOverride?.message ?? (safety ? "Because this could be dangerous, it goes out as ASAP." : null);
  const cover = photos[0];
  // Severity's only effect on this screen (#59): one line when the date is slower than the job should wait.
  // It stays put (held) while a time or price saves, rather than vanishing and coming back with the reply.
  const pushback = !safety ? job.pushback : null;

  // Correcting by talking: the reply line, and what to highlight for a moment.
  const [reply, setReply] = useState<ReactNode>(null);
  const [changed, setChanged] = useState<Changed | null>(null);
  const [prefill, setPrefill] = useState<{ text: string; n: number } | null>(null);
  useEffect(() => {
    if (!changed) return;
    const timer = setTimeout(() => setChanged(null), 2600);
    return () => clearTimeout(timer);
  }, [changed]);
  const hl = (field: CorrectedField) => (changed?.fields.has(field) ? "animate-changed" : "");
  const checklistHighlight = new Set<string>();
  if (changed) {
    if (["title", "summary", "trade"].some((f) => changed.fields.has(f as CorrectedField))) checklistHighlight.add("what");
    if (changed.fields.has("location")) checklistHighlight.add("where");
    if (changed.fields.has("when")) checklistHighlight.add("when");
    if (changed.fields.has("photos")) checklistHighlight.add("photos");
    for (const label of changed.details) checklistHighlight.add(`detail-${label}`);
  }

  const correct = async (text: string) => {
    setReply(null);
    try {
      const res = await onCorrect(text);
      setReply(correctionReply(res));
      if (res.changed.length > 0) setChanged((c) => ({ fields: new Set(res.changed), details: res.changedDetails, n: (c?.n ?? 0) + 1 }));
      // Keep the words when nothing changed, so they can be reworded.
      return res.changed.length > 0 || !!res.photoRequest;
    } catch (e) {
      setReply((e as Error).message);
      return false;
    }
  };
  // A photo is in the checklist only once it has uploaded; a failed one says so with both ways on (#79).
  const addPhoto = async (file: File) => {
    setReply(null);
    try {
      await onAddPhoto(file);
      setReply("Photo added. The tradie gets it with the job.");
      setChanged((c) => ({ fields: new Set<CorrectedField>(["photos"]), details: [], n: (c?.n ?? 0) + 1 }));
    } catch (e) {
      setReply(
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
          <ErrorNote>{(e as Error).message || "That photo didn't upload."}</ErrorNote>
          <button type="button" className={linkButton} onClick={() => void addPhoto(file)}>
            Try again
          </button>
          <button type="button" className={linkButton} onClick={() => setReply("Going without that photo.")}>
            Go without it
          </button>
        </span>,
      );
    }
  };
  const settling = settlingReason(pending);
  const find = async () => {
    if (busy || confirming) return;
    await briefQueue.settled();
    onConfirm(tier, when);
  };

  const price = writeUp.prices[tier];
  const extra = photos.length - 4;
  // Arriving from the last question, focus lands on the title as it does on each question (#70).
  const title = useRef<HTMLHeadingElement>(null);
  useFocusOnMount(title);

  return (
    <div className="lw-check">
      <div className="lw-check__main flex flex-col gap-2.5">
        <h1 ref={title} tabIndex={-1} className="lw-title-1 px-2 pt-4 pb-1 animate-question">
          Ready to send?
        </h1>
        {safety && <SafetyBanner />}

        <article aria-labelledby="job-title" className={`lw-glass p-[18px] animate-question ${confirmError || whenError ? "is-error" : ""}`}>
          <div className="flex items-baseline justify-between gap-3">
            <p className="lw-caption inline-flex min-w-0 items-center gap-1 font-semibold text-muted">
              Your job ·
              <TradeLabel trade={writeUp.trade} source={factSource(writeUp.tradeSource)} changed={!!changed?.fields.has("trade")} />
            </p>
            {/* Every change is said, so Edit starts the box below (#55). */}
            <button
              type="button"
              onClick={() => setPrefill((p) => ({ text: "", n: (p?.n ?? 0) + 1 }))}
              aria-label="Edit your job"
              className={`${linkButton} -my-3 -mr-2 inline-flex min-h-11 shrink-0 items-center px-2`}
            >
              Edit
            </button>
          </div>
          <h2 id="job-title" className={`lw-title-2 mt-2 rounded text-balance ${hl("title")}`}>
            {writeUp.title}
          </h2>
          <p className={`lw-callout mt-2 line-clamp-4 max-w-[62ch] rounded text-muted text-pretty ${hl("summary")}`}>{writeUp.summary}</p>
          {cover && (
            <div className={`lw-thumbs mt-3 rounded ${hl("photos")}`} aria-label={photos.length === 1 ? "1 photo" : `${photos.length} photos`}>
              {photos.slice(0, 4).map((p, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={p.id} src={photoUrl(p.path, session.uploadToken)} alt={`Photo ${i + 1}`} />
              ))}
              {extra > 0 && (
                <span className="lw-inner lw-label lw-num grid size-11 place-items-center rounded-thumb text-muted">+{extra}</span>
              )}
            </div>
          )}

          <div className="lw-divider mt-3.5" />
          <div className={`-mx-1.5 rounded-field px-1.5 py-2 ${hl("when")}`}>
            <WhenPicker
              when={when}
              windows={job.when?.asap ? [] : job.windows}
              remembered={remembered}
              calendar={calendar}
              nowMs={nowMs}
              locked={safety}
              note={whenNote}
              saving={saving}
              busy={busy || confirming}
              onSave={(pick) => saveWhen(pick)}
            />
            {whenError && <ErrorNote className="mt-1 mb-1">{whenError}</ErrorNote>}
          </div>
          <div className="lw-divider" />
          <div className={`-mx-1.5 flex min-h-[66px] items-center gap-3 rounded-field px-1.5 py-2 ${hl("location")}`}>
            <div className="min-w-0 flex-1">
              <p className="lw-kv__k">Where</p>
              <p className={`lw-kv__v truncate ${writeUp.location ? "" : "text-muted"}`}>{writeUp.location || "Not set yet"}</p>
            </div>
            {!writeUp.location && (
              <button
                type="button"
                onClick={() => setPrefill((p) => ({ text: "It's in ", n: (p?.n ?? 0) + 1 }))}
                aria-label="Add suburb"
                className={`${linkButton} inline-flex min-h-11 shrink-0 items-center px-1`}
              >
                Add
              </button>
            )}
          </div>
          <div className="lw-divider" />
          <div className={`-mx-1.5 rounded-field px-1.5 py-[13px] ${hl("price")}`}>
            <p className="lw-kv__k">Estimate</p>
            <p className="lw-callout lw-num text-muted" aria-label={`Estimate, ${priceRange(price)}, nothing charged yet`}>
              <span className="font-semibold text-ink">{priceRange(price)}</span> · nothing charged yet
            </p>
          </div>

          <p className="lw-section-label mx-0 mt-3.5 mb-0">What the tradie gets</p>
          <BriefChecklist
            writeUp={writeUp}
            photos={photos}
            uploadToken={session.uploadToken}
            deadline={proDeadline(when, nowMs, job.windows)}
            whenNote={job.whenOverride?.message ?? null}
            uploading={uploading}
            highlight={checklistHighlight}
            onSay={(text) => setPrefill((p) => ({ text, n: (p?.n ?? 0) + 1 }))}
          />
        </article>

        <div className="animate-question">
          <Composer variant="brief" busy={correcting} reply={reply} prefill={prefill} onSubmit={correct} onAttach={(file) => void addPhoto(file)} />
        </div>
      </div>

      <div className="lw-check__aside">
        <section aria-labelledby="prices-title" className="flex flex-col gap-2.5 animate-question">
          {pushback ? (
            // While the line shows, it takes the "Estimated price" heading's place, as on iOS.
            <div className="px-2 pt-4 pb-1">
              <h2 id="prices-title" className="sr-only">
                Estimated price
              </h2>
              <SlowDateLine pushback={pushback} held={busy || confirming || !!saving} onAnswer={onPushback} />
            </div>
          ) : (
            <div className="px-2 pt-4 pb-1">
              <h2 id="prices-title" className="lw-title-3">
                Estimated price
              </h2>
              {writeUp.priceReason && <p className="lw-caption mt-1 text-muted text-pretty">{writeUp.priceReason}</p>}
            </div>
          )}
          <div className="flex flex-col gap-2.5" role="radiogroup" aria-label="How soon, and the price">
            {TIER_ORDER.map((t) => {
              const locked = safety && t !== "high";
              const selected = saving && saving !== "when" ? saving === t : t === tier;
              return (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={locked || busy || confirming}
                  onClick={() => !selected && pickTier(t)}
                  className={`lw-glass lw-option lw-tier flex w-full items-start gap-3 text-left ${selected ? "is-selected" : ""} ${
                    locked || busy || confirming ? "cursor-not-allowed" : ""
                  } ${locked ? "opacity-45" : ""} ${selected ? hl("price") : ""}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="lw-headline">{TIER_SHORT[t]}</span>
                      <span className="lw-headline lw-num shrink-0">{priceRange(writeUp.prices[t])}</span>
                    </span>
                    <span className="lw-caption mt-0.5 block text-muted text-pretty">{TIER_INFO[t].reason}</span>
                  </span>
                  <span aria-hidden className={`lw-radio ${selected ? "is-on" : ""}`}>
                    <Icon name="check" className={`size-3.5 transition-opacity duration-150 ${selected ? "opacity-100" : "opacity-0"}`} />
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* How it books (#77), in one quiet line by the button. */}
        <p id="find-note" className="lw-caption mt-1 px-4 text-center text-muted text-pretty">
          {bookingLine(tier, trade.worker, state.booking)}
        </p>
        {/* The one yellow pill, pinned to the bottom like the app's confirm bar. */}
        <div className="lw-actionbar flex flex-col gap-2.5">
          {confirmError && (
            <div role="alert" className="lw-glass is-error rounded-[20px] px-4 py-3">
              <ErrorNote>Couldn&apos;t send. {confirmError}</ErrorNote>
            </div>
          )}
          <button
            type="button"
            onClick={() => void find()}
            disabled={confirming || busy}
            aria-describedby="find-note"
            aria-label={settling ?? (confirming ? "Sending" : `Send request, ${priceRange(price)} estimate, nothing charged yet`)}
            className={`${buttonPrimary} w-full`}
          >
            {!settling && !confirming && <Icon name={icons.send} />}
            {settling ?? (confirming ? "Sending…" : "Send request")}
          </button>
        </div>
      </div>
    </div>
  );
}
