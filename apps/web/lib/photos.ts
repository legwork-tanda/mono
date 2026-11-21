import type { Photo } from "@legwork/shared";
import { api } from "./api";

const MAX_EDGE = 1600;

/**
 * Shrinks a photo to at most 1600px on its long edge and re-encodes it as JPEG.
 * Keeps uploads small on mobile data and turns HEIC and friends into a format
 * the API (and Claude) accept.
 */
export async function preparePhoto(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("Couldn't read that photo. Try a JPEG or PNG.");
  }

  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!blob) throw new Error("Couldn't prepare that photo. Try another one.");
  return blob;
}

/** Resizes and uploads one photo to a job, with either of the job's tokens. */
export async function uploadPhoto(jobId: string, token: string, file: File): Promise<Photo> {
  const body = await preparePhoto(file);
  return api<Photo>(`/jobs/${jobId}/photos`, {
    method: "POST",
    token,
    body,
    headers: { "Content-Type": "image/jpeg" },
  });
}
