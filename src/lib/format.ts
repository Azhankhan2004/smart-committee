export function formatMoney(amount: number | null | undefined, currency = "PKR"): string {
  const n = Number(amount ?? 0);
  return `${currency} ${new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 }).format(n)}`;
}

export function percent(part: number, total: number): number {
  if (!total) return 0;
  return Math.min(100, Math.round((part / total) * 100));
}

export function memberLabel(m: { slot_code: string; full_name?: string | null }): string {
  return m.full_name ? `Slot ${m.slot_code} · ${m.full_name}` : `Slot ${m.slot_code}`;
}

export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export const PAYMENT_METHODS = [
  { value: "cash", label: "Cash" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "easypaisa", label: "Easypaisa" },
  { value: "jazzcash", label: "JazzCash" },
  { value: "raast", label: "Raast" },
  { value: "other", label: "Other" },
] as const;

export function methodLabel(value: string | null | undefined): string {
  return PAYMENT_METHODS.find((m) => m.value === value)?.label ?? "—";
}

/** Turns a Postgres/Supabase error into a sentence a family member can understand. */
export function friendlyError(err: unknown): string {
  const msg =
    typeof err === "object" && err && "message" in err ? String((err as { message: unknown }).message) : String(err);
  if (msg.includes("members_slot_code_key") || msg.includes("members_committee_slot_key")) return "That slot code is already used by another member.";
  if (msg.includes("members_phone_e164_check")) return "The WhatsApp number is not in a valid international format.";
  if (msg.includes("members_slot_code_check")) return "Slot code must be letters (A–Z), optionally followed by a number.";
  if (msg.includes("winners_one_per_month_idx")) return "A winner has already been announced for this month.";
  if (msg.includes("winners_member_once_idx")) return "This member has already won in another month.";
  if (msg.includes("monthly_schedules_winner_key")) return "Each member can be assigned to only one month.";
  if (msg.includes("JWT") || msg.includes("not authorized") || msg.includes("permission denied"))
    return "You are not authorized to do this. Please sign in again.";
  return msg || "Something went wrong.";
}
