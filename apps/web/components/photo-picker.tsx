"use client";

import { useEffect, useRef, useState } from "react";
import type { Photo } from "@legwork/shared";
import { api, photoUrl } from "@/lib/api";
import { photoHint, uploadPhoto } from "@/lib/photos";
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
  /** Check for photos added from another device every few seconds. */
  poll?: boolean;
};

/** Pick, resize, upload and show a job's photos. */
export function PhotoPicker({ jobId, token, uploadToken, photos, onPhotosChange, max, canRemove, variant, poll }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const remaining = max - photos.length - uploads.filter((u) => !u.error).length;

  useEffect(() => {
    if (!poll) return;
    const timer = setInterval(() => {
      if (document.hidden) return;
      api<Photo[]>(`/jobs/${jobId}/photos`, { token })
        .then((latest) => onPhotosChange(() => latest))
        .catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [poll, jobId, token, onPhotosChange]);

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
  const picker = (
    <input
      ref={input}
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

  return (
    <div className="space-y-4">
      {picker}
      {hint && !full && (
        <p className="flex items-center gap-2 text-[15px] text-muted">
          <Icon d={icons.camera} className="size-4.5 shrink-0 text-brand" />
          {hint}
        </p>
      )}
      {variant === "button" ? (
        <button
          type="button"
          disabled={full}
          onClick={() => input.current?.click()}
          className="flex h-14 w-full items-center justify-center gap-3 rounded-xl bg-brand text-lg font-semibold text-white transition-colors hover:bg-brand-strong disabled:bg-line disabled:text-faint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          <Icon d={icons.camera} className="size-6" />
          {full ? "That's the maximum" : photos.length > 0 ? "Add more photos" : "Take or choose photos"}
        </button>
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
          className={`flex min-h-48 w-full flex-col items-center justify-center gap-2 rounded-[20px] border-2 border-dashed px-6 py-8 text-center transition-colors disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
            dragging ? "border-brand bg-brand-soft" : "border-drop-line bg-drop hover:border-brand/60"
          }`}
        >
          <span className="flex size-11 items-center justify-center rounded-full bg-white text-brand shadow-card">
            <Icon d={icons.upload} />
          </span>
          <span className="font-semibold">{full ? "That's the maximum" : "Add photos"}</span>
          <span className="text-sm text-muted">Drag photos here or browse</span>
        </button>
      )}

      {(photos.length > 0 || uploads.length > 0) && (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {photos.map((photo) => (
            <li key={photo.id} className="group relative aspect-square overflow-hidden rounded-[14px] bg-surface animate-fade-in">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photoUrl(photo.path, uploadToken)} alt="" className="size-full object-cover" />
              {canRemove && (
                <button
                  type="button"
                  onClick={() => void remove(photo)}
                  aria-label="Remove photo"
                  className="absolute top-1.5 right-1.5 flex size-7 items-center justify-center rounded-full bg-ink/70 text-white transition hover:bg-ink focus-visible:outline-2 focus-visible:outline-white"
                >
                  <Icon d={icons.close} className="size-4" />
                </button>
              )}
            </li>
          ))}
          {uploads.map((upload) => (
            <li key={upload.key} className="relative aspect-square overflow-hidden rounded-[14px] bg-surface">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={upload.preview} alt="" className="size-full object-cover opacity-50" />
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 p-2 text-center">
                {upload.error ? (
                  <>
                    <span className="text-xs font-semibold text-danger">{upload.error}</span>
                    <button
                      type="button"
                      onClick={() => drop(upload.key)}
                      className="text-xs font-semibold underline"
                    >
                      Dismiss
                    </button>
                  </>
                ) : (
                  <Spinner className="size-6 text-brand" />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <p role="status" className="min-h-5 text-sm text-muted">
        {notice ?? (photos.length > 0 ? `${photos.length} of ${max} photos added` : null)}
      </p>
    </div>
  );
}
