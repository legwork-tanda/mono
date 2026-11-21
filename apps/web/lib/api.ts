import type { ApiError, JobState, MatchState, RoundEvent, Step } from "@legwork/shared";

/**
 * Where the API lives. In development it's the same host as the page on port
 * 8787, so localhost uses localhost and a mesh or LAN address (a phone over
 * Tailscale) uses that address. Production builds use NEXT_PUBLIC_API_URL.
 */
export function apiUrl() {
  // A tunnel (HTTPS, for testing a tradie's GPS on a phone) has no port 8787 of its own.
  if (process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_DEV_API_URL) return process.env.NEXT_PUBLIC_DEV_API_URL;
  if (process.env.NODE_ENV === "development" && typeof window !== "undefined") {
    const port = process.env.NEXT_PUBLIC_API_PORT ?? "8787";
    return `${window.location.protocol}//${window.location.hostname}:${port}`;
  }
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";
}

/** A failed API call. `status` is 0 when the request never got a response. */
export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

type Options = Omit<RequestInit, "body"> & { token?: string; json?: unknown; body?: BodyInit };

export async function api<T>(path: string, { token, json, headers, ...init }: Options = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${apiUrl()}${path}`, {
      ...init,
      body: json === undefined ? init.body : JSON.stringify(json),
      headers: {
        ...(json === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
    });
  } catch {
    throw new ApiRequestError("Couldn't reach Legwork. Check your connection and try again.", 0);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiError | null;
    throw new ApiRequestError(body?.error ?? `Something went wrong (${res.status}).`, res.status);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/** URL for an <img> showing a job photo. */
export const photoUrl = (path: string, uploadToken: string) =>
  `${apiUrl()}${path}?t=${encodeURIComponent(uploadToken)}`;

/**
 * Runs the next intake round. Calls `onStep` for each question as it streams
 * in, and resolves with the job state once the round is done.
 */
export async function streamRound(
  jobId: string,
  token: string,
  onStep: (step: Step) => void,
): Promise<JobState> {
  let res: Response;
  try {
    res = await fetch(`${apiUrl()}/jobs/${jobId}/continue`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new ApiRequestError("Couldn't reach Legwork. Check your connection and try again.", 0);
  }
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => null)) as ApiError | null;
    throw new ApiRequestError(body?.error ?? `Something went wrong (${res.status}).`, res.status);
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buffer += value;
    const lines = buffer.split("\n");
    buffer = done ? "" : lines.pop()!;
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as RoundEvent;
      if (event.type === "step") onStep(event.step);
      else if (event.type === "state") return event.state;
      else throw new ApiRequestError(event.error, 502);
    }
    if (done) break;
  }
  throw new ApiRequestError("The connection dropped. Try again.", 0);
}

/** How often the match stream sends a keep-alive line while nothing changes. */
const STREAM_HEARTBEAT_S = 10;
/** No bytes for this long (heartbeats included) means the connection is dead. */
const STREAM_IDLE_MS = 25_000;

/**
 * Follows a job's match over one long-lived request: `onMatch` gets the state
 * straight away and again each time it changes. Resolves with the last state
 * when the server ends the stream (the job stopped changing, or the stream hit
 * its time limit and should be reopened if the job is still live). Rejects
 * when the connection fails or goes silent for STREAM_IDLE_MS, so the caller
 * can say the live info is out of date and reconnect.
 */
export async function streamMatch(
  jobId: string,
  token: string,
  onMatch: (match: MatchState) => void,
  signal: AbortSignal,
): Promise<MatchState | null> {
  // Our own abort, linked to the caller's, so a silent connection can be dropped.
  const attempt = new AbortController();
  const abort = () => attempt.abort();
  if (signal.aborted) abort();
  signal.addEventListener("abort", abort);
  let stalled = false;
  let idle: ReturnType<typeof setTimeout> | undefined;
  const watch = () => {
    clearTimeout(idle);
    idle = setTimeout(() => {
      stalled = true;
      attempt.abort();
    }, STREAM_IDLE_MS);
  };

  try {
    watch();
    let res: Response;
    try {
      res = await fetch(`${apiUrl()}/jobs/${jobId}/match/stream?heartbeat=${STREAM_HEARTBEAT_S}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: attempt.signal,
      });
    } catch (e) {
      if (signal.aborted) throw e;
      throw new ApiRequestError("Couldn't reach Legwork. Check your connection and try again.", 0);
    }
    if (!res.ok || !res.body) {
      const body = (await res.json().catch(() => null)) as ApiError | null;
      throw new ApiRequestError(body?.error ?? `Something went wrong (${res.status}).`, res.status);
    }

    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    let last: MatchState | null = null;
    for (;;) {
      let chunk: ReadableStreamReadResult<string>;
      try {
        chunk = await reader.read();
      } catch (e) {
        if (signal.aborted) throw e;
        throw new ApiRequestError(stalled ? "Live updates stopped arriving." : "The connection dropped.", 0);
      }
      const { value, done } = chunk;
      watch();
      if (value) buffer += value;
      const lines = buffer.split("\n");
      buffer = done ? "" : lines.pop()!;
      for (const line of lines) {
        // Empty lines are heartbeats: the connection is alive, nothing changed.
        if (!line.trim()) continue;
        last = JSON.parse(line) as MatchState;
        onMatch(last);
      }
      if (done) return last;
    }
  } finally {
    clearTimeout(idle);
    signal.removeEventListener("abort", abort);
  }
}
