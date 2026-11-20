"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon, icons } from "./ui";

/**
 * Voice dictation with the browser's own speech recognition (Chrome, Edge,
 * Safari). Where it isn't available the mic button just doesn't show.
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
  network: "Voice typing needs an internet connection.",
};

/**
 * `start(current)` dictates onto the end of `current`, calling `onText` with
 * the full new value as words come in.
 */
export function useDictation(onText: (text: string) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  useEffect(() => {
    setSupported(recognitionCtor() !== null);
    return () => rec.current?.abort();
  }, []);

  const stop = useCallback(() => rec.current?.stop(), []);

  const start = useCallback((current: string) => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    rec.current?.abort();
    const r = new Ctor();
    r.continuous = true;
    r.interimResults = true;
    r.lang = navigator.language?.startsWith("en") ? navigator.language : "en-AU";
    r.onresult = (e) => {
      const said = Array.from(e.results, (res) => res[0]?.transcript ?? "").join("");
      onTextRef.current(join(current, said));
    };
    r.onerror = (e) => {
      if (e.error !== "aborted" && e.error !== "no-speech") setError(ERRORS[e.error] ?? "Voice typing stopped. Try again.");
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
  }, []);

  return { supported, listening, error, start, stop };
}

export function MicButton({
  listening,
  onClick,
  className = "",
}: {
  listening: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={listening}
      aria-label={listening ? "Stop voice typing" : "Voice typing"}
      title={listening ? "Stop voice typing" : "Speak instead of typing"}
      className={`relative inline-flex size-10 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
        listening ? "bg-danger text-white hover:bg-danger/90" : "text-muted hover:bg-surface hover:text-ink"
      } ${className}`}
    >
      {listening && <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-danger/40" />}
      <Icon d={listening ? icons.stop : icons.mic} className="relative size-5" />
    </button>
  );
}
