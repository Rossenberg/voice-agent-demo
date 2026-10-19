// Armenia is UTC+4 all year (no daylight saving).
export const TZ_OFFSET_MIN = 4 * 60;

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export class ToolError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

/** Current local date (YYYY-MM-DD) and minutes since midnight. */
export function localNow(nowMs = Date.now()): { date: string; minutes: number } {
  const d = new Date(nowMs + TZ_OFFSET_MIN * 60_000);
  return { date: d.toISOString().slice(0, 10), minutes: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

export function parseDate(s: unknown): Date | null {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + "T00:00:00Z");
  return isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : d;
}

export const addDays = (date: string, n: number) => new Date(Date.parse(date + "T00:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);

export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

export const weekdayOf = (date: string) => new Date(date + "T00:00:00Z").getUTCDay();

/** "Wednesday, 21 October 2026" */
export function spokenDate(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  return `${WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export const toHHMM = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

export function parseHHMM(s: unknown): number | null {
  if (typeof s !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const hh = Number(m[1]), mm = Number(m[2]);
  return hh < 24 && mm < 60 ? hh * 60 + mm : null;
}

/** Normalizes to +<digits>. Accepts Armenian local format 0XXXXXXXX. */
export function normalizePhone(s: unknown): string | null {
  if (typeof s !== "string") return null;
  let digits = s.replace(/[^\d+]/g, "");
  if (digits.startsWith("00")) digits = "+" + digits.slice(2);
  if (/^0\d{8}$/.test(digits)) digits = "+374" + digits.slice(1);
  if (/^374\d{8}$/.test(digits)) digits = "+" + digits;
  return /^\+\d{8,15}$/.test(digits) ? digits : null;
}

/** +37491234567 → +374 •• ••• 567 (dashboard is public). */
export function maskPhone(p: string): string {
  return p.length > 7 ? `${p.slice(0, 4)} •• ••• ${p.slice(-3)}` : "•••";
}

/** "Anna Karapetyan" → "Anna K." (dashboard is public). */
export function maskName(n: string | null): string | null {
  if (!n) return n;
  const [first, ...rest] = n.trim().split(/\s+/);
  return rest.length ? `${first} ${rest[rest.length - 1][0]}.` : first;
}

/** Deterministic 0..1 value from a string (FNV-1a). */
export function hash01(s: string): number {
  let x = 2166136261;
  for (let i = 0; i < s.length; i++) {
    x ^= s.charCodeAt(i);
    x = Math.imul(x, 16777619);
  }
  return (x >>> 0) / 4294967296;
}

export const cleanText = (s: unknown, max: number) => (typeof s === "string" ? s.trim().slice(0, max) : "");

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
