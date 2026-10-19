import type { Business } from "./businesses";
import { addDays, daysBetween, hash01, localNow, toHHMM, weekdayOf } from "./util";

const GRID_MIN = 30; // appointments start on :00 and :30
const MIN_NOTICE_MIN = 60; // no bookings starting within the next hour
export const MAX_DAYS_AHEAD = 60;

// To make the demo calendar look like a real, busy clinic, ~35% of the time
// is "already booked" by patients who aren't in our database. This is
// deterministic per business/date/time, so the same question always gets the
// same answer.
const SYNTHETIC_BUSY_RATE = 0.35;

export type ClosedReason = "closed_weekday" | "holiday" | "past" | "too_far";

export function closedReason(biz: Business, date: string): ClosedReason | null {
  const today = localNow().date;
  if (date < today) return "past";
  if (daysBetween(today, date) > MAX_DAYS_AHEAD) return "too_far";
  if (biz.holidays.includes(date.slice(5))) return "holiday";
  if (!biz.hours[weekdayOf(date)]) return "closed_weekday";
  return null;
}

function syntheticBusy(bizKey: string, date: string, cellStart: number): boolean {
  return hash01(`${bizKey}|${date}|${cellStart}`) < SYNTHETIC_BUSY_RATE;
}

/** Free start times (minutes since midnight) for a service on a date. */
export async function freeStarts(db: D1Database, bizKey: string, biz: Business, date: string, durationMin: number): Promise<number[]> {
  if (closedReason(biz, date)) return [];
  const [open, close] = biz.hours[weekdayOf(date)]!;

  const { results } = await db
    .prepare("SELECT start_min, end_min FROM bookings WHERE business = ? AND date = ? AND status = 'confirmed'")
    .bind(bizKey, date)
    .all<{ start_min: number; end_min: number }>();

  const now = localNow();
  const earliest = date === now.date ? now.minutes + MIN_NOTICE_MIN : 0;

  const starts: number[] = [];
  for (let s = open; s + durationMin <= close; s += GRID_MIN) {
    if (s < earliest) continue;
    const e = s + durationMin;
    let ok = true;
    for (let c = s; c < e && ok; c += GRID_MIN) {
      if (syntheticBusy(bizKey, date, c)) ok = false;
    }
    if (ok && results.filter((b) => b.start_min < e && b.end_min > s).length >= biz.chairs) ok = false;
    if (ok) starts.push(s);
  }
  return starts;
}

const PREFERENCE: Record<string, [number, number]> = {
  morning: [0, 12 * 60],
  afternoon: [12 * 60, 17 * 60],
  evening: [17 * 60, 24 * 60],
};

/** Up to `max` times, filtered by preference and spread across the day. */
export function pickTimes(starts: number[], preference: string | undefined, max = 6): string[] {
  const range = preference ? PREFERENCE[preference] : undefined;
  const filtered = range ? starts.filter((s) => s >= range[0] && s < range[1]) : starts;
  if (filtered.length <= max) return filtered.map(toHHMM);
  const step = filtered.length / max;
  return Array.from({ length: max }, (_, i) => toHHMM(filtered[Math.floor(i * step)]));
}

/** Next open dates (after `date`) that have free time for the service. */
export async function nextAvailableDates(db: D1Database, bizKey: string, biz: Business, date: string, durationMin: number, count = 3) {
  const out: { date: string; times: string[] }[] = [];
  for (let i = 1; i <= 14 && out.length < count; i++) {
    const d = addDays(date, i);
    const starts = await freeStarts(db, bizKey, biz, d, durationMin);
    if (starts.length) out.push({ date: d, times: pickTimes(starts, undefined, 3) });
  }
  return out;
}
