import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DrawRow, MemberSummary, PaymentRow, ScheduleRow, Settings, Template } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyDB = SupabaseClient<any, any, any>;

const n = (v: unknown) => Number(v ?? 0);

function fail(what: string, error: { message: string } | null): never {
  throw new Error(`Could not load ${what}: ${error?.message ?? "unknown error"}`);
}

export async function getSettings(db: AnyDB, committeeId: string): Promise<Settings | null> {
  const { data, error } = await db.from("committee_settings").select("*").eq("committee_id", committeeId).maybeSingle();
  if (error) fail("settings", error);
  if (!data) return null;
  return { ...data, monthly_contribution: n(data.monthly_contribution), payout_amount: n(data.payout_amount) } as Settings;
}

export async function getSchedules(db: AnyDB, committeeId: string): Promise<ScheduleRow[]> {
  const { data, error } = await db.from("v_schedule").select("*").eq("committee_id", committeeId).order("month_number");
  if (error) fail("schedule", error);
  return (data ?? []).map((r) => ({
    ...r,
    contribution_amount: n(r.contribution_amount),
    payout_amount: n(r.payout_amount),
    expected_total: n(r.expected_total),
    collected_total: n(r.collected_total),
    member_count: n(r.member_count),
    paid_count: n(r.paid_count),
    partial_count: n(r.partial_count),
    unpaid_count: n(r.unpaid_count),
  })) as ScheduleRow[];
}

export async function getMembers(db: AnyDB, committeeId: string): Promise<MemberSummary[]> {
  const { data, error } = await db
    .from("v_member_summary")
    .select("*")
    .eq("committee_id", committeeId)
    .order("display_order")
    .order("slot_code");
  if (error) fail("members", error);
  return (data ?? []).map((r) => ({
    ...r,
    total_contributed: n(r.total_contributed),
    outstanding_to_date: n(r.outstanding_to_date),
  })) as MemberSummary[];
}

export async function getPayments(
  db: AnyDB,
  committeeId: string,
  filter: { scheduleId?: string; memberId?: string } = {},
): Promise<PaymentRow[]> {
  let q = db.from("v_payments").select("*").eq("committee_id", committeeId);
  if (filter.scheduleId) q = q.eq("schedule_id", filter.scheduleId);
  if (filter.memberId) q = q.eq("member_id", filter.memberId);
  const { data, error } = await q.order("month_number").order("slot_code").limit(5000);
  if (error) fail("payments", error);
  return (data ?? []).map((r) => ({
    ...r,
    required_amount: n(r.required_amount),
    amount_paid: n(r.amount_paid),
    balance: n(r.balance),
    days_overdue: n(r.days_overdue),
  })) as PaymentRow[];
}

export async function getTemplates(db: AnyDB, committeeId: string): Promise<Template[]> {
  const { data, error } = await db.from("notification_templates").select("*").eq("committee_id", committeeId).order("key");
  if (error) fail("templates", error);
  return (data ?? []) as Template[];
}

export async function getDraws(db: AnyDB, committeeId: string): Promise<DrawRow[]> {
  const { data, error } = await db
    .from("draws")
    .select("id, schedule_id, mode, candidate_slots, winner_slot, created_by_email, created_at")
    .eq("committee_id", committeeId)
    .order("created_at", { ascending: false });
  if (error) fail("draws", error);
  return (data ?? []) as DrawRow[];
}
