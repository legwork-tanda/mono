"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import {
  addDays,
  coverageAt,
  dayHasHours,
  formatWindow,
  nearestFittingWindow,
  railMinutes,
  railRow,
  railRows,
  rowsForDuration,
  sameSlot,
  sortSlots,
  tradeInfo,
  WHEN_DEFAULT_DURATION_HOURS,
  WHEN_STEP_MIN,
  WHEN_WINDOWS_MAX,
  windowHours,
  type CalendarDay,
  type TimeSlot,
  type WhenCalendar,
} from "@legwork/shared";
import { Icon, icons } from "./ui";

/** What the customer has picked: ASAP, or a set of windows. Switching to ASAP keeps the windows for switching back. */
export type WhenPick = { asap: boolean; slots: TimeSlot[] };

/** One half hour on the rail. A thumb has to land on it in the sun, so it's a real touch target. */
const ROW_PX = 44;
/** How many rows the rail shows at once: about three hours, with the question still on screen. */
const VIEW_ROWS = 6;
/** Two weeks a page keeps the month to two rows on a phone; the arrows move it on. */
const WEEKS_PER_PAGE = 2;
/** How long a press lasts before it becomes a drag, so a scroll never starts a selection. */
const HOLD_MS = 120;

const WEEKDAY_INITIALS = ["M", "T", "W", "T", "F", "S", "S"];
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
const dayOfMonth = (date: string) => Number(date.slice(8, 10));
const monthOf = (date: string) => MONTHS[Number(date.slice(5, 7)) - 1]!;
/** "Saturday 21 November", for screen readers. */
const spokenDay = (date: string) => `${WEEKDAY_NAMES[weekday(date)]} ${dayOfMonth(date)} ${monthOf(date)}`;
/** "Sat 21", for a chip. */
const shortDay = (date: string) => `${WEEKDAY_NAMES[weekday(date)]!.slice(0, 3)} ${dayOfMonth(date)}`;
/** "HH:MM" from minutes past midnight. */
const mmhh = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
/** "9:00", "11:30am" — the meridiem once, at the end, unless the window crosses noon. */
function clockText(fromMinutes: number, toMinutes: number) {
  const h12 = (m: number) => `${((Math.floor(m / 60) + 11) % 12) + 1}:${String(m % 60).padStart(2, "0")}`;
  const mer = (m: number) => (m < 720 ? "am" : "pm");
  return mer(fromMinutes) === mer(toMinutes) ? `${h12(fromMinutes)}–${h12(toMinutes)}${mer(toMinutes)}` : `${h12(fromMinutes)}${mer(fromMinutes)}–${h12(toMinutes)}${mer(toMinutes)}`;
}

/**
 * Minutes past midnight right now in the job's time zone, so today's rail can
 * start at the next half hour instead of offering the morning that has gone.
 */
function minutesNowIn(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-AU", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return (get("hour") % 24) * 60 + get("minute");
}

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-selected";
/** The rail's hatching: nobody on the clock in this half hour. */
const HATCH = "repeating-linear-gradient(135deg, transparent 0 5px, var(--lw-text-3) 5px 6px)";
/** A slot's start or end as minutes past midnight. */
const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

/** A day before today (shown faint, for orientation) or after the calendar ends. */
type Filler = { date: string; filler: true };
type Cell = CalendarDay | Filler;
const isFiller = (c: Cell): c is Filler => "filler" in c;

/** The calendar's weeks, Monday first, padded with filler days that can't be picked. */
function weeksOf(calendar: WhenCalendar): Cell[][] {
  const lead = (weekday(calendar.today) + 6) % 7;
  const cells: Cell[] = [
    ...Array.from({ length: lead }, (_, i) => ({ date: addDays(calendar.today, i - lead), filler: true as const })),
    ...calendar.days,
  ];
  const last = calendar.days.at(-1)?.date ?? calendar.today;
  for (let i = 1; cells.length % 7; i++) cells.push({ date: addDays(last, i), filler: true });
  const weeks: Cell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

type Notice = { text: string; offer?: TimeSlot | null };

/**
 * "When works for you?" (#65, amendment F): ASAP as its own tile, then the
 * month as the app already had it, and the day you tap drawn as a half-hour rail.
 *
 * Drag the rail to show when you're free, or tap a start and an end: both
 * produce the same window, the same chip and the same payload. Every half hour
 * is a focusable cell, arrow keys move, and space starts and ends a range.
 *
 * The rail is drawn in the tradies' working hours, not their bookings — we have
 * no capacity data, so solid means "somebody is on the clock", hatched means
 * nobody is, and dragging over hatched time is allowed and said plainly. A
 * window shorter than the job is refused with the reason and the nearest window
 * that fits, because a Pro cannot finish a day's work in two hours (#65, B).
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
  const duration = calendar.durationHours || WHEN_DEFAULT_DURATION_HOURS;
  const needRows = rowsForDuration(duration);
  const rows = railRows();
  const maxStartRow = rows - needRows;
  const nowMinutes = minutesNowIn(calendar.timeZone);
  const counted = calendar.asap.free !== null;

  const firstOpen = calendar.days.find(dayHasHours) ?? calendar.days[0]!;
  const initialDay = value.slots[0]?.date ?? firstOpen.date;
  const weeks = weeksOf(calendar);
  const pageOf = (date: string) => Math.max(0, Math.floor(Math.max(0, weeks.findIndex((w) => w.some((c) => c.date === date))) / WEEKS_PER_PAGE));
  const [day, setDay] = useState(initialDay);
  const [page, setPage] = useState(() => pageOf(initialDay));
  const [anchor, setAnchor] = useState<number | null>(null);
  const [live, setLive] = useState<{ from: number; to: number } | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [cursor, setCursor] = useState(0);

  const selected = calendar.days.find((d) => d.date === day) ?? firstOpen;
  const picked = value.slots.filter((s) => s.date === day);
  const pages = Math.max(1, Math.ceil(weeks.length / WEEKS_PER_PAGE));
  const shown = weeks.slice(page * WEEKS_PER_PAGE, (page + 1) * WEEKS_PER_PAGE);
  const firstShown = shown.flat().find((c) => !isFiller(c))?.date ?? calendar.today;

  // Only today's rail hides the half hours that have gone.
  const past = (row: number) => day === calendar.today && railMinutes(row + 1) <= nowMinutes;
  const lastPickable = (() => {
    if (day !== calendar.today) return rows - 1;
    let row = rows - 1;
    while (row >= 0 && past(row)) row--;
    return row;
  })();

  const rail = useRef<HTMLDivElement | null>(null);
  const rowEls = useRef(new Map<number, HTMLButtonElement>());
  const press = useRef<{ y: number; row: number; timer: number | null; dragging: boolean } | null>(null);
  /** Set only by the keyboard, so a re-render never pulls focus by itself. */
  const focusNext = useRef<number | null>(null);
  useEffect(() => {
    const row = focusNext.current;
    if (row === null) return;
    focusNext.current = null;
    rowEls.current.get(row)?.focus();
  });
  // A day opens at its first time you can still pick: 7am on Tuesday, 3pm today.
  useEffect(() => {
    const el = rail.current;
    if (!el) return;
    let first = 0;
    while (first < rows - 1 && day === calendar.today && railMinutes(first + 1) <= nowMinutes) first++;
    el.scrollTop = first * ROW_PX;
  }, [day, calendar.today, rows, nowMinutes]);

  /** The row under a pointer, from the rail's own box, scroll position included. */
  const rowAt = (clientY: number) => {
    const el = rail.current;
    if (!el) return -1;
    const box = el.getBoundingClientRect();
    const index = Math.floor((clientY - box.top + el.scrollTop) / ROW_PX);
    return Math.max(0, Math.min(rows - 1, index));
  };

  const add = (slot: TimeSlot) => {
    const slots = value.slots.some((s) => sameSlot(s, slot)) ? value.slots : sortSlots([...value.slots, slot]).slice(0, WHEN_WINDOWS_MAX);
    // Picking a window leaves ASAP; the windows themselves are never dropped by switching.
    onChange({ asap: false, slots });
  };

  /** A picked range, checked against the job's length before it becomes a chip. */
  const commit = (from: number, to: number) => {
    const a = Math.min(from, to);
    const b = Math.max(from, to) + 1;
    const start = railMinutes(a);
    const end = railMinutes(b);
    const window = { start: mmhh(start), end: mmhh(end) };
    const hours = (end - start) / 60;
    if (hours + 1e-9 < duration) {
      setNotice({
        text: `That's a ${hours === 1 ? "1-hour" : `${hours}-hour`} window for a job that takes ${durationText(duration)}.`,
        offer: nearestFittingWindow(day, window.start, duration),
      });
      return;
    }
    setNotice(null);
    add({ date: day, ...window });
  };

  /** A tap: the first one starts a range, the second one ends it. */
  const tap = (row: number) => {
    if (anchor === null) {
      setAnchor(row);
      setNotice(null);
      return;
    }
    setAnchor(null);
    commit(anchor, row);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button > 0) return;
    // The time labels are the scroll surface; the track is the drag surface.
    if ((e.target as HTMLElement).closest("[data-gutter]")) return;
    const row = rowAt(e.clientY);
    if (row < 0 || past(row)) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    press.current = {
      y: e.clientY,
      row,
      dragging: false,
      timer: window.setTimeout(() => {
        if (!press.current) return;
        press.current.dragging = true;
        setLive({ from: press.current.row, to: press.current.row });
      }, HOLD_MS),
    };
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (!p) return;
    if (!p.dragging) {
      // Moving before the hold is a scroll, not a selection.
      if (Math.abs(e.clientY - p.y) > 10 && p.timer) window.clearTimeout(p.timer);
      return;
    }
    setLive({ from: p.row, to: rowAt(e.clientY) });
  };

  const onPointerUp = () => {
    const p = press.current;
    if (!p) return;
    if (p.timer) window.clearTimeout(p.timer);
    press.current = null;
    if (p.dragging) {
      const to = live?.to ?? p.row;
      setLive(null);
      if (to !== p.row) commit(p.row, to);
      else tap(p.row);
      return;
    }
    tap(p.row);
  };

  const onRowKey = (e: KeyboardEvent<HTMLButtonElement>, row: number) => {
    const move = { ArrowDown: 1, ArrowUp: -1, PageDown: 5, PageUp: -5 }[e.key];
    if (move !== undefined) {
      e.preventDefault();
      const next = Math.max(0, Math.min(rows - 1, row + move));
      setCursor(next);
      focusNext.current = next;
      return;
    }
    if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      const next = e.key === "Home" ? 0 : rows - 1;
      setCursor(next);
      focusNext.current = next;
      return;
    }
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      if (past(row)) return;
      if (anchor === null) {
        setAnchor(row);
        setNotice({ text: "Start set. Move to the end and press space again." });
      } else {
        const from = anchor;
        setAnchor(null);
        commit(from, row);
      }
      return;
    }
    if (e.key === "Escape") {
      setAnchor(null);
      setLive(null);
      setNotice(null);
    }
  };

  // What the rail paints as committed: every picked window on this day, and the
  // range being dragged for as long as it lasts.
  const painted = new Set<number>();
  const bounds = (fromRow: number, toRow: number) => [Math.min(fromRow, toRow), Math.max(fromRow, toRow) + 1] as const;
  for (const slot of picked) {
    const [a, b] = bounds(railRow(minutesOf(slot.start)), railRow(minutesOf(slot.end)) - 1);
    for (let r = a; r < b; r++) painted.add(r);
  }
  const dragged = live ? bounds(live.from, live.to) : anchor !== null ? ([anchor, anchor + 1] as const) : null;

  const peak = Math.max(0, ...(selected.coverage ?? []).map((n) => n ?? 0));
  const firstLive = (selected.coverage ?? []).findIndex((n) => (n ?? 0) > 0);
  const worker = calendar.trade ? `${tradeInfo(calendar.trade).worker}s` : "people";
  const supplyLine =
    selected.coverage === null ? null : peak === 0 ? `Nobody's marked free ${spokenDay(selected.date)}` : `${peak} ${worker} work ${WEEKDAY_NAMES[weekday(selected.date)]}${firstLive >= 0 && railMinutes(firstLive) < 720 ? " mornings" : ""}`;

  const showDay = (date: string) => {
    setDay(date);
    setAnchor(null);
    setLive(null);
    setNotice(null);
    setCursor(0);
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
          <span className="lw-headline block">As soon as someone can get here</span>
          {!value.asap && (
            <span className="lw-caption block truncate text-muted">Or pick the times you're free below</span>
          )}
          {counted && calendar.asap.free! > 0 && (
            <span className="lw-footnote mt-1 block text-faint">
              {calendar.asap.free} {worker} ready now
            </span>
          )}
        </span>
        <span aria-hidden className={`lw-radio ${value.asap ? "is-on" : ""}`}>
          {value.asap && <Icon name={icons.check} className="size-3.5" />}
        </span>
      </button>

      <div className={`lw-glass transition-opacity ${value.asap ? "opacity-60" : ""}`}>
        {/* The month, two weeks a page, as the app already had it. Tapping a day opens its rail below. */}
        <div className="flex items-center justify-between px-3 pt-2">
          <p className="lw-headline text-[15px]" aria-live="polite">
            {monthOf(firstShown)}
            {monthOf(addDays(firstShown, 13)) !== monthOf(firstShown) && ` – ${monthOf(addDays(firstShown, 13))}`}
          </p>
          <div className="flex">
            <button
              type="button"
              aria-label="Earlier days"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className={`lw-icon-btn lw-press text-muted disabled:opacity-30 ${focusRing}`}
            >
              <Icon name="caret-left" className="size-5" />
            </button>
            <button
              type="button"
              aria-label="Later days"
              disabled={page >= pages - 1}
              onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
              className={`lw-icon-btn lw-press text-muted disabled:opacity-30 ${focusRing}`}
            >
              <Icon name="caret-right" className="size-5" />
            </button>
          </div>
        </div>
        <div className="grid grid-cols-7 px-2 text-center lw-footnote font-semibold text-faint" aria-hidden>
          {WEEKDAY_INITIALS.map((d, i) => (
            <span key={i}>{d}</span>
          ))}
        </div>
        <div role="grid" aria-label="Days with times somebody works. Arrow keys move between days." className="mt-0.5 grid grid-cols-7 gap-y-0.5 px-2 pb-2">
          {shown.map((week, w) => (
            <div key={w} role="row" className="contents">
              {week.map((c, i) => {
                if (isFiller(c)) {
                  return (
                    <span key={`filler-${w}-${i}`} role="gridcell" aria-hidden className="flex h-11 items-center justify-center text-[15px] text-faint/40 tabular-nums">
                      {dayOfMonth(c.date)}
                    </span>
                  );
                }
                const current = c.date === day;
                const hasPicked = value.slots.some((s) => s.date === c.date);
                const open = dayHasHours(c);
                return (
                  <button
                    key={c.date}
                    type="button"
                    role="gridcell"
                    aria-selected={current}
                    aria-label={`${spokenDay(c.date)}${open ? "" : ", nobody working"}${hasPicked ? ", has picked times" : ""}`}
                    onClick={() => {
                      if (!disabled) showDay(c.date);
                    }}
                    className={`lw-press mx-auto flex h-11 w-full max-w-12 flex-col items-center justify-center rounded-[11px] leading-none tabular-nums ${focusRing} ${
                      current ? "ring-2 ring-selected" : ""
                    } ${hasPicked ? "bg-accent text-on-accent" : open ? "" : "text-faint/60"}`}
                  >
                    <span className="text-[15px] font-semibold">{dayOfMonth(c.date)}</span>
                    <span aria-hidden className={`mt-1 size-1 rounded-full ${open ? "bg-current opacity-60" : "opacity-0"}`} />
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="flex items-baseline justify-between gap-2 px-3 pb-1 pt-2.5">
          <p className="lw-headline text-[15px]">{shortDay(selected.date)} {monthOf(selected.date).slice(0, 3)}</p>
          {supplyLine && <p className="lw-footnote text-right text-faint">{supplyLine}</p>}
        </div>

        <div
          ref={rail}
          className="relative border-t border-glass"
          style={{ maxHeight: ROW_PX * VIEW_ROWS, overflowY: "auto", overscrollBehavior: "contain" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          role="group"
          aria-label={`Half-hour times on ${spokenDay(selected.date)}`}
        >
          {Array.from({ length: rows }, (_, r) => {
            const start = railMinutes(r);
            const end = start + WHEN_STEP_MIN;
            const count = coverageAt(selected, start);
            const dead = count === 0;
            const gone = past(r);
            const inRange = dragged ? r >= dragged[0] && r < dragged[1] : false;
            const chosen = !dragged && painted.has(r);
            const edgeTop = (dragged && r === dragged[0]) || (chosen && !painted.has(r - 1));
            const edgeBottom = (dragged && r === dragged[1] - 1) || (chosen && !painted.has(r + 1));
            const spoken = `${spokenDay(selected.date)}, ${clockText(start, end)}${count === null ? "" : count === 0 ? ", nobody on" : `, ${count} working`}`;
            return (
              <div key={r} className="flex items-stretch">
                <span
                  data-gutter
                  aria-hidden
                  className="flex w-[52px] shrink-0 items-start justify-end pr-2 pt-1 text-[11px] tabular-nums text-faint"
                  style={{ touchAction: "pan-y" }}
                >
                  {clockText(start, end).split("–")[0]}
                </span>
                <button
                  ref={(el) => {
                    if (el) rowEls.current.set(r, el);
                    else rowEls.current.delete(r);
                  }}
                  type="button"
                  tabIndex={r === cursor ? 0 : -1}
                  disabled={disabled || gone}
                  aria-label={spoken}
                  aria-pressed={chosen}
                  onKeyDown={(e) => onRowKey(e, r)}
                  onFocus={() => setCursor(r)}
                  className={`relative my-px flex-1 touch-none rounded-[7px] ${focusRing} ${gone ? "opacity-30" : ""}`}
                  style={{
                    height: ROW_PX - 2,
                    touchAction: "none",
                    backgroundColor: dead ? "transparent" : "color-mix(in oklab, var(--lw-text) 7%, transparent)",
                    border: "1px solid color-mix(in oklab, var(--lw-glass-line) 60%, transparent)",
                    backgroundImage: dead ? HATCH : undefined,
                  }}
                >
                  {(chosen || inRange) && (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-x-0"
                      style={{
                        top: 0,
                        bottom: 0,
                        background: inRange ? "color-mix(in oklab, var(--lw-accent) 30%, transparent)" : "color-mix(in oklab, var(--lw-accent) 55%, transparent)",
                        borderRadius: `${edgeTop ? 7 : 0}px ${edgeTop ? 7 : 0}px ${edgeBottom ? 7 : 0}px ${edgeBottom ? 7 : 0}px`,
                        marginTop: edgeTop ? 0 : -1,
                        marginBottom: edgeBottom ? 0 : -1,
                      }}
                    />
                  )}
                </button>
              </div>
            );
          })}
        </div>

        <div className="space-y-1 px-3 pb-2 pt-1.5">
          {live ? (
            <p className="lw-subhead tabular-nums" aria-live="polite">
              {clockText(railMinutes(Math.min(live.from, live.to)), railMinutes(Math.max(live.from, live.to) + 1))}
            </p>
          ) : anchor !== null ? (
            <p className="lw-footnote text-muted" aria-live="polite">
              Tap where the window ends.
            </p>
          ) : (
            <p className="lw-footnote text-faint">The job takes about {durationText(duration)}, so windows start at that length.</p>
          )}

          {picked.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-0.5" aria-label={`Times picked on ${spokenDay(selected.date)}`}>
              {picked.map((slot) => (
                <button
                  key={`${slot.start}-${slot.end}`}
                  type="button"
                  disabled={disabled}
                  aria-label={`Remove ${shortDay(slot.date)} ${formatWindow(slot)}`}
                  onClick={() => {
                    setNotice(null);
                    onChange({ ...value, slots: value.slots.filter((s) => !sameSlot(s, slot)) });
                  }}
                  className={`lw-chip is-on min-h-9 gap-1.5 px-2.5 ${focusRing}`}
                >
                  {formatWindow(slot)}
                  <span aria-hidden className="text-[13px] leading-none opacity-70">
                    ×
                  </span>
                </button>
              ))}
            </div>
          )}

          {notice && (
            <div className="space-y-1" role="status">
              <p className="lw-footnote text-muted">{notice.text}</p>
              {notice.offer && (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    setNotice(null);
                    add(notice.offer!);
                  }}
                  className={`lw-chip min-h-9 px-2.5 ${focusRing}`}
                >
                  Use {formatWindow(notice.offer)}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {!value.asap && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => setNotice({ text: "Say it instead: “only free 9 to 11:30 on Tuesday”, and it comes back as a time you can remove." })}
          className={`lw-link self-center text-sm ${focusRing} disabled:opacity-40`}
        >
          Another time
        </button>
      )}
    </div>
  );
}

/** "2 hours", "half a day", "a day" — how long the job takes, in words. */
function durationText(hours: number) {
  if (hours >= 7) return hours >= 9 ? "a day" : "most of a day";
  if (hours >= 4) return "half a day";
  return `${hours} ${hours === 1 ? "hour" : "hours"}`;
}
