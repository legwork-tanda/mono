"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiUrl } from "@/lib/api";
import { Icon, icons } from "./ui";

/**
 * Voice dictation. Uses the browser's own live speech recognition where it
 * works (Chrome, Edge, Safari). That sends audio to the browser vendor's
 * servers and fails with a "network" error in Brave, embedded/Electron
 * browsers and some VPNs, so then we record the audio ourselves and have the
 * API transcribe it (POST /transcribe). The mic button only shows when one of
 * the two is possible.
 */

type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

function recognitionCtor(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  return ((w.SpeechRecognition ?? w.webkitSpeechRecognition) as (new () => Recognition) | undefined) ?? null;
}

const canRecord = () =>
  typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

/** Set once the browser's recognition fails for network reasons; we record from then on. */
let useRecorder = false;

/** Recordings stop on their own after this long (the API takes about a minute). */
const RECORD_MAX_MS = 55_000;

/** Joins what was typed before with what's being said, with sensible spacing and capitals. */
function join(before: string, said: string) {
  const spoken = said.trim();
  if (!spoken) return before;
  if (!before.trim()) return spoken[0]!.toUpperCase() + spoken.slice(1);
  const sentenceEnded = /[.!?]\s*$/.test(before);
  const next = sentenceEnded ? spoken[0]!.toUpperCase() + spoken.slice(1) : spoken;
  return `${before.replace(/\s+$/, "")} ${next}`;
}

const ERRORS: Record<string, string> = {
  "not-allowed": "Microphone access is blocked. Allow it in your browser to use voice.",
  "service-not-allowed": "Voice typing isn't available in this browser.",
  "audio-capture": "No microphone found.",
};

/** Decodes a recording and re-encodes it as 16 kHz mono 16-bit WAV, which every speech model accepts. */
async function toWav(blob: Blob): Promise<Blob> {
  const rate = 16_000;
  const ctx = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  } finally {
    void ctx.close();
  }
  const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * rate)), rate);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  const samples = (await offline.startRendering()).getChannelData(0);

  const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const text = (at: number, s: string) => [...s].forEach((ch, i) => view.setUint8(at + i, ch.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((v, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v)) * 0x7fff, true));
  return new Blob([view], { type: "audio/wav" });
}

async function transcribe(blob: Blob): Promise<string> {
  const res = await fetch(`${apiUrl()}/transcribe`, {
    method: "POST",
    headers: { "Content-Type": "audio/wav" },
    body: await toWav(blob),
  }).catch(() => {
    throw new Error("Couldn't reach Legwork to transcribe that. Check the API is running.");
  });
  const body = (await res.json().catch(() => null)) as { text?: string; error?: string } | null;
  if (!res.ok) throw new Error(body?.error ?? "Couldn't transcribe that. Try again or type it instead.");
  return body?.text ?? "";
}

/**
 * `start(current)` dictates onto the end of `current`, calling `onText` with
 * the full new value as words come in. `busy` is true while a recording is
 * being transcribed.
 */
export function useDictation(onText: (text: string) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  useEffect(() => {
    setSupported(recognitionCtor() !== null || canRecord());
    return () => {
      rec.current?.abort();
      const r = recorder.current;
      recorder.current = null;
      if (r && r.state !== "inactive") r.stop();
    };
  }, []);

  const stop = useCallback(() => {
    rec.current?.stop();
    if (recorder.current?.state === "recording") recorder.current.stop();
  }, []);

  const record = useCallback(async (current: string) => {
    if (!canRecord()) {
      setError("Voice typing isn't available in this browser.");
      return;
    }
    setError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      const name = (e as DOMException)?.name;
      setError(name === "NotFoundError" ? ERRORS["audio-capture"]! : ERRORS["not-allowed"]!);
      return;
    }
    const r = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    const timer = setTimeout(() => r.state === "recording" && r.stop(), RECORD_MAX_MS);
    r.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
    r.onstop = async () => {
      clearTimeout(timer);
      stream.getTracks().forEach((t) => t.stop());
      setListening(false);
      const mine = recorder.current === r;
      if (mine) recorder.current = null;
      if (!mine || chunks.length === 0) return; // unmounted or replaced
      setBusy(true);
      try {
        const said = await transcribe(new Blob(chunks, { type: r.mimeType }));
        onTextRef.current(join(current, said));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    };
    recorder.current = r;
    r.start();
    setListening(true);
  }, []);

  const start = useCallback(
    (current: string) => {
      const Ctor = recognitionCtor();
      if (useRecorder || !Ctor) {
        void record(current);
        return;
      }
      rec.current?.abort();
      const r = new Ctor();
      let heard = false;
      r.continuous = true;
      r.interimResults = true;
      r.lang = navigator.language?.startsWith("en") ? navigator.language : "en-AU";
      r.onresult = (e) => {
        heard = true;
        const said = Array.from(e.results, (res) => res[0]?.transcript ?? "").join("");
        onTextRef.current(join(current, said));
      };
      r.onerror = (e) => {
        if (e.error === "aborted" || e.error === "no-speech") return;
        // The browser's speech service is unreachable: record and transcribe on our API instead.
        if ((e.error === "network" || e.error === "service-not-allowed") && !heard && canRecord()) {
          useRecorder = true;
          rec.current = null;
          r.onend = null;
          r.abort();
          setListening(false);
          void record(current);
          return;
        }
        setError(ERRORS[e.error] ?? "Voice typing stopped. Try again.");
      };
      r.onend = () => {
        setListening(false);
        if (rec.current === r) rec.current = null;
      };
      rec.current = r;
      setError(null);
      setListening(true);
      try {
        r.start();
      } catch {
        setListening(false);
      }
    },
    [record],
  );

  return { supported, listening, busy, error, start, stop };
}

export function MicButton({
  listening,
  busy = false,
  onClick,
  className = "",
}: {
  listening: boolean;
  busy?: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-pressed={listening}
      aria-busy={busy}
      aria-label={busy ? "Transcribing" : listening ? "Stop voice typing" : "Voice typing"}
      title={busy ? "Transcribing…" : listening ? "Stop voice typing" : "Speak instead of typing"}
      className={`relative inline-flex size-10 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
        listening
          ? "bg-danger text-white hover:bg-danger/90"
          : busy
            ? "animate-pulse text-brand"
            : "text-muted hover:bg-surface hover:text-ink"
      } ${className}`}
    >
      {listening && <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-danger/40" />}
      <Icon d={listening ? icons.stop : icons.mic} className="relative size-5" />
    </button>
  );
}
