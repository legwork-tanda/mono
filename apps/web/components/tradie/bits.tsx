"use client";

import { useEffect, useState } from "react";
import { TIER_INFO, tradeInfo, type MatchStage, type Tier, type TradeId, type TradieStageRequest } from "@legwork/shared";
import { Icon } from "@/components/ui";

export const money = (n: number) => `$${n.toLocaleString("en-AU")}`;

const dayOf = (date: string) => new Date(`${date}T00:00:00`);

/** "Sat 22 Nov", or "Today" / "Tomorrow". */
export function niceDate(date: string) {
  if (!date) return "";
  const d = dayOf(date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((d.getTime() - today.getTime()) / 864e5);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
}

/** The date tile in a list row: "SAT" over "22". */
export function DateTile({ date }: { date: string }) {
  if (!date) return <span className="lw-date" aria-hidden />;
  const d = dayOf(date);
  return (
    <span className="lw-date" aria-hidden>
      <span>{d.toLocaleDateString("en-AU", { weekday: "short" }).toUpperCase()}</span>
      <b>{d.getDate()}</b>
    </span>
  );
}

export function TierBadge({ tier }: { tier: Tier }) {
  return <span className="lw-badge">{TIER_INFO[tier].label}</span>;
}

export const tradeLabel = (trade: TradeId) => tradeInfo(trade).label;

/** The job stepper, as the user sees it: Booked › On the way › Arrived › Done. */
export const JOB_STEPS = ["Booked", "On the way", "Arrived", "Done"] as const;
const STEP_OF: Partial<Record<MatchStage, number>> = { matched: 0, en_route: 1, in_progress: 2, completed: 3 };
export const jobStep = (stage: MatchStage) => STEP_OF[stage] ?? 0;

/** The only stage a booked job can move to next. */
export const NEXT_STAGE: Partial<Record<MatchStage, TradieStageRequest["to"]>> = {
  matched: "en_route",
  en_route: "in_progress",
  in_progress: "completed",
};

/** The one yellow action on a booked job, and the toast that confirms it. */
export const STAGE_ACTION: Record<TradieStageRequest["to"], { label: string; icon: "navigation-arrow" | "door" | "check"; done: string }> = {
  en_route: { label: "I'm on my way", icon: "navigation-arrow", done: "They've been told you're on the way." },
  in_progress: { label: "I'm at the door", icon: "door", done: "They've been told you're there." },
  completed: { label: "Finish job", icon: "check", done: "Job done. They can review you now." },
};

export const ACTIVE_STAGES = new Set<MatchStage>(["matched", "en_route", "in_progress"]);

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

const RING = 150.8; // 2πr for r = 24

/** The offer ring: ink drains a second at a time; the last 10 s fill the centre yellow. */
export function Countdown({ left, total }: { left: number; total: number }) {
  const off = RING * (1 - Math.min(1, left / Math.max(1, total)));
  return (
    <div className={`lw-countdown ${left <= 10 ? "is-low" : ""}`} role="timer" aria-label={`${left} seconds left`}>
      <svg viewBox="0 0 56 56" aria-hidden>
        <circle className="trk" cx="28" cy="28" r="24" />
        <circle className="prg" cx="28" cy="28" r="24" style={{ strokeDashoffset: off }} />
      </svg>
      <b aria-hidden>{left}</b>
    </div>
  );
}

const MINUS = "M5 12h14";
const PLUS = "M12 5v14M5 12h14";

/** Minus, value, plus: 44pt buttons, so it works with gloves on. */
export function Qty({
  value,
  min,
  max,
  step,
  onChange,
  label,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (n: number) => void;
  /** "quote": read as "Lower your quote", "Raise your quote". */
  label: string;
}) {
  return (
    <div className="lw-qty">
      <button type="button" onClick={() => onChange(Math.max(min, value - step))} disabled={value <= min} aria-label={`Lower ${label}`}>
        <Icon d={MINUS} className="size-4" />
      </button>
      <output className="lw-num" aria-live="polite">
        {money(value)}
      </output>
      <button type="button" onClick={() => onChange(Math.min(max, value + step))} disabled={value >= max} aria-label={`Raise ${label}`}>
        <Icon d={PLUS} className="size-4" />
      </button>
    </div>
  );
}
