import type { ApiError, JobState, RoundEvent, Step } from "@legwork/shared";

/**
 * Where the API lives. In development it's the same host as the page on port
 * 8787, so localhost uses localhost and a mesh or LAN address (a phone over
 * Tailscale) uses that address. Production builds use NEXT_PUBLIC_API_URL.
 */
export function apiUrl() {
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
