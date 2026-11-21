"use client";

import { useEffect, useState } from "react";
import { TIER_INFO, tradeInfo, type MatchStage, type Tier, type TradeId } from "@legwork/shared";

export const money = (n: number) => `$${n.toLocaleString("en-AU")}`;

/** "Sat 22 Nov", or "Today" / "Tomorrow". */
export function niceDate(date: string) {
  if (!date) return "";
  const d = new Date(`${date}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((d.getTime() - today.getTime()) / 864e5);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
}

const TIER_TONE: Record<Tier, string> = {
  high: "bg-surface text-ink",
  medium: "bg-accent-tint text-ink",
  low: "bg-accent-tint text-ink",
};

export function TierBadge({ tier }: { tier: Tier }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${TIER_TONE[tier]}`}>{TIER_INFO[tier].label}</span>;
}

export const tradeLabel = (trade: TradeId) => tradeInfo(trade).label;

export const STAGE_LABEL: Record<MatchStage, string> = {
  searching: "Searching",
  no_match: "No match",
  scheduled: "Scheduled",
  matched: "Booked",
  en_route: "On the way",
  in_progress: "Working",
  completed: "Done",
  cancelled: "Cancelled",
};

const STAGE_TONE: Partial<Record<MatchStage, string>> = {
  matched: "bg-accent-tint text-ink",
  en_route: "bg-accent text-on-accent",
  in_progress: "bg-accent-tint text-ink",
  completed: "bg-surface text-ink",
  cancelled: "bg-surface text-muted",
};

export function StageBadge({ stage }: { stage: MatchStage }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STAGE_TONE[stage] ?? "bg-surface text-muted"}`}>{STAGE_LABEL[stage]}</span>;
}

/** Seconds left until `until` (ISO), ticking every second; null without a time. */
export function useSecondsLeft(until: string | null) {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!until) return setLeft(null);
    const tick = () => setLeft(Math.max(0, Math.round((Date.parse(until) - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [until]);
  return left;
}

export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** "1:24 left", red in the last 15 seconds. */
export function TimeLeft({ until }: { until: string | null }) {
  const left = useSecondsLeft(until);
  if (left === null) return null;
  return (
    <span className={`text-sm font-semibold tabular-nums ${left <= 15 ? "text-ink" : "text-muted"}`}>
      {left > 0 ? `${mmss(left)} left` : "Time's up"}
    </span>
  );
}
