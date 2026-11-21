"use client";

import { useEffect, useRef } from "react";
import type { LiveEvent, LiveEventType } from "@legwork/shared";
import { apiUrl } from "./api";

/**
 * What a listener hears: a change pushed by the API ("photos" or "state"), or
 * "sync" when it may have missed some (the socket came back, the tab came back
 * into view, or the slow fallback poll while the socket is down). Re-read on any of them.
 */
export type JobLiveSignal = LiveEventType | "sync";

/** While the socket is down, listeners still hear "sync" this often. */
export const FALLBACK_POLL_MS = 15_000;
/** A ping keeps proxies from closing a quiet socket; the API answers "pong" without waking up. */
const PING_MS = 25_000;
const BACKOFF_MIN_MS = 500;
const BACKOFF_MAX_MS = 15_000;

type Listener = (signal: JobLiveSignal) => void;

/**
 * One socket per job and token, shared by every component following that job
 * (the photo picker and the job flow both do). It opens with the first
 * listener and closes with the last.
 */
class Channel {
  private readonly listeners = new Set<Listener>();
  private socket: WebSocket | null = null;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private ping: ReturnType<typeof setInterval> | undefined;
  private fallback: ReturnType<typeof setInterval> | undefined;
  private backoff = BACKOFF_MIN_MS;
  /** Whether the socket has opened since the last time it dropped, so a reopen can say "sync". */
  private dropped = false;

  constructor(
    private readonly url: string,
    private readonly onEmpty: () => void,
  ) {}

  add(listener: Listener) {
    this.listeners.add(listener);
    if (this.listeners.size === 1) this.start();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stop();
    };
  }

  private emit(signal: JobLiveSignal) {
    for (const listener of [...this.listeners]) listener(signal);
  }

  private readonly onVisible = () => {
    if (document.visibilityState !== "visible") return;
    this.emit("sync");
    // A phone that slept may hold a dead socket: reconnect now rather than after the backoff.
    if (!this.isOpen()) this.connect(true);
  };

  private readonly onOnline = () => this.connect(true);

  private isOpen() {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  private start() {
    document.addEventListener("visibilitychange", this.onVisible);
    window.addEventListener("online", this.onOnline);
    this.fallback = setInterval(() => {
      if (!this.isOpen() && !document.hidden) this.emit("sync");
    }, FALLBACK_POLL_MS);
    this.connect(false);
  }

  private stop() {
    document.removeEventListener("visibilitychange", this.onVisible);
    window.removeEventListener("online", this.onOnline);
    clearInterval(this.fallback);
    clearTimeout(this.retry);
    clearInterval(this.ping);
    const socket = this.socket;
    this.socket = null;
    socket?.close(1000, "done");
    this.onEmpty();
  }

  private connect(now: boolean) {
    clearTimeout(this.retry);
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) {
      if (!now || this.isOpen()) return;
      // Still connecting after a wake-up: start over.
      this.socket.onclose = null;
      this.socket.close();
    }
    if (now) this.backoff = BACKOFF_MIN_MS;

    let socket: WebSocket;
    try {
      socket = new WebSocket(this.url);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      this.backoff = BACKOFF_MIN_MS;
      clearInterval(this.ping);
      this.ping = setInterval(() => socket.readyState === WebSocket.OPEN && socket.send("ping"), PING_MS);
      // Anything that changed while the socket was down.
      if (this.dropped) this.emit("sync");
      this.dropped = false;
    };
    socket.onmessage = (message) => {
      if (typeof message.data !== "string" || message.data === "pong") return;
      try {
        const event = JSON.parse(message.data) as LiveEvent;
        if (event.type === "photos" || event.type === "state") this.emit(event.type);
      } catch {
        // Not an event.
      }
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.dropped = true;
      clearInterval(this.ping);
      if (this.listeners.size > 0) this.scheduleRetry();
    };
  }

  private scheduleRetry() {
    clearTimeout(this.retry);
    // Jitter, so a desktop and a phone that lose the network together don't retry in step.
    const wait = this.backoff * (0.75 + Math.random() * 0.5);
    this.backoff = Math.min(this.backoff * 2, BACKOFF_MAX_MS);
    this.retry = setTimeout(() => this.connect(false), wait);
  }
}

const channels = new Map<string, Channel>();

function channelFor(jobId: string, token: string) {
  const url = `${apiUrl().replace(/^http/, "ws")}/jobs/${encodeURIComponent(jobId)}/live?t=${encodeURIComponent(token)}`;
  let channel = channels.get(url);
  if (!channel) {
    channel = new Channel(url, () => channels.delete(url));
    channels.set(url, channel);
  }
  return channel;
}

/**
 * Follows a job's changes from other devices (the desktop and the phone that
 * scanned its QR code). `onSignal` runs within a moment of a change on the API,
 * and with "sync" after a gap; re-read the job then. Pass `enabled: false`
 * (or no job) to stop following.
 */
export function useJobLive(jobId: string | null | undefined, token: string | null | undefined, onSignal: Listener, enabled = true) {
  const latest = useRef(onSignal);
  useEffect(() => {
    latest.current = onSignal;
  });

  useEffect(() => {
    if (!enabled || !jobId || !token || typeof WebSocket === "undefined") return;
    return channelFor(jobId, token).add((signal) => latest.current(signal));
  }, [jobId, token, enabled]);
}
