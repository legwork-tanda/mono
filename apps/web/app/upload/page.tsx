"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Photo, UploadSession } from "@legwork/shared";
import { api } from "@/lib/api";
import { PhotoPicker } from "@/components/photo-picker";
import { Icon, icons, Logo, Walking } from "@/components/ui";

// Opened from the QR code on the photo step. The link carries the job's upload
// token, which can add and view photos and nothing else.
function PhoneUpload() {
  const params = useSearchParams();
  const jobId = params.get("job") ?? "";
  const token = params.get("t") ?? "";

  const [session, setSession] = useState<UploadSession | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId || !token) {
      setError("This link isn't complete. Scan the QR code again.");
      return;
    }
    api<UploadSession>(`/jobs/${jobId}/upload`, { token })
      .then((s) => {
        setSession(s);
        setPhotos(s.photos);
      })
      .catch(() => setError("This link has expired or isn't valid. Scan the QR code again."));
  }, [jobId, token]);

  const onPhotosChange = useCallback((update: (p: Photo[]) => Photo[]) => setPhotos(update), []);

  return (
    <main className="mx-auto w-full max-w-md px-5 pt-6 pb-12">
      <Logo />

      {error ? (
        <p role="alert" className="mt-10 rounded-2xl border border-danger/25 bg-danger/5 p-5 font-semibold text-danger">
          {error}
        </p>
      ) : !session ? (
        <Walking label="Loading your job…" className="mt-10" />
      ) : (
        <>
          <h1 className="mt-8 text-2xl font-bold tracking-tight">Add photos of the job</h1>
          <p className="mt-2 line-clamp-3 text-muted">&ldquo;{session.description}&rdquo;</p>

          <div className="mt-7">
            <PhotoPicker
              jobId={jobId}
              token={token}
              uploadToken={token}
              photos={photos}
              onPhotosChange={onPhotosChange}
              max={session.maxPhotos}
              canRemove={false}
              variant="button"
            />
          </div>

          {photos.length > 0 && (
            <div className="mt-2 flex gap-3 rounded-2xl bg-success-soft p-4 text-success">
              <Icon d={icons.check} className="mt-0.5 size-5 shrink-0 stroke-[2.5]" />
              <p className="text-sm font-medium">
                Your photos are on your computer now. Add more, or go back there to carry on.
              </p>
            </div>
          )}
        </>
      )}
    </main>
  );
}

export default function UploadPage() {
  return (
    <div className="min-h-dvh bg-canvas">
      <Suspense>
        <PhoneUpload />
      </Suspense>
    </div>
  );
}
