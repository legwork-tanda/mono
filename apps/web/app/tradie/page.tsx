"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  TRADES,
  TRADIE_RADII,
  TRADIE_SKILLS_MAX,
  TRADIE_TRADES_MAX,
  type TradeId,
  type TradieDraft,
  type TradieSignupRequest,
  type TradieSignupResponse,
} from "@legwork/shared";
import { api } from "@/lib/api";
import { Avatar } from "@/components/match-view";
import { useTradie } from "@/components/tradie/tradie-context";
import { buttonPrimary, buttonQuiet, cardClass, ErrorNote, Icon, icons, Logo, Walking } from "@/components/ui";

// Become a tradie in a few seconds. The name is generated for you (Shuffle
// for another); you pick the trades you do, a few skills and how far you'll
// travel. No password.

const draftUrl = (username: string | null, trades: TradeId[]) => {
  const q = new URLSearchParams();
  if (username) q.set("username", username);
  if (trades.length > 0) q.set("trades", trades.join(","));
  return `/tradie/draft?${q}`;
};

export default function TradieSignUp() {
  const { session, setSession } = useTradie();
  const router = useRouter();
  const [username, setUsername] = useState<string | null>(null);
  const [trades, setTrades] = useState<TradeId[]>([]);
  const [skillOptions, setSkillOptions] = useState<string[]>([]);
  const [skills, setSkills] = useState<string[]>([]);
  const [radius, setRadius] = useState<number>(10);
  const [busy, setBusy] = useState<"draft" | "signup" | null>("draft");
  const [error, setError] = useState<string | null>(null);
  // Only the latest draft request counts when trades are tapped quickly.
  const latest = useRef(0);

  useEffect(() => {
    if (session) router.replace("/tradie/home/");
  }, [session, router]);

  /** Asks for a draft: a new name (keep = null) or the same one, for these trades. */
  const draft = useCallback(async (keep: string | null, picked: TradeId[]) => {
    const ticket = ++latest.current;
    setBusy("draft");
    setError(null);
    try {
      const next = await api<TradieDraft>(draftUrl(keep, picked));
      if (ticket !== latest.current) return;
      setUsername(next.username);
      setSkillOptions(picked.length > 0 ? next.skillOptions : []);
      // Skills that no longer fit the trades drop off.
      setSkills((list) => list.filter((s) => next.skillOptions.includes(s)));
    } catch (e) {
      if (ticket === latest.current) setError((e as Error).message);
    } finally {
      if (ticket === latest.current) setBusy(null);
    }
  }, []);

  useEffect(() => {
    if (session === null) void draft(null, []);
  }, [session, draft]);

  function toggleTrade(t: TradeId) {
    const on = trades.includes(t);
    if (!on && trades.length >= TRADIE_TRADES_MAX) return;
    const next = on ? trades.filter((x) => x !== t) : [...trades, t];
    setTrades(next);
    void draft(username, next);
  }

  async function signUp() {
    if (!username || trades.length === 0) return;
    setBusy("signup");
    setError(null);
    try {
      const res = await api<TradieSignupResponse>("/tradie/signup", {
        method: "POST",
        json: { username, trades, skills, radiusKm: radius } satisfies TradieSignupRequest,
      });
      setSession({ token: res.token, tradie: res.tradie });
      router.replace("/tradie/home/");
    } catch (e) {
      setError((e as Error).message);
      // Most likely the name was just taken: offer a fresh one.
      if ((e as { status?: number }).status === 409) void draft(null, trades);
    } finally {
      setBusy((b) => (b === "signup" ? null : b));
    }
  }

  if (session) {
    return (
      <div className="lw-screen items-center justify-center">
        <Walking label="Opening your dashboard…" />
      </div>
    );
  }

  return (
    <div className="lw-screen">
      <header className="lw-appbar">
        <Logo href="/tradie/" />
        <span className="lw-glass lw-glass--pill lw-caption lw-strong flex h-11 items-center px-4">For tradies</span>
      </header>
      <main className="lw-screen__body gap-4 animate-question">
      <div>
        <h1 className="lw-title-1">Take jobs on Legwork</h1>
        <p className="lw-callout lw-c2 mt-1.5 text-pretty">Jobs near you with a locked price range and photos. No lead fees.</p>
      </div>

      {!username ? (
        <Walking label="Making your profile…" />
      ) : (
        <section className={`${cardClass} space-y-5 p-5`} aria-label="Your profile">
          <div className="flex items-center gap-3">
            <Avatar tradie={{ id: username, name: username, business: "", rating: 0, reviewCount: 0, jobsDone: 0, reviews: [] }} size="size-14" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-lg font-semibold">{username}</p>
              <p className="truncate text-sm text-muted">Your name for the demo</p>
            </div>
            <button type="button" onClick={() => void draft(null, trades)} disabled={busy === "signup"} className={buttonQuiet} aria-label="Shuffle your name">
              {busy === "draft" ? "Shuffling…" : "Shuffle"}
            </button>
          </div>

          <fieldset>
            <legend className="lw-headline">Your trades</legend>
            <p className="lw-footnote lw-c3">Pick up to {TRADIE_TRADES_MAX}. You only get offers for these.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {TRADES.map((t) => {
                const on = trades.includes(t.id);
                const full = !on && trades.length >= TRADIE_TRADES_MAX;
                return (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={on}
                    disabled={full}
                    onClick={() => toggleTrade(t.id)}
                    className={`lw-chip ${on ? "is-on" : ""} disabled:text-disabled`}
                  >
                    {on && <Icon name={icons.check} />}
                    {t.label}
                  </button>
                );
              })}
            </div>
          </fieldset>

          {skillOptions.length > 0 && (
            <fieldset>
              <legend className="lw-headline">What you&rsquo;re best at</legend>
              <p className="lw-footnote lw-c3">Pick a few. Jobs that match your skills come to you first.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {skillOptions.map((s) => {
                  const on = skills.includes(s);
                  return (
                    <button
                      key={s}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setSkills((list) => (on ? list.filter((x) => x !== s) : list.length < TRADIE_SKILLS_MAX ? [...list, s] : list))}
                      className={`lw-chip lw-chip--compact ${on ? "is-selected" : ""}`}
                    >
                      {s}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          )}

          <fieldset>
            <legend className="lw-headline">How far you&rsquo;ll travel</legend>
            <div className="mt-2 grid grid-cols-4 gap-2">
              {TRADIE_RADII.map((km) => (
                <button
                  key={km}
                  type="button"
                  aria-pressed={radius === km}
                  onClick={() => setRadius(km)}
                  className={`lw-chip lw-num justify-center ${radius === km ? "is-selected" : ""}`}
                >
                  {km} km
                </button>
              ))}
            </div>
          </fieldset>
        </section>
      )}

      {error && <ErrorNote>{error}</ErrorNote>}

      <button type="button" onClick={() => void signUp()} disabled={!username || trades.length === 0 || !!busy} className={`${buttonPrimary} w-full`}>
        {busy === "signup" ? "Setting you up…" : trades.length === 0 ? "Pick at least one trade" : "Start taking jobs"}
      </button>
      <p className="text-center text-xs text-faint text-pretty">Demo only: there&rsquo;s no password. Whoever has this phone is this tradie.</p>
      </main>
    </div>
  );
}
