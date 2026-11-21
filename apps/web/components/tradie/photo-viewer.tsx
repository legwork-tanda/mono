"use client";

import { useEffect, useState } from "react";
import type { Photo } from "@legwork/shared";
import { apiUrl } from "@/lib/api";
import { Icon, icons } from "@/components/ui";

/** A tradie-side photo URL: the token rides in `?t=` so a plain <img> can load it. */
export const tradiePhotoUrl = (photo: Photo, token: string) => `${apiUrl()}${photo.path}?t=${encodeURIComponent(token)}`;

/** The customer's photos as a grid; tap one to see it full screen, tap again (or pinch) to zoom. */
export function PhotoGrid({ photos, token }: { photos: Photo[]; token: string }) {
  const [open, setOpen] = useState<number | null>(null);
  if (photos.length === 0) return <p className="text-sm text-muted">No photos with this job.</p>;
  return (
    <>
      <div className="grid grid-cols-3 gap-2">
        {photos.map((p, i) => (
          <button key={p.id} type="button" onClick={() => setOpen(i)} className="aspect-square overflow-hidden rounded-xl bg-surface ring-1 ring-line" aria-label={`Open photo ${i + 1}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={tradiePhotoUrl(p, token)} alt="" className="size-full object-cover" />
          </button>
        ))}
      </div>
      {open !== null && <PhotoViewer photos={photos} token={token} start={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function PhotoViewer({ photos, token, start, onClose }: { photos: Photo[]; token: string; start: number; onClose: () => void }) {
  const [index, setIndex] = useState(start);
  const [zoomed, setZoomed] = useState(false);
  const photo = photos[index]!;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setIndex((i) => Math.min(photos.length - 1, i + 1));
      if (e.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, photos.length]);

  useEffect(() => setZoomed(false), [index]);

  return (
    <div role="dialog" aria-modal="true" aria-label="Photo" className="fixed inset-0 z-50 flex flex-col bg-black">
      <div className="flex items-center justify-between px-3 py-2 text-white">
        <span className="text-sm tabular-nums">
          {index + 1} / {photos.length}
        </span>
        <button type="button" onClick={onClose} aria-label="Close" className="flex size-10 items-center justify-center rounded-full hover:bg-white/10">
          <Icon d={icons.close} />
        </button>
      </div>
      {/* Pinch to zoom works natively inside a scrollable box; a tap toggles 2x. */}
      <div className="flex-1 overflow-auto" style={{ touchAction: "pan-x pan-y pinch-zoom" }}>
        <div className={`flex min-h-full items-center justify-center ${zoomed ? "w-[200%]" : "w-full"}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={tradiePhotoUrl(photo, token)}
            alt={`Photo ${index + 1} of the job`}
            onClick={() => setZoomed((z) => !z)}
            className={`${zoomed ? "w-full cursor-zoom-out" : "max-h-[80dvh] max-w-full cursor-zoom-in"} object-contain`}
          />
        </div>
      </div>
      {photos.length > 1 && (
        <div className="flex justify-between px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-white">
          <button type="button" disabled={index === 0} onClick={() => setIndex(index - 1)} className="h-11 rounded-xl px-4 font-semibold hover:bg-white/10 disabled:opacity-30">
            Previous
          </button>
          <button type="button" disabled={index === photos.length - 1} onClick={() => setIndex(index + 1)} className="h-11 rounded-xl px-4 font-semibold hover:bg-white/10 disabled:opacity-30">
            Next
          </button>
        </div>
      )}
    </div>
  );
}
