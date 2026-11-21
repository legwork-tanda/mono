// Jobs are anonymous. Whoever creates one gets two random bearer tokens:
// - the job token: full access, stays on the device that created the job
// - the upload token: add and view photos only, used in <img> URLs
// A phone that scans the desktop's QR code gets its own owner token through a
// single-use handoff code (see handoff.ts).
// Only SHA-256 hashes of the tokens are stored.

export type Access = "owner" | "upload";

export function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

export async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Reads the token from `Authorization: Bearer …`, or from `?t=` for <img> requests. */
export function readToken(req: Request) {
  const header = req.headers.get("Authorization");
  if (header?.startsWith("Bearer ")) return header.slice(7).trim();
  return new URL(req.url).searchParams.get("t");
}

/**
 * Which access a token grants for a job with these hashes, if any.
 * `isHandoffToken` checks the owner tokens issued to phones by a handoff.
 */
export async function accessFor(
  token: string | null,
  hashes: { token_hash: string; upload_token_hash: string },
  isHandoffToken?: (hash: string) => Promise<boolean>,
): Promise<Access | null> {
  if (!token) return null;
  const hash = await hashToken(token);
  if (hash === hashes.token_hash) return "owner";
  if (hash === hashes.upload_token_hash) return "upload";
  if (isHandoffToken && (await isHandoffToken(hash))) return "owner";
  return null;
}
