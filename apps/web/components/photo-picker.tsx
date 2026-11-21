"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import type { Photo } from "@legwork/shared";
import { api, photoUrl } from "@/lib/api";
import { photoHint, uploadPhoto } from "@/lib/photos";
import { useJobLive } from "@/lib/use-job-live";
import { Icon, icons, Spinner } from "./ui";

type Upload = { key: string; preview: string; error: string | null };

type Props = {
  jobId: string;
  /** Token used to upload and list: the job token on desktop, the upload token on a phone. */
  token: string;
  uploadToken: string;
  photos: Photo[];
  onPhotosChange: (update: (photos: Photo[]) => Photo[]) => void;
  max: number;
  /** Only the job's owner can remove photos. */
  canRemove: boolean;
  /** Big tap target for phones instead of a drag-and-drop area. */
  variant: "dropzone" | "button";
  /** Follow photos added or removed on another device (pushed over the job's live channel). */
  poll?: boolean;
};

/** Pick, resize, upload and show a job's photos. */
export function PhotoPicker({ jobId, token, uploadToken, photos, onPhotosChange, max, canRemove, variant, poll }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const remaining = max - photos.length - uploads.filter((u) => !u.error).length;

  // Another device's photos show up as soon as the API says so (or on the slow
  // fallback poll while the live channel is down).
  useJobLive(
    jobId,
    token,
    (signal) => {
      if (signal === "state") return;
      api<Photo[]>(`/jobs/${jobId}/photos`, { token })
        .then((latest) => onPhotosChange(() => latest))
        .catch(() => {});
    },
    !!poll,
  );

  // Local previews stay alive until their upload is dropped or the picker unmounts.
  const previews = useRef(new Map<string, string>());
  useEffect(() => {
    const live = previews.current;
    return () => live.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  function drop(key: string) {
    const url = previews.current.get(key);
    if (url) URL.revokeObjectURL(url);
    previews.current.delete(key);
    setUploads((u) => u.filter((x) => x.key !== key));
  }

  function add(files: FileList | File[]) {
    setNotice(null);
    const images = [...files].filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
    if (images.length === 0) return;
    if (images.length > remaining) setNotice(`You can add up to ${max} photos.`);

    for (const file of images.slice(0, Math.max(0, remaining))) {
      const key = crypto.randomUUID();
      const preview = URL.createObjectURL(file);
      previews.current.set(key, preview);
      setUploads((u) => [...u, { key, preview, error: null }]);
      uploadPhoto(jobId, token, file)
        .then((photo) => {
          onPhotosChange((p) => (p.some((x) => x.id === photo.id) ? p : [...p, photo]));
          drop(key);
        })
        .catch((e: Error) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, error: e.message } : x))));
    }
  }

  async function remove(photo: Photo) {
    onPhotosChange((p) => p.filter((x) => x.id !== photo.id));
    await api(`/jobs/${jobId}/photos/${photo.id}`, { method: "DELETE", token }).catch(() => {
      onPhotosChange((p) => [...p, photo]);
      setNotice("Couldn't remove that photo. Try again.");
    });
  }

  const full = remaining <= 0;
  const hint = photoHint(photos.length + uploads.filter((u) => !u.error).length);
  const onPicked = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) add(e.target.files);
    e.target.value = "";
  };
  const picker = (
    <>
      <input ref={input} type="file" accept="image/*" multiple className="sr-only" tabIndex={-1} onChange={onPicked} />
      {/* On a phone this opens the back camera straight away. */}
      {variant === "button" && (
        <input ref={camera} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} onChange={onPicked} />
      )}
    </>
  );

  return (
    <div className="space-y-4">
      {picker}
      {hint && !full && (
        <p className="lw-caption flex items-center gap-2 text-muted">
          <Icon name={icons.camera} className="size-4.5 shrink-0" />
          {hint}
        </p>
      )}
      {variant === "button" ? (
        <div className="flex flex-col items-center gap-1">
          <button type="button" disabled={full} onClick={() => camera.current?.click()} className="lw-btn lw-btn--secondary w-full">
            <Icon name={icons.camera} />
            {full ? "That's the maximum" : photos.length > 0 ? "Take another photo" : "Take a photo"}
          </button>
          {!full && (
            <button type="button" onClick={() => input.current?.click()} className="lw-link inline-flex min-h-11 items-center px-1">
              Choose from your photos
            </button>
          )}
        </div>
      ) : (
        <button
          type="button"
          disabled={full}
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            add(e.dataTransfer.files);
          }}
          className={`lw-inner lw-press flex min-h-36 w-full flex-col items-center justify-center gap-2 px-6 py-6 text-center disabled:cursor-not-allowed disabled:opacity-60 ${
            dragging ? "ring-2 ring-selected ring-inset" : "ring-1 ring-line ring-inset"
          }`}
        >
          <span className="lw-glass lw-glass--circle">
            <Icon name="image" />
          </span>
          <span className="lw-headline">{full ? "That's the maximum" : "Add photos"}</span>
          <span className="lw-caption text-muted">Drag photos here or browse</span>
        </button>
      )}

      {(photos.length > 0 || uploads.length > 0) && (
        <ul className="grid grid-cols-3 gap-2">
          {photos.map((photo) => (
            <li key={photo.id} className="relative aspect-square overflow-hidden rounded-well bg-surface animate-fade-in">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photoUrl(photo.path, uploadToken)} alt="" className="lw-thumb size-full rounded-none" />
              {canRemove && (
                <button
                  type="button"
                  onClick={() => void remove(photo)}
                  aria-label="Remove photo"
                  className="lw-press lw-hit absolute top-1.5 right-1.5 flex size-7 items-center justify-center rounded-full bg-[#1D1D1F]/75 text-[#fff]"
                >
                  <Icon name={icons.close} className="size-4" />
                </button>
              )}
            </li>
          ))}
          {uploads.map((upload) => (
            <li
              key={upload.key}
              className={`relative aspect-square overflow-hidden rounded-well bg-surface ${upload.error ? "ring-2 ring-[var(--lw-error-ring)] ring-inset" : ""}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={upload.preview} alt="" className="lw-thumb size-full rounded-none opacity-40" />
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 p-2 text-center">
                {upload.error ? (
                  <>
                    <span className="text-xs font-bold text-ink">{upload.error}</span>
                    <button type="button" onClick={() => drop(upload.key)} className="lw-link text-xs">
                      Dismiss
                    </button>
                  </>
                ) : (
                  <Spinner className="text-ink" />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <p role="status" className="lw-caption min-h-5 text-muted">
        {notice ?? (photos.length > 0 ? `${photos.length} of ${max} photos added` : null)}
      </p>
    </div>
  );
}
