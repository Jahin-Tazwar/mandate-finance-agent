/**
 * Date helpers for "YYYY-MM-DD" strings. Everything is UTC, so a date can never
 * shift by a day because of the computer's time zone.
 */
const DAY_MS = 86_400_000;

export const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "2026-10-12" ⇄ milliseconds at midnight UTC (the "Z" means UTC)
const toMs = (date: string) => Date.parse(`${date}T00:00:00Z`);
const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** e.g. addDays("2026-10-30", 3) → "2026-11-02" */
export const addDays = (date: string, days: number) => fromMs(toMs(date) + days * DAY_MS);

/** Whole days from `a` to `b` (positive if b is later). */
export const daysBetween = (a: string, b: string) => Math.round((toMs(b) - toMs(a)) / DAY_MS);

/** 0 = Sunday … 5 = Friday … 6 = Saturday */
export const weekdayOf = (date: string) => new Date(toMs(date)).getUTCDay();
export const dayOfMonth = (date: string) => Number(date.slice(8, 10));
export const monthOf = (date: string) => date.slice(0, 7); // "2026-10"

/** e.g. "2026-02" → 28, "2026-10" → 31 */
export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  // Trick: "day 0" of the NEXT month is the last day of this month.
  // (JS months start at 0, so `m` here already points to the next month.)
  return new Date(Date.UTC(y!, m!, 0)).getUTCDate();
}

/** Same day-of-month `n` months later, clamped (Jan 31 + 1 month → Feb 28). */
export function addMonths(date: string, n: number, day = dayOfMonth(date)): string {
  // Move to the 1st of the target month (JS months start at 0), e.g. "2026-01-31" + 1 → "2026-02"
  const [y, m] = date.split("-").map(Number);
  const target = new Date(Date.UTC(y!, m! - 1 + n, 1));
  const month = target.toISOString().slice(0, 7);

  // Then the wanted day, but no later than that month's last day (31 → 28 in February)
  const clampedDay = Math.min(day, daysInMonth(month));
  return `${month}-${String(clampedDay).padStart(2, "0")}`;
}

/** "2026-11-01" → "Nov 1" */
export const shortDate = (date: string) => `${MONTH_NAMES[Number(date.slice(5, 7)) - 1]} ${dayOfMonth(date)}`;

/** "2027-04-09" → "Apr 9, 2027" (for dates that may be in another year) */
export const longDate = (date: string) => `${shortDate(date)}, ${date.slice(0, 4)}`;

/** The month before, e.g. "2026-01" → "2025-12" */
export const previousMonth = (month: string) => addMonths(`${month}-01`, -1).slice(0, 7);
