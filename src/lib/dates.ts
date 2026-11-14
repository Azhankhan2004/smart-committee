// All committee dates are plain calendar dates ("YYYY-MM-DD") in the
// committee's time zone. We do the maths in UTC to avoid DST surprises.

export function todayInTimeZone(timeZone: string, now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function toUTCDate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const d = toUTCDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toISODate(d);
}

/** Whole days from b to a (a - b). */
export function diffDays(a: string, b: string): number {
  return Math.round((toUTCDate(a).getTime() - toUTCDate(b).getTime()) / 86_400_000);
}

export function dayOfMonth(iso: string): number {
  return Number(iso.slice(8, 10));
}

export function periodOf(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

export function monthLabel(iso: string): string {
  return toUTCDate(iso).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function shortMonthLabel(iso: string): string {
  return toUTCDate(iso).toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return toUTCDate(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function formatDateTime(ts: string | null | undefined, timeZone = "Asia/Karachi"): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });
}
