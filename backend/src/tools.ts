import { BUSINESSES, type Business } from "./businesses";
import { closedReason, freeStarts, MAX_DAYS_AHEAD, nextAvailableDates, pickTimes } from "./availability";
import { recordCallEvent } from "./calls";
import { addDays, cleanText, localNow, normalizePhone, parseDate, parseHHMM, spokenDate, toHHMM, ToolError, weekdayOf } from "./util";

export interface ToolContext {
  db: D1Database;
  bizKey: string;
  platform: string;
}

type Args = Record<string, unknown>;

function getBusiness(key: string): Business {
  const biz = BUSINESSES[key];
  if (!biz) throw new ToolError("unknown_business", `Unknown business '${key}'.`);
  return biz;
}

function getService(biz: Business, id: unknown) {
  const service = typeof id === "string" ? biz.services[id] : undefined;
  if (!service) {
    throw new ToolError("unknown_service", `Unknown service_id. Valid values: ${Object.keys(biz.services).join(", ")}.`);
  }
  return { id: id as string, ...service };
}

function getDate(value: unknown): string {
  if (!parseDate(value)) throw new ToolError("invalid_date", "date must be YYYY-MM-DD.");
  return value as string;
}

const CLOSED_MESSAGES = {
  closed_weekday: "The clinic is closed on this day of the week.",
  holiday: "The clinic is closed on this date (public holiday).",
  past: "This date is in the past.",
  too_far: `Bookings can only be made up to ${MAX_DAYS_AHEAD} days ahead.`,
};

export async function checkAvailability(ctx: ToolContext, args: Args) {
  const biz = getBusiness(ctx.bizKey);
  const service = getService(biz, args.service_id);
  const date = getDate(args.date);
  const preference = typeof args.time_preference === "string" && args.time_preference !== "any" ? args.time_preference : undefined;

  const base = {
    today: localNow().date,
    date,
    date_spoken: spokenDate(date),
    service: { id: service.id, name: service.name, duration_min: service.durationMin },
  };

  const closed = closedReason(biz, date);
  if (closed) {
    if (closed === "too_far") return { ...base, open: false, reason: CLOSED_MESSAGES.too_far, available_times: [], alternatives: [] };
    const from = closed === "past" ? localNow().date : date;
    const alternatives = await nextAvailableDates(ctx.db, ctx.bizKey, biz, closed === "past" ? addDays(from, -1) : from, service.durationMin);
    return { ...base, open: false, reason: CLOSED_MESSAGES[closed], available_times: [], alternatives: withSpoken(alternatives) };
  }

  const starts = await freeStarts(ctx.db, ctx.bizKey, biz, date, service.durationMin);
  const times = pickTimes(starts, preference);
  const [open, close] = biz.hours[weekdayOf(date)]!;
  const result = {
    ...base,
    open: true,
    opening_hours: `${toHHMM(open)}-${toHHMM(close)}`,
    available_times: times,
    note: undefined as string | undefined,
    alternatives: [] as ReturnType<typeof withSpoken>,
  };
  if (!times.length) {
    if (starts.length) {
      // Free time exists, just not in the preferred part of the day.
      result.note = `No free times in the ${preference}. Other free times that day are listed in other_times_that_day.`;
      return { ...result, other_times_that_day: pickTimes(starts, undefined) };
    }
    result.note = "Fully booked on this date. Offer the alternatives.";
    result.alternatives = withSpoken(await nextAvailableDates(ctx.db, ctx.bizKey, biz, date, service.durationMin));
  }
  return result;
}

const withSpoken = (alts: { date: string; times: string[] }[]) => alts.map((a) => ({ ...a, date_spoken: spokenDate(a.date) }));

export async function createBooking(ctx: ToolContext, args: Args) {
  const biz = getBusiness(ctx.bizKey);
  const service = getService(biz, args.service_id);
  const date = getDate(args.date);
  const start = parseHHMM(args.time);
  if (start === null) throw new ToolError("invalid_time", "time must be HH:MM (24h).");
  const name = cleanText(args.patient_name, 80);
  if (!name) throw new ToolError("missing_name", "patient_name is required.");
  const phone = normalizePhone(args.phone);
  if (!phone) throw new ToolError("invalid_phone", "phone is not a valid number. Ask the patient to repeat it.");
  const notes = cleanText(args.notes, 300) || null;
  const conversationId = cleanText(args.conversation_id, 120) || null;

  const free = await freeStarts(ctx.db, ctx.bizKey, biz, date, service.durationMin);
  if (!free.includes(start)) {
    throw new ToolError("slot_taken", "This time is not available (just booked or outside opening hours). Call check_availability again and offer new times.");
  }

  // Insert only if the chairs are still free (guards against two calls booking the same slot at once).
  const end = start + service.durationMin;
  const row = await ctx.db
    .prepare(
      `INSERT INTO bookings (business, platform, service_id, patient_name, phone, date, start_min, end_min, notes, conversation_id)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10
       WHERE (SELECT COUNT(*) FROM bookings
              WHERE business = ?1 AND date = ?6 AND status = 'confirmed' AND start_min < ?8 AND end_min > ?7) < ?11
       RETURNING id`,
    )
    .bind(ctx.bizKey, ctx.platform, service.id, name, phone, date, start, end, notes, conversationId, biz.chairs)
    .first<{ id: number }>();
  if (!row) throw new ToolError("slot_taken", "This time was just booked. Call check_availability again and offer new times.");

  if (conversationId) await recordCallEvent(ctx.db, conversationId, ctx.bizKey, ctx.platform, "booked");

  const bookingId = `${biz.bookingPrefix}-${1000 + row.id}`;
  return {
    success: true,
    booking_id: bookingId,
    booking_id_spoken: bookingId.replace("-", "").split("").join(" "), // "S D 1 0 4 2"
    summary: `${service.name}, ${spokenDate(date)} at ${toHHMM(start)}`,
  };
}

const TRANSFER_REASONS = ["patient_request", "angry_patient", "complex_question", "emergency", "reschedule_or_cancel", "system_error", "other"];

export async function transferToHuman(ctx: ToolContext, args: Args) {
  const biz = getBusiness(ctx.bizKey);
  const reason = typeof args.reason === "string" && TRANSFER_REASONS.includes(args.reason) ? args.reason : "other";
  const summary = cleanText(args.summary, 600) || "(no summary)";
  const phone = normalizePhone(args.phone);
  if (!phone) throw new ToolError("invalid_phone", "A valid callback phone number is required. Ask the patient for it and confirm it.");
  const name = cleanText(args.patient_name, 80) || null;
  const conversationId = cleanText(args.conversation_id, 120) || null;

  const row = await ctx.db
    .prepare(
      `INSERT INTO callbacks (business, platform, reason, summary, patient_name, phone, conversation_id)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .bind(ctx.bizKey, ctx.platform, reason, summary, name, phone, conversationId)
    .first<{ id: number }>();

  if (conversationId) await recordCallEvent(ctx.db, conversationId, ctx.bizKey, ctx.platform, "transferred");

  return {
    success: true,
    ticket_id: `${biz.callbackPrefix}-${100 + row!.id}`,
    message: "The administrator will call back within 15 minutes during opening hours.",
  };
}

export const TOOLS: Record<string, (ctx: ToolContext, args: Args) => Promise<unknown>> = {
  check_availability: checkAvailability,
  create_booking: createBooking,
  transfer_to_human: transferToHuman,
};
