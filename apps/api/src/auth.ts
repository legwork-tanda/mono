// Jobs are anonymous. Whoever creates one gets two random bearer tokens:
// - the job token: full access, stays on the device that created the job
// - the upload token: add and view photos only, used in <img> URLs
// A phone that scans the desktop's QR code gets its own owner token through a
// single-use handoff code (see handoff.ts).
// Only SHA-256 hashes of the tokens are stored.

export type Access = "owner" | "upload";

/** A random base64url token: 32 bytes (256 bits) unless a shorter one is asked for. */
export function newToken(bytesLength = 32) {
  const bytes = crypto.getRandomValues(new Uint8Array(bytesLength));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

export async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Reads the token from `Authorization: Bearer …`. `?t=` is read only when
 * `allowQuery` is set, which the API does just for photo reads (<img> URLs
 * can't send headers). Anything that changes a job needs the header.
 */
export function readToken(req: Request, { allowQuery = false } = {}) {
  const header = req.headers.get("Authorization");
  if (header?.startsWith("Bearer ")) return header.slice(7).trim();
  return allowQuery ? new URL(req.url).searchParams.get("t") : null;
}

/** Query parameters whose values are credentials, and never belong in a log line. */
const SECRET_PARAMS = new Set(["t", "token", "code", "key", "sig", "signature", "access_token", "auth", "password"]);

/** The request's path and query, with every credential value replaced, for logging. */
export function redactUrl(url: string) {
  const parsed = new URL(url, "http://x");
  if (!parsed.search) return parsed.pathname;
  const params = [...parsed.searchParams].map(([name, value]) =>
    `${encodeURIComponent(name)}=${SECRET_PARAMS.has(name.toLowerCase()) ? "[redacted]" : encodeURIComponent(value)}`,
  );
  return `${parsed.pathname}?${params.join("&")}`;
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
