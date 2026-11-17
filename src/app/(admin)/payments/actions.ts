"use server";
import { revalidatePath } from "next/cache";
import { adminForAction } from "@/lib/auth";
import { getPayments, getSchedules, getSettings, getTemplates } from "@/lib/data";
import { todayInTimeZone } from "@/lib/dates";
import { friendlyError } from "@/lib/format";
import { contextFor, dispatchNotification } from "@/lib/notifications";
import { waLink } from "@/lib/phone";
import { getWhatsAppConfig } from "@/lib/whatsapp";
import { dedupeKeyFor, renderTemplate } from "@/lib/templates";
import type { ActionResult } from "@/lib/types";

export type RecordPaymentInput = {
  paymentId: string;
  amount: number;
  date: string;
  method: string;
  reference: string;
  remarks: string;
  sendConfirmation: boolean;
};

export type RecordPaymentResult = {
  notification: "sent" | "failed" | "skipped" | "duplicate" | "not_configured" | "not_requested";
  notificationError?: string;
  manualShare?: { url: string; body: string; memberId: string; scheduleId: string; phone: string | null };
};

export async function recordPayment(input: RecordPaymentInput): Promise<ActionResult<RecordPaymentResult>> {
  try {
    const { db, userId, committeeId } = await adminForAction();
    if (!Number.isFinite(input.amount)) return { ok: false, error: "Please enter a valid amount." };
    if (input.amount > 0 && !input.method) return { ok: false, error: "Please choose the payment method (Cash or Online)." };
    const { error } = await db.rpc("record_payment", {
      p_payment_id: input.paymentId,
      p_amount_paid: input.amount,
      p_payment_date: input.amount > 0 ? input.date || null : null,
      p_method: input.method || null,
      p_reference: input.reference,
      p_remarks: input.remarks,
    });
    if (error) return { ok: false, error: friendlyError(error) };
    revalidatePath("/", "layout");

    const result: RecordPaymentResult = { notification: "not_requested" };
    if (input.sendConfirmation && input.amount > 0) {
      const { data: row } = await db.from("v_payments").select("schedule_id, member_id").eq("id", input.paymentId).single();
      const [settings, schedules, templates, payments] = await Promise.all([
        getSettings(db, committeeId),
        getSchedules(db, committeeId),
        getTemplates(db, committeeId),
        getPayments(db, committeeId, { scheduleId: row!.schedule_id }),
      ]);
      const payment = payments.find((p) => p.id === input.paymentId)!;
      const template = templates.find((t) => t.key === "payment_received");
      if (settings && template && template.is_active) {
        const member = { id: payment.member_id, slot_code: payment.slot_code, full_name: payment.full_name, phone_e164: payment.phone_e164 };
        const context = contextFor({ settings, schedules, scheduleId: payment.schedule_id, member, payment });
        const outcome = await dispatchNotification(db, {
          cfg: await getWhatsAppConfig(committeeId),
          committeeId,
          template,
          member,
          scheduleId: payment.schedule_id,
          context,
          dedupeKey: dedupeKeyFor("payment_received", {
            scheduleId: payment.schedule_id,
            memberId: payment.member_id,
            today: todayInTimeZone(settings.timezone),
            paymentId: payment.id,
            amountPaid: payment.amount_paid,
          }),
          triggeredBy: "admin",
          actorId: userId,
        });
        result.notification = outcome.status;
        if (outcome.status === "failed" || outcome.status === "skipped") result.notificationError = outcome.error;
        if (outcome.status === "not_configured") {
          const body = renderTemplate(template.body, context);
          result.manualShare = { url: waLink(payment.phone_e164, body), body, memberId: payment.member_id, scheduleId: payment.schedule_id, phone: payment.phone_e164 };
        }
      }
    }
    return { ok: true, message: "Payment saved.", data: result };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}
