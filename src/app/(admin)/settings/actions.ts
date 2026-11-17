"use server";
import { revalidatePath } from "next/cache";
import { adminForAction } from "@/lib/auth";
import { friendlyError } from "@/lib/format";
import { normalizePhone } from "@/lib/phone";
import { runScheduler, type SchedulerReport } from "@/lib/scheduler-engine";
import type { ActionResult, Settings } from "@/lib/types";
import { getWhatsAppConfig, sendWhatsApp } from "@/lib/whatsapp";

export type SettingsInput = Omit<Settings, "committee_id" | "updated_at">;

const INT_RANGES: Partial<Record<keyof SettingsInput, [number, number]>> = {
  total_members: [2, 60],
  payment_due_day: [1, 28],
  reminder_days_before: [0, 27],
  overdue_reminder_every_days: [0, 30],
  monthly_reminder_day: [1, 28],
  monthly_update_day: [1, 28],
  winner_announcement_day: [1, 28],
};

const refresh = () => revalidatePath("/", "layout");

export async function saveSettings(input: SettingsInput): Promise<ActionResult<Record<string, number>>> {
  try {
    const { db, committeeId } = await adminForAction();
    for (const [k, [min, max]] of Object.entries(INT_RANGES) as [keyof SettingsInput, [number, number]][]) {
      const v = Number(input[k]);
      if (!Number.isInteger(v) || v < min || v > max) return { ok: false, error: `“${k.replaceAll("_", " ")}” must be a whole number from ${min} to ${max}.` };
    }
    if (!(input.monthly_contribution > 0) || !(input.payout_amount > 0)) return { ok: false, error: "Amounts must be greater than zero." };
    if (!/^\d{4}-\d{2}-01$/.test(input.start_month)) return { ok: false, error: "Please choose a valid start month." };
    if (!["sequence", "lucky_draw"].includes(input.winner_selection)) return { ok: false, error: "Choose how winners are picked." };
    try {
      new Intl.DateTimeFormat("en", { timeZone: input.timezone });
    } catch {
      return { ok: false, error: "Unknown time zone. Use a name like Asia/Karachi." };
    }

    const { error } = await db
      .from("committee_settings")
      .update({
        committee_name: input.committee_name.trim(),
        currency: input.currency.trim().toUpperCase(),
        total_members: input.total_members,
        monthly_contribution: input.monthly_contribution,
        payout_amount: input.payout_amount,
        start_month: input.start_month,
        timezone: input.timezone,
        payment_due_day: input.payment_due_day,
        reminder_days_before: input.reminder_days_before,
        remind_on_due_date: input.remind_on_due_date,
        overdue_reminder_every_days: input.overdue_reminder_every_days,
        monthly_reminder_day: input.monthly_reminder_day,
        monthly_update_day: input.monthly_update_day,
        winner_announcement_day: input.winner_announcement_day,
        auto_send_enabled: input.auto_send_enabled,
        auto_announce_winner: input.auto_announce_winner,
        winner_selection: input.winner_selection,
      })
      .eq("committee_id", committeeId);
    if (error) return { ok: false, error: friendlyError(error) };

    const { data, error: genError } = await db.rpc("generate_schedule", { p_committee_id: committeeId });
    refresh();
    if (genError) return { ok: false, error: `Settings saved, but the schedule could not be updated: ${friendlyError(genError)}` };
    const r = data as Record<string, number>;
    return {
      ok: true,
      data: r,
      message: `Settings saved. Schedule: ${r.created} created, ${r.updated} updated, ${r.removed} removed${r.protected ? `, ${r.protected} month(s) with history left unchanged` : ""}.`,
    };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}

export async function savePublicPage(input: { slug: string; public_enabled: boolean }): Promise<ActionResult> {
  try {
    const { db, committeeId, role } = await adminForAction();
    if (role !== "owner") return { ok: false, error: "Only an owner can change the public page." };
    const slug = input.slug.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/.test(slug)) {
      return { ok: false, error: "The web address may only use lowercase letters, numbers and dashes (3–48 characters)." };
    }
    const { error } = await db.from("committees").update({ slug, public_enabled: input.public_enabled }).eq("id", committeeId);
    if (error) return { ok: false, error: error.code === "23505" ? "That web address is already taken." : friendlyError(error) };
    refresh();
    return { ok: true, message: "Public page settings saved." };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}

export async function saveLogo(dataUrl: string | null): Promise<ActionResult> {
  try {
    const { db, committeeId, role } = await adminForAction();
    if (role !== "owner") return { ok: false, error: "Only an owner can change the logo." };
    if (dataUrl !== null && (!/^data:image\/(png|jpeg|webp);base64,/.test(dataUrl) || dataUrl.length > 400000)) {
      return { ok: false, error: "Please use a PNG, JPG or WebP image (it is resized automatically)." };
    }
    const { error } = await db.from("committees").update({ logo_data: dataUrl }).eq("id", committeeId);
    if (error) return { ok: false, error: friendlyError(error) };
    refresh();
    return { ok: true, message: dataUrl ? "Logo saved." : "Logo removed." };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}

export async function addAdmin(email: string, role: "owner" | "admin"): Promise<ActionResult> {
  try {
    const { db, committeeId } = await adminForAction();
    const { error } = await db.rpc("add_committee_admin", { p_committee_id: committeeId, p_email: email, p_role: role });
    if (error) return { ok: false, error: friendlyError(error) };
    refresh();
    return { ok: true, message: `${email} can now manage this committee.` };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}

export async function removeAdmin(userId: string): Promise<ActionResult> {
  try {
    const { db, committeeId } = await adminForAction();
    const { error } = await db.rpc("remove_committee_admin", { p_committee_id: committeeId, p_user_id: userId });
    if (error) return { ok: false, error: friendlyError(error) };
    refresh();
    return { ok: true, message: "Admin removed." };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}

export async function saveWhatsApp(input: { phoneNumberId: string; accessToken: string; businessAccountId: string; displayPhone: string }): Promise<ActionResult> {
  try {
    const { db, committeeId, role } = await adminForAction();
    if (role !== "owner") return { ok: false, error: "Only an owner can change WhatsApp settings." };
    if (!/^\d{5,30}$/.test(input.phoneNumberId.trim())) return { ok: false, error: "Phone number ID should be digits only (from Meta → WhatsApp → API Setup)." };
    const existing = await getWhatsAppConfig(committeeId);
    if (!existing.configured && input.accessToken.trim().length < 20) return { ok: false, error: "Please paste the access token." };
    const { error } = await db.rpc("set_whatsapp_credentials", {
      p_committee_id: committeeId,
      p_phone_number_id: input.phoneNumberId.trim(),
      p_access_token: input.accessToken.trim(),
      p_business_account_id: input.businessAccountId.trim() || null,
      p_display_phone: input.displayPhone.trim() || null,
    });
    if (error) return { ok: false, error: friendlyError(error) };
    refresh();
    return { ok: true, message: "WhatsApp connected. Send a test message to check it works." };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}

export async function clearWhatsApp(): Promise<ActionResult> {
  try {
    const { db, committeeId } = await adminForAction();
    const { error } = await db.rpc("clear_whatsapp_credentials", { p_committee_id: committeeId });
    if (error) return { ok: false, error: friendlyError(error) };
    refresh();
    return { ok: true, message: "WhatsApp disconnected for this committee." };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}

export async function runSchedulerNow(dryRun: boolean): Promise<ActionResult<SchedulerReport>> {
  try {
    const { db, committeeId, committee } = await adminForAction();
    const report = await runScheduler(db, committeeId, { dryRun, ignoreAutoSendSwitch: true, slug: committee.slug });
    if (!dryRun) refresh();
    return { ok: true, data: report };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}

/** Sends Meta's default "hello_world" template to check the credentials work. */
export async function sendTestMessage(phone: string): Promise<ActionResult> {
  try {
    const { committeeId } = await adminForAction();
    const p = normalizePhone(phone);
    if (!p.ok) return { ok: false, error: p.error };
    const cfg = await getWhatsAppConfig(committeeId);
    const res = await sendWhatsApp(cfg, { kind: "template", to: p.value, templateName: "hello_world", languageCode: "en_US", bodyParams: [] });
    if (!res.ok) return { ok: false, error: res.error };
    return { ok: true, message: `Test message accepted by WhatsApp (id …${res.messageId.slice(-6)}).` };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}

/** Owner only: move month 1 to another calendar month. Every month keeps its payments and winner. */
export async function changeStartMonth(newStartMonth: string, reason: string): Promise<ActionResult> {
  try {
    const { db, committeeId } = await adminForAction();
    if (!/^\d{4}-\d{2}$/.test(newStartMonth)) return { ok: false, error: "Please choose the new start month." };
    if (reason.trim().length < 5) return { ok: false, error: "Please give a clear reason (at least 5 characters)." };
    const { data, error } = await db.rpc("change_start_month", {
      p_committee_id: committeeId,
      p_new_start: `${newStartMonth}-01`,
      p_reason: reason.trim(),
    });
    if (error) return { ok: false, error: friendlyError(error) };
    const r = data as { months: number; payment_rows_added: number };
    revalidatePath("/", "layout");
    return { ok: true, message: `Start month changed. ${r.months} months moved; all payments and winners stayed with their month.` };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}
