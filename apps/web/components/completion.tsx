"use client";

import { useEffect, useRef, useState } from "react";
import {
  MAX_REVIEW_PHOTOS,
  REVIEW_TEXT_MAX,
  type JobState,
  type MatchOffer,
  type MatchState,
} from "@legwork/shared";
import { api, apiUrl, photoUrl } from "@/lib/api";
import { preparePhoto } from "@/lib/photos";
import { formatPriceRange } from "@legwork/shared";
import { Avatar, Stars } from "./match-view";
import { buttonPrimary, buttonQuiet, fieldClass, Icon, icons, Spinner } from "./ui";

type Session = { id: string; token: string; uploadToken: string };

const money = (n: number) => `$${n.toLocaleString("en-AU")}`;
const cardClass = "rounded-[24px] bg-white p-5 shadow-card ring-1 ring-line";

function StarRow({ stars, className = "text-xl" }: { stars: number; className?: string }) {
  return (
    <span className={`leading-none ${className}`} aria-label={`${stars} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} aria-hidden className={n <= stars ? "text-amber-500" : "text-line"}>
          ★
        </span>
      ))}
    </span>
  );
}

/** Thumbnails that open full size in a new tab. */
function PhotoStrip({ urls, label }: { urls: string[]; label: string }) {
  if (urls.length === 0) return null;
  return (
    <ul className="grid grid-cols-3 gap-2" aria-label={label}>
      {urls.map((url, i) => (
        <li key={url}>
          <a href={url} target="_blank" rel="noreferrer" className="block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={`${label} ${i + 1}`} className="aspect-square w-full rounded-xl object-cover ring-1 ring-line" />
          </a>
        </li>
      ))}
    </ul>
  );
}

type Picked = { id: string; blob: Blob; preview: string };

function ReviewForm({ name, onSubmit }: { name: string; onSubmit: (form: FormData) => Promise<void> }) {
  const [stars, setStars] = useState(0);
  const [text, setText] = useState("");
  const [photos, setPhotos] = useState<Picked[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const previews = useRef<string[]>([]);

  useEffect(() => () => previews.current.forEach((u) => URL.revokeObjectURL(u)), []);

  async function add(files: FileList | null) {
    if (!files?.length) return;
    const room = MAX_REVIEW_PHOTOS - photos.length;
    const chosen = [...files].slice(0, room);
    setError(files.length > room ? `You can add up to ${MAX_REVIEW_PHOTOS} photos.` : null);
    setPreparing(true);
    try {
      const ready: Picked[] = [];
      for (const file of chosen) {
        const blob = await preparePhoto(file);
        const preview = URL.createObjectURL(blob);
        previews.current.push(preview);
        ready.push({ id: crypto.randomUUID(), blob, preview });
      }
      setPhotos((p) => [...p, ...ready].slice(0, MAX_REVIEW_PHOTOS));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPreparing(false);
    }
  }

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!stars) return setError("Tap a star to rate.");
        setSaving(true);
        setError(null);
        const form = new FormData();
        form.set("stars", String(stars));
        form.set("text", text);
        photos.forEach((p, i) => form.append("photos", p.blob, `photo-${i + 1}.jpg`));
        try {
          await onSubmit(form);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setSaving(false);
        }
      }}
      className="space-y-3"
    >
      <p className="font-semibold">How did {name} go?</p>
      <div className="flex gap-1" role="radiogroup" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={stars === n}
            aria-label={`${n} star${n === 1 ? "" : "s"}`}
            onClick={() => setStars(n)}
            className={`text-4xl leading-none transition-transform hover:scale-110 ${n <= stars ? "text-amber-500" : "text-line"}`}
          >
            ★
          </button>
        ))}
      </div>
      <label htmlFor="review" className="sr-only">
        Review
      </label>
      <textarea
        id="review"
        rows={3}
        value={text}
        maxLength={REVIEW_TEXT_MAX}
        onChange={(e) => setText(e.target.value)}
        placeholder="A few words for the next customer (optional)"
        className={`${fieldClass} resize-none`}
      />

      <div className="space-y-2">
        <p className="text-sm text-muted">
          Photos of the finished work <span className="text-faint">(optional, up to {MAX_REVIEW_PHOTOS})</span>
        </p>
        <div className="grid grid-cols-3 gap-2">
          {photos.map((p, i) => (
            <div key={p.id} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.preview} alt={`Review photo ${i + 1}`} className="aspect-square w-full rounded-xl object-cover ring-1 ring-line" />
              <button
                type="button"
                onClick={() => setPhotos((list) => list.filter((x) => x.id !== p.id))}
                aria-label={`Remove photo ${i + 1}`}
                className="absolute top-1.5 right-1.5 flex size-7 items-center justify-center rounded-full bg-ink/70 text-white"
              >
                <Icon d={icons.close} className="size-4" />
              </button>
            </div>
          ))}
          {photos.length < MAX_REVIEW_PHOTOS && (
            <button
              type="button"
              onClick={() => input.current?.click()}
              disabled={preparing}
              className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line text-sm font-semibold text-muted hover:bg-surface"
            >
              {preparing ? <Spinner /> : <Icon d={icons.camera} />}
              Add photo
            </button>
          )}
        </div>
        <input
          ref={input}
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            void add(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <button type="submit" disabled={saving || preparing} className={`${buttonPrimary} w-full`}>
        {saving && <Spinner />}
        Post review
      </button>
    </form>
  );
}

/**
 * The finished job: what was done, who did it, the final price inside the
 * locked range, the job photos, and the review (the form, or what was posted).
 */
export function Completion({
  session,
  state,
  match,
  booked,
  onReviewed,
}: {
  session: Session;
  state: JobState;
  match: MatchState;
  booked: MatchOffer;
  onReviewed: (match: MatchState) => void;
}) {
  const writeUp = state.job.writeUp!;
  const tradie = booked.tradie;
  const name = tradie.name.split(" ")[0] ?? tradie.name;
  const [showAll, setShowAll] = useState(false);
  const details = showAll ? writeUp.details : writeUp.details.slice(0, 4);

  return (
    <div className="space-y-5 animate-question">
      <section aria-label="What was done" className={cardClass}>
        <div className="flex items-center gap-2 text-sm font-semibold text-success">
          <Icon d={icons.check} className="size-4 stroke-[2.5]" />
          Completed{match.timeline.done ? ` · ${new Date(match.timeline.done).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" })}` : ""}
        </div>
        <h2 className="mt-2 text-lg font-semibold">{writeUp.title}</h2>
        <p className="mt-1 text-muted text-pretty">{writeUp.summary}</p>
        {details.length > 0 && (
          <dl className="mt-3 space-y-1 text-sm">
            {details.map((d) => (
              <div key={d.label} className="flex gap-2">
                <dt className="shrink-0 text-faint">{d.label}</dt>
                <dd className="min-w-0">{d.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {writeUp.details.length > 4 && (
          <button type="button" onClick={() => setShowAll((v) => !v)} className={`${buttonQuiet} -ml-3 mt-1`}>
            {showAll ? "Show less" : `Show all ${writeUp.details.length} details`}
          </button>
        )}
        <p className="mt-3 text-xs text-faint">{[writeUp.location, match.whenLabel ?? match.date].filter(Boolean).join(" · ")}</p>
        {state.photos.length > 0 && (
          <div className="mt-4">
            <PhotoStrip urls={state.photos.map((p) => photoUrl(p.path, session.uploadToken))} label="Job photo" />
          </div>
        )}
      </section>

      <section aria-label="Your tradie and price" className={cardClass}>
        <div className="flex items-center gap-3">
          <Avatar tradie={tradie} size="size-12" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{tradie.name}</p>
            <p className="mt-0.5 flex items-center gap-2 text-sm text-muted">
              <Stars rating={tradie.rating} count={tradie.reviewCount} />
              <span aria-hidden>·</span>
              <span className="truncate">{tradie.business}</span>
            </p>
          </div>
        </div>
        <div className="mt-4 flex items-baseline justify-between gap-3 border-t border-line pt-4">
          <div>
            <p className="font-semibold">Final price</p>
            <p className="text-sm text-muted">Locked at {formatPriceRange(match.price)} when you confirmed</p>
          </div>
          <p className="text-2xl font-semibold tabular-nums">{money(booked.quote ?? match.price.max)}</p>
        </div>
      </section>

      <section aria-label="Your review" className={cardClass}>
        {match.review ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-success">
              <Icon d={icons.check} className="size-5 stroke-[2.5]" />
              <p className="font-semibold">Thanks, your review is posted.</p>
            </div>
            <StarRow stars={match.review.stars} />
            {match.review.text && <p className="text-pretty whitespace-pre-wrap">{match.review.text}</p>}
            <PhotoStrip urls={match.review.photos.map((path) => `${apiUrl()}${path}`)} label="Review photo" />
            <p className="text-sm text-muted">It&apos;ll show on {name}&apos;s profile for the next customer.</p>
          </div>
        ) : (
          <ReviewForm
            name={name}
            onSubmit={async (form) => {
              onReviewed(await api<MatchState>(`/jobs/${session.id}/review`, { method: "POST", token: session.token, body: form }));
            }}
          />
        )}
      </section>
    </div>
  );
}
