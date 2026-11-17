export const TEMPLATE_KEYS = [
  "monthly_reminder",
  "winner_announcement",
  "payment_due",
  "payment_overdue",
  "payment_received",
  "new_month_update",
  "winner_personal",
] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export type PaymentStatus = "pending" | "partially_paid" | "paid";
export type EffectiveStatus = PaymentStatus | "overdue";
export type Phase = "past" | "current" | "upcoming";

export type Settings = {
  committee_id: string;
  committee_name: string;
  currency: string;
  total_members: number;
  monthly_contribution: number;
  payout_amount: number;
  start_month: string;
  timezone: string;
  payment_due_day: number;
  reminder_days_before: number;
  remind_on_due_date: boolean;
  overdue_reminder_every_days: number;
  monthly_reminder_day: number;
  monthly_update_day: number;
  winner_announcement_day: number;
  auto_send_enabled: boolean;
  auto_announce_winner: boolean;
  winner_selection: "sequence" | "lucky_draw";
  updated_at: string;
};

export type Committee = { id: string; slug: string; public_enabled: boolean; name: string; logo: string | null; role: "owner" | "admin" };

export type DrawRow = {
  id: string;
  schedule_id: string;
  mode: "manual" | "auto" | "scheduler";
  candidate_slots: string[];
  winner_slot: string;
  created_by_email: string | null;
  created_at: string;
};

export type Member = {
  id: string;
  slot_code: string;
  display_order: number;
  full_name: string | null;
  phone_e164: string | null;
  joined_month: string;
  is_active: boolean;
  notes: string | null;
  deactivated_at: string | null;
  created_at: string;
  updated_at: string;
};

export type MemberSummary = Member & {
  winner_schedule_id: string | null;
  winner_month_number: number | null;
  winner_period_month: string | null;
  has_won: boolean;
  total_contributed: number;
  outstanding_to_date: number;
  current_status: EffectiveStatus | null;
};

export type ScheduleRow = {
  id: string;
  month_number: number;
  period_month: string;
  due_date: string;
  contribution_amount: number;
  payout_amount: number;
  winner_member_id: string | null;
  winner_slot: string | null;
  winner_name: string | null;
  announcement_id: string | null;
  announced_at: string | null;
  announced_by_email: string | null;
  is_announced: boolean;
  phase: Phase;
  expected_total: number;
  collected_total: number;
  member_count: number;
  paid_count: number;
  partial_count: number;
  unpaid_count: number;
  /** Set when the month is reserved for financial support instead of a draw. */
  reserve_status: "reserved" | "given" | null;
  reserve_given_type: "payout" | "help" | null;
  reserve_member_slot: string | null;
  reserve_reason: string | null;
  reserve_given_note: string | null;
  reserved_at: string | null;
  reserve_given_at: string | null;
};

export type PaymentRow = {
  id: string;
  schedule_id: string;
  member_id: string;
  required_amount: number;
  amount_paid: number;
  status: PaymentStatus;
  payment_date: string | null;
  payment_method: string | null;
  transaction_ref: string | null;
  remarks: string | null;
  confirmed_by_email: string | null;
  confirmed_at: string | null;
  slot_code: string;
  full_name: string | null;
  phone_e164: string | null;
  member_active: boolean;
  month_number: number;
  period_month: string;
  due_date: string;
  balance: number;
  is_overdue: boolean;
  effective_status: EffectiveStatus;
  days_overdue: number;
};

export type WinnerRow = {
  id: string;
  schedule_id: string;
  member_id: string;
  payout_amount: number;
  status: "announced" | "voided";
  announced_at: string;
  announced_by_email: string | null;
  notes: string | null;
  voided_at: string | null;
  void_reason: string | null;
};

export type Template = {
  id: string;
  key: TemplateKey;
  name: string;
  description: string | null;
  body: string;
  meta_template_name: string | null;
  meta_language_code: string;
  meta_body_params: string[];
  meta_header_image: boolean;
  is_active: boolean;
  updated_at: string;
};

export type LogStatus = "queued" | "sent" | "delivered" | "read" | "failed" | "skipped" | "manual_opened";

export type NotificationLog = {
  id: string;
  template_key: TemplateKey;
  member_id: string | null;
  schedule_id: string | null;
  recipient_phone: string | null;
  message_body: string;
  request_payload: unknown;
  channel: "whatsapp_api" | "manual_link";
  status: LogStatus;
  provider_message_id: string | null;
  error_message: string | null;
  attempts: number;
  dedupe_key: string | null;
  triggered_by: "admin" | "scheduler" | "retry";
  created_at: string;
  sent_at: string | null;
};

export type AuditLog = {
  id: number;
  occurred_at: string;
  actor_email: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  summary: string | null;
  reason: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
};

export type ActionResult<T = undefined> = { ok: true; message?: string; data?: T } | { ok: false; error: string };
