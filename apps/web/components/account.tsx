"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  AuthError,
  contactLabel,
  currentUser,
  initials,
  MOCK_CODE_HINT,
  signIn,
  signOut,
  verifyCode,
  type Challenge,
  type User,
} from "@/lib/mock-auth";
import { buttonPrimary, buttonQuiet, buttonSecondary, ErrorNote, fieldClass, Icon, icons, linkButton } from "./ui";

/** A job this device holds the token for, as listed under "My jobs". */
export type DeviceJob = { id: string; title: string; detail: string; action: string; onOpen: () => void };

type View = { name: "account" } | { name: "contact"; mode: "in" | "up" } | { name: "code"; challenge: Challenge };

/**
 * The header's account entry point (#63): "Sign in" when signed out, the
 * customer's initials and first name when signed in. Opens a sheet with the
 * sign in / sign up screens, or "My jobs" and "Sign out". Entirely optional:
 * nothing in the job flow waits for it.
 */
export function AccountButton({ jobs }: { jobs: DeviceJob[] }) {
  const [user, setUser] = useState<User | null>(null);
  const [view, setView] = useState<View | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => setUser(currentUser()), []);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (view && !el.open) {
      el.showModal();
      // Start in the first field, not on Close.
      el.querySelector<HTMLInputElement>("input")?.focus();
    }
    if (!view && el.open) el.close();
  }, [view]);

  const open = () => setView(user ? { name: "account" } : { name: "contact", mode: "in" });
  const close = () => setView(null);

  return (
    <>
      {user ? (
        <button
          type="button"
          onClick={open}
          aria-label={`Account: ${user.name}`}
          title={user.name.split(/\s+/)[0]}
          className="lw-glass lw-glass--circle text-[15px] font-semibold"
        >
          <span aria-hidden>{initials(user.name)}</span>
        </button>
      ) : (
        <button type="button" onClick={open} aria-label="Sign in" title="Sign in" className="lw-glass lw-glass--circle">
          <Icon name={icons.user} />
        </button>
      )}

      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        onClose={close}
        onClick={(e) => e.target === e.currentTarget && close()}
        className="lw-glass lw-glass--sheet lw-account-sheet mx-auto mt-auto mb-2 max-h-[calc(100dvh-env(safe-area-inset-top)-16px)] w-[calc(100%-16px)] max-w-[424px] overflow-y-auto p-0 text-ink open:animate-fade-in sm:my-auto lg:max-w-[440px]"
      >
        {view && (
          <div className="px-5 pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom))] lg:px-7 lg:pb-7">
            {/* A sheet on a phone (grabber), a centred card from 640px (no grabber). */}
            <div className="lw-grabber sm:hidden" aria-hidden />
            <div className="flex justify-end">
              <button type="button" onClick={close} aria-label="Close" className="lw-icon-btn -mt-2 -mr-2.5">
                <Icon name={icons.close} />
              </button>
            </div>
            {/* One calm fade as the sheet moves between sign-in, code and account. */}
            <div key={view.name} className="animate-fade-in">
              {view.name === "account" && user ? (
                <AccountPanel
                  titleId={titleId}
                  user={user}
                  jobs={jobs}
                  onOpenJob={(job) => {
                    close();
                    job.onOpen();
                  }}
                  onSignOut={async () => {
                    await signOut();
                    setUser(null);
                    close();
                  }}
                />
              ) : view.name === "code" ? (
                <CodeForm
                  titleId={titleId}
                  challenge={view.challenge}
                  onBack={() => setView({ name: "contact", mode: view.challenge.name ? "up" : "in" })}
                  onDone={(u) => {
                    setUser(u);
                    setView({ name: "account" });
                  }}
                />
              ) : view.name === "contact" ? (
                <ContactForm
                  key={view.mode}
                  titleId={titleId}
                  mode={view.mode}
                  onSwitch={(mode) => setView({ name: "contact", mode })}
                  onSent={(challenge) => setView({ name: "code", challenge })}
                />
              ) : null}
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}

function Avatar({ name, large = false }: { name: string; large?: boolean }) {
  return (
    <span
      aria-hidden
      className={`lw-initials lw-initials--accent ${large ? "size-14 text-lg" : ""}`}
    >
      {initials(name)}
    </span>
  );
}

function ContactForm({
  titleId,
  mode,
  onSwitch,
  onSent,
}: {
  titleId: string;
  mode: "in" | "up";
  onSwitch: (mode: "in" | "up") => void;
  onSent: (challenge: Challenge) => void;
}) {
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signUp = mode === "up";

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (signUp && !name.trim()) return setError("Add your name.");
    setBusy(true);
    setError(null);
    try {
      onSent(await signIn({ contact, name: signUp ? name : undefined }));
    } catch (err) {
      setError(err instanceof AuthError ? err.message : "Something went wrong. Try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <h2 id={titleId} className="lw-title-2">
        {signUp ? "Create your account" : "Sign in"}
      </h2>
      <p className="lw-callout mt-1.5 text-muted text-pretty">
        {signUp ? "Keep your jobs in one place." : "We'll send you a 6-digit code. No password needed."}
      </p>

      <div className="mt-6 space-y-4">
        {signUp && (
          <label className="block">
            <span className="lw-footnote font-semibold text-faint">Your name</span>
            <input
              className={`${fieldClass} mt-1.5 ${error ? "is-error" : ""}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              autoFocus
              required
            />
          </label>
        )}
        <label className="block">
          <span className="lw-footnote font-semibold text-faint">Email or mobile</span>
          <input
            className={`${fieldClass} mt-1.5 ${error ? "is-error" : ""}`}
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            placeholder="you@example.com or 0412 345 678"
            autoComplete="username"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus={!signUp}
            required
          />
        </label>
      </div>

      {error && (
        <div role="alert" className="mt-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      <button type="submit" disabled={busy || !contact.trim()} className={`${buttonPrimary} mt-6 w-full`}>
        {busy ? "Sending code…" : "Send code"}
      </button>

      <p className="lw-subhead mt-5 text-center text-muted">
        {signUp ? "Already have an account? " : "New to Legwork? "}
        <button type="button" onClick={() => onSwitch(signUp ? "in" : "up")} className={linkButton}>
          {signUp ? "Sign in" : "Create an account"}
        </button>
      </p>
      <p className="lw-footnote mt-3 text-center text-faint">You can post a job without an account.</p>
    </form>
  );
}

function CodeForm({
  titleId,
  challenge,
  onBack,
  onDone,
}: {
  titleId: string;
  challenge: Challenge;
  onBack: () => void;
  onDone: (user: User) => void;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onDone(await verifyCode(challenge, code));
    } catch (err) {
      setError(err instanceof AuthError ? err.message : "Something went wrong. Try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <button type="button" onClick={onBack} className={`${buttonQuiet} -ml-3`}>
        <Icon name={icons.back} className="size-4" />
        Back
      </button>
      <h2 id={titleId} className="lw-title-2 mt-2">
        Enter your code
      </h2>
      <p className="lw-callout mt-1.5 text-muted text-pretty">
        We sent a 6-digit code to <span className="font-semibold text-ink">{contactLabel(challenge)}</span>.
      </p>

      <label className="mt-6 block">
        <span className="sr-only">6-digit code</span>
        <input
          className={`${fieldClass} text-center text-2xl font-semibold tracking-[0.4em] tabular-nums ${error ? "is-error" : ""}`}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="••••••"
          aria-describedby={`${titleId}-hint`}
          autoFocus
        />
      </label>
      {/* MOCK: no code is sent, so say which one to type. */}
      <p id={`${titleId}-hint`} className="lw-caption mt-2 text-center text-muted">
        Demo: any 6 digits work, e.g. <span className="font-semibold text-ink tabular-nums">{MOCK_CODE_HINT}</span>
      </p>

      {error && (
        <div role="alert" className="mt-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      <button type="submit" disabled={busy || code.length !== 6} className={`${buttonPrimary} mt-6 w-full`}>
        {busy ? (
          "Checking…"
        ) : challenge.isNew ? (
          "Create account"
        ) : (
          "Sign in"
        )}
      </button>
    </form>
  );
}

function AccountPanel({
  titleId,
  user,
  jobs,
  onOpenJob,
  onSignOut,
}: {
  titleId: string;
  user: User;
  jobs: DeviceJob[];
  onOpenJob: (job: DeviceJob) => void;
  onSignOut: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  return (
    <div>
      <div className="flex items-center gap-4">
        <Avatar name={user.name} large />
        <div className="min-w-0">
          <h2 id={titleId} className="lw-title-2 truncate">
            {user.name}
          </h2>
          <p className="lw-caption truncate text-muted">{contactLabel(user)}</p>
        </div>
      </div>

      <section aria-labelledby={`${titleId}-jobs`} className="mt-7">
        <h3 id={`${titleId}-jobs`} className="lw-section-label mx-1">
          My jobs
        </h3>
        {jobs.length === 0 ? (
          <p className="lw-inner lw-caption mt-2 px-4 py-4 text-muted">
            Jobs you post on this device show up here.
          </p>
        ) : (
          <ul className="lw-inner mt-2 divide-y divide-line px-3.5">
            {jobs.map((job) => (
              <li key={job.id}>
                <button
                  type="button"
                  onClick={() => onOpenJob(job)}
                  className="lw-li lw-press w-full text-left focus-visible:outline-2 focus-visible:outline-selected"
                >
                  <span className="min-w-0 flex-1">
                    <span className="lw-headline block truncate">{job.title}</span>
                    <span className="lw-caption block truncate text-muted">{job.detail}</span>
                  </span>
                  <span className="lw-subhead flex shrink-0 items-center gap-1 font-semibold text-ink">
                    {job.action}
                    <Icon name="caret-right" className="size-4 text-faint" />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {jobs.length > 0 && <p className="lw-footnote mt-2 px-1 text-faint">Only jobs started on this device for now.</p>}
      </section>

      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void onSignOut().finally(() => setBusy(false));
        }}
        className={`${buttonSecondary} mt-7 w-full`}
      >
        {busy ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );
}
