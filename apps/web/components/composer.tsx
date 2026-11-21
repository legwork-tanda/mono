"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { CORRECTION_MAX, JOB_DESCRIPTION_MAX, MAX_PHOTOS } from "@legwork/shared";
import { photoHint } from "@/lib/photos";
import { MicButton, useDictation } from "./dictation";
import { Icon, icons, Spinner } from "./ui";

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

  if (brief) {
    return (
      <div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="flex items-end gap-0.5 rounded-[22px] border border-line bg-white py-1 pr-1 pl-1 shadow-card transition focus-within:border-brand focus-within:ring-4 focus-within:ring-brand/15"
        >
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
          <button
            type="button"
            onClick={() => picker.current?.click()}
            aria-label="Add photos"
            title="Add photos"
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface hover:text-ink focus-visible:outline-2 focus-visible:outline-brand"
          >
            <Icon d={icons.image} className="size-5" />
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
            onPaste={(e) => {
              const files = [...e.clipboardData.files].filter(isImage);
              if (files.length > 0) {
                e.preventDefault();
                add(files);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={dictation.listening ? "Listening… say what's wrong" : "Anything wrong? Just say it."}
            className="block max-h-32 min-h-10 min-w-0 flex-1 resize-none bg-transparent px-1 py-2 text-base leading-6 outline-none placeholder:text-muted"
          />
          {dictation.supported && (
            <MicButton
              listening={dictation.listening}
              busy={dictation.busy}
              onClick={() => (dictation.listening ? dictation.stop() : dictation.start(value))}
            />
          )}
          {(trimmed || busy) && (
            <button
              type="submit"
              disabled={busy}
              aria-label="Fix it"
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-brand text-white transition-colors hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-70"
            >
              {busy ? <Spinner /> : <Icon d={icons.send} className="size-[18px]" />}
            </button>
          )}
        </form>
        {(notice || reply) && (
          <p role="status" className="mt-1.5 px-3 text-sm text-pretty text-muted">
            {notice ? <span className="text-danger">{notice}</span> : reply}
          </p>
        )}
      </div>
    );
  }

  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className={`rounded-3xl border bg-white shadow-float transition ${
          dragging ? "border-brand ring-4 ring-brand/15" : "border-line focus-within:border-brand focus-within:ring-4 focus-within:ring-brand/15"
        }`}
      >
        <label htmlFor="job" className="sr-only">
          What do you need done?
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
          onPaste={(e) => {
            const files = [...e.clipboardData.files].filter(isImage);
            if (files.length > 0) {
              e.preventDefault();
              add(files);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={dictation.listening ? "Listening… describe the job" : attachments.length > 0 ? "Add a few words if you like, or just get started" : "Describe the job, or just add a photo"}
          className="block max-h-56 min-h-20 w-full resize-none bg-transparent px-5 pt-4 pb-1 text-lg leading-7 outline-none placeholder:text-faint"
        />

        {attachments.length > 0 && (
          <ul className="flex flex-wrap gap-2 px-5 pt-2">
            {attachments.map((a, i) => {
              const status = photoStatus?.get(a.file);
              return (
              <li
                key={a.key}
                className={`relative size-16 overflow-hidden rounded-xl bg-surface animate-fade-in ${status ? "ring-2 ring-danger" : ""}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={a.preview} alt="" className={`size-full object-cover ${status ? "opacity-40" : ""}`} />
                {status === "retrying" ? (
                  <span className="absolute inset-0 flex items-center justify-center text-brand" aria-label={`Uploading photo ${i + 1}`}>
                    <Spinner className="size-6" />
                  </span>
                ) : status ? (
                  <button
                    type="button"
                    onClick={() => onRetry?.(a.file)}
                    aria-label={`Photo ${i + 1} didn't upload. Retry`}
                    title={status.error}
                    className="absolute inset-x-1 bottom-1 flex h-6 items-center justify-center gap-1 rounded-full bg-danger text-xs font-semibold text-white transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-white"
                  >
                    <Icon d={RETRY_ICON} className="size-3.5" />
                    Retry
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => remove(a.key)}
                  aria-label="Remove photo"
                  className="absolute top-1 right-1 flex size-6 items-center justify-center rounded-full bg-ink/70 text-white transition hover:bg-ink focus-visible:outline-2 focus-visible:outline-white"
                >
                  <Icon d={icons.close} className="size-3.5" />
                </button>
              </li>
              );
            })}
          </ul>
        )}
        {failedKeys.size > 0 && (
          <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 pt-2 text-sm">
            <span className="text-danger">
              {failedKeys.size === 1
                ? `Photo ${attachments.findIndex((a) => failedKeys.has(a.key)) + 1} didn't upload.`
                : `Photos ${attachments.flatMap((a, i) => (failedKeys.has(a.key) ? [i + 1] : [])).join(", ").replace(/, (\d+)$/, " and $1")} didn't upload.`}{" "}
              Retry or remove {failedKeys.size === 1 ? "it" : "them"}.
            </span>
            {canContinueWithout && (
              <button type="button" onClick={continueWithout} className="font-semibold text-ink underline underline-offset-2">
                Continue without {failedKeys.size === 1 ? "it" : "them"}
              </button>
            )}
          </div>
        )}
        {attachments.length === 1 && <p className="px-5 pt-2 text-sm text-muted">{photoHint(1)}</p>}

        <div className="flex items-center justify-between gap-3 p-3 pl-3">
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
          <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => picker.current?.click()}
            className="inline-flex h-10 items-center gap-2 rounded-full px-3 text-sm font-semibold text-muted transition-colors hover:bg-surface hover:text-ink focus-visible:outline-2 focus-visible:outline-brand"
          >
            <Icon d={icons.image} className="size-5" />
            <span>
              Add photos<span className="hidden sm:inline"> or drop them here</span>
            </span>
          </button>
          {dictation.supported && (
            <MicButton
              listening={dictation.listening}
              busy={dictation.busy}
              onClick={() => (dictation.listening ? dictation.stop() : dictation.start(value))}
            />
          )}
          </div>
          <button
            type="submit"
            className="inline-flex h-10 items-center gap-2 rounded-full bg-brand pr-3.5 pl-5 text-sm font-semibold text-white transition-colors hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            Get started
            <Icon d={icons.arrow} className="size-4" />
          </button>
        </div>
      </form>

      <p role="status" className="mt-2 min-h-5 px-2 text-center text-sm text-danger">
        {notice}
      </p>

      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
        {EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => {
              setValue(example);
              setNotice(null);
              textarea.current?.focus();
            }}
            className="rounded-full border border-line bg-white px-3.5 py-1.5 text-sm text-muted transition-colors hover:border-brand/50 hover:text-ink focus-visible:outline-2 focus-visible:outline-brand"
          >
            {example}
          </button>
        ))}
      </div>

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-canvas/80 backdrop-blur-sm animate-fade-in">
          <div className="flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-drop-line bg-drop px-12 py-10 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-white text-brand shadow-card">
              <Icon d={icons.image} className="size-6" />
            </span>
            <p className="text-lg font-semibold">Drop photos to add them to your job</p>
            <p className="text-sm text-muted">Up to {MAX_PHOTOS} photos</p>
          </div>
        </div>
      )}
    </>
  );
}
