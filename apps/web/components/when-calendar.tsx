"use client";

import { useState } from "react";
import {
  addDays,
  formatWindow,
  sameSlot,
  sortSlots,
  WHEN_BLOCKS,
  type CalendarDay,
  type TimeSlot,
  type WhenCalendar,
} from "@legwork/shared";
import { Icon, icons } from "./ui";

/** What the customer has picked: ASAP, or a set of blocks. Switching to ASAP keeps the blocks for switching back. */
export type WhenPick = { asap: boolean; slots: TimeSlot[] };

const WEEKDAY_INITIALS = ["M", "T", "W", "T", "F", "S", "S"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** Two weeks a page keeps the calendar to two rows on a phone; the arrows move it on. */
const WEEKS_PER_PAGE = 2;

const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
const dayOfMonth = (date: string) => Number(date.slice(8, 10));
const monthOf = (date: string) => MONTHS[Number(date.slice(5, 7)) - 1]!;

/** A day before today (shown faint, for orientation) or after the calendar ends. */
type Filler = { date: string; filler: true };
type Cell = CalendarDay | Filler;
const isFiller = (c: Cell): c is Filler => "filler" in c;

/** The calendar's weeks, Monday first, padded with filler days that can't be picked. */
function weeksOf(calendar: WhenCalendar): Cell[][] {
  const lead = (weekday(calendar.today) + 6) % 7;
  const cells: Cell[] = [...Array.from({ length: lead }, (_, i) => ({ date: addDays(calendar.today, i - lead), filler: true as const })), ...calendar.days];
  const last = calendar.days.at(-1)?.date ?? calendar.today;
  for (let i = 1; cells.length % 7; i++) cells.push({ date: addDays(last, i), filler: true });
  const weeks: Cell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

const firstOpenDay = (calendar: WhenCalendar) => calendar.days.find((d) => d.blocks.length > 0)?.date ?? null;

/**
 * "How soon?" as a small calendar of blocks (#65): ASAP as its own tile, then a
 * two-week month view of only the days somebody is free, and the tapped day's
 * blocks in plain words. Any number of blocks across any number of days. Taps
 * only. Used by the question and by the brief.
 */
export function WhenCalendarPicker({
  calendar,
  value,
  onChange,
  disabled = false,
}: {
  calendar: WhenCalendar;
  value: WhenPick;
  onChange: (next: WhenPick) => void;
  disabled?: boolean;
}) {
  const weeks = weeksOf(calendar);
  const pages = Math.ceil(weeks.length / WEEKS_PER_PAGE);
  const initialDay = value.slots[0]?.date ?? firstOpenDay(calendar);
  const [day, setDay] = useState<string | null>(initialDay);
  const pageOf = (date: string | null) => {
    if (!date) return 0;
    const index = weeks.findIndex((w) => w.some((d) => d.date === date));
    return Math.max(0, Math.floor(index / WEEKS_PER_PAGE));
  };
  const [page, setPage] = useState(() => pageOf(initialDay));
  const shown = weeks.slice(page * WEEKS_PER_PAGE, (page + 1) * WEEKS_PER_PAGE);
  const firstShown = shown.flat().find((d) => !isFiller(d))?.date ?? calendar.today;
  const selectedDay = calendar.days.find((d) => d.date === day) ?? null;
  const picked = (slot: TimeSlot) => value.slots.some((s) => sameSlot(s, slot));
  const pickedOn = (date: string) => value.slots.some((s) => s.date === date);
  const counted = calendar.asap.free !== null;

  const toggle = (slot: TimeSlot) => {
    const slots = picked(slot) ? value.slots.filter((s) => !sameSlot(s, slot)) : sortSlots([...value.slots, slot]);
    // Picking a block leaves ASAP; the blocks themselves are never dropped by switching.
    onChange({ asap: false, slots });
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        role="switch"
        aria-checked={value.asap}
        disabled={disabled}
        onClick={() => onChange({ ...value, asap: !value.asap })}
        className={`flex min-h-12 w-full items-center gap-3 rounded-[14px] px-3.5 py-2 text-left ring-1 transition-colors duration-150 ${
          value.asap ? "bg-brand-soft ring-2 ring-brand" : "bg-white ring-line hover:ring-brand/50"
        }`}
      >
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block text-base font-semibold">ASAP</span>
          <span className="block truncate text-xs text-muted">As soon as someone can get here</span>
        </span>
        {counted && calendar.asap.free! > 0 && <span className="shrink-0 text-xs text-muted">{calendar.asap.free} free now</span>}
        {value.asap && <Icon d={icons.check} className="size-5 shrink-0 stroke-[2.5] text-brand" />}
      </button>

      <div className={`rounded-[14px] bg-white p-2 ring-1 ring-line transition-opacity ${value.asap ? "opacity-60" : ""}`}>
        <div className="flex items-center justify-between pl-1.5">
          <p className="text-sm font-semibold" aria-live="polite">
            {monthOf(firstShown)}
            {monthOf(addDays(firstShown, 13)) !== monthOf(firstShown) && ` – ${monthOf(addDays(firstShown, 13))}`}
          </p>
          <div className="flex">
            <button
              type="button"
              aria-label="Earlier days"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
              className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-surface disabled:opacity-30"
            >
              <Icon d={icons.back} className="size-4" />
            </button>
            <button
              type="button"
              aria-label="Later days"
              disabled={page >= pages - 1}
              onClick={() => setPage((p) => p + 1)}
              className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-surface disabled:opacity-30"
            >
              <Icon d={icons.arrow} className="size-4" />
            </button>
          </div>
        </div>
        <div className="grid grid-cols-7 text-center text-[11px] font-medium text-faint" aria-hidden>
          {WEEKDAY_INITIALS.map((d, i) => (
            <span key={i}>{d}</span>
          ))}
        </div>
        <div role="grid" aria-label="Days" className="mt-0.5 grid grid-cols-7 gap-y-0.5">
          {shown.flat().map((d, i) => {
            if (isFiller(d)) {
              return (
                <span key={`filler-${i}`} aria-hidden className="flex h-11 items-center justify-center text-[15px] text-faint/50 tabular-nums">
                  {dayOfMonth(d.date)}
                </span>
              );
            }
            const open = d.blocks.length > 0;
            const current = d.date === day;
            const has = pickedOn(d.date);
            return (
              <button
                key={d.date}
                type="button"
                role="gridcell"
                aria-selected={current}
                aria-label={`${d.date}${open ? (d.free !== null ? `, ${d.free} free` : "") : ", nobody free"}${has ? ", picked" : ""}`}
                disabled={!open || disabled}
                onClick={() => setDay(d.date)}
                className={`mx-auto flex h-11 w-full max-w-12 flex-col items-center justify-center rounded-xl leading-none transition-colors duration-150 ${
                  current ? "ring-2 ring-brand" : ""
                } ${has ? "bg-brand text-white" : open ? "hover:bg-surface" : "cursor-not-allowed text-faint/60 line-through"}`}
              >
                <span className="text-[15px] font-semibold tabular-nums">{dayOfMonth(d.date)}</span>
                {open && d.free !== null && <span className={`mt-0.5 text-[10px] ${has ? "text-white/80" : "text-muted"}`}>{d.free} free</span>}
              </button>
            );
          })}
        </div>
      </div>

      {selectedDay && (
        <div className="flex gap-1.5" role="group" aria-label={`Blocks on ${selectedDay.date}`}>
          {WHEN_BLOCKS.map((b) => {
            const offered = selectedDay.blocks.find((x) => x.name === b.name);
            if (!offered) return null;
            const slot = { date: selectedDay.date, start: b.start, end: b.end };
            const on = picked(slot);
            return (
              <button
                key={b.name}
                type="button"
                role="checkbox"
                aria-checked={on}
                disabled={disabled}
                onClick={() => toggle(slot)}
                className={`flex min-h-11 flex-1 flex-col items-center justify-center rounded-xl px-2 leading-tight ring-1 transition-colors duration-150 ${
                  on ? "bg-brand-soft ring-2 ring-brand" : "bg-white ring-line hover:ring-brand/50"
                }`}
              >
                <span className="text-sm font-semibold">{b.label}</span>
                {on && <span className="text-[11px] text-muted">{formatWindow(b)}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
