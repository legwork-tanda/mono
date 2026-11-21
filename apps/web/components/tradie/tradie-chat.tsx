"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MESSAGE_MAX, type TradieThread } from "@legwork/shared";
import { buttonPrimary, buttonQuiet, fieldClass, Icon, icons, Spinner, Walking } from "@/components/ui";
import { usePoll } from "@/lib/use-poll";
import { JobSummary } from "./job-summary";
import { useTradie } from "./tradie-context";

const clockTime = (iso: string) => new Date(iso).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });

/**
 * The chat with the customer, full screen: the confirmed job pinned at the
 * top, then the thread (polled every 2 s while open; reading it marks it
 * read). Read-only once the job is done or cancelled.
 */
export function TradieChat({ jobId, onClose }: { jobId: string; onClose: () => void }) {
  const { call, refresh } = useTradie();
  const [thread, setThread] = useState<TradieThread | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      setThread(await call<TradieThread>(`/jobs/${encodeURIComponent(jobId)}/messages`));
    } catch {
      // The next poll will try again.
    }
  }, [call, jobId]);
  usePoll(load, 2000);

  // Opening the thread clears the unread badge.
  useEffect(() => {
    void refresh();
  }, [refresh, thread?.messages.length]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [thread?.messages.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit() {
    const value = text.trim();
    if (!value || sending) return;
    setSending(true);
    setError(null);
    try {
      setThread(await call<TradieThread>(`/jobs/${encodeURIComponent(jobId)}/messages`, { json: { text: value } }));
      setText("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Messages with the customer" className="fixed inset-0 z-50 flex flex-col bg-surface">
      <header className="flex items-center gap-3 border-b border-line bg-white px-4 py-3">
        <button type="button" onClick={onClose} aria-label="Back" className={buttonQuiet}>
          <Icon name={icons.back} />
        </button>
        <div className="min-w-0">
          <p className="truncate font-semibold">Customer</p>
          <p className="truncate text-xs text-muted">{thread?.writeUp.location ?? ""}</p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {!thread ? (
          <Walking label="Opening the chat…" />
        ) : (
          <div className="mx-auto max-w-xl space-y-3">
            <JobSummary writeUp={thread.writeUp} tier={thread.tier} date={thread.date} price={thread.price} quote={thread.quote} compact />
            {thread.messages.length === 0 && (
              <p className="py-6 text-center text-sm text-muted text-pretty">Ask about access or parking, or let them know when you&rsquo;ll be there.</p>
            )}
            {thread.messages.map((m) => {
              const mine = m.author === "tradie";
              return (
                <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                  <div className={`lw-bubble ${mine ? "lw-bubble--out" : "lw-glass lw-bubble--in"}`}>
                    <p className="whitespace-pre-wrap break-words">{m.text}</p>
                    <p className={`mt-0.5 text-right text-[11px] tabular-nums ${mine ? "opacity-70" : "text-faint"}`}>{clockTime(m.createdAt)}</p>
                  </div>
                </div>
              );
            })}
            <div ref={end} />
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="border-t border-line bg-white px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      >
        <div className="mx-auto max-w-xl">
          {error && (
            <p role="alert" className="mb-2 text-sm text-ink">
              {error}
            </p>
          )}
          {!thread || thread.canMessage ? (
            <div className="flex items-end gap-2">
              <label htmlFor="tradie-message" className="sr-only">
                Message the customer
              </label>
              <textarea
                id="tradie-message"
                rows={1}
                value={text}
                maxLength={MESSAGE_MAX}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void submit();
                  }
                }}
                placeholder="Message the customer"
                className={`${fieldClass} max-h-32 min-h-12 flex-1 resize-none`}
              />
              <button type="submit" disabled={sending || !text.trim()} aria-label="Send" className={`${buttonPrimary} size-12 shrink-0 px-0`}>
                {sending ? <Spinner /> : <Icon name={icons.send} />}
              </button>
            </div>
          ) : (
            <p className="text-center text-sm text-muted">
              {thread.stage === "cancelled" ? "This job was cancelled, so messaging is closed." : "This job is done, so messaging is closed."}
            </p>
          )}
        </div>
      </form>
    </div>
  );
}
