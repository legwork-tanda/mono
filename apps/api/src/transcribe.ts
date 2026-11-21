// Voice typing fallback. Browsers' built-in speech recognition (Chrome's in
// particular) streams audio to the browser vendor's servers, and fails with a
// "network" error in Brave, embedded/Electron browsers, Chromium builds and
// behind some VPNs. When that happens the web app records the audio itself and
// sends it here as a WAV, and we transcribe it with Gemini through OpenRouter.

import { Hono } from "hono";
import type { ApiError } from "@legwork/shared";
import type { Env } from "./env";
import { DEFAULT_VISION_MODEL } from "./vision";

/** ~60 seconds of 16 kHz, 16-bit mono WAV. */
export const AUDIO_MAX_BYTES = 2_000_000;

const PROMPT = `Transcribe this audio exactly as spoken. It's a customer describing a job for a tradie (plumber, electrician, etc.). Australian English spelling. Add normal punctuation. Output only the transcript, nothing else. If there is no speech, output nothing.`;

type ChatResponse = {
  choices?: { message?: { content?: string | null } }[];
  error?: { message?: string };
};

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export const transcribe = new Hono<{ Bindings: Env }>();

transcribe.post("/", async (c) => {
  const key = c.env.OPENROUTER_API_KEY;
  if (!key) {
    return c.json<ApiError>(
      { error: "Voice typing isn't set up on this server (OPENROUTER_API_KEY is missing). Type your answer instead." },
      503,
    );
  }
  const type = c.req.header("Content-Type") ?? "";
  if (!type.startsWith("audio/wav")) return c.json<ApiError>({ error: "Send audio as audio/wav." }, 415);

  const audio = new Uint8Array(await c.req.arrayBuffer());
  if (audio.byteLength === 0) return c.json({ text: "" });
  if (audio.byteLength > AUDIO_MAX_BYTES) {
    return c.json<ApiError>({ error: "That recording is too long. Keep it under a minute." }, 413);
  }

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Title": "Legwork" },
    body: JSON.stringify({
      model: c.env.VISION_MODEL || DEFAULT_VISION_MODEL,
      reasoning: { effort: "minimal", exclude: true },
      max_tokens: 1000,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: PROMPT },
            { type: "input_audio", input_audio: { data: toBase64(audio), format: "wav" } },
          ],
        },
      ],
    }),
  });
  const body = (await res.json().catch(() => null)) as ChatResponse | null;
  if (!res.ok) {
    console.error(`Transcription failed (${res.status}): ${body?.error?.message ?? "no details"}`);
    return c.json<ApiError>({ error: "Couldn't transcribe that. Try again or type it instead." }, 502);
  }
  return c.json({ text: body?.choices?.[0]?.message?.content?.trim() ?? "" });
});
