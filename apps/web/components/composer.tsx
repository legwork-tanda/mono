"use client";

import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from "react";
import { CORRECTION_MAX, JOB_DESCRIPTION_MAX, MAX_PHOTOS } from "@legwork/shared";
import { photoHint } from "@/lib/photos";
import { MicButton, useDictation } from "./dictation";
import { ErrorNote, Icon, icons, Spinner } from "./ui";

const EXAMPLES = ["My kitchen tap is leaking", "Paint two bedrooms", "Install a ceiling fan"];

type Attachment = { key: string; file: File; preview: string };

const isImage = (f: File) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name);

/** A photo's upload on the homepage, when it needs the customer: it failed, or is being retried. */
export type PhotoStatus = { error: string } | "retrying";

const RETRY_ICON = "M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v3.5H8";

/**
 * The homepage prompt: describe the job, optionally with photos (attach,
 * paste, or drop them anywhere on the page). With `variant="brief"` it's the
 * one input on the summary card (#55): "Anything wrong? Just say it.", typed
 * or spoken. There, photos go straight to `onAttach` (the brief shows them),
 * and the text clears once `onSubmit` resolves to true.
 */
export function Composer({
  onSubmit,
  onAttach,
  onRemove,
  variant = "home",
  busy = false,
  reply,
  prefill,
  initial,
  photoStatus,
  onRetry,
}: {
  onSubmit: (description: string, photos: File[]) => void | Promise<boolean>;
  /** Called as each photo is added, so it can start uploading before submit. */
  onAttach?: (file: File) => void;
  onRemove?: (file: File) => void;
  variant?: "home" | "brief";
  /** Brief: a correction is being applied. */
  busy?: boolean;
  /** Brief: the one-line answer to the last correction, shown under the box. */
  reply?: ReactNode;
  /** Brief: text to start the box with (e.g. from tapping a gap), focused. `n` changes each time. */
  prefill?: { text: string; n: number } | null;
  /** Home: what the customer had entered when starting last failed, to start the box with (#67). */
  initial?: { description: string; files: File[] } | null;
  /** Home: photos that failed to upload (or are being retried), shown on their thumbnails. */
  photoStatus?: ReadonlyMap<File, PhotoStatus>;
  /** Home: upload a failed photo again. */
  onRetry?: (file: File) => void;
}) {
  const brief = variant === "brief";
  const max = brief ? CORRECTION_MAX : JOB_DESCRIPTION_MAX;
  const [value, setValue] = useState(() => initial?.description ?? "");
  const [attachments, setAttachments] = useState<Attachment[]>(() =>
    (initial?.files ?? []).map((file) => ({ key: crypto.randomUUID(), file, preview: URL.createObjectURL(file) })),
  );
  // Refs keep the page-wide drop handler (registered once) current.
  const countRef = useRef(0);
  countRef.current = attachments.length;
  const onAttachRef = useRef(onAttach);
  onAttachRef.current = onAttach;
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const trimmed = value.trim();
  const dictation = useDictation((text) => {
    setValue(text.slice(0, max));
    setNotice(null);
  });
  useEffect(() => {
    if (!prefill) return;
    setValue(prefill.text.slice(0, max));
    const el = textarea.current;
    el?.focus();
    el?.setSelectionRange(prefill.text.length, prefill.text.length);
  }, [prefill, max]);
  useEffect(() => {
    if (dictation.error) setNotice(dictation.error);
  }, [dictation.error]);

  useEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  function add(files: Iterable<File>) {
    const images = [...files].filter(isImage);
    if (images.length === 0) return;
    if (brief) {
      // On the brief, photos upload at once and show on the card.
      images.forEach((file) => onAttachRef.current?.(file));
      return;
    }
    const room = MAX_PHOTOS - countRef.current;
    setNotice(images.length > room ? `You can add up to ${MAX_PHOTOS} photos.` : null);
    const accepted = images
      .slice(0, Math.max(0, room))
      .map((file) => ({ key: crypto.randomUUID(), file, preview: URL.createObjectURL(file) }));
    countRef.current += accepted.length;
    setAttachments((current) => [...current, ...accepted]);
    accepted.forEach((a) => onAttachRef.current?.(a.file));
    textarea.current?.focus();
  }

  function remove(key: string) {
    setNotice(null);
    const gone = attachments.find((a) => a.key === key);
    if (!gone) return;
    URL.revokeObjectURL(gone.preview);
    onRemove?.(gone.file);
    setAttachments((current) => current.filter((a) => a.key !== key));
  }

  // Photos can be dropped anywhere on the page, not just on the box.
  useEffect(() => {
    if (brief) return;
    let depth = 0;
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files") ?? false;
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      if (e.dataTransfer) add(e.dataTransfer.files);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [brief]);

  // A description, photos, or both: with only photos we work the job out from them.
  const canSubmit = trimmed.length > 0 || attachments.length > 0;
  const failedKeys = new Set(attachments.filter((a) => photoStatus?.has(a.file)).map((a) => a.key));
  const kept = attachments.filter((a) => !failedKeys.has(a.key));
  // Without the failed photos there must still be something to go on.
  const canContinueWithout = failedKeys.size > 0 && (trimmed.length > 0 || kept.length > 0);

  /** Drops the photos that failed and starts with what made it through. */
  function continueWithout() {
    failedKeys.forEach(remove);
    dictation.stop();
    onSubmit(
      trimmed,
      kept.map((a) => a.file),
    );
  }

  async function submitBrief() {
    if (!trimmed || busy) {
      textarea.current?.focus();
      return;
    }
    dictation.stop();
    if (await onSubmit(trimmed, [])) setValue("");
  }

  function submit() {
    if (brief) return void submitBrief();
    if (!canSubmit) {
      setNotice("Describe the job or add a photo to get started.");
      textarea.current?.focus();
      return;
    }
    dictation.stop();
    // The previews are handed over with the files; the flow shows them next.
    onSubmit(
      trimmed,
      attachments.map((a) => a.file),
    );
  }

  const textareaEvents = {
    onPaste: (e: ClipboardEvent<HTMLTextAreaElement>) => {
      const files = [...e.clipboardData.files].filter(isImage);
      if (files.length > 0) {
        e.preventDefault();
        add(files);
      }
    },
    onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        submit();
      }
    },
  };

  const fileInput = (
    <input
      ref={picker}
      type="file"
      accept="image/*"
      multiple
      className="sr-only"
      tabIndex={-1}
      onChange={(e) => {
        if (e.target.files) add(e.target.files);
        e.target.value = "";
      }}
    />
  );

  if (brief) {
    // S02's composer: a glass pill with photos, the text, the mic, and a yellow send once there's something to send.
    return (
      <div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="lw-glass flex min-h-14 items-end gap-0.5 rounded-[28px] py-1.5 pr-1.5 pl-1.5"
        >
          {fileInput}
          <button type="button" onClick={() => picker.current?.click()} aria-label="Add photos" title="Add photos" className="lw-icon-btn text-muted">
            <Icon name={icons.camera} />
          </button>
          <label htmlFor="brief-correction" className="sr-only">
            Anything wrong? Just say it.
          </label>
          <textarea
            id="brief-correction"
            ref={textarea}
            rows={1}
            value={value}
            maxLength={max}
            onChange={(e) => {
              setValue(e.target.value);
              setNotice(null);
            }}
            {...textareaEvents}
            placeholder={dictation.listening ? "Listening… say what's wrong" : "Anything wrong? Just say it."}
            className="lw-callout lw-placeholder block max-h-32 min-h-11 min-w-0 flex-1 resize-none bg-transparent px-1 py-[11px] text-ink outline-none"
          />
          {dictation.supported && (
            <MicButton
              listening={dictation.listening}
              busy={dictation.busy}
              accent={!trimmed && !busy}
              onClick={() => (dictation.listening ? dictation.stop() : dictation.start(value))}
            />
          )}
          {(trimmed || busy) && (
            <button type="submit" disabled={busy} aria-label="Fix it" className="lw-icon-btn lw-icon-btn--accent disabled:opacity-70">
              {busy ? <Spinner /> : <Icon name={icons.send} fill className="size-5" />}
            </button>
          )}
        </form>
        {(notice || reply) && (
          <div role="status" className="lw-caption mt-2 px-4 text-pretty text-muted">
            {notice ? <ErrorNote>{notice}</ErrorNote> : reply}
          </div>
        )}
      </div>
    );
  }

  const hasContent = trimmed.length > 0 || attachments.length > 0;

  return (
    <>
      <div className="mb-3 flex flex-wrap gap-2 px-1">
        {EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => {
              setValue(example);
              setNotice(null);
              textarea.current?.focus();
            }}
            className="lw-chip lw-chip--compact lw-glass"
          >
            {example}
          </button>
        ))}
      </div>

      {/* S01's describe bar: a glass panel with the text, photos, and the yellow mic or send. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className={`lw-glass pt-4 pr-3 pb-3 pl-5 ${dragging ? "is-selected" : ""}`}
      >
        <label htmlFor="job" className="sr-only">
          What needs fixing?
        </label>
        <textarea
          id="job"
          ref={textarea}
          rows={2}
          autoFocus
          value={value}
          maxLength={JOB_DESCRIPTION_MAX}
          onChange={(e) => {
            setValue(e.target.value);
            setNotice(null);
          }}
          {...textareaEvents}
          placeholder={
            dictation.listening
              ? "Listening… describe the job"
              : attachments.length > 0
                ? "Add a few words if you like, or just get started"
                : "Describe it in your own words…"
          }
          className="lw-placeholder block max-h-56 min-h-14 w-full resize-none bg-transparent pr-2 text-[18px] leading-[1.35] text-ink outline-none"
        />

        {attachments.length > 0 && (
          <ul className="flex flex-wrap gap-2 pt-3">
            {attachments.map((a, i) => {
              const status = photoStatus?.get(a.file);
              return (
                <li
                  key={a.key}
                  className={`relative size-16 overflow-hidden rounded-thumb bg-surface animate-fade-in ${status ? "ring-2 ring-[var(--lw-error-ring)]" : ""}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={a.preview} alt="" className={`lw-thumb size-full rounded-none ${status ? "opacity-40" : ""}`} />
                  {status === "retrying" ? (
                    <span className="absolute inset-0 flex items-center justify-center text-ink" aria-label={`Uploading photo ${i + 1}`}>
                      <Spinner />
                    </span>
                  ) : status ? (
                    <button
                      type="button"
                      onClick={() => onRetry?.(a.file)}
                      aria-label={`Photo ${i + 1} didn't upload. Retry`}
                      title={status.error}
                      className="lw-press absolute inset-x-1 bottom-1 flex h-6 items-center justify-center gap-1 rounded-full bg-[#1D1D1F] text-xs font-semibold text-[#fff]"
                    >
                      <Icon d={RETRY_ICON} className="size-3.5" />
                      Retry
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => remove(a.key)}
                    aria-label="Remove photo"
                    className="lw-press absolute top-1 right-1 flex size-6 items-center justify-center rounded-full bg-[#1D1D1F]/75 text-[#fff]"
                  >
                    <Icon name={icons.close} className="size-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {failedKeys.size > 0 && (
          <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-3">
            <ErrorNote>
              {failedKeys.size === 1
                ? `Photo ${attachments.findIndex((a) => failedKeys.has(a.key)) + 1} didn't upload.`
                : `Photos ${attachments.flatMap((a, i) => (failedKeys.has(a.key) ? [i + 1] : [])).join(", ").replace(/, (\d+)$/, " and $1")} didn't upload.`}{" "}
              Retry or remove {failedKeys.size === 1 ? "it" : "them"}.
            </ErrorNote>
            {canContinueWithout && (
              <button type="button" onClick={continueWithout} className="lw-link">
                Continue without {failedKeys.size === 1 ? "it" : "them"}
              </button>
            )}
          </div>
        )}
        {attachments.length === 1 && <p className="lw-caption pt-2 text-muted">{photoHint(1)}</p>}

        <div className="mt-1 flex items-center justify-between gap-3">
          {fileInput}
          <button
            type="button"
            onClick={() => picker.current?.click()}
            className="lw-btn-quiet -ml-3 font-normal text-muted"
          >
            <Icon name={icons.image} className="size-6" />
            <span>
              Add photos<span className="hidden sm:inline"> or drop them here</span>
            </span>
          </button>
          <div className="flex items-center gap-1.5">
            {dictation.supported && (
              <MicButton
                listening={dictation.listening}
                busy={dictation.busy}
                accent={!hasContent}
                onClick={() => (dictation.listening ? dictation.stop() : dictation.start(value))}
              />
            )}
            {(hasContent || !dictation.supported) && (
              <button type="submit" aria-label="Get started" title="Get started" className="lw-icon-btn lw-icon-btn--accent lw-icon-btn--mic">
                <Icon name={icons.arrow} className="size-[22px]" />
              </button>
            )}
          </div>
        </div>
      </form>

      <div role="status" className="mt-2 min-h-5 px-3">
        {notice && <ErrorNote>{notice}</ErrorNote>}
      </div>

      {dragging && (
        <div className="lw-scrim pointer-events-none z-50 flex items-center justify-center p-6 animate-fade-in">
          <div className="lw-glass lw-glass--sheet flex flex-col items-center gap-3 px-12 py-10 text-center">
            <span className="lw-glass lw-glass--circle">
              <Icon name={icons.image} />
            </span>
            <p className="lw-title-3">Drop photos to add them to your job</p>
            <p className="lw-caption text-muted">Up to {MAX_PHOTOS} photos</p>
          </div>
        </div>
      )}
    </>
  );
}
