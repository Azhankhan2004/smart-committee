import "server-only";
import type { AnyDB } from "./data";
import { buildContext, buildMetaParams, renderTemplate, type MessageContext } from "./templates";
import type { NotificationLog, PaymentRow, ScheduleRow, Settings, Template } from "./types";
import { sendWhatsApp, type WhatsAppConfig, type WhatsAppPayload } from "./whatsapp";

export const MAX_ATTEMPTS = 3;

export type Recipient = { id: string; slot_code: string; full_name: string | null; phone_e164: string | null };

export type DispatchOutcome =
  | { status: "sent"; logId: string }
  | { status: "failed"; logId: string; error: string }
  | { status: "skipped"; error: string }
  | { status: "duplicate"; logId?: string }
  | { status: "not_configured" };

export function payloadFor(template: Template, phone: string, ctx: MessageContext, body: string, headerImageUrl?: string | null): WhatsAppPayload {
  if (template.meta_template_name) {
    return {
      kind: "template",
      to: phone,
      templateName: template.meta_template_name,
      languageCode: template.meta_language_code || "en",
      bodyParams: buildMetaParams(template.meta_body_params ?? [], ctx),
      headerImageUrl: template.meta_header_image ? headerImageUrl ?? null : null,
    };
  }
  // Free-form text only works inside WhatsApp's 24-hour customer-service window.
  return { kind: "text", to: phone, body };
}

/** Builds the placeholder values for one member and one committee month. */
export function contextFor(args: {
  settings: Settings;
  schedules: ScheduleRow[];
  scheduleId: string | null;
  member: Recipient;
  payment?: PaymentRow | null;
}): MessageContext {
  const idx = args.schedules.findIndex((s) => s.id === args.scheduleId);
  const schedule = idx >= 0 ? args.schedules[idx] : null;
  return buildContext({
    settings: args.settings,
    schedule,
    nextSchedule: idx >= 0 ? args.schedules[idx + 1] ?? null : null,
    member: args.member,
    payment: args.payment ?? null,
    totalMonths: args.schedules.length || args.settings.total_members,
  });
}

async function sendAndRecord(db: AnyDB, cfg: WhatsAppConfig, logId: string, payload: WhatsAppPayload, previousAttempts: number): Promise<DispatchOutcome> {
  const result = await sendWhatsApp(cfg, payload);
  const now = new Date().toISOString();
  const update = result.ok
    ? { status: "sent", provider_message_id: result.messageId, error_message: null, sent_at: now, attempts: previousAttempts + 1 }
    : { status: "failed", error_message: result.error.slice(0, 1000), attempts: previousAttempts + 1 };
  const { error } = await db.from("notification_logs").update(update).eq("id", logId);
  if (error) console.error("Failed to update notification log", logId, error.message);
  return result.ok ? { status: "sent", logId } : { status: "failed", logId, error: result.error };
}

/**
 * Sends one WhatsApp message through the Cloud API and records it.
 * Never reports success unless Meta returned a message id.
 */
export async function dispatchNotification(
  db: AnyDB,
  input: {
    cfg: WhatsAppConfig;
    committeeId: string;
    template: Template;
    member: Recipient;
    scheduleId: string | null;
    context: MessageContext;
    dedupeKey: string | null;
    triggeredBy: "admin" | "scheduler";
    actorId?: string | null;
    headerImageUrl?: string | null;
  },
): Promise<DispatchOutcome> {
  const { cfg, committeeId, template, member, scheduleId, context, dedupeKey, triggeredBy, actorId } = input;
  const body = renderTemplate(template.body, context);

  if (!member.phone_e164) {
    await db.from("notification_logs").insert({
      committee_id: committeeId,
      template_key: template.key,
      member_id: member.id,
      schedule_id: scheduleId,
      message_body: body,
      channel: "whatsapp_api",
      status: "skipped",
      error_message: "No WhatsApp number saved for this member.",
      triggered_by: triggeredBy,
      created_by: actorId ?? null,
    });
    return { status: "skipped", error: `Slot ${member.slot_code} has no WhatsApp number.` };
  }

  if (!cfg.configured) return { status: "not_configured" };

  const payload = payloadFor(template, member.phone_e164, context, body, input.headerImageUrl);
  const { data: inserted, error } = await db
    .from("notification_logs")
    .insert({
      committee_id: committeeId,
      template_key: template.key,
      member_id: member.id,
      schedule_id: scheduleId,
      recipient_phone: member.phone_e164,
      message_body: body,
      request_payload: payload,
      channel: "whatsapp_api",
      status: "queued",
      dedupe_key: dedupeKey,
      triggered_by: triggeredBy,
      created_by: actorId ?? null,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505" && dedupeKey) {
      // Already sent (or attempted). Retry automatically only if it failed earlier.
      const { data: existing } = await db
        .from("notification_logs")
        .select("id, status, attempts, request_payload")
        .eq("dedupe_key", dedupeKey)
        .maybeSingle();
      if (existing && existing.status === "failed" && existing.attempts < MAX_ATTEMPTS) {
        return sendAndRecord(db, cfg, existing.id, (existing.request_payload as WhatsAppPayload) ?? payload, existing.attempts);
      }
      return { status: "duplicate", logId: existing?.id };
    }
    return { status: "skipped", error: `Could not create the log entry: ${error.message}` };
  }

  return sendAndRecord(db, cfg, inserted.id, payload, 0);
}

/** Re-sends a failed API message using the exact payload stored in its log. */
export async function retryNotification(db: AnyDB, cfg: WhatsAppConfig, logId: string, committeeId: string): Promise<DispatchOutcome> {
  const { data: log, error } = await db
    .from("notification_logs")
    .select("*")
    .eq("id", logId)
    .eq("committee_id", committeeId)
    .single<NotificationLog>();
  if (error || !log) return { status: "skipped", error: "Log entry not found." };
  if (log.channel !== "whatsapp_api" || log.status !== "failed") {
    return { status: "skipped", error: "Only failed WhatsApp API messages can be retried." };
  }
  if (!log.request_payload) return { status: "skipped", error: "This log has no stored payload to retry." };
  if (!cfg.configured) return { status: "not_configured" };
  await db.from("notification_logs").update({ triggered_by: "retry" }).eq("id", logId);
  return sendAndRecord(db, cfg, logId, log.request_payload as WhatsAppPayload, log.attempts);
}

export type SendSummary = { sent: number; failed: number; skipped: number; duplicate: number; errors: string[] };

export function emptySummary(): SendSummary {
  return { sent: 0, failed: 0, skipped: 0, duplicate: 0, errors: [] };
}

export function tally(summary: SendSummary, outcome: DispatchOutcome, label: string) {
  switch (outcome.status) {
    case "sent":
      summary.sent++;
      break;
    case "failed":
      summary.failed++;
      summary.errors.push(`${label}: ${outcome.error}`);
      break;
    case "skipped":
      summary.skipped++;
      summary.errors.push(`${label}: ${outcome.error}`);
      break;
    case "duplicate":
      summary.duplicate++;
      break;
    case "not_configured":
      summary.skipped++;
      break;
  }
}
