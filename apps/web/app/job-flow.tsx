"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  detectSafety,
  MAX_PHOTOS,
  type Answer,
  type ConfirmRequest,
  type CreateJobResponse,
  type MatchState,
  type Tier,
  type JobState,
  type Photo,
  type Step,
  type WriteUpEdit,
} from "@legwork/shared";
import { api, ApiRequestError, photoUrl, streamRound } from "@/lib/api";
import { uploadPhoto } from "@/lib/photos";
import { Composer } from "@/components/composer";
import { JobReady, SafetyBanner } from "@/components/job-ready";
import { MatchView } from "@/components/match-view";
import { PhoneQr } from "@/components/phone-qr";
import { PhotoPicker } from "@/components/photo-picker";
import { QuestionStep } from "@/components/question-step";
import { buttonPrimary, buttonQuiet, cardClass, Icon, icons, Logo, Walking } from "@/components/ui";

type Session = { id: string; token: string; uploadToken: string };
type Entry = { step: Step; answer: Answer };

const STORAGE_KEY = "legwork.job";

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function saveSession(session: Session | null) {
  try {
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode etc.: the flow still works, it just won't survive a reload.
  }
}

// Jobs the customer chose to schedule for later after no match, listed at home.
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

// The last suburb, so returning customers answer that question with one tap.
const SUBURB_KEY = "legwork.suburb";

function savedSuburb() {
  try {
    return localStorage.getItem(SUBURB_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function saveSuburb(suburb: string) {
  try {
    localStorage.setItem(SUBURB_KEY, suburb);
  } catch {
    // Not remembered; nothing else changes.
  }
}

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

  return (
    <div className="mt-5">
      <div className="flex items-center gap-3">
        {photos.length > 0 && uploadToken && (
          <div className="flex shrink-0 -space-x-2.5">
            {photos.slice(0, 3).map((p) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={p.id}
                src={photoUrl(p.path, uploadToken)}
                alt=""
                className="size-10 rounded-[10px] object-cover ring-2 ring-canvas"
              />
            ))}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-faint">Your job</p>
          <p className="truncate text-sm font-semibold">{label}</p>
        </div>
        {entries.length > 0 && (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full border border-line bg-white pr-2.5 pl-3.5 text-sm font-semibold text-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-brand"
          >
            <span className="hidden sm:inline">Your answers</span>
            <span className="sm:hidden">Answers</span>
            <span className="rounded-full bg-surface px-1.5 text-xs text-ink tabular-nums">{entries.length}</span>
            <Icon d="m6 9 6 6 6-6" className={`size-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
          </button>
        )}
      </div>

      {open && entries.length > 0 && (
        <ol className="mt-3 divide-y divide-line rounded-2xl border border-line bg-white shadow-card animate-fade-in">
          {entries.map((entry) => (
            <li key={entry.step.id} className="flex items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs text-faint">{entry.step.prompt}</p>
                <p className="truncate text-sm font-medium">{formatAnswer(entry, photos.length)}</p>
              </div>
              {entry.editable && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onEdit(entry);
                  }}
                  className="shrink-0 rounded-md px-2 py-1 text-sm font-semibold text-brand transition-colors hover:bg-brand-soft focus-visible:outline-2 focus-visible:outline-brand"
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
  // On a phone the camera is right there, so skip the QR code.
  const wide = useMediaQuery("(min-width: 768px)");
  // When the job already has photos, this step asks for more: Continue needs a new one.
  const [startCount] = useState(photos.length);
  const added = photos.length > startCount;
  return (
    <div className="space-y-5">
      <div className={wide ? "grid grid-cols-[1fr_13.5rem] gap-4" : ""}>
        <PhotoPicker
          jobId={session.id}
          token={session.token}
          uploadToken={session.uploadToken}
          photos={photos}
          onPhotosChange={onPhotosChange}
          max={MAX_PHOTOS}
          canRemove
          variant={wide ? "dropzone" : "button"}
          poll={wide}
        />
        {wide && <PhoneQr jobId={session.id} uploadToken={session.uploadToken} />}
      </div>
      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={() => onDone(false)} className={buttonQuiet}>
          Skip for now
        </button>
        <button type="button" disabled={!added} onClick={() => onDone(true)} className={buttonPrimary}>
          Continue
          <Icon d={icons.arrow} className="size-4.5" />
        </button>
      </div>
    </div>
  );
}

function ErrorNotice({ failure }: { failure: Failure }) {
  return (
    <div role="alert" className={`${cardClass} p-6`}>
      <p className="font-semibold text-danger">{failure.message}</p>
      <button type="button" onClick={failure.retry} className={`${buttonPrimary} mt-4 h-11 px-5 text-sm`}>
        Try again
      </button>
    </div>
  );
}

/** Shown instead of the summary card when no supported trade can do the job. It can't be confirmed. */
function Unsupported({ title, needed, onStartOver }: { title: string; needed: string; onStartOver: () => void }) {
  return (
    <div role="alert" className={`${cardClass} p-6`}>
      <p className="text-sm font-semibold text-muted">{title}</p>
      <h1 className="mt-2 text-[1.625rem] leading-[1.25] font-semibold tracking-[-0.015em] text-pretty">
        We don&apos;t support this kind of job yet
      </h1>
      <p className="mt-3 text-[17px] text-muted text-pretty">
        This sounds like one for {needed}, and none of our tradies cover that yet. Sorry we can&apos;t help with this one.
      </p>
      <button type="button" onClick={onStartOver} className={`${buttonPrimary} mt-5 h-11 px-5 text-sm`}>
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
  // Answers sent (or waiting to be sent) but not yet confirmed by the API. Their
  // questions are hidden straight away so the next one shows without waiting.
  const [pending, setPending] = useState<ReadonlyMap<string, Entry>>(new Map());
  // Earlier answers to show when the customer goes back to a question.
  const [prefill, setPrefill] = useState<Record<string, Answer>>({});
  const [roundRunning, setRoundRunning] = useState(false);
  const [publishing, setPublishing] = useState(false);
  // The search as it was when the customer confirmed; MatchView keeps it fresh.
  const [match, setMatch] = useState<MatchState | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [answerError, setAnswerError] = useState<string | null>(null);
  const [scheduled, setScheduled] = useState<ScheduledJob[]>([]);

  // Requests run one after another: a round, then answers in the order given.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const pendingRef = useRef(new Map<string, Entry>());
  const generation = useRef(0);

  const updatePending = (update: (pending: Map<string, Entry>) => void) => {
    update(pendingRef.current);
    setPending(new Map(pendingRef.current));
  };

  const reset = useCallback(() => {
    generation.current++;
    queue.current = Promise.resolve();
    pendingRef.current = new Map();
    saveSession(null);
    setSession(null);
    setDraft(null);
    setStarting(null);
    setState(null);
    setPending(new Map());
    setPrefill({});
    setMatch(null);
    setRoundRunning(false);
    setFailure(null);
    setAnswerError(null);
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
      queue.current = queue.current.then(round);
    },
    [reset],
  );

  /** Reloads the job from the API and carries on from wherever it is. */
  const resync = useCallback(
    async (s: Session) => {
      setFailure(null);
      try {
        const fresh = await api<JobState>(`/jobs/${s.id}/state`, { token: s.token });
        setState(fresh);
        if (fresh.job.status === "intake" && fresh.queue.length === 0) runRound(s);
      } catch (e) {
        if (e instanceof ApiRequestError && e.status === 404) return reset();
        setFailure({ message: (e as Error).message, retry: () => void resync(s) });
      }
    },
    [reset, runRound],
  );

  useEffect(() => setScheduled(loadScheduled()), []);

  const updateScheduled = (update: (jobs: ScheduledJob[]) => ScheduledJob[]) => {
    const next = update(loadScheduled());
    saveScheduled(next);
    setScheduled(next);
  };

  /** "Schedule for later": list the job at home and go back there. */
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

  // Photos added on the homepage upload straight away to a draft job, so the
  // vision model can read them while the customer is still typing.
  const early = useRef<{ session: Promise<Session>; uploads: Map<File, Promise<Photo | null>> } | null>(null);

  function attachEarly(file: File) {
    if (!early.current) {
      const draftSession = api<CreateJobResponse>("/jobs", { method: "POST", json: { description: "" } }).then((c) => ({
        id: c.job.id,
        token: c.token,
        uploadToken: c.uploadToken,
      }));
      draftSession.catch(() => {});
      early.current = { session: draftSession, uploads: new Map() };
    }
    const { session: draftSession, uploads } = early.current;
    uploads.set(
      file,
      draftSession.then((s) => uploadPhoto(s.id, s.token, file)).catch(() => null),
    );
  }

  function removeEarly(file: File) {
    const pre = early.current;
    const upload = pre?.uploads.get(file);
    if (!pre || !upload) return;
    pre.uploads.delete(file);
    void Promise.all([pre.session, upload])
      .then(([s, photo]) => photo && api(`/jobs/${s.id}/photos/${photo.id}`, { method: "DELETE", token: s.token }))
      .catch(() => {});
  }

  /** The job to start: the early draft (with its photos already up) or a new one. */
  async function prepareJob(description: string, files: File[]): Promise<{ s: Session; photos: Photo[] }> {
    const pre = early.current;
    early.current = null;

    if (pre) {
      try {
        const s = await pre.session;
        setStarting(files.length > 0 ? "uploading" : "creating");
        const photos = await Promise.all(files.map((f) => pre.uploads.get(f) ?? uploadPhoto(s.id, s.token, f).catch(() => null)));
        if (description) await api(`/jobs/${s.id}/description`, { method: "POST", token: s.token, json: { description } });
        return { s, photos: photos.filter((p): p is Photo => p !== null) };
      } catch {
        // The draft didn't work out: fall through and start fresh.
      }
    }

    const created = await api<CreateJobResponse>("/jobs", { method: "POST", json: { description } });
    const s = { id: created.job.id, token: created.token, uploadToken: created.uploadToken };
    if (files.length > 0) setStarting("uploading");
    const uploaded = await Promise.allSettled(files.map((f) => uploadPhoto(s.id, s.token, f)));
    return { s, photos: uploaded.flatMap((r) => (r.status === "fulfilled" ? [r.value] : [])) };
  }

  async function start(description: string, files: File[]) {
    const gen = generation.current;
    setDraft(description);
    setStarting("creating");
    setFailure(null);
    try {
      const { s, photos } = await prepareJob(description, files);
      if (gen !== generation.current) return;
      if (!description && photos.length === 0) {
        // Nothing to go on: back to the start with a reason.
        reset();
        setFailure({
          message: "We couldn't upload your photos. Try again, or describe the job instead.",
          retry: () => setFailure(null),
        });
        return;
      }
      const fresh = await api<JobState>(`/jobs/${s.id}/state`, { token: s.token });
      if (gen !== generation.current) return;
      saveSession(s);
      setSession(s);
      setState(fresh);
      setStarting(null);
      runRound(s);
    } catch (e) {
      if (gen !== generation.current) return;
      setDraft(null);
      setStarting(null);
      setFailure({ message: (e as Error).message, retry: () => setFailure(null) });
    }
  }

  function answer(step: Step, value: Answer) {
    if (!session) return;
    const s = session;
    const gen = generation.current;
    setAnswerError(null);
    const entry = { step, answer: value };
    updatePending((p) => p.set(step.id, entry));

    queue.current = queue.current.then(async () => {
      // Skipped if the customer went back to this question before it was sent.
      if (gen !== generation.current || pendingRef.current.get(step.id) !== entry) return;
      try {
        const next = await api<JobState>(`/jobs/${s.id}/steps/${step.id}/answer`, {
          method: "POST",
          token: s.token,
          json: { answer: value },
        });
        if (gen !== generation.current) return;
        updatePending((p) => p.delete(step.id));
        setState(next);
        // That was the last queued question: time for the next round.
        if (next.job.status === "intake" && next.queue.length === 0 && pendingRef.current.size === 0) runRound(s);
      } catch (e) {
        if (gen !== generation.current) return;
        // Drop everything not yet confirmed and take the API's word for where we are.
        updatePending((p) => p.clear());
        queue.current = Promise.resolve();
        if (e instanceof ApiRequestError && e.status === 400) setAnswerError(e.message);
        await resync(s);
      }
    });
  }

  /** Back / Edit: shows an earlier question again with its answer filled in. */
  function reopen(entry: Entry) {
    if (!session) return;
    const s = session;
    const gen = generation.current;
    setAnswerError(null);
    setPrefill((p) => ({ ...p, [entry.step.id]: entry.answer }));

    if (pendingRef.current.has(entry.step.id)) {
      // Not sent yet: just take it back.
      updatePending((p) => p.delete(entry.step.id));
      return;
    }

    // Saved already: show it now, and reopen it on the API in turn.
    setState(
      (st) =>
        st && {
          ...st,
          history: st.history.filter((h) => h.step.id !== entry.step.id),
          queue: [entry.step, ...st.queue].sort((a, b) => a.position - b.position),
        },
    );
    queue.current = queue.current.then(async () => {
      if (gen !== generation.current) return;
      try {
        const next = await api<JobState>(`/jobs/${s.id}/steps/${entry.step.id}/reopen`, { method: "POST", token: s.token });
        if (gen === generation.current && pendingRef.current.size === 0) setState(next);
      } catch (e) {
        if (gen !== generation.current) return;
        updatePending((p) => p.clear());
        queue.current = Promise.resolve();
        setAnswerError((e as Error).message);
        await resync(s);
      }
    });
  }

  async function editWriteUp(edit: WriteUpEdit) {
    if (!session) return;
    setState(await api<JobState>(`/jobs/${session.id}/write-up`, { method: "PATCH", token: session.token, json: edit }));
  }

  /** Locks the chosen tier's price and starts the search. */
  async function confirm(tier: Tier, date: string) {
    if (!session) return;
    setPublishing(true);
    try {
      const started = await api<MatchState>(`/jobs/${session.id}/confirm`, {
        method: "POST",
        token: session.token,
        json: { tier, date } satisfies ConfirmRequest,
      });
      setMatch(started);
      setState((st) => st && { ...st, job: { ...st.job, status: "open" } });
    } catch (e) {
      setFailure({ message: (e as Error).message, retry: () => setFailure(null) });
    } finally {
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
  const firstAnswer = answeredEntries.find((e) => e.step.position === 0)?.answer;
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

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-5 py-4 sm:px-8">
        <Logo />
        {inFlow && (
          <button type="button" onClick={reset} className={buttonQuiet}>
            Start over
          </button>
        )}
      </header>

      {!inFlow ? (
        <main className="mx-auto flex w-full max-w-[680px] flex-1 flex-col justify-center px-5 pb-[14vh] sm:px-8">
          <h1 className="text-center text-[2rem] leading-tight font-semibold tracking-[-0.02em] text-balance sm:text-[2.75rem]">
            What do you need done?
          </h1>
          <p className="mx-auto mt-3 max-w-md text-center text-lg text-muted text-pretty">
            Describe it in a sentence or just add a photo. We&apos;ll ask a few quick questions and bring the right tradie to you.
          </p>
          <div className="mt-8">
            <Composer onSubmit={(d, files) => void start(d, files)} onAttach={attachEarly} onRemove={removeEarly} />
            {failure && (
              <p role="alert" className="mt-3 text-center text-sm text-danger">
                {failure.message}
              </p>
            )}
          </div>
          {scheduled.length > 0 && (
            <section aria-labelledby="scheduled" className="mt-8">
              <h2 id="scheduled" className="text-sm font-semibold text-muted">
                Scheduled for later
              </h2>
              <ul className="mt-2 space-y-2">
                {scheduled.map((job) => (
                  <li key={job.id}>
                    <button
                      type="button"
                      onClick={() => openScheduled(job)}
                      className={`${cardClass} flex w-full items-center justify-between gap-3 px-4 py-3 text-left`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{job.title}</span>
                        {job.date && <span className="block text-sm text-muted">Needed by {shortDate(job.date)}</span>}
                      </span>
                      <span className="shrink-0 text-sm font-semibold text-brand">Search again</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <p className="mt-8 flex items-center justify-center gap-2 text-[13px] text-faint">
            <Icon d={icons.check} className="size-4 text-success" />
            No account needed
            <span aria-hidden>·</span>
            Takes about a minute
          </p>
        </main>
      ) : done && session ? (
        <main className="mx-auto w-full max-w-[680px] flex-1 px-5 pt-4 pb-16 sm:px-8 sm:pt-8">
          {failure ? (
            <ErrorNotice failure={failure} />
          ) : state.job.status === "open" ? (
            <MatchView session={session} state={state} initial={match} onNewJob={reset} onScheduled={scheduleCurrent} />
          ) : state.job.writeUp?.unsupported ? (
            <Unsupported title={state.job.writeUp.title} needed={state.job.writeUp.unsupported} onStartOver={reset} />
          ) : (
            <JobReady
              state={state}
              session={session}
              confirming={publishing}
              onEdit={editWriteUp}
              onPhotosChange={setPhotos}
              onConfirm={(tier, date) => void confirm(tier, date)}
              onStartOver={reset}
            />
          )}
        </main>
      ) : (
        <main className="mx-auto w-full max-w-[640px] flex-1 px-5 pt-2 pb-16 sm:px-8 sm:pt-6">
          {safety && (
            <div className="mb-5">
              <SafetyBanner />
            </div>
          )}
          <div className="h-1 overflow-hidden rounded-full bg-line" aria-hidden>
            <div
              className="h-full rounded-full bg-brand transition-[width] duration-500 ease-out"
              style={{ width: `${Math.max(4, progress * 100)}%` }}
            />
          </div>

          <JobContext
            label={jobLabel}
            entries={answeredEntries}
            photos={state?.photos ?? []}
            uploadToken={session?.uploadToken ?? null}
            onEdit={reopen}
          />

          {failure ? (
            <div className="mt-10 sm:mt-14">
              <ErrorNotice failure={failure} />
            </div>
          ) : step && session ? (
            <section key={step.id} aria-labelledby="question" className="mt-10 animate-question sm:mt-14">
              <div className="flex h-8 items-center justify-end">
                {backTo && (
                  <button type="button" onClick={() => reopen(backTo)} className={`${buttonQuiet} -mr-3 h-8 px-2.5`}>
                    <Icon d={icons.back} className="size-4" />
                    Back
                  </button>
                )}
              </div>
              <h1
                id="question"
                className="mt-2 text-[1.625rem] leading-[1.25] font-semibold tracking-[-0.015em] text-pretty sm:text-[2rem]"
              >
                {step.prompt}
              </h1>
              {step.helper && <p className="mt-3 text-[17px] text-muted text-pretty">{step.helper}</p>}
              <div className="mt-8">
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
                    initial={prefill[step.id] ?? (step.section === "where" ? savedSuburb() : undefined)}
                    onAnswer={(a) => {
                      if (step.section === "where" && typeof a === "string") saveSuburb(a);
                      answer(step, a);
                    }}
                  />
                )}
              </div>
              {answerError && (
                <p role="alert" className="mt-3 text-sm text-danger">
                  {answerError}
                </p>
              )}
            </section>
          ) : (
            <div className="mt-10 animate-question sm:mt-14">
              <Walking label={waitingLabel} />
            </div>
          )}
        </main>
      )}
    </div>
  );
}
