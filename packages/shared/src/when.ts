// When the customer needs the job done: ASAP, or a real date with an optional
// window, in the customer's own time zone. The tier is only the price bucket;
// this is the deadline a tradie works to.
//
// The options for "How soon do you need it?" are generated from the clock in
// the customer's time zone, so the API and the web app agree on every label:
// the API offers them and resolves an answer back to a date and window.

import type { Tier } from "./trades";

/** A window on the job's day, local to its time zone, as 24-hour "HH:MM". */
export type TimeWindow = { start: string; end: string };

/** When the job is needed. */
export type JobWhen = {
  /** As soon as someone can get here. `date` is the day it was asked for. */
  asap: boolean;
  /** The day, YYYY-MM-DD in `timeZone`. */
  date: string;
  /** Null means any time that day. */
  window: TimeWindow | null;
  /** IANA time zone the date and window are in, e.g. "Australia/Brisbane". */
  timeZone: string;
};

/** One answer to "How soon do you need it?". */
export type WhenOption = Omit<JobWhen, "timeZone"> & { label: string };

/** What a client sends to set the time: ASAP, or a date with an optional window. */
export type WhenInput = { asap: true } | { asap?: false; date: string; window?: TimeWindow | null };

/** Used when the client didn't say where it is. Legwork launches in South East Queensland. */
export const DEFAULT_TIME_ZONE = "Australia/Brisbane";
export const ASAP_LABEL = "ASAP — as soon as someone can get here";
/** The furthest ahead a date can be picked, in days. */
export const WHEN_MAX_DAYS = 60;
/** A window for today is offered only if it starts at least this far ahead. */
const TODAY_LEAD_MIN = 60;
/** At most this many of today's windows are offered, so the list stays short. */
const TODAY_WINDOWS_SHOWN = 2;
/** Days after tomorrow offered as their own option ("Thu 3 Apr"). */
const LATER_DAYS_SHOWN = 3;

/** Two-hour windows offered for today, as [start hour, end hour]. */
const TODAY_WINDOWS: [number, number][] = [
  [8, 10],
  [10, 12],
  [12, 14],
  [14, 16],
  [16, 18],
  [18, 20],
];
/** A named part of the day: the blocks the "How soon?" calendar offers (#65). */
export type WhenBlock = "morning" | "afternoon" | "evening";

/**
 * The blocks of a day, in plain words, with the hours each one covers. The
 * same hours the correction prompt uses for "morning", "afternoon", "evening".
 */
export const WHEN_BLOCKS: readonly { name: WhenBlock; label: string; start: string; end: string }[] = [
  { name: "morning", label: "Morning", start: "08:00", end: "12:00" },
  { name: "afternoon", label: "Afternoon", start: "12:00", end: "17:00" },
  { name: "evening", label: "Evening", start: "17:00", end: "20:00" },
];
/** Named parts of the day offered for tomorrow in the older list of options (`whenOptions`). */
const NAMED_WINDOWS = WHEN_BLOCKS.slice(0, 2);

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-4]):([0-5]\d)$/;

const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (hour: number) => `${pad(hour)}:00`;

/** True for a time zone this runtime knows, e.g. "Australia/Sydney". */
export function isTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-AU", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Formatters by time zone: building one is far slower than using it, and the calendar uses many. */
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterFor(timeZone: string) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-AU", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** The calendar date and time of day at `ms` in `timeZone`. */
function zoned(ms: number, timeZone: string) {
  const parts = formatterFor(timeZone).formatToParts(ms);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return { date: `${get("year")}-${pad(get("month"))}-${pad(get("day"))}`, minutes: (get("hour") % 24) * 60 + get("minute") };
}

/** Today's date (YYYY-MM-DD) in `timeZone`. */
export const todayIn = (timeZone: string, nowMs: number) => zoned(nowMs, timeZone).date;

/** A real calendar date as YYYY-MM-DD, or null. */
function parseDate(value: string) {
  const m = DATE_RE.exec(value);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d ? date : null;
}

/** True for a real calendar date written as YYYY-MM-DD. */
export const isCalendarDate = (value: unknown): value is string => typeof value === "string" && parseDate(value) !== null;

/** `date` moved by `days`. */
export function addDays(date: string, days: number) {
  const d = parseDate(date)!;
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Whole days from `from` to `to` (both YYYY-MM-DD). */
export const daysBetween = (from: string, to: string) => Math.round((parseDate(to)!.getTime() - parseDate(from)!.getTime()) / 864e5);

const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

/** "8am", "12pm", "4:30pm". */
function clock(time: string, withSuffix: boolean) {
  const minutes = minutesOf(time);
  const h24 = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}${m ? `:${pad(m)}` : ""}${withSuffix ? (h24 < 12 ? "am" : "pm") : ""}`;
}

/** "4–6pm", "10am–12pm". */
export function formatWindow(window: TimeWindow) {
  const sameHalf = minutesOf(window.start) < 720 === minutesOf(window.end) <= 720 && minutesOf(window.end) !== 720;
  return `${clock(window.start, !sameHalf)}–${clock(window.end, true)}`;
}

/** "Thu 3 Apr". */
export function formatDay(date: string) {
  const d = parseDate(date)!;
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

const windowPart = (window: TimeWindow | null) => {
  if (!window) return "";
  const named = WHEN_BLOCKS.find((w) => w.start === window.start && w.end === window.end);
  return named ? named.name : formatWindow(window);
};

/**
 * How to say when, in a few words. With `nowMs`, relative to the customer's
 * today ("Today 4–6pm", "Tomorrow morning", "Thu 3 Apr"); without it, a fixed
 * date for anyone reading later ("Sat 21 Nov, 4–6pm", "ASAP, Sat 21 Nov").
 */
export function whenLabel(when: Omit<JobWhen, "timeZone"> & { timeZone?: string }, nowMs?: number): string {
  if (nowMs === undefined) {
    if (when.asap) return `ASAP, ${formatDay(when.date)}`;
    const part = windowPart(when.window);
    return part ? `${formatDay(when.date)}, ${part}` : formatDay(when.date);
  }
  if (when.asap) return "ASAP";
  const ahead = daysBetween(todayIn(when.timeZone ?? DEFAULT_TIME_ZONE, nowMs), when.date);
  const day = ahead === 0 ? "Today" : ahead === 1 ? "Tomorrow" : formatDay(when.date);
  const part = windowPart(when.window);
  return part ? `${day} ${part}` : day;
}

/**
 * The options for "How soon do you need it?" at `nowMs`, in order: ASAP, the
 * next of today's windows still ahead, tomorrow morning and afternoon, then
 * the next few days. A date picker covers anything else.
 */
export function whenOptions(nowMs: number, timeZone: string): WhenOption[] {
  const { date: today, minutes } = zoned(nowMs, timeZone);
  const option = (o: Omit<WhenOption, "label">): WhenOption => ({ ...o, label: o.asap ? ASAP_LABEL : whenLabel({ ...o, timeZone }, nowMs) });

  const options = [option({ asap: true, date: today, window: null })];
  TODAY_WINDOWS.filter(([start]) => start * 60 >= minutes + TODAY_LEAD_MIN)
    .slice(0, TODAY_WINDOWS_SHOWN)
    .forEach(([start, end]) => options.push(option({ asap: false, date: today, window: { start: hhmm(start), end: hhmm(end) } })));
  const tomorrow = addDays(today, 1);
  for (const w of NAMED_WINDOWS) options.push(option({ asap: false, date: tomorrow, window: { start: w.start, end: w.end } }));
  for (let i = 2; i < 2 + LATER_DAYS_SHOWN; i++) options.push(option({ asap: false, date: addDays(today, i), window: null }));
  return options;
}

/** The dates a picker may offer: today to WHEN_MAX_DAYS ahead. */
export function whenDateRange(nowMs: number, timeZone: string) {
  const today = todayIn(timeZone, nowMs);
  return { min: today, max: addDays(today, WHEN_MAX_DAYS) };
}

/**
 * The price bucket for a time. ASAP and anything today: High (same-day
 * callout). Tomorrow: Medium. Two or more days out: Low.
 */
export function tierForWhen(when: Pick<JobWhen, "asap" | "date" | "timeZone">, nowMs: number): Tier {
  if (when.asap) return "high";
  const ahead = daysBetween(todayIn(when.timeZone, nowMs), when.date);
  return ahead <= 0 ? "high" : ahead === 1 ? "medium" : "low";
}

/** A sensible time for a tier, when only the tier is known: ASAP, tomorrow, or later this week. */
export function whenForTier(tier: Tier, nowMs: number, timeZone: string): JobWhen {
  const today = todayIn(timeZone, nowMs);
  if (tier === "high") return { asap: true, date: today, window: null, timeZone };
  return { asap: false, date: addDays(today, tier === "medium" ? 1 : 3), window: null, timeZone };
}

/**
 * Checks a time the customer picked. ASAP is always fine. A date must be a
 * real day from today to WHEN_MAX_DAYS ahead; a window must be at least an
 * hour long, within the day, and not already over if it's today.
 */
export function checkWhen(input: unknown, nowMs: number, timeZone: string): { when: JobWhen } | { error: string } {
  if (!input || typeof input !== "object") return { error: "Pick when you need it." };
  const value = input as Record<string, unknown>;
  const { date: today, minutes } = zoned(nowMs, timeZone);
  if (value.asap === true) return { when: { asap: true, date: today, window: null, timeZone } };
  if (value.asap !== undefined && value.asap !== false) return { error: "Pick when you need it." };

  if (!isCalendarDate(value.date)) return { error: "That date doesn't look right." };
  const ahead = daysBetween(today, value.date);
  if (ahead < 0) return { error: "That date has passed. Pick another." };
  if (ahead > WHEN_MAX_DAYS) return { error: `Pick a date in the next ${WHEN_MAX_DAYS} days.` };

  const raw = value.window ?? null;
  if (raw === null) return { when: { asap: false, date: value.date, window: null, timeZone } };
  const w = raw as Record<string, unknown>;
  if (typeof raw !== "object" || typeof w.start !== "string" || typeof w.end !== "string" || !TIME_RE.test(w.start) || !TIME_RE.test(w.end)) {
    return { error: "That time window doesn't look right." };
  }
  const [start, end] = [minutesOf(w.start), minutesOf(w.end)];
  if (start >= 1440 || end > 1440 || end - start < 60) return { error: "A time window needs to be at least an hour within the day." };
  if (ahead === 0 && end <= minutes) return { error: "That time has passed. Pick another." };
  return { when: { asap: false, date: value.date, window: { start: w.start, end: w.end }, timeZone } };
}

/** The UTC instant of a local date and "HH:MM" time in `timeZone`. */
export function zonedTimeToUtc(date: string, time: string, timeZone: string): number {
  const d = parseDate(date)!;
  const target = d.getTime() + minutesOf(time) * 60_000;
  // Guess, see what local time that is, and correct by the difference (twice for DST edges).
  let guess = target;
  for (let i = 0; i < 2; i++) {
    const local = zoned(guess, timeZone);
    const shown = parseDate(local.date)!.getTime() + local.minutes * 60_000;
    guess += target - shown;
  }
  return guess;
}

/** When the job has to be started by: the end of its window, or the end of its day. */
export const whenDeadlineMs = (when: JobWhen) => zonedTimeToUtc(when.date, when.window?.end ?? "24:00", when.timeZone);

/**
 * The one line shown when danger moved the job to ASAP: the customer's own
 * answer first, then the reason. `said` is what they chose. Danger is the only
 * thing that forces a time (#54).
 */
export function whenOverrideMessage(said: JobWhen, nowMs: number): string {
  const label = whenLabel(said, nowMs);
  const saidText = /^(Today|Tomorrow)\b/.test(label) ? label.charAt(0).toLowerCase() + label.slice(1) : label;
  return `You said ${saidText} — we're treating this as ASAP because it could be dangerous.`;
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * The customer's date as they'd say it, for "… is fine" (#59): "Tomorrow",
 * "Friday" within the next six days, "Next week" for a day in the next
 * Monday-to-Sunday week, otherwise the date ("Thu 17 Dec").
 */
export function dateInWords(when: Pick<JobWhen, "asap" | "date" | "timeZone">, nowMs: number): string {
  const today = todayIn(when.timeZone, nowMs);
  const ahead = daysBetween(today, when.date);
  if (when.asap || ahead <= 0) return "Today";
  if (ahead === 1) return "Tomorrow";
  const weekday = parseDate(when.date)!.getUTCDay();
  if (ahead <= 6) return WEEKDAY_NAMES[weekday]!;
  // Monday of this week, then the next one.
  const sinceMonday = (parseDate(today)!.getUTCDay() + 6) % 7;
  const nextMonday = addDays(today, 7 - sinceMonday);
  if (when.date >= nextMonday && when.date < addDays(nextMonday, 7)) return "Next week";
  return formatDay(when.date);
}

// --- The calendar of blocks (#65) -------------------------------------------

/** How far ahead the "How soon?" calendar goes, in days from today (today included). */
export const WHEN_CALENDAR_DAYS = 28;
/** Most blocks a customer can offer for one job. */
export const WHEN_WINDOWS_MAX = 12;

/** One block the customer offered: a day and a window on it, local to the job's time zone. */
export type TimeSlot = { date: string; start: string; end: string };

/** A block on a calendar day that at least one eligible Pro is free for. */
export type CalendarBlock = {
  name: WhenBlock;
  start: string;
  end: string;
  /** How many eligible Pros are free then. Null when the count isn't backed by data (the trade isn't known yet). */
  free: number | null;
};

/** One day on the calendar. No blocks means nobody is free that day: show it, but it can't be picked. */
export type CalendarDay = {
  date: string;
  /** Eligible Pros free for at least one block that day, or null when not backed by data. */
  free: number | null;
  blocks: CalendarBlock[];
};

/**
 * The supply-shaped calendar for "How soon?" and the brief's When: today and
 * the next WHEN_CALENDAR_DAYS - 1 days, each with only the blocks somebody
 * eligible actually works. Never a past day, never Evening unless someone
 * works evenings.
 */
export type WhenCalendar = {
  timeZone: string;
  /** Today in `timeZone`: the first day of `days`. */
  today: string;
  /** ASAP is a mode, not a day. `free` counts eligible Pros available right now (null when not backed by data). */
  asap: { free: number | null };
  days: CalendarDay[];
};

/** The named block a slot is, or null if its hours aren't one of WHEN_BLOCKS. */
export const blockOf = (slot: Pick<TimeSlot, "start" | "end">) => WHEN_BLOCKS.find((b) => b.start === slot.start && b.end === slot.end) ?? null;

/** A slot as an answer string: "2026-11-24 morning". */
export function slotKey(slot: TimeSlot) {
  const block = blockOf(slot);
  return block ? `${slot.date} ${block.name}` : `${slot.date} ${slot.start}-${slot.end}`;
}

/** Reads "2026-11-24 morning" back into a slot. Null if it isn't one. */
export function parseSlotKey(key: unknown): TimeSlot | null {
  if (typeof key !== "string") return null;
  const m = /^(\d{4}-\d{2}-\d{2}) (morning|afternoon|evening)$/.exec(key.trim());
  if (!m || !isCalendarDate(m[1])) return null;
  const block = WHEN_BLOCKS.find((b) => b.name === m[2])!;
  return { date: m[1]!, start: block.start, end: block.end };
}

/** Earliest first: by day, then by start. */
export const sortSlots = (slots: TimeSlot[]) =>
  [...slots].sort((a, b) => (a.date === b.date ? minutesOf(a.start) - minutesOf(b.start) : a.date < b.date ? -1 : 1));

export const sameSlot = (a: TimeSlot, b: TimeSlot) => a.date === b.date && a.start === b.start && a.end === b.end;

/** A slot as the job's single time (the earliest block is what `required_date` and the window hold). */
export const slotWhen = (slot: TimeSlot, timeZone: string): JobWhen => ({
  asap: false,
  date: slot.date,
  window: { start: slot.start, end: slot.end },
  timeZone,
});

/** "Today", "Tomorrow", "Tue" within the week, otherwise "Tue 1 Dec". */
function shortDay(date: string, today: string) {
  const ahead = daysBetween(today, date);
  if (ahead === 0) return "Today";
  if (ahead === 1) return "Tomorrow";
  return ahead < 7 ? WEEKDAYS[parseDate(date)!.getUTCDay()]! : formatDay(date);
}

/**
 * The offered blocks in one line, earliest first: "Tue morning · Wed
 * afternoon", or "Tue morning, afternoon · Wed evening" for two on one day.
 */
export function slotsLabel(slots: TimeSlot[], nowMs: number, timeZone: string): string {
  const today = todayIn(timeZone, nowMs);
  const days: { date: string; parts: string[] }[] = [];
  for (const slot of sortSlots(slots)) {
    const part = windowPart({ start: slot.start, end: slot.end });
    const last = days.at(-1);
    if (last?.date === slot.date) last.parts.push(part);
    else days.push({ date: slot.date, parts: [part] });
  }
  return days.map((d) => `${shortDay(d.date, today)} ${d.parts.join(", ")}`).join(" · ");
}

/**
 * Checks a set of offered blocks against the calendar the customer was shown:
 * each a slot (or "YYYY-MM-DD morning"), on a day of the calendar, for a block
 * somebody is free for. Returns them earliest first, without repeats.
 */
export function checkSlots(input: unknown, calendar: WhenCalendar): { slots: TimeSlot[] } | { error: string } {
  if (!Array.isArray(input) || input.length === 0) return { error: "Pick at least one time." };
  if (input.length > WHEN_WINDOWS_MAX) return { error: `Pick up to ${WHEN_WINDOWS_MAX} times.` };
  const slots: TimeSlot[] = [];
  for (const raw of input) {
    const slot =
      typeof raw === "string"
        ? parseSlotKey(raw)
        : raw && typeof raw === "object" && typeof raw.date === "string" && typeof raw.start === "string" && typeof raw.end === "string"
          ? { date: raw.date as string, start: raw.start as string, end: raw.end as string }
          : null;
    if (!slot || !isCalendarDate(slot.date) || !blockOf(slot)) return { error: "That time doesn't look right." };
    if (slot.date < calendar.today) return { error: "That day has passed. Pick another." };
    const day = calendar.days.find((d) => d.date === slot.date);
    if (!day) return { error: `Pick a day in the next ${WHEN_CALENDAR_DAYS} days.` };
    if (!day.blocks.some((b) => b.start === slot.start && b.end === slot.end)) {
      return { error: day.blocks.length === 0 ? "No one's free that day. Pick another." : "No one's free then. Pick another time." };
    }
    if (!slots.some((s) => sameSlot(s, slot))) slots.push(slot);
  }
  return { slots: sortSlots(slots) };
}
