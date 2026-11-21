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
import { buttonPrimary, ErrorNote, fieldClass, Icon, icons, linkButton } from "./ui";

type Session = { id: string; token: string; uploadToken: string };

const money = (n: number) => `$${n.toLocaleString("en-AU")}`;
const cardClass = "lw-glass p-[18px]";

/** Stars in ink, off stars at 25%. Never yellow. */
function StarRow({ stars, className = "" }: { stars: number; className?: string }) {
  return (
    <span role="img" className={`lw-stars ${className}`} aria-label={`Rating, ${stars} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Icon key={n} name="star" fill className={`size-[18px] ${n <= stars ? "" : "off"}`} />
      ))}
    </span>
  );
}

/** Thumbnails that open full size in a new tab. */
function PhotoStrip({ urls, label }: { urls: string[]; label: string }) {
  if (urls.length === 0) return null;
  return (
    <ul className="grid grid-cols-4 gap-1.5" aria-label={label}>
      {urls.map((url, i) => (
        <li key={url}>
          <a href={url} target="_blank" rel="noreferrer" className="block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={`${label} ${i + 1}`} className="lw-thumb aspect-square w-full" />
          </a>
        </li>
      ))}
    </ul>
  );
}

type Picked = { id: string; blob: Blob; preview: string };

const GOOD_TAGS = ["On time", "Tidy", "Explained the fix", "Fair price", "Would book again"];
const BAD_TAGS = ["Late", "Messy", "Didn't explain", "Price higher than quoted", "Had to come back"];

/**
 * S12: 1 to 5 ink stars, what went well (or could be better), a note, and up
 * to three photos of the finished work. The API takes stars, text and photos,
 * so the picked tags lead the review text (as the iOS app).
 */
function ReviewForm({ name, initials, onSubmit }: { name: string; initials: string; onSubmit: (form: FormData) => Promise<void> }) {
  const [stars, setStars] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [photos, setPhotos] = useState<Picked[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const previews = useRef<string[]>([]);
  const low = stars > 0 && stars <= 3;
  const shownTags = low ? BAD_TAGS : GOOD_TAGS;

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

  function rate(n: number) {
    // Good and bad tags are different lists: switching sides clears the picks.
    if (n <= 3 !== low || stars === 0) setTags([]);
    setStars(n);
  }

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!stars) return setError("Tap a star to rate.");
        setSaving(true);
        setError(null);
        const tagLine = shownTags.filter((t) => tags.includes(t)).join(" · ");
        const body = [tagLine, text.trim()].filter(Boolean).join("\n").slice(0, REVIEW_TEXT_MAX);
        const form = new FormData();
        form.set("stars", String(stars));
        form.set("text", body);
        photos.forEach((p, i) => form.append("photos", p.blob, `photo-${i + 1}.jpg`));
        try {
          await onSubmit(form);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setSaving(false);
        }
      }}
      className="lw-stack gap-4"
    >
      <div className="flex flex-col items-center gap-3.5 pt-2 text-center">
        <span aria-hidden className="lw-initials size-20 text-2xl">
          {initials}
        </span>
        <h2 className="lw-title-1">How did {name} go?</h2>
        <div className="lw-stars lw-stars--input" role="radiogroup" aria-label="Rating">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={stars === n}
              aria-label={`${n} star${n === 1 ? "" : "s"}`}
              onClick={() => rate(n)}
              className={n <= stars ? "" : "text-faint"}
            >
              <Icon name="star" fill={n <= stars} className="size-9" />
            </button>
          ))}
        </div>
      </div>

      <div className={`lw-glass space-y-3.5 p-[18px] ${error ? "is-error" : ""}`}>
        <p className="lw-label">{low ? "What could be better?" : "What went well?"}</p>
        <div className="lw-chips" role="group" aria-label={low ? "What could be better" : "What went well"}>
          {shownTags.map((tag) => {
            const on = tags.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                aria-pressed={on}
                onClick={() => setTags((list) => (on ? list.filter((t) => t !== tag) : [...list, tag]))}
                className={`lw-chip min-h-11 ${on ? "is-on" : ""}`}
              >
                {tag}
              </button>
            );
          })}
        </div>
        <label htmlFor="review" className="sr-only">
          Note
        </label>
        <textarea
          id="review"
          rows={3}
          value={text}
          maxLength={REVIEW_TEXT_MAX}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a note (optional)"
          className={`${fieldClass} min-h-[72px] resize-none rounded-[var(--lw-radius-lg)] px-4 py-3.5`}
        />

        {photos.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {photos.map((p, i) => (
              <div key={p.id} className="relative animate-fade-in">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.preview} alt={`Review photo ${i + 1}`} className="lw-thumb aspect-square w-full" />
                <button
                  type="button"
                  onClick={() => setPhotos((list) => list.filter((x) => x.id !== p.id))}
                  aria-label={`Remove photo ${i + 1}`}
                  className="lw-press absolute -top-1.5 -right-1.5 flex size-11 items-center justify-center"
                >
                  <span className="lw-glass flex size-7 items-center justify-center rounded-full">
                    <Icon name={icons.close} className="size-4" />
                  </span>
                </button>
              </div>
            ))}
          </div>
        )}
        {photos.length < MAX_REVIEW_PHOTOS && (
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={preparing}
            className="lw-press lw-subhead flex min-h-11 items-center gap-2.5 disabled:text-disabled"
          >
            <Icon name={icons.camera} />
            {preparing ? "Adding…" : photos.length === 0 ? "Add a photo" : "Add another photo"}
            <span className="lw-footnote text-faint tabular-nums">
              {photos.length}/{MAX_REVIEW_PHOTOS}
            </span>
          </button>
        )}
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

      {error && (
        <div role="alert" className="px-1">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
      <button type="submit" disabled={saving || preparing || stars === 0} className={`${buttonPrimary} w-full`}>
        {saving ? "Sending…" : "Send rating"}
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
    <div className="lw-done animate-question">
      <section aria-label="What was done" className={cardClass}>
        <div className="flex items-center gap-3">
          <span className="lw-done-badge">
            <Icon name={icons.check} className="size-6" />
          </span>
          <div className="min-w-0">
            <h2 className="lw-title-2">{name}&rsquo;s finished</h2>
            <p className="lw-caption text-muted">
              Completed{match.timeline.done ? ` · ${new Date(match.timeline.done).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" })}` : ""}
            </p>
          </div>
        </div>
        <div className="lw-kv mt-3">
          <p className="lw-kv__k">What was done</p>
          <p className="lw-kv__v">
            <span className="font-semibold">{writeUp.title}.</span> {writeUp.summary}
          </p>
        </div>
        {details.length > 0 && (
          <dl>
            {details.map((d) => (
              <div key={d.label} className="lw-kv">
                <dt className="lw-kv__k">{d.label}</dt>
                <dd className="lw-kv__v min-w-0">{d.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {writeUp.details.length > 4 && (
          <button type="button" onClick={() => setShowAll((v) => !v)} className={`${linkButton} mt-2 inline-flex min-h-11 items-center`}>
            {showAll ? "Show less" : `Show all ${writeUp.details.length} details`}
          </button>
        )}
        <p className="lw-footnote mt-3 text-faint">{[writeUp.location, match.whenLabel ?? match.date].filter(Boolean).join(" · ")}</p>
        {state.photos.length > 0 && (
          <div className="mt-3">
            <p className="lw-kv__k mb-1.5">Photos</p>
            <PhotoStrip urls={state.photos.map((p) => photoUrl(p.path, session.uploadToken))} label="Job photo" />
          </div>
        )}
      </section>

      <section aria-label="Your tradie and price" className={cardClass}>
        <div className="flex items-center gap-3">
          <Avatar tradie={tradie} />
          <div className="min-w-0 flex-1">
            <p className="lw-headline">{tradie.name}</p>
            <p className="lw-caption mt-0.5 flex items-center gap-2 text-muted">
              <Stars rating={tradie.rating} count={tradie.reviewCount} />
              <span aria-hidden>·</span>
              <span className="truncate">{tradie.business}</span>
            </p>
          </div>
        </div>
        <div className="mt-3">
          <div className="lw-price lw-price--total">
            <span>Final price</span>
            <span>{money(booked.quote ?? match.price.max)}</span>
          </div>
          <p className="lw-caption text-faint">Locked at {formatPriceRange(match.price)} when you confirmed</p>
        </div>
      </section>

      <section aria-label="Your review" className={match.review ? cardClass : ""}>
        {match.review ? (
          <div className="space-y-3 animate-fade-in">
            <div className="flex items-center gap-2.5">
              <span className="lw-dot lw-dot--done">
                <Icon name={icons.check} className="size-3.5" />
              </span>
              <p className="lw-headline">Thanks, your review is posted.</p>
            </div>
            <StarRow stars={match.review.stars} />
            {match.review.text && <p className="text-pretty whitespace-pre-wrap">{match.review.text}</p>}
            <PhotoStrip urls={match.review.photos.map((path) => `${apiUrl()}${path}`)} label="Review photo" />
            <p className="lw-caption text-muted">It&apos;ll show on {name}&apos;s profile for the next customer.</p>
          </div>
        ) : (
          <ReviewForm
            name={name}
            initials={tradie.name
              .split(" ")
              .map((p) => p[0])
              .slice(0, 2)
              .join("")}
            onSubmit={async (form) => {
              onReviewed(await api<MatchState>(`/jobs/${session.id}/review`, { method: "POST", token: session.token, body: form }));
            }}
          />
        )}
      </section>
    </div>
  );
}
