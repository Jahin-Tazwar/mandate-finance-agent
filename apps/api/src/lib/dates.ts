/**
 * Date helpers for "YYYY-MM-DD" strings. Everything is UTC, so a date can never
 * shift by a day because of the computer's time zone.
 */
const DAY_MS = 86_400_000;

export const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const toMs = (date: string) => Date.parse(`${date}T00:00:00Z`);
const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const addDays = (date: string, days: number) => fromMs(toMs(date) + days * DAY_MS);

/** Whole days from `a` to `b` (positive if b is later). */
export const daysBetween = (a: string, b: string) => Math.round((toMs(b) - toMs(a)) / DAY_MS);

export const weekdayOf = (date: string) => new Date(toMs(date)).getUTCDay();
export const dayOfMonth = (date: string) => Number(date.slice(8, 10));
export const monthOf = (date: string) => date.slice(0, 7); // "2026-10"

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y!, m!, 0)).getUTCDate();
}

/** Same day-of-month `n` months later, clamped (Jan 31 + 1 month → Feb 28). */
export function addMonths(date: string, n: number, day = dayOfMonth(date)): string {
  const [y, m] = date.split("-").map(Number);
  const target = new Date(Date.UTC(y!, m! - 1 + n, 1));
  const month = target.toISOString().slice(0, 7);
  return `${month}-${String(Math.min(day, daysInMonth(month))).padStart(2, "0")}`;
}

/** "2026-11-01" → "Nov 1" */
export const shortDate = (date: string) => `${MONTH_NAMES[Number(date.slice(5, 7)) - 1]} ${dayOfMonth(date)}`;

/** "YYYY-MM" of the month before `month`. */
export const previousMonth = (month: string) => addMonths(`${month}-01`, -1).slice(0, 7);
