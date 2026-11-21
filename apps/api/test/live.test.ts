// The live channel (live.ts): who may open a job's socket, and that every
// change to a job pokes its Durable Object. The object itself (WebSocketPair,
// hibernation) only exists in workerd, so a fake namespace stands in for it
// and records what the worker sends.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateJobResponse, HandoffResponse, Photo, RedeemHandoffResponse } from "@legwork/shared";
import { app } from "../src/index";
import type { Env } from "../src/env";
import { eventFor, notifyJob } from "../src/live";
import { testDb } from "./d1";
import { ask, choice, fakeClaude, type Scripted } from "./fake-claude";
import { fakeR2 } from "./fake-r2";
import { T0, world } from "./tradie-world";

type Sent = { jobId: string; path: string; type?: string; upgrade: boolean; url: string };

/** A stand-in for the JOB_LIVE namespace. Upgrades answer 200 (Node can't make a 101). */
function fakeLive() {
  const sent: Sent[] = [];
  const namespace = {
    idFromName: (name: string) => ({ name }),
    get: (id: { name: string }) => ({
      async fetch(input: RequestInfo, init?: RequestInit) {
        const req = new Request(input, init);
        const url = new URL(req.url);
        const body = req.method === "POST" ? ((await req.json()) as { type?: string }) : {};
        sent.push({ jobId: id.name, path: url.pathname, type: body.type, upgrade: req.headers.get("Upgrade") === "websocket", url: req.url });
        return new Response("socket", { status: 200 });
      },
    }),
  };
  const notifies = () => sent.filter((s) => s.path === "/notify").map((s) => ({ jobId: s.jobId, type: s.type }));
  return { namespace: namespace as unknown as DurableObjectNamespace, sent, notifies };
}

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

async function setup(...script: Scripted[]) {
  const { d1 } = testDb();
  const live = fakeLive();
  const env: Env = {
    ENVIRONMENT: "test",
    ALLOWED_ORIGINS: "http://localhost:3000",
    ANTHROPIC_API_KEY: "",
    DB: d1,
    PHOTOS: fakeR2().bucket,
    INTAKE_MODEL: fakeClaude(...script).model,
    JOB_LIVE: live.namespace,
  };
  const created = (await (await app.request("/jobs", json({ description: "Leaking tap" }), env)).json()) as CreateJobResponse;
  const other = (await (await app.request("/jobs", json({ description: "Other job" }), env)).json()) as CreateJobResponse;
  live.sent.length = 0;
  const { token, uploadToken } = created;
  const id = created.job.id;
  const call = (path: string, as: string, init: RequestInit = {}) =>
    app.request(path, { ...init, headers: { Authorization: `Bearer ${as}`, ...init.headers } }, env);
  const socket = (query: string, headers: Record<string, string> = { Upgrade: "websocket" }, jobId = id) =>
    app.request(`/jobs/${jobId}/live${query}`, { headers }, env);
  return { env, live, id, token, uploadToken, other, call, socket };
}

function json(body: unknown, method = "POST"): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

describe("GET /jobs/:id/live", () => {
  it("opens for the owner token, the upload token and a phone's handoff token, given as ?t=", async () => {
    const t = await setup();
    for (const as of [t.token, t.uploadToken]) {
      const res = await t.socket(`?t=${encodeURIComponent(as)}`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("socket");
    }
    const { code } = (await (await t.call(`/jobs/${t.id}/handoff`, t.token, { method: "POST" })).json()) as HandoffResponse;
    const phone = (await (await app.request("/handoff", json({ jobId: t.id, code }), t.env)).json()) as RedeemHandoffResponse;
    expect((await t.socket(`?t=${encodeURIComponent(phone.token)}`)).status).toBe(200);

    // Each socket went to this job's object, as the upgrade it was.
    const upgrades = t.live.sent.filter((s) => s.path.endsWith("/live"));
    expect(upgrades).toHaveLength(3);
    expect(upgrades.every((s) => s.jobId === t.id && s.upgrade)).toBe(true);
  });

  it("refuses a missing, wrong or another job's token with the same 404", async () => {
    const t = await setup();
    for (const query of ["", "?t=", "?t=nope", `?t=${encodeURIComponent(t.other.token)}`, `?t=${encodeURIComponent(t.other.uploadToken)}`]) {
      expect((await t.socket(query)).status, query).toBe(404);
    }
    // And an unknown job looks the same as a wrong token.
    expect((await t.socket(`?t=${encodeURIComponent(t.token)}`, undefined, "no-such-job")).status).toBe(404);
    expect(t.live.sent).toEqual([]);
  });

  it("works with the header token too, and needs a WebSocket upgrade", async () => {
    const t = await setup();
    expect((await t.socket("", { Upgrade: "websocket", Authorization: `Bearer ${t.token}` })).status).toBe(200);
    expect((await t.socket(`?t=${encodeURIComponent(t.token)}`, {})).status).toBe(426);
  });

  it("doesn't let ?t= through on routes that change the job", async () => {
    const t = await setup();
    const res = await app.request(`/jobs/${t.id}/description?t=${encodeURIComponent(t.token)}`, json({ description: "x" }), t.env);
    expect(res.status).toBe(404);
  });

  it("says it's unavailable without the Durable Object binding", async () => {
    const t = await setup();
    const env = { ...t.env, JOB_LIVE: undefined };
    const res = await app.request(`/jobs/${t.id}/live?t=${encodeURIComponent(t.token)}`, { headers: { Upgrade: "websocket" } }, env);
    expect(res.status).toBe(503);
  });
});

describe("changes notify the job's live channel", () => {
  it("sends photos for an upload, from the phone's upload token, and for a removal", async () => {
    const t = await setup();
    const res = await t.call(`/jobs/${t.id}/photos`, t.uploadToken, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: JPEG });
    expect(res.status).toBe(201);
    expect(t.live.notifies()).toEqual([{ jobId: t.id, type: "photos" }]);

    const photo = (await res.json()) as Photo;
    expect((await t.call(`/jobs/${t.id}/photos/${photo.id}`, t.token, { method: "DELETE" })).status).toBe(204);
    expect(t.live.notifies()).toEqual([
      { jobId: t.id, type: "photos" },
      { jobId: t.id, type: "photos" },
    ]);
  });

  it("sends state for other changes, such as the description", async () => {
    const t = await setup();
    expect((await t.call(`/jobs/${t.id}/description`, t.token, json({ description: "Dripping tap" }))).status).toBe(200);
    expect(t.live.notifies()).toEqual([{ jobId: t.id, type: "state" }]);
  });

  it("sends state once an intake round has finished", async () => {
    const t = await setup(ask(choice("Which tap?", ["Kitchen", "Bathroom"])));
    const res = await t.call(`/jobs/${t.id}/continue`, t.token, { method: "POST" });
    await res.text();
    await vi.waitFor(() => expect(t.live.notifies()).toEqual([{ jobId: t.id, type: "state" }]));
  });

  it("sends nothing for reads or for changes that were refused", async () => {
    const t = await setup();
    await t.call(`/jobs/${t.id}/state`, t.token);
    await t.call(`/jobs/${t.id}/photos`, t.token);
    // Refused: bad body, wrong content type, and the upload token can't change the description.
    await t.call(`/jobs/${t.id}/description`, t.token, json({}));
    await t.call(`/jobs/${t.id}/photos`, t.token, { method: "POST", headers: { "Content-Type": "text/plain" }, body: "hi" });
    await t.call(`/jobs/${t.id}/description`, t.uploadToken, json({ description: "x" }));
    expect(t.live.notifies()).toEqual([]);
  });
});

describe("a tradie's changes notify the customer's job", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
  });
  afterEach(() => vi.useRealTimers());

  it("sends state for a bid and a decline, but not for a location report", async () => {
    const w = world();
    const live = fakeLive();
    w.env.JOB_LIVE = live.namespace;
    const first = await w.addLive();
    const second = await w.addLive();
    const job = await w.confirmJob({ tier: "medium" });
    await w.match(job);
    live.sent.length = 0;

    expect((await w.asTradie(first.token, `/jobs/${job.id}/bid`, { quote: 300 })).status).toBe(200);
    expect((await w.asTradie(second.token, `/jobs/${job.id}/decline`, {})).status).toBe(200);
    expect(live.notifies()).toEqual([
      { jobId: job.id, type: "state" },
      { jobId: job.id, type: "state" },
    ]);

    live.sent.length = 0;
    await w.asTradie(first.token, `/jobs/${job.id}/location`, { lat: -27.46, lng: 153.03 });
    expect(live.notifies()).toEqual([]);
  });
});

describe("live helpers", () => {
  it("picks the event from the path", () => {
    expect(eventFor("/jobs/j1/photos")).toBe("photos");
    expect(eventFor("/jobs/j1/photos/p1")).toBe("photos");
    expect(eventFor("/jobs/j1/steps/s1/answer")).toBe("state");
    expect(eventFor("/jobs/j1/write-up")).toBe("state");
  });

  it("never throws, with no binding or a failing object", async () => {
    await expect(notifyJob({}, "j1", "state")).resolves.toBeUndefined();
    const broken = {
      idFromName: () => ({}),
      get: () => ({ fetch: () => Promise.reject(new Error("gone")) }),
    } as unknown as DurableObjectNamespace;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(notifyJob({ JOB_LIVE: broken }, "j1", "photos")).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
