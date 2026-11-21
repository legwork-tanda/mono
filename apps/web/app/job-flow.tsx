"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_TIME_ZONE,
  detectSafety,
  parseSlotKey,
  slotsLabel,
  type TimeSlot,
  MAX_PHOTOS,
  type Answer,
  type ConfirmRequest,
  type CorrectionRequest,
  type PushbackRequest,
  type CorrectionResponse,
  type CreateJobResponse,
  type MatchState,
  type Tier,
  type JobState,
  type Photo,
  type Step,
  type JobEdit,
  type JobWhen,
} from "@legwork/shared";
import { api, ApiRequestError, photoUrl, streamRound } from "@/lib/api";
import { AnswerQueue, type QueuedAnswer } from "@/lib/answer-queue";
import { BriefQueue } from "@/lib/brief-queue";
import { quickPosition, rememberSuburb } from "@/lib/location";
import { uploadPhoto } from "@/lib/photos";
import { loadSession, saveSession, type Session } from "@/lib/session";
import { AccountButton, type DeviceJob } from "@/components/account";
import { Composer, type PhotoStatus } from "@/components/composer";
import { JobDraft } from "@/lib/job-start";
import { JobReady, SafetyBanner } from "@/components/job-ready";
import { MatchView } from "@/components/match-view";
import { jobUser } from "@/lib/mock-auth";
import { PhoneQr } from "@/components/phone-qr";
import { PhotoPicker } from "@/components/photo-picker";
import { useJobLive } from "@/lib/use-job-live";
import { LiveMessage, QuestionHeading, QuestionStep, useFocusOnMount } from "@/components/question-step";
import { BOOKING_STEPS, buttonPrimary, buttonQuiet, buttonSecondary, ErrorNote, Icon, icons, Logo, PhotoBackdrop, TopBar, Walking } from "@/components/ui";

type Entry = { step: Step; answer: Answer };

/** The browser's time zone, so "How soon?" offers the customer's own today and tomorrow. */
function localTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

// Jobs the customer saved after no match, listed at home. Nobody is booked and
// nothing searches on its own; the customer reopens one to search again.
const SCHEDULED_KEY = "legwork.scheduled";
type ScheduledJob = Session & { title: string; date: string };

function loadScheduled(): ScheduledJob[] {
  try {
    const raw = localStorage.getItem(SCHEDULED_KEY);
    return raw ? (JSON.parse(raw) as ScheduledJob[]) : [];
  } catch {
    return [];
  }
}

function saveScheduled(jobs: ScheduledJob[]) {
  try {
    localStorage.setItem(SCHEDULED_KEY, JSON.stringify(jobs));
  } catch {
    // Not remembered; the job itself is still saved on the server.
  }
}

const shortDate = (date: string) =>
  date ? new Date(`${date}T00:00:00`).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" }) : "";

type Failure = { message: string; retry: () => void };

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(query);
    setMatches(media.matches);
    const onChange = () => setMatches(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

// --- Progress and context ---------------------------------------------------

function formatAnswer({ step, answer }: Entry, photoCount: number) {
  if (step.type === "photos") {
    if (answer === null) return "Skipped";
    return `${photoCount} photo${photoCount === 1 ? "" : "s"}`;
  }
  if (answer === null) return "Skipped";
  // The calendar's blocks (#65) read back the way the question showed them.
  if (step.section === "when" && Array.isArray(answer)) {
    const slots = answer.map(parseSlotKey).filter((s): s is TimeSlot => s !== null);
    return slotsLabel(slots, Date.now(), Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIME_ZONE);
  }
  return Array.isArray(answer) ? answer.join(", ") : answer;
}

/**
 * The job in one line (photos and description), with the answers so far
 * tucked into a panel that opens on demand, so the question stays the focus.
 */
function JobContext({
  label,
  entries,
  photos,
  uploadToken,
  onEdit,
}: {
  label: string;
  entries: (Entry & { editable: boolean })[];
  photos: Photo[];
  uploadToken: string | null;
  onEdit: (entry: Entry) => void;
}) {
  const [open, setOpen] = useState(false);
  // Desktop's side card: a couple of key facts under the title (the latest answers), the rest under Answers.
  const facts = entries
    .filter((e) => e.answer !== null && e.step.type !== "photos")
    .slice(-3)
    .map((e) => formatAnswer(e, photos.length))
    .join(" · ");

  return (
    <div className="lw-glass lw-context px-4 py-2.5 lw-desktop:px-[18px] lw-desktop:py-4">
      <div className="flex items-center gap-3">
        {photos.length > 0 && uploadToken && (
          <div className="flex shrink-0 -space-x-2.5">
            {photos.slice(0, 3).map((p) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={p.id}
                src={photoUrl(p.path, uploadToken)}
                alt=""
                className="lw-thumb size-9 ring-2 ring-[var(--lw-glass-ring)]"
              />
            ))}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="sr-only">Your job</p>
          <p className="lw-headline truncate lw-desktop:line-clamp-2 lw-desktop:whitespace-normal">{label}</p>
          {facts && <p className="lw-caption mt-0.5 hidden truncate text-muted lw-desktop:block">{facts}</p>}
        </div>
        {entries.length > 0 && (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className={`lw-chip lw-chip--compact shrink-0 pr-2.5 ${open ? "is-selected" : ""}`}
          >
            <span className="hidden sm:inline">Your answers</span>
            <span className="sm:hidden">Answers</span>
            <span className="lw-num text-xs font-semibold">{entries.length}</span>
            <Icon name={icons.caretDown} className={`size-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
          </button>
        )}
      </div>

      {open && entries.length > 0 && (
        <ol className="lw-inner mt-3 px-3.5 py-0.5 animate-fade-in">
          {entries.map((entry) => (
            <li key={entry.step.id} className="lw-kv">
              <p className="lw-kv__k truncate">{entry.step.prompt}</p>
              <p className="lw-kv__v truncate">{formatAnswer(entry, photos.length)}</p>
              {entry.editable && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onEdit(entry);
                  }}
                  className="lw-kv__end lw-link -my-2 py-3"
                >
                  Edit
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// --- Steps ------------------------------------------------------------------

function PhotoStep({
  session,
  photos,
  onPhotosChange,
  onDone,
}: {
  session: Session;
  photos: Photo[];
  onPhotosChange: (update: (photos: Photo[]) => Photo[]) => void;
  onDone: (added: boolean) => void;
}) {
  // On a phone the camera is right there, so skip the QR code (it carries the whole job over).
  const wide = useMediaQuery("(min-width: 768px)");
  // When the job already has photos, this step asks for more: Continue needs a new one.
  const [startCount] = useState(photos.length);
  const added = photos.length > startCount;
  // On a computer the phone's camera is one link away, not a second panel.
  const [qr, setQr] = useState(false);
  return (
    <div className="space-y-3">
      <div className={wide ? "grid grid-cols-1 gap-3" : ""}>
        <div className="lw-glass p-[18px]">
          <PhotoPicker
            jobId={session.id}
            token={session.token}
            uploadToken={session.uploadToken}
            photos={photos}
            onPhotosChange={onPhotosChange}
            max={MAX_PHOTOS}
            canRemove
            variant={wide ? "dropzone" : "button"}
            poll
          />
        </div>
        {wide && qr && <PhoneQr session={session} />}
      </div>
      <button type="button" disabled={!added} onClick={() => onDone(true)} className={`${buttonPrimary} w-full`}>
        Continue
      </button>
      <div className="flex flex-wrap justify-center gap-x-5">
        {wide && !qr && (
          <button type="button" onClick={() => setQr(true)} className="lw-link inline-flex min-h-11 items-center px-1">
            Use your phone&apos;s camera
          </button>
        )}
        <button type="button" onClick={() => onDone(false)} className="lw-link inline-flex min-h-11 items-center px-1">
          Skip for now
        </button>
      </div>
    </div>
  );
}

function ErrorNotice({ failure }: { failure: Failure }) {
  // Focus lands on the failure, so Try again is the next Tab (#70).
  const ref = useRef<HTMLDivElement>(null);
  useFocusOnMount(ref);
  return (
    <div ref={ref} tabIndex={-1} role="status" aria-labelledby="failure" className="lw-glass is-error p-[18px]">
      <ErrorNote id="failure">{failure.message}</ErrorNote>
      <button type="button" onClick={failure.retry} className={`${buttonPrimary} mt-4 w-full`}>
        Try again
      </button>
    </div>
  );
}

/** Shown instead of the summary card when no supported trade can do the job. It can't be confirmed. */
function Unsupported({ title, needed, onStartOver }: { title: string; needed: string; onStartOver: () => void }) {
  return (
    <div role="alert" className="pt-6">
      <h1 className="lw-title-1 px-2 text-pretty">We don&apos;t support this kind of job yet</h1>
      <div className="lw-glass mt-5 p-[18px]">
        <p className="lw-caption font-semibold text-muted">Your job</p>
        <p className="lw-title-3 mt-1">{title}</p>
        <p className="lw-callout mt-3 text-muted text-pretty">
          This sounds like one for {needed}, and none of our tradies cover that yet. Sorry we can&apos;t help with this one.
        </p>
      </div>
      <button type="button" onClick={onStartOver} className={`${buttonPrimary} mt-4 w-full`}>
        Start a different job
      </button>
    </div>
  );
}

// --- Flow -------------------------------------------------------------------

export function JobFlow() {
  const [session, setSession] = useState<Session | null>(null);
  // The description while the job is being created, so the flow can open at once.
  const [draft, setDraft] = useState<string | null>(null);
  const [starting, setStarting] = useState<null | "creating" | "uploading">(null);
  const [state, setState] = useState<JobState | null>(null);
  // Answers sent (or waiting to be sent) but not yet confirmed by the API, a
  // snapshot of `answers` below. Their questions are hidden straight away so the
  // next one shows without waiting.
  const [pending, setPending] = useState<ReadonlyMap<string, Entry>>(new Map());
  // Set while saving is paused after a failure: the first answer that didn't save.
  const [unsaved, setUnsaved] = useState<{ entry: QueuedAnswer; retrying: boolean } | null>(null);
  // Earlier answers to show when the customer goes back to a question.
  const [prefill, setPrefill] = useState<Record<string, Answer>>({});
  const [roundRunning, setRoundRunning] = useState(false);
  const [publishing, setPublishing] = useState(false);
  // The search as it was when the customer confirmed; MatchView keeps it fresh.
  const [match, setMatch] = useState<MatchState | null>(null);
  // The live stage, as MatchView last saw it.
  const [liveStage, setLiveStage] = useState<MatchState["stage"] | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  // Send failed on the brief: it stays on S04 with a ring and this note (S04 spec).
  const [confirmError, setConfirmError] = useState<string | null>(null);
  // Close on the booking screens asks first ("Discard this job?").
  const [discarding, setDiscarding] = useState(false);
  // A refused answer or a failed Back, shown under that question.
  const [answerError, setAnswerError] = useState<{ stepId: string; message: string } | null>(null);
  const [scheduled, setScheduled] = useState<ScheduledJob[]>([]);
  // What the customer entered when starting last failed, kept for the form (#67).
  const [restore, setRestore] = useState<{ description: string; files: File[] } | null>(null);
  const [photoStatus, setPhotoStatus] = useState<ReadonlyMap<File, PhotoStatus>>(new Map());

  // Requests run one after another: a round, then answers in the order given.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const draftJob = useRef<JobDraft | null>(null);
  const generation = useRef(0);
  const sessionRef = useRef<Session | null>(null);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  // Steps going back to being unanswered on the API (Back / Edit), still running.
  const reopening = useRef(new Set<string>());
  // The answer queue (lib/answer-queue.ts), made once below.
  const answersRef = useRef<AnswerQueue | null>(null);
  // Requests that change the job, still running. The job only follows the
  // other device (below) while there are none, so it can't undo one.
  const inFlight = useRef(0);
  // Changes made on the brief, one at a time so a late reply can't undo a newer one (#79).
  const brief = useRef(new BriefQueue()).current;
  const track = <T,>(task: () => Promise<T>) => async () => {
    inFlight.current++;
    try {
      return await task();
    } finally {
      inFlight.current--;
    }
  };

  const enqueue = (task: () => Promise<unknown>) => {
    // A task that throws mustn't stop the ones after it.
    queue.current = queue.current.then(track(task)).catch(() => {});
  };

  const reset = useCallback(() => {
    generation.current++;
    queue.current = Promise.resolve();
    answersRef.current?.clear();
    reopening.current.clear();
    saveSession(null);
    setSession(null);
    setDraft(null);
    setStarting(null);
    setState(null);
    setPrefill({});
    setMatch(null);
    setLiveStage(null);
    setRoundRunning(false);
    setFailure(null);
    setConfirmError(null);
    setAnswerError(null);
    draftJob.current = null;
    setRestore(null);
    setPhotoStatus(new Map());
  }, []);

  /** Streams the next round of questions in, or the write-up when intake is done. */
  const runRound = useCallback(
    (s: Session) => {
      const gen = generation.current;
      const round = async () => {
        setRoundRunning(true);
        setFailure(null);
        try {
          const final = await streamRound(s.id, s.token, (step) => {
            if (gen !== generation.current) return;
            setState((st) => (st && !st.queue.some((q) => q.id === step.id) ? { ...st, queue: [...st.queue, step] } : st));
          });
          if (gen === generation.current) setState(final);
        } catch (e) {
          if (gen !== generation.current) return;
          if (e instanceof ApiRequestError && e.status === 404) return reset();
          setFailure({ message: (e as Error).message, retry: () => runRound(s) });
        } finally {
          if (gen === generation.current) setRoundRunning(false);
        }
      };
      queue.current = queue.current.then(track(round));
    },
    [reset],
  );

  /** Reloads the job from the API and carries on from wherever it is. */
  const resync = useCallback(
    async (s: Session) => {
      setFailure(null);
      try {
        const fresh = await api<JobState>(`/jobs/${s.id}/state`, { token: s.token });
        // Keeps answers not saved yet, dropping any the API already has.
        answersRef.current!.reconcile(fresh);
      } catch (e) {
        if (e instanceof ApiRequestError && e.status === 404) return reset();
        setFailure({ message: (e as Error).message, retry: () => void resync(s) });
      }
    },
    [reset, runRound],
  );

  // Everything the answer queue calls is stable, so it's made once.
  if (!answersRef.current) {
    const current = () => sessionRef.current!;
    const answers: AnswerQueue = new AnswerQueue({
      send: ({ step, answer }) =>
        api<JobState>(`/jobs/${current().id}/steps/${step.id}/answer`, {
          method: "POST",
          token: current().token,
          json: { answer },
        }),
      load: () => api<JobState>(`/jobs/${current().id}/state`, { token: current().token }),
      enqueue,
      onState: (fresh, settled) => {
        // A reopen still running brings its own state; this one would show its question as answered.
        if (reopening.current.size > 0) return;
        setState(fresh);
        // That was the last queued question: time for the next round.
        if (fresh.job.status === "intake" && fresh.queue.length === 0 && settled) runRound(current());
      },
      onRejected: ({ step, answer }, message) => {
        setPrefill((p) => ({ ...p, [step.id]: answer }));
        setAnswerError({ stepId: step.id, message });
      },
      onDropped: ({ step, answer }) => setPrefill((p) => ({ ...p, [step.id]: answer })),
      onLoadFailed: (e) => {
        if (e instanceof ApiRequestError && e.status === 404) reset();
      },
      onChange: () => {
        setPending(new Map(answers.entries().map((e) => [e.step.id, e])));
        const stuck = answers.stuck;
        setUnsaved(stuck && { entry: stuck, retrying: answers.retrying });
      },
    });
    answersRef.current = answers;
  }
  const answers = answersRef.current;

  // Back online: try the answers that didn't save.
  useEffect(() => {
    const onOnline = () => answers.retry();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [answers]);

  useEffect(() => setScheduled(loadScheduled()), []);

  const updateScheduled = (update: (jobs: ScheduledJob[]) => ScheduledJob[]) => {
    const next = update(loadScheduled());
    saveScheduled(next);
    setScheduled(next);
  };

  /** "Save for later": list the job at home (not booked) and go back there. */
  const scheduleCurrent = useCallback(
    (date: string) => {
      if (session && state?.job.writeUp) {
        const entry: ScheduledJob = { ...session, title: state.job.writeUp.title, date };
        updateScheduled((jobs) => [entry, ...jobs.filter((j) => j.id !== session.id)]);
      }
      reset();
    },
    [session, state, reset],
  );

  /** Reopens a scheduled job, where the customer can search again. */
  const openScheduled = (job: ScheduledJob) => {
    updateScheduled((jobs) => jobs.filter((j) => j.id !== job.id));
    const s: Session = { id: job.id, token: job.token, uploadToken: job.uploadToken };
    saveSession(s);
    setSession(s);
    void resync(s);
  };

  // Pick up a job in progress after a reload.
  useEffect(() => {
    const saved = loadSession();
    if (!saved) return;
    setSession(saved);
    void resync(saved);
  }, [resync]);

  // The job can move on from another device: the phone that scanned the QR
  // code, or back. Until it's confirmed (the search then follows itself over a
  // stream), the API pushes a nudge on every change (useJobLive; a slow poll
  // stands in while that's down), and the server's state is taken when it has
  // changed and nothing here is mid-request.
  const status = state?.job.status;
  const latest = useRef(state);
  useEffect(() => {
    latest.current = state;
  }, [state]);
  // Unsaved answers count as busy too, so the server's state can't hide them.
  const idle = () => inFlight.current === 0 && answers.size === 0 && !brief.busy;
  const refetching = useRef(false);
  /** Set when a nudge lands mid-read or while busy, so it's read again once that's done. */
  const missed = useRef(false);
  const refetchState = () => {
    if (!session || document.hidden) return;
    if (!idle() || refetching.current) {
      missed.current = true;
      return;
    }
    missed.current = false;
    refetching.current = true;
    const gen = generation.current;
    const mark = brief.mark();
    api<JobState>(`/jobs/${session.id}/state`, { token: session.token })
      .then((fresh) => {
        // A brief change that started or landed meanwhile is newer than this read.
        if (gen !== generation.current || !idle() || brief.changedSince(mark)) return;
        if (JSON.stringify(fresh) !== JSON.stringify(latest.current)) setState(fresh);
      })
      .catch(() => {})
      .finally(() => {
        refetching.current = false;
        // With this render's closure gone stale, go through the latest one.
        if (missed.current) latestRefetch.current();
      });
  };
  const latestRefetch = useRef(refetchState);
  const following = !!session && (status === "intake" || status === "ready");
  useJobLive(session?.id, session?.token, () => refetchState(), following);
  // A nudge that came while this device was busy: catch up once it's idle again.
  useEffect(() => {
    latestRefetch.current = refetchState;
    if (!following || !missed.current) return;
    const timer = setTimeout(() => refetchState(), 300);
    return () => clearTimeout(timer);
  });

  /** The homepage's draft job (see JobDraft): created on demand, kept until intake starts. */
  function currentDraft(): JobDraft {
    draftJob.current ??= new JobDraft({
      create: (description) =>
        api<CreateJobResponse>("/jobs", { method: "POST", json: { description, timeZone: localTimeZone(), user: jobUser() } }).then((c) => ({
          id: c.job.id,
          token: c.token,
          uploadToken: c.uploadToken,
        })),
      upload: (s, file) => uploadPhoto(s.id, s.token, file),
      removePhoto: (s, photo) => api(`/jobs/${s.id}/photos/${photo.id}`, { method: "DELETE", token: s.token }),
      describe: (s, description) => api(`/jobs/${s.id}/description`, { method: "POST", token: s.token, json: { description } }),
    });
    return draftJob.current;
  }

  const setStatus = (file: File, status: PhotoStatus | null) =>
    setPhotoStatus((current) => {
      const next = new Map(current);
      if (status) next.set(file, status);
      else next.delete(file);
      return next;
    });

  function retryPhoto(file: File) {
    setStatus(file, "retrying");
    currentDraft()
      .retry(file)
      .then(() => setStatus(file, null))
      .catch((e: Error) => setStatus(file, { error: e.message }));
  }

  function removePhoto(file: File) {
    currentDraft().remove(file);
    setStatus(file, null);
  }

  async function start(description: string, files: File[]) {
    const gen = generation.current;
    const job = currentDraft();
    // Back to the form with everything the customer entered, and nothing started.
    const backToForm = (message: string, failed: ReadonlyMap<File, PhotoStatus> = new Map()) => {
      setDraft(null);
      setStarting(null);
      setRestore({ description, files });
      setPhotoStatus(failed);
      setFailure({ message, retry: () => setFailure(null) });
    };
    setDraft(description);
    setStarting(files.length > 0 ? "uploading" : "creating");
    setFailure(null);
    setPhotoStatus(new Map());
    try {
      const { session: s, failed } = await job.prepare(description, files);
      if (gen !== generation.current) return;
      if (failed.size > 0) {
        backToForm(
          !description && failed.size === files.length
            ? "We couldn't upload your photos. Retry them, or describe the job instead."
            : "Some photos didn't upload, so we haven't started yet.",
          new Map([...failed].map(([file, error]) => [file, { error }])),
        );
        return;
      }
      const fresh = await api<JobState>(`/jobs/${s.id}/state`, { token: s.token });
      if (gen !== generation.current) return;
      draftJob.current = null;
      setRestore(null);
      saveSession(s);
      setSession(s);
      setState(fresh);
      setStarting(null);
      runRound(s);
    } catch (e) {
      if (gen !== generation.current) return;
      backToForm(`${(e as Error).message} Your job is still here.`);
    }
  }

  function answer(step: Step, value: Answer) {
    if (!session) return;
    setAnswerError(null);
    answers.add(step, value);
  }

  /** Back / Edit: shows an earlier question again with its answer filled in. */
  function reopen(entry: Entry) {
    if (!session) return;
    const s = session;
    const gen = generation.current;
    const id = entry.step.id;
    setAnswerError(null);
    setPrefill((p) => ({ ...p, [id]: entry.answer }));

    const taken = answers.take(id);
    // Queued, not sent yet: just take it back.
    if (taken && !taken.inFlight) return;
    if (!taken) {
      // Saved already: show it now, and reopen it on the API in turn.
      setState(
        (st) =>
          st && {
            ...st,
            history: st.history.filter((h) => h.step.id !== id),
            queue: [entry.step, ...st.queue.filter((q) => q.id !== id)].sort((a, b) => a.position - b.position),
          },
      );
    }
    // On the wire: its step is still in the local queue, so it shows again at
    // once; it's reopened on the API once that save settles, if it landed.
    reopening.current.add(id);
    enqueue(async () => {
      if (gen !== generation.current || !reopening.current.has(id)) return;
      if (taken?.inFlight && !(await taken.inFlight)) {
        reopening.current.delete(id);
        return;
      }
      try {
        const next = await api<JobState>(`/jobs/${s.id}/steps/${id}/reopen`, { method: "POST", token: s.token });
        if (gen !== generation.current) return;
        reopening.current.delete(id);
        // Answers still unsaved stay hidden, so the latest state is safe to show.
        if (reopening.current.size === 0) setState(next);
      } catch (e) {
        if (gen !== generation.current) return;
        reopening.current.delete(id);
        setAnswerError({ stepId: id, message: (e as Error).message });
        // Back to the API's word on where things are, keeping unsaved answers.
        await resync(s);
      }
    });
  }

  /** Wraps a brief change's apply so a reply that lands after "Start over" is dropped. */
  const onThisJob = <T,>(apply: (value: T) => void) => {
    const gen = generation.current;
    return (value: T) => gen === generation.current && apply(value);
  };

  /** A time or price change on the brief. Queued behind any other brief change (#79). */
  async function editWriteUp(edit: JobEdit, kind: "when" | "price" = "when") {
    const s = session!;
    await brief.run(kind, () => api<JobState>(`/jobs/${s.id}/write-up`, { method: "PATCH", token: s.token, json: edit }), onThisJob(setState));
  }

  /** Answers the slow-date line on the brief (#59): move it sooner, or keep the date. */
  async function answerPushback(answer: PushbackRequest["answer"]) {
    const s = session!;
    await brief.run(
      "pushback",
      () => api<JobState>(`/jobs/${s.id}/pushback`, { method: "POST", token: s.token, json: { answer } satisfies PushbackRequest }),
      onThisJob(setState),
    );
  }

  /** Corrects the brief in plain words (#55). The brief updates in place from the returned state. */
  async function correctBrief(text: string): Promise<CorrectionResponse> {
    const s = session!;
    return brief.run(
      "correct",
      () => api<CorrectionResponse>(`/jobs/${s.id}/correct`, { method: "POST", token: s.token, json: { text } satisfies CorrectionRequest }),
      onThisJob((res) => setState(res.state)),
    );
  }

  /** A photo added on the brief: it's in the checklist once it has uploaded, and Find waits for it (#79). */
  async function addBriefPhoto(file: File): Promise<Photo> {
    const s = session!;
    return brief.run("photo", () => uploadPhoto(s.id, s.token, file), onThisJob((photo) => setPhotos((current) => [...current, photo])));
  }

  /** Locks the chosen tier's price and starts the search, with the date and window picked. */
  async function confirm(tier: Tier, when: JobWhen) {
    if (!session) return;
    setPublishing(true);
    setConfirmError(null);
    inFlight.current++;
    try {
      // Only once every brief change has landed (#79); the brief holds Find until then too.
      // Meanwhile, where the job is, so the booked tradie can find it (else the suburb answer places it).
      const [, at] = await Promise.all([brief.settled(), quickPosition()]);
      const started = await api<MatchState>(`/jobs/${session.id}/confirm`, {
        method: "POST",
        token: session.token,
        json: {
          tier,
          date: when.date,
          ...(when.asap ? { asap: true } : { window: when.window }),
          ...(at ?? {}),
        } satisfies ConfirmRequest,
      });
      setMatch(started);
      setState((st) => st && { ...st, job: { ...st.job, status: "open" } });
    } catch (e) {
      setConfirmError((e as Error).message);
    } finally {
      inFlight.current--;
      setPublishing(false);
    }
  }

  const setPhotos = useCallback(
    (update: (photos: Photo[]) => Photo[]) => setState((s) => (s ? { ...s, photos: update(s.photos) } : s)),
    [],
  );

  const inFlow = session !== null || draft !== null;
  const visible = state ? state.queue.filter((q) => !pending.has(q.id)) : [];
  const step = visible[0] ?? null;
  const done = state !== null && state.job.status !== "intake";
  const answeredEntries = [
    ...(state?.history ?? []),
    ...[...pending.values()].map((p) => ({ ...p, editable: true })),
  ].sort((a, b) => a.step.position - b.step.position);
  // Back goes to the latest editable answer before this question, saved or not.
  const backTo = step ? (answeredEntries.filter((h) => h.editable && h.step.position < step.position).at(-1) ?? null) : null;
  const description = state?.job.description ?? draft ?? "";
  // Known questions so far; one more slot is held back for the write-up.
  const progress = answeredEntries.length / (answeredEntries.length + visible.length + 1);
  // With photos only, the answer to the checking question is the best name for the job.
  // Not the suburb or the time: the where question can come first now, and "Newtown" isn't a job.
  const firstAnswer = answeredEntries.find((e) => e.step.section !== "where" && e.step.section !== "when" && e.step.type !== "photos")?.answer;
  const jobLabel = description || (typeof firstAnswer === "string" ? firstAnswer : "From your photos");
  // Danger shows at once: from the API (the write-up or the answers it has) or
  // straight from what the customer has typed, before the API has replied.
  const typed = answeredEntries.flatMap((e) => (e.answer === null ? [] : Array.isArray(e.answer) ? e.answer : [e.answer]));
  const safety = (state?.job.safety ?? false) || detectSafety([description, ...typed].join("\n"));

  const waitingLabel =
    starting === "uploading"
      ? "Uploading your photos…"
      : answeredEntries.length === 0
        ? description
          ? "Reading your job…"
          : "Looking at your photos…"
        : "Putting your job together…";

  // "My jobs" under the account (#63): the jobs this browser holds tokens for.
  const deviceJobs: DeviceJob[] = [
    ...(session
      ? [
          {
            id: session.id,
            title: state?.job.writeUp?.title ?? jobLabel,
            detail: status === "open" ? "Finding a tradie" : done ? "Ready to confirm" : "In progress",
            action: "Open",
            onOpen: () => window.scrollTo({ top: 0 }),
          },
        ]
      : []),
    ...scheduled
      .filter((job) => job.id !== session?.id)
      .map((job) => ({
        id: job.id,
        title: job.title,
        detail: job.date ? `Needed by ${shortDate(job.date)}` : "Scheduled for later",
        action: "Search again",
        onOpen: () => openScheduled(job),
      })),
  ];

  // Where the booking stepper is (Describe › When › Check › Book), as on iOS.
  const stage = done ? 2 : step?.section === "when" ? 1 : 0;
  const searching = done && state?.job.status === "open";
  const unsupported = done && !!state?.job.writeUp?.unsupported;
  // Every screen is laid out for desktop now (the map scenes fill the window), so
  // Send never snaps the page to the phone column.
  const wide = true;
  // While the search runs, the booking bar stays up with its stepper on Book, so
  // Send is one fade into the map rather than a bar swap. Booked, the app bar takes over.
  const bookingBar = inFlow && (!searching || (liveStage ?? match?.stage) === "searching");

  const home = (
    <main className="lw-screen__body lw-home">
      {scheduled.length > 0 && (
        <section aria-labelledby="scheduled" className="lw-home__saved mt-3 animate-fade-in lw-desktop:mt-0 lw-desktop:mb-6">
          <h2 id="scheduled" className="lw-headline flex items-center gap-2 px-1.5">
            Saved, not booked
            <span className="lw-count">{scheduled.length}</span>
          </h2>
          <p className="lw-caption mt-1 px-1.5 text-muted text-pretty">
            No one is booked for these and we aren&rsquo;t searching. Open one to search again.
          </p>
          <ul className="lw-glass mt-2.5 px-3.5 py-1">
            {scheduled.map((job, i) => (
              <li key={job.id}>
                {i > 0 && <div className="lw-divider" />}
                <button type="button" onClick={() => openScheduled(job)} className="lw-li lw-press w-full text-left">
                  <span className="lw-date" aria-hidden>
                    {job.date ? (
                      <>
                        <span>{new Date(`${job.date}T00:00:00`).toLocaleDateString("en-AU", { weekday: "short" }).toUpperCase()}</span>
                        <b>{new Date(`${job.date}T00:00:00`).getDate()}</b>
                      </>
                    ) : (
                      <Icon name={icons.calendar} />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="lw-headline lw-ellipsis block">{job.title}</span>
                    <span className="lw-caption lw-ellipsis block text-muted">
                      No tradie booked{job.date ? ` · wanted ${shortDate(job.date)}` : ""}
                    </span>
                  </span>
                  <span className="lw-chip lw-chip--compact shrink-0">Search again</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="lw-home__intro mt-auto pt-10 animate-question lw-desktop:mt-0 lw-desktop:pt-0">
        <h1 className="lw-display px-2.5">
          What needs
          <br />
          fixing?
        </h1>
        <p className="lw-callout mt-3 max-w-[22rem] px-2.5 text-muted text-pretty lw-desktop:mt-5 lw-desktop:max-w-[26rem]">
          Describe it in a sentence or just add a photo. We&apos;ll ask a few quick questions and bring the right tradie to you.
        </p>
      </div>
      <div className="lw-home__composer mt-6 lw-desktop:mt-0">
        <Composer
          onSubmit={(d, files) => void start(d, files)}
          onAttach={(file) => currentDraft().attach(file)}
          onRemove={removePhoto}
          initial={restore}
          photoStatus={photoStatus}
          onRetry={retryPhoto}
        />
        {failure && (
          <div role="alert" className="px-3">
            <ErrorNote>{failure.message}</ErrorNote>
          </div>
        )}
      </div>
      <p className="lw-home__foot lw-caption mt-3 flex items-center justify-center gap-2 text-muted">
        <Icon name={icons.check} className="size-4" />
        No account needed
        <span aria-hidden>·</span>
        Takes about a minute
      </p>
    </main>
  );

  return (
    <>
      <PhotoBackdrop photo={!inFlow ? "pipe" : done ? "boiler" : "radiator"} />
      <div className={`lw-screen ${wide ? "lw-screen--wide" : ""}`}>
        {bookingBar ? (
          <TopBar
            title={unsupported ? "Not covered yet" : "New job"}
            steps={unsupported ? undefined : BOOKING_STEPS}
            current={searching ? 3 : stage}
            progress={!done && stage === 0 ? progress : undefined}
            onBack={!done && backTo && !failure ? () => reopen(backTo) : null}
            // Searching, the job is posted: the sheet's Cancel request is the way out.
            onClose={searching ? undefined : () => setDiscarding(true)}
          />
        ) : (
          <header className="lw-appbar">
            <Logo />
            <div className="flex items-center gap-2">
              {inFlow && (
                <button type="button" onClick={reset} className={`lw-glass lw-glass--pill ${buttonQuiet} h-11 px-4`}>
                  Start over
                </button>
              )}
              <AccountButton
                jobs={deviceJobs}
                onNewUser={() => {
                  // The next person starts clean: none of the last person's jobs on this device.
                  reset();
                  saveScheduled([]);
                  setScheduled([]);
                }}
              />
            </div>
          </header>
        )}

        {!inFlow ? (
          home
        ) : done && session ? (
          <main className="lw-screen__body pt-2">
            {failure ? (
              <div className="pt-6 lw-desktop:mx-auto lw-desktop:w-full lw-desktop:max-w-[560px]">
                <ErrorNotice failure={failure} />
              </div>
            ) : state.job.status === "open" ? (
              <MatchView session={session} state={state} initial={match} onNewJob={reset} onScheduled={scheduleCurrent} onStage={setLiveStage} />
            ) : state.job.writeUp?.unsupported ? (
              <div className="lw-desktop:mx-auto lw-desktop:w-full lw-desktop:max-w-[560px]">
                <Unsupported title={state.job.writeUp.title} needed={state.job.writeUp.unsupported} onStartOver={reset} />
              </div>
            ) : (
              <JobReady
                state={state}
                session={session}
                confirming={publishing}
                confirmError={confirmError}
                onEdit={editWriteUp}
                onCorrect={correctBrief}
                onPushback={answerPushback}
                briefQueue={brief}
                onAddPhoto={addBriefPhoto}
                onConfirm={(tier, when) => void confirm(tier, when)}
              />
            )}
          </main>
        ) : (
          <main className="lw-screen__body pt-3 lw-desktop:grid lw-desktop:grid-cols-[minmax(0,360px)_minmax(0,560px)] lw-desktop:content-start lw-desktop:justify-center lw-desktop:gap-x-12 lw-desktop:pt-8">
            {/* Desktop: the job sits in its own column beside the question. */}
            <aside className="lw-desktop:sticky lw-desktop:top-[148px] lw-desktop:self-start">
              {safety && (
                <div className="mb-3">
                  <SafetyBanner compact />
                </div>
              )}
              <JobContext
                label={jobLabel}
                entries={answeredEntries}
                photos={state?.photos ?? []}
                uploadToken={session?.uploadToken ?? null}
                onEdit={reopen}
              />
            </aside>

            <div className="min-w-0">
              {unsaved && (
                <div role="alert" className="lw-glass is-error mt-3 flex items-center gap-3 py-2.5 pr-2.5 pl-4 lw-desktop:mt-0 lw-desktop:mb-4">
                  <ErrorNote className="min-w-0 flex-1">
                    Your answer to &ldquo;{unsaved.entry.step.prompt}&rdquo; didn&apos;t save.
                  </ErrorNote>
                  <button
                    type="button"
                    disabled={unsaved.retrying}
                    onClick={() => answers.retry()}
                    className="lw-btn lw-btn--secondary lw-btn--compact shrink-0"
                  >
                    {unsaved.retrying ? "Retrying…" : "Retry"}
                  </button>
                </div>
              )}

              {failure ? (
                <div className="mt-8 lw-desktop:mt-0">
                  <ErrorNotice failure={failure} />
                </div>
              ) : step && session ? (
                <section key={step.id} aria-labelledby="question" className="mt-6 animate-question lw-desktop:mt-0">
                  <QuestionHeading id="question" className="lw-title-1 px-2 text-pretty">
                    {step.prompt}
                  </QuestionHeading>
                  {step.helper && <p className="lw-subhead mt-1.5 line-clamp-2 max-w-[34rem] px-2 text-muted text-pretty">{step.helper}</p>}
                  <div className="mt-5">
                    {step.type === "photos" ? (
                      <PhotoStep
                        session={session}
                        photos={state!.photos}
                        onPhotosChange={setPhotos}
                        onDone={(added) => answer(step, added ? "done" : null)}
                      />
                    ) : (
                      <QuestionStep
                        step={step}
                        initial={prefill[step.id]}
                        onAnswer={(a) => {
                          if (step.section === "where" && typeof a === "string") rememberSuburb(a);
                          answer(step, a);
                        }}
                      />
                    )}
                  </div>
                </section>
              ) : (
                // Between questions the next one usually lands within half a second: the loader
                // waits that long before fading in, so a quick answer goes question to question
                // with one transition instead of flashing it.
                <div className={`mt-8 animate-question lw-desktop:mt-0 ${answeredEntries.length > 0 ? "[animation-delay:450ms]" : ""}`}>
                  <Walking label={waitingLabel} />
                </div>
              )}
              {/* Outside the question, which is keyed by step, so the region is in place before a save error arrives. */}
              <LiveMessage className="lw-error-note mt-3 px-2">
                {!failure && step && answerError?.stepId === step.id ? answerError.message : null}
              </LiveMessage>
            </div>
          </main>
        )}
      </div>
      <DiscardSheet
        open={discarding}
        onKeep={() => setDiscarding(false)}
        onDiscard={() => {
          setDiscarding(false);
          reset();
        }}
      />
    </>
  );
}

/** Close on the booking screens: "Discard this job?" from the bottom, as on iOS (copy deck: describe.discard). */
function DiscardSheet({ open, onKeep, onDiscard }: { open: boolean; onKeep: () => void; onDiscard: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby="discard-title"
      onCancel={(e) => {
        e.preventDefault();
        onKeep();
      }}
      onClick={(e) => {
        // A tap on the scrim keeps the job.
        if (e.target === e.currentTarget) onKeep();
      }}
      className="lw-confirm-sheet lw-glass lw-glass--sheet"
    >
      <h2 id="discard-title" className="lw-title-3 px-1">
        Discard this job?
      </h2>
      <p className="lw-callout mt-1.5 px-1 text-muted text-pretty">You&apos;ll lose what you&apos;ve written and your photos.</p>
      <div className="mt-5 flex flex-col gap-2.5">
        <button type="button" onClick={onDiscard} className={buttonSecondary}>
          Discard
        </button>
        <button type="button" autoFocus onClick={onKeep} className={buttonQuiet}>
          Keep editing
        </button>
      </div>
    </dialog>
  );
}
