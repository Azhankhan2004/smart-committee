import "server-only";
import { getMembers, getSchedules, getSettings, getTemplates, type AnyDB } from "./data";
import { appUrl } from "./env";
import { contextFor, dispatchNotification } from "./notifications";
import { waLink } from "./phone";
import { dedupeKeyFor, renderTemplate } from "./templates";
import { getWhatsAppConfig } from "./whatsapp";

export type WinnerNotifyResult =
  | { status: "sent" | "duplicate" }
  | { status: "failed" | "skipped"; error: string }
  | { status: "manual"; share: { url: string; body: string; memberId: string; scheduleId: string; phone: string | null } }
  | { status: "template_off" };

export function bannerUrl(slug: string, monthNumber: number) {
  return `${appUrl()}/api/banner/${slug}/${monthNumber}`;
}

/**
 * Sends the personal "you won" WhatsApp message (with the winner banner image)
 * to the member who just won. Falls back to a ready-to-send wa.me link when the
 * committee has not connected the WhatsApp Cloud API.
 */
export async function notifyWinner(
  db: AnyDB,
  args: { committeeId: string; slug: string; scheduleId: string; actorId?: string | null; triggeredBy: "admin" | "scheduler"; today: string },
): Promise<WinnerNotifyResult> {
  const [settings, schedules, members, templates, cfg] = await Promise.all([
    getSettings(db, args.committeeId),
    getSchedules(db, args.committeeId),
    getMembers(db, args.committeeId),
    getTemplates(db, args.committeeId),
    getWhatsAppConfig(args.committeeId),
  ]);
  const schedule = schedules.find((s) => s.id === args.scheduleId);
  const member = members.find((m) => m.id === schedule?.winner_member_id);
  const template = templates.find((t) => t.key === "winner_personal");
  if (!settings || !schedule || !member) return { status: "skipped", error: "Winner not found." };
  if (!template || !template.is_active) return { status: "template_off" };

  const context = contextFor({ settings, schedules, scheduleId: schedule.id, member });
  if (!cfg.configured) {
    const body = renderTemplate(template.body, context);
    return {
      status: "manual",
      share: { url: waLink(member.phone_e164, body), body, memberId: member.id, scheduleId: schedule.id, phone: member.phone_e164 },
    };
  }
  const outcome = await dispatchNotification(db, {
    cfg,
    committeeId: args.committeeId,
    template,
    member,
    scheduleId: schedule.id,
    context,
    dedupeKey: dedupeKeyFor("winner_personal", { scheduleId: schedule.id, memberId: member.id, today: args.today }),
    triggeredBy: args.triggeredBy,
    actorId: args.actorId,
    headerImageUrl: bannerUrl(args.slug, schedule.month_number),
  });
  if (outcome.status === "sent" || outcome.status === "duplicate") return { status: outcome.status };
  if (outcome.status === "not_configured") return { status: "skipped", error: "WhatsApp is not connected." };
  return { status: outcome.status, error: outcome.error };
}
