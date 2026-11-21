import type { LiveEvent, LiveEventType } from "@legwork/shared";
import type { Env } from "./env";

// Live job sync between devices: the desktop and the phone that scanned its QR
// code. Each job gets one Durable Object (JobLive) holding the WebSocket of
// every device that has the job open. Whenever the API changes a job's photos
// or state, it pokes that object, which sends every socket a tiny
// `{type, at}` event. Clients then re-read the endpoints they already use, so
// nothing about the job itself goes over the socket.
//
// The sockets use the hibernation API: the object sleeps between events and
// answers the clients' "ping" heartbeats without waking up.

/** Pokes the job's live channel. Never throws: sync is best effort, and clients also poll slowly. */
export async function notifyJob(env: Pick<Env, "JOB_LIVE">, jobId: string, type: LiveEventType) {
  if (!env.JOB_LIVE) return;
  try {
    const stub = env.JOB_LIVE.get(env.JOB_LIVE.idFromName(jobId));
    await stub.fetch("https://live/notify", { method: "POST", body: JSON.stringify({ type }) });
  } catch (error) {
    console.error("live notify failed", error);
  }
}

/**
 * Notifies after the response, where there's an execution context (Workers),
 * or straight away otherwise (tests).
 */
export async function notifyAfter(
  c: { env: Pick<Env, "JOB_LIVE">; executionCtx: { waitUntil(p: Promise<unknown>): void } },
  jobId: string,
  type: LiveEventType,
) {
  const sent = notifyJob(c.env, jobId, type);
  try {
    c.executionCtx.waitUntil(sent);
  } catch {
    // No execution context (tests).
    await sent;
  }
}

/** The event a change to this request's path should send: photo routes say "photos", everything else "state". */
export function eventFor(path: string): LiveEventType {
  return /^\/jobs\/[^/]+\/photos(\/|$)/.test(path) ? "photos" : "state";
}

/** One job's sockets. Addressed by `idFromName(jobId)`. */
export class JobLive {
  constructor(private readonly state: DurableObjectState) {
    // Heartbeats are answered by the runtime, so an idle object stays asleep.
    state.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(req: Request) {
    const url = new URL(req.url);
    if (url.pathname === "/notify" && req.method === "POST") {
      const body = (await req.json().catch(() => null)) as { type?: LiveEventType } | null;
      const event: LiveEvent = { type: body?.type === "photos" ? "photos" : "state", at: Date.now() };
      const message = JSON.stringify(event);
      for (const socket of this.state.getWebSockets()) {
        try {
          socket.send(message);
        } catch {
          // Already closing; the runtime drops it.
        }
      }
      return new Response(null, { status: 204 });
    }

    if (req.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected a WebSocket", { status: 426 });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    this.state.acceptWebSocket(pair[1]);
    return new Response(null, { status: 101, webSocket: client });
  }

  // Clients only ever send "ping", which the auto-response handles.
  async webSocketMessage() {}

  async webSocketClose(socket: WebSocket, code: number, reason: string) {
    try {
      socket.close(code, reason);
    } catch {
      // Already closed.
    }
  }

  async webSocketError(socket: WebSocket) {
    try {
      socket.close(1011, "error");
    } catch {
      // Already closed.
    }
  }
}
