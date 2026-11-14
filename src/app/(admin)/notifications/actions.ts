"use server";
import { revalidatePath } from "next/cache";
import { adminForAction } from "@/lib/auth";
import { getMembers, getPayments, getSchedules, getSettings, getTemplates } from "@/lib/data";
import { todayInTimeZone } from "@/lib/dates";
import { friendlyError } from "@/lib/format";
import { contextFor, dispatchNotification, emptySummary, retryNotification, tally, type SendSummary } from "@/lib/notifications";
import { waLink } from "@/lib/phone";
import { dedupeKeyFor, renderTemplate, TEMPLATE_LABELS, unknownPlaceholders } from "@/lib/templates";
import { TEMPLATE_KEYS, type ActionResult, type TemplateKey } from "@/lib/types";
import { whatsappConfig } from "@/lib/whatsapp";

export type Audience = "all" | "unpaid" | "one";

export type PreviewItem = {
  memberId: string;
  slot: string;
  name: string | null;
  phone: string | null;
  body: string;
  waUrl: string;
  alreadySent: boolean;
  lastStatus: string | null;
};

type Req = { templateKey: TemplateKey; scheduleId: string; audience: Audience; memberId?: string };

async function resolve(req: Req) {
  const ctx = await adminForAction();
  if (!TEMPLATE_KEYS.includes(req.templateKey)) throw new Error("Unknown notification type.");
  const [settings, schedules, members, templates, payments] = await Promise.all([
    getSettings(ctx.db),
    getSchedules(ctx.db),
    getMembers(ctx.db),
    getTemplates(ctx.db),
    getPayments(ctx.db, { scheduleId: req.scheduleId }),
  ]);
  if (!settings) throw new Error("Settings missing.");
  const template = templates.find((t) => t.key === req.templateKey);
  if (!template) throw new Error("Template not found.");
  if (!schedules.some((s) => s.id === req.scheduleId)) throw new Error("Please choose a committee month.");

  const active = members.filter((m) => m.is_active);
  const payFor = (memberId: string) => payments.find((p) => p.member_id === memberId) ?? null;
  let recipients = active;
  if (req.audience === "unpaid") recipients = active.filter((m) => (payFor(m.id)?.status ?? "pending") !== "paid");
  if (req.audience === "one") recipients = active.filter((m) => m.id === req.memberId);
  if (req.templateKey === "payment_received") recipients = recipients.filter((m) => (payFor(m.id)?.amount_paid ?? 0) > 0);

  const today = todayInTimeZone(settings.timezone);
  const items = recipients.map((m) => {
    const payment = payFor(m.id);
    const context = contextFor({ settings, schedules, scheduleId: req.scheduleId, member: m, payment });
    const dedupeKey = dedupeKeyFor(req.templateKey, {
      scheduleId: req.scheduleId,
      memberId: m.id,
      today,
      paymentId: payment?.id,
      amountPaid: payment?.amount_paid,
    });
    return { member: m, payment, context, dedupeKey, body: renderTemplate(template.body, context) };
  });
  return { ctx, settings, template, items };
}

export async function buildPreview(req: Req): Promise<ActionResult<{ items: PreviewItem[]; apiConfigured: boolean; templateActive: boolean }>> {
  try {
    const { ctx, template, items } = await resolve(req);
    const keys = items.map((i) => i.dedupeKey);
    const { data: existing } = keys.length
      ? await ctx.db.from("notification_logs").select("dedupe_key, status").in("dedupe_key", keys)
      : { data: [] as { dedupe_key: string; status: string }[] };
    const { data: manual } = await ctx.db
      .from("notification_logs")
      .select("member_id")
      .eq("template_key", req.templateKey)
      .eq("schedule_id", req.scheduleId)
      .eq("status", "manual_opened");
    const statusByKey = new Map((existing ?? []).map((e) => [e.dedupe_key, e.status]));
    const manualSet = new Set((manual ?? []).map((m) => m.member_id));

    return {
      ok: true,
      data: {
        apiConfigured: whatsappConfig().configured,
        templateActive: template.is_active,
        items: items.map((i) => {
          const st = statusByKey.get(i.dedupeKey) ?? null;
          return {
            memberId: i.member.id,
            slot: i.member.slot_code,
            name: i.member.full_name,
            phone: i.member.phone_e164,
            body: i.body,
            waUrl: waLink(i.member.phone_e164, i.body),
            alreadySent: (st !== null && st !== "failed") || manualSet.has(i.member.id),
            lastStatus: st ?? (manualSet.has(i.member.id) ? "manual_opened" : null),
          };
        }),
      },
    };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}

export async function sendNotifications(req: Req & { resend: boolean }): Promise<ActionResult<SendSummary>> {
  try {
    if (!whatsappConfig().configured) return { ok: false, error: "The WhatsApp Cloud API is not configured. Use the manual WhatsApp buttons instead." };
    const { ctx, template, items } = await resolve(req);
    if (!template.is_active) return { ok: false, error: "This template is switched off. Turn it on under Templates first." };
    const summary = emptySummary();
    // Members already reached by a manual WhatsApp share count as "already sent" too.
    const manualSet = new Set<string>();
    if (!req.resend) {
      const { data: manual } = await ctx.db
        .from("notification_logs")
        .select("member_id")
        .eq("template_key", req.templateKey)
        .eq("schedule_id", req.scheduleId)
        .eq("status", "manual_opened");
      (manual ?? []).forEach((m) => manualSet.add(m.member_id));
    }
    for (const i of items) {
      if (manualSet.has(i.member.id)) {
        summary.duplicate++;
        continue;
      }
      const outcome = await dispatchNotification(ctx.db, {
        template,
        member: i.member,
        scheduleId: req.scheduleId,
        context: i.context,
        dedupeKey: req.resend ? `${i.dedupeKey}:resend:${Date.now()}` : i.dedupeKey,
        triggeredBy: "admin",
        actorId: ctx.userId,
      });
      tally(summary, outcome, `Slot ${i.member.slot_code}`);
    }
    revalidatePath("/notifications", "layout");
    return { ok: true, data: summary };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}

export async function logManualShare(input: { templateKey: TemplateKey; memberId: string; scheduleId: string | null; body: string; phone: string | null }): Promise<ActionResult> {
  try {
    const { db, userId } = await adminForAction();
    const { error } = await db.from("notification_logs").insert({
      template_key: input.templateKey,
      member_id: input.memberId,
      schedule_id: input.scheduleId,
      recipient_phone: input.phone,
      message_body: input.body.slice(0, 4000),
      channel: "manual_link",
      status: "manual_opened",
      triggered_by: "admin",
      created_by: userId,
    });
    if (error) return { ok: false, error: friendlyError(error) };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}

export async function retryLog(logId: string): Promise<ActionResult> {
  try {
    const { db } = await adminForAction();
    const outcome = await retryNotification(db, logId);
    revalidatePath("/notifications/logs");
    if (outcome.status === "sent") return { ok: true, message: "Message sent." };
    if (outcome.status === "not_configured") return { ok: false, error: "WhatsApp Cloud API is not configured." };
    return { ok: false, error: "error" in outcome ? outcome.error : "Retry failed." };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}

export async function retryAllFailed(): Promise<ActionResult<SendSummary>> {
  try {
    const { db } = await adminForAction();
    const { data } = await db.from("notification_logs").select("id, recipient_phone").eq("status", "failed").eq("channel", "whatsapp_api").limit(100);
    const summary = emptySummary();
    for (const l of data ?? []) tally(summary, await retryNotification(db, l.id), l.recipient_phone ?? l.id);
    revalidatePath("/notifications/logs");
    return { ok: true, data: summary };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}

export async function saveTemplate(input: {
  id: string;
  body: string;
  meta_template_name: string;
  meta_language_code: string;
  meta_body_params: string;
  is_active: boolean;
}): Promise<ActionResult> {
  try {
    const { db } = await adminForAction();
    const body = input.body.trim();
    if (body.length < 10) return { ok: false, error: "The message is too short." };
    if (body.length > 1024) return { ok: false, error: "WhatsApp template bodies are limited to 1024 characters." };
    const unknown = unknownPlaceholders(body);
    if (unknown.length) return { ok: false, error: `Unknown placeholder(s): ${unknown.map((u) => `{{${u}}}`).join(", ")}` };
    const metaName = input.meta_template_name.trim();
    if (metaName && !/^[a-z0-9_]+$/.test(metaName)) return { ok: false, error: "Meta template name may only use lowercase letters, numbers and underscores." };
    const params = input.meta_body_params.split(",").map((s) => s.trim()).filter(Boolean);
    const unknownParams = unknownPlaceholders(params.map((p) => `{{${p}}}`).join(" "));
    if (unknownParams.length) return { ok: false, error: `Unknown Meta parameter(s): ${unknownParams.join(", ")}` };

    const { error } = await db
      .from("notification_templates")
      .update({ body, meta_template_name: metaName || null, meta_language_code: input.meta_language_code.trim() || "en", meta_body_params: params, is_active: input.is_active })
      .eq("id", input.id);
    if (error) return { ok: false, error: friendlyError(error) };
    revalidatePath("/notifications", "layout");
    return { ok: true, message: "Template saved." };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}

