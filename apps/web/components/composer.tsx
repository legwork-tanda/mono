"use client";

import { useEffect, useRef, useState } from "react";
import { JOB_DESCRIPTION_MAX, MAX_PHOTOS } from "@legwork/shared";
import { Icon, icons } from "./ui";

const EXAMPLES = ["My kitchen tap is leaking", "Paint two bedrooms", "Install a ceiling fan"];

type Attachment = { key: string; file: File; preview: string };

const isImage = (f: File) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name);

/**
 * The homepage prompt: describe the job, optionally with photos (attach,
 * paste, or drop them anywhere on the page).
 */
export function Composer({
  onSubmit,
  onAttach,
  onRemove,
}: {
  onSubmit: (description: string, photos: File[]) => void;
  /** Called as each photo is added, so it can start uploading before submit. */
  onAttach?: (file: File) => void;
  onRemove?: (file: File) => void;
}) {
  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
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

  useEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  function add(files: Iterable<File>) {
    const images = [...files].filter(isImage);
    if (images.length === 0) return;
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
  }, []);

  // A description, photos, or both: with only photos we work the job out from them.
  const canSubmit = trimmed.length > 0 || attachments.length > 0;

  function submit() {
    if (!canSubmit) {
      setNotice("Describe the job or add a photo to get started.");
      textarea.current?.focus();
      return;
    }
    // The previews are handed over with the files; the flow shows them next.
    onSubmit(
      trimmed,
      attachments.map((a) => a.file),
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
          placeholder={attachments.length > 0 ? "Add a few words if you like, or just get started" : "Describe the job, or just add a photo"}
          className="block max-h-56 min-h-20 w-full resize-none bg-transparent px-5 pt-4 pb-1 text-lg leading-7 outline-none placeholder:text-faint"
        />

        {attachments.length > 0 && (
          <ul className="flex flex-wrap gap-2 px-5 pt-2">
            {attachments.map((a) => (
              <li key={a.key} className="relative size-16 overflow-hidden rounded-xl bg-surface animate-fade-in">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={a.preview} alt="" className="size-full object-cover" />
                <button
                  type="button"
                  onClick={() => remove(a.key)}
                  aria-label="Remove photo"
                  className="absolute top-1 right-1 flex size-6 items-center justify-center rounded-full bg-ink/70 text-white transition hover:bg-ink focus-visible:outline-2 focus-visible:outline-white"
                >
                  <Icon d={icons.close} className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}

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
