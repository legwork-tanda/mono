"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { TradieProfile } from "@legwork/shared";
import { Avatar, Stars } from "@/components/match-view";
import { tradeLabel } from "@/components/tradie/bits";
import { useTradie } from "@/components/tradie/tradie-context";
import { buttonSecondary, cardClass, Icon, icons, Walking } from "@/components/ui";

// Who this phone is playing: their rating, trades and the reviews customers
// see on their card (a few come with the profile; real ones join them as jobs
// are reviewed). And signing out, which frees the name so the phone can be
// handed on.

export default function TradieMePage() {
  const { session, setSession, call } = useTradie();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [profile, setProfile] = useState<TradieProfile | null>(null);

  // Fresh from the server: the rating and reviews change as customers review them.
  useEffect(() => {
    if (!session) return;
    void call<TradieProfile>("/me")
      .then(setProfile)
      .catch(() => {});
  }, [session, call]);

  if (!session) return <Walking label="Loading…" />;
  const t = profile ?? session.tradie;
  const reviews = profile?.reviews ?? null;

  async function signOut() {
    setBusy(true);
    try {
      await call("/signout", { json: {} });
    } catch {
      // Signed out already: carry on.
    }
    setSession(null);
    router.replace("/tradie/");
  }

  return (
    <div className="lw-screen">
      <header className="lw-appbar">
        <Link href="/tradie/home/" className="lw-glass lw-glass--circle lw-press" aria-label="Back to your dashboard">
          <Icon name={icons.back} />
        </Link>
        <h1 className="lw-headline">Your profile</h1>
        <span className="size-11 shrink-0" aria-hidden />
      </header>
      <main className="lw-screen__body gap-4">
      <section className={`${cardClass} space-y-4 p-5`}>
        <div className="flex items-center gap-3">
          <Avatar tradie={{ id: t.id, name: t.username, business: "", rating: t.rating, reviewCount: t.reviewCount, jobsDone: t.jobsDone, reviews: [] }} size="size-14" />
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold">{t.username}</p>
            <Stars rating={t.rating} count={t.reviewCount} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {t.trades.map((trade) => (
            <span key={trade} className="lw-chip lw-chip--compact">
              {tradeLabel(trade)}
            </span>
          ))}
        </div>
        {t.skills.length > 0 && <p className="text-sm text-muted">{t.skills.join(" · ")}</p>}
        <p className="text-sm text-muted">
          Travels up to {t.radiusKm} km · {t.jobsDone} jobs done
        </p>
      </section>

      <section aria-label="Your reviews" className="space-y-3">
        <h2 className="lw-section-label">Your reviews</h2>
        <p className="lw-caption lw-c2 px-1.5">People see these on your card when you bid.</p>
        {reviews === null ? (
          <Walking label="Loading reviews…" size="h-8" />
        ) : reviews.length === 0 ? (
          <p className="text-sm text-muted">No reviews yet.</p>
        ) : (
          <ul className="space-y-3">
            {reviews.map((r, i) => (
              <li key={i} className={`${cardClass} p-4`}>
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold">{r.author}</p>
                  <span className="text-ink" aria-label={`${r.stars} out of 5 stars`}>
                    {"★".repeat(r.stars)}
                    <span className="text-line">{"★".repeat(5 - r.stars)}</span>
                  </span>
                </div>
                <p className="mt-1.5 text-sm text-muted text-pretty">{r.text}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <button type="button" onClick={() => void signOut()} disabled={busy} className={`${buttonSecondary} w-full`}>
        {busy ? "Signing out…" : "Sign out"}
      </button>
      <p className="text-center text-xs text-faint text-pretty">Signing out frees your name so someone else can use this phone.</p>
      </main>
    </div>
  );
}
