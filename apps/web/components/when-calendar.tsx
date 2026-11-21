"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
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
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** "Saturday 21 November", for screen readers. */
const spokenDay = (date: string) => `${WEEKDAY_NAMES[weekday(date)]} ${dayOfMonth(date)} ${monthOf(date)}`;
const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-selected";

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
 * blocks in plain words. Any number of blocks across any number of days. Used
 * by the question and by the brief.
 *
 * Keyboard (#70): the days are an ARIA grid with one tab stop. Arrow keys move
 * a day or a week (turning the page when they run off it), Home and End go to
 * the ends of the week, Enter or Space opens a day, and the blocks under it are
 * toggle buttons.
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
  const [chosenDay, setDay] = useState<string | null>(initialDay);
  // The calendar can change under the customer (it narrows to the trade's own
  // tradies once that's known, and a block closes as the day goes on). A day
  // that has closed since it was opened falls back to the first open one, so
  // the blocks row never vanishes under a ring on a struck-out day.
  const isOpen = (date: string | null) => calendar.days.some((d) => d.date === date && d.blocks.length > 0);
  const day = isOpen(chosenDay) ? chosenDay : (value.slots.find((s) => isOpen(s.date))?.date ?? firstOpenDay(calendar));
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

  // The day the arrow keys are on. It's the grid's only tab stop.
  const [cursor, setCursor] = useState<string | null>(initialDay);
  const shownDays = shown.flat().filter((d): d is CalendarDay => !isFiller(d));
  const onPage = (date: string | null) => shownDays.some((d) => d.date === date);
  const tabStop = onPage(cursor) ? cursor : onPage(day) ? day : (shownDays.find((d) => d.blocks.length > 0) ?? shownDays[0])?.date;
  const dayButtons = useRef(new Map<string, HTMLButtonElement>());
  // Set only by the arrow keys, so a page turn or a re-render never pulls focus by itself.
  const focusNext = useRef<string | null>(null);
  useEffect(() => {
    const date = focusNext.current;
    if (!date) return;
    focusNext.current = null;
    dayButtons.current.get(date)?.focus();
  });

  const moveTo = (date: string) => {
    if (!calendar.days.some((d) => d.date === date)) return;
    setCursor(date);
    setPage(pageOf(date));
    focusNext.current = date;
  };
  const onGridKey = (e: KeyboardEvent<HTMLButtonElement>, date: string) => {
    const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    const lead = (weekday(date) + 6) % 7;
    const target =
      offset !== undefined ? addDays(date, offset) : e.key === "Home" ? addDays(date, -lead) : e.key === "End" ? addDays(date, 6 - lead) : null;
    if (!target) return;
    e.preventDefault();
    // Home and End clamp to the calendar's own days when the week is cut short.
    if (e.key === "Home" || e.key === "End") {
      const week = calendar.days.filter((d) => d.date >= addDays(date, -lead) && d.date <= addDays(date, 6 - lead));
      const end = e.key === "Home" ? week[0] : week.at(-1);
      if (end) moveTo(end.date);
      return;
    }
    moveTo(target);
  };

  const toggle = (slot: TimeSlot) => {
    const slots = picked(slot) ? value.slots.filter((s) => !sameSlot(s, slot)) : sortSlots([...value.slots, slot]);
    // Picking a block leaves ASAP; the blocks themselves are never dropped by switching.
    onChange({ asap: false, slots });
  };

  return (
    <div className="flex flex-col gap-2.5">
      <button
        type="button"
        role="switch"
        aria-checked={value.asap}
        disabled={disabled}
        onClick={() => onChange({ ...value, asap: !value.asap })}
        className={`lw-glass lw-option lw-press flex w-full items-center gap-3 text-left ${focusRing} ${value.asap ? "is-selected" : ""}`}
      >
        <span className="min-w-0 flex-1">
          <span className="lw-headline block">ASAP</span>
          <span className="lw-caption block truncate text-muted">As soon as someone can get here</span>
          {counted && calendar.asap.free! > 0 && <span className="lw-caption mt-1 block text-muted">{calendar.asap.free} free now</span>}
        </span>
        <span aria-hidden className={`lw-radio ${value.asap ? "is-on" : ""}`}>
          {value.asap && <Icon name={icons.check} className="size-3.5" />}
        </span>
      </button>

      <div className={`lw-glass p-3 transition-opacity ${value.asap ? "opacity-60" : ""}`}>
        <div className="flex items-center justify-between pl-1.5">
          <p className="lw-subhead font-semibold" aria-live="polite">
            {monthOf(firstShown)}
            {monthOf(addDays(firstShown, 13)) !== monthOf(firstShown) && ` – ${monthOf(addDays(firstShown, 13))}`}
          </p>
          <div className="flex">
            <button
              type="button"
              aria-label="Earlier days"
              disabled={page === 0}
              onClick={() => {
                setPage((p) => p - 1);
                setCursor(null);
              }}
              className={`lw-icon-btn lw-press text-muted disabled:opacity-30 ${focusRing}`}
            >
              <Icon name="caret-left" className="size-5" />
            </button>
            <button
              type="button"
              aria-label="Later days"
              disabled={page >= pages - 1}
              onClick={() => {
                setPage((p) => p + 1);
                setCursor(null);
              }}
              className={`lw-icon-btn lw-press text-muted disabled:opacity-30 ${focusRing}`}
            >
              <Icon name="caret-right" className="size-5" />
            </button>
          </div>
        </div>
        <div className="grid grid-cols-7 text-center lw-footnote font-semibold text-muted" aria-hidden>
          {WEEKDAY_INITIALS.map((d, i) => (
            <span key={i}>{d}</span>
          ))}
        </div>
        <div role="grid" aria-label="Days with free times. Arrow keys move between days." className="mt-0.5 grid grid-cols-7 gap-y-0.5">
          {Array.from({ length: shown.length }, (_, w) => (
            <div key={w} role="row" className="contents">
              {shown[w]!.map((d, i) => {
                if (isFiller(d)) {
                  return (
                    <span
                      key={`filler-${w}-${i}`}
                      role="gridcell"
                      aria-hidden
                      className="flex h-11 items-center justify-center text-[15px] text-faint/50 tabular-nums"
                    >
                      {dayOfMonth(d.date)}
                    </span>
                  );
                }
                const open = d.blocks.length > 0;
                const current = d.date === day;
                const has = pickedOn(d.date);
                const free = open ? (d.free !== null ? `, ${d.free} free` : "") : ", nobody free";
                return (
                  <button
                    key={d.date}
                    ref={(el) => {
                      if (el) dayButtons.current.set(d.date, el);
                      else dayButtons.current.delete(d.date);
                    }}
                    type="button"
                    role="gridcell"
                    tabIndex={d.date === tabStop ? 0 : -1}
                    aria-selected={current}
                    aria-disabled={!open || disabled}
                    aria-label={`${spokenDay(d.date)}${free}${has ? ", has picked times" : ""}`}
                    onKeyDown={(e) => onGridKey(e, d.date)}
                    onFocus={() => setCursor(d.date)}
                    onClick={() => {
                      if (open && !disabled) setDay(d.date);
                    }}
                    className={`lw-press mx-auto flex h-11 w-full max-w-12 flex-col items-center justify-center rounded-[11px] leading-none ${focusRing} ${
                      current ? "ring-2 ring-selected" : ""
                    } ${has ? "bg-accent text-on-accent" : open ? "" : "cursor-not-allowed text-faint/60 line-through"}`}
                  >
                    <span className="text-[15px] font-semibold tabular-nums">{dayOfMonth(d.date)}</span>
                    {open && d.free !== null && <span className={`lw-footnote mt-0.5 leading-none ${has ? "text-on-accent" : "text-muted"}`}>{d.free} free</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {selectedDay && (
        <div className="flex gap-2" role="group" aria-label={`Times on ${spokenDay(selectedDay.date)}`}>
          {WHEN_BLOCKS.map((b) => {
            const offered = selectedDay.blocks.find((x) => x.name === b.name);
            if (!offered) return null;
            const slot = { date: selectedDay.date, start: b.start, end: b.end };
            const on = picked(slot);
            return (
              <button
                key={b.name}
                type="button"
                aria-pressed={on}
                aria-label={`${b.label}, ${formatWindow(b)}, ${spokenDay(selectedDay.date)}`}
                disabled={disabled}
                onClick={() => toggle(slot)}
                className={`lw-chip h-auto min-h-11 flex-1 flex-col justify-center gap-0 px-2 py-1 leading-tight ${focusRing} ${on ? "is-on" : ""}`}
              >
                <span className="text-sm font-semibold">{b.label}</span>
                {on && <span className="lw-footnote">{formatWindow(b)}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
