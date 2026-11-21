// Supply for "How soon?" (#65): which days and blocks at least one eligible Pro
// is free for, so the calendar never offers a time nobody can keep.
//
// There is no real per-day availability yet. What exists in D1 is each Pro's
// licence, service radius, whether they're available now, how soon they can
// start (`earliest_start_hours`) and a mock weekly timetable (`tradie_hours`,
// migration 0022, from data/build-tradie-hours.mjs). There are no bookings and
// no capacity, so a "free" count is just how many eligible Pros work then.

import {
  addDays,
  todayIn,
  railMinutes,
  railRows,
  WHEN_BLOCKS,
  WHEN_CALENDAR_DAYS,
  WHEN_DEFAULT_DURATION_HOURS,
  WHEN_STEP_MIN,
  zonedTimeToUtc,
  type CalendarDay,
  type TradeId,
  type WhenCalendar,
} from "@legwork/shared";
import { licenceGrants } from "./licences";

/** A Pro works a block only if their hours cover at least this much of it. */
export const BLOCK_MIN_OVERLAP_MIN = 120;
/** Today's block is offered only while at least this much of it is still ahead, after the lead time. */
export const TODAY_LEAD_MIN = 60;

export type WorkingHours = { weekday: number; start: string; end: string };

export type SupplyTradie = {
  id: string;
  licenceType: string | null;
  maxSeverity: number;
  availableNow: boolean;
  earliestStartHours: number;
  distanceKm: number;
  serviceRadiusKm: number;
  hours: WorkingHours[];
};

/**
 * What the job needs from a Pro. The trade is null while the questions are
 * still being answered and nobody has named it yet: then any Pro counts, and
 * the calendar shows no numbers. Severity is null until the write-up exists.
 */
export type SupplyNeed = { trade: TradeId | null; severity: number | null };

const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

/** The hard rules, the same as matching's gate (`ineligibleReasons`) minus the time. */
function eligible(t: SupplyTradie, need: SupplyNeed) {
  if (t.distanceKm > t.serviceRadiusKm) return false;
  if (need.trade ? !licenceGrants(t.licenceType, need.trade) : !t.licenceType) return false;
  return need.severity === null || need.severity <= t.maxSeverity;
}

/** The latest a Pro can turn up and still give the block an hour. */
const lastStartOf = (date: string, block: { end: string }, timeZone: string) => zonedTimeToUtc(date, block.end, timeZone) - TODAY_LEAD_MIN * 60_000;

/**
 * True when the Pro works this block on this day and can start in time for
 * it: an hour's lead, or their own earliest start if that's later.
 */
export function freeFor(t: SupplyTradie, date: string, block: { start: string; end: string }, nowMs: number, timeZone: string, lastStartMs = lastStartOf(date, block, timeZone)) {
  const hours = t.hours.find((h) => h.weekday === weekdayOf(date));
  if (!hours) return false;
  const overlap = Math.min(minutes(hours.end), minutes(block.end)) - Math.max(minutes(hours.start), minutes(block.start));
  if (overlap < BLOCK_MIN_OVERLAP_MIN) return false;
  return nowMs + Math.max(TODAY_LEAD_MIN * 60_000, t.earliestStartHours * 36e5) <= lastStartMs;
}

/**
 * True when the Pro's timetable covers this half hour whole. The rail asks
 * this, not `freeFor`: a half hour is a fact about the timetable, and there is
 * no capacity data to say anyone is actually free inside it.
 */
export function worksInterval(t: SupplyTradie, date: string, start: number, end: number) {
  const hours = t.hours.find((h) => h.weekday === weekdayOf(date));
  return Boolean(hours) && minutes(hours!.start) <= start && minutes(hours!.end) >= end;
}

/**
 * The calendar for a job: today and the next days, each with the blocks at
 * least one eligible Pro is free for, and the same day drawn as half hours for
 * the rail (#65, amendment F). A day nobody is free keeps its place with no
 * blocks, so the month view stays a month view.
 */
export function whenCalendar(
  tradies: SupplyTradie[],
  need: SupplyNeed,
  nowMs: number,
  timeZone: string,
  durationHours = WHEN_DEFAULT_DURATION_HOURS,
): WhenCalendar {
  const pool = tradies.filter((t) => eligible(t, need));
  const counted = need.trade !== null;
  const today = todayIn(timeZone, nowMs);
  const days: CalendarDay[] = [];
  const rows = railRows();
  for (let i = 0; i < WHEN_CALENDAR_DAYS; i++) {
    const date = addDays(today, i);
    const freeOnDay = new Set<string>();
    const blocks = WHEN_BLOCKS.flatMap((b) => {
      const lastStartMs = lastStartOf(date, b, timeZone);
      const free = pool.filter((t) => freeFor(t, date, b, nowMs, timeZone, lastStartMs));
      free.forEach((t) => freeOnDay.add(t.id));
      return free.length > 0 ? [{ name: b.name, start: b.start, end: b.end, free: counted ? free.length : null }] : [];
    });
    // The rail's texture: who is on the clock in each half hour, not who is free.
    // No trade named yet means no numbers, rather than an invented flat line.
    const coverage = counted
      ? Array.from({ length: rows }, (_, r) => {
          const start = railMinutes(r);
          const end = start + WHEN_STEP_MIN;
          return pool.filter((t) => worksInterval(t, date, start, end)).length;
        })
      : null;
    days.push({ date, free: counted && blocks.length > 0 ? freeOnDay.size : null, blocks, coverage });
  }
  const now = pool.filter((t) => t.availableNow).length;
  return { timeZone, today, asap: { free: counted ? now : null }, days, durationHours, trade: need.trade };
}

type TradieSupplyRow = {
  id: string;
  licence_type: string | null;
  max_severity: number;
  available_now: number;
  earliest_start_hours: number;
  distance_km: number;
  service_radius_km: number;
};
type HoursRow = { tradie_id: string; weekday: number; start: string; end: string };

/** Every Pro with their timetable. A Pro with no hours stored is never free on the calendar. */
export async function loadSupply(db: D1Database): Promise<SupplyTradie[]> {
  const [tradies, hours] = await Promise.all([
    db
      .prepare("SELECT id, licence_type, max_severity, available_now, earliest_start_hours, distance_km, service_radius_km FROM tradies")
      .all<TradieSupplyRow>(),
    db.prepare("SELECT tradie_id, weekday, start, end FROM tradie_hours").all<HoursRow>(),
  ]);
  return tradies.results.map((t) => ({
    id: t.id,
    licenceType: t.licence_type,
    maxSeverity: t.max_severity,
    availableNow: !!t.available_now,
    earliestStartHours: t.earliest_start_hours,
    distanceKm: t.distance_km,
    serviceRadiusKm: t.service_radius_km,
    hours: hours.results.filter((h) => h.tradie_id === t.id).map((h) => ({ weekday: h.weekday, start: h.start, end: h.end })),
  }));
}
