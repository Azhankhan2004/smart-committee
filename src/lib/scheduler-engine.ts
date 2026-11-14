import "server-only";
import { getMembers, getPayments, getSchedules, getSettings, getTemplates, type AnyDB } from "./data";
import { todayInTimeZone } from "./dates";
import { contextFor, dispatchNotification, emptySummary, tally, type SendSummary } from "./notifications";
import { planNotifications, type PlannedMessage } from "./scheduler-plan";
import { TEMPLATE_LABELS } from "./templates";
import { whatsappConfig } from "./whatsapp";

export type SchedulerReport = {
  ranAt: string;
  today: string | null;
  dryRun: boolean;
  ran: boolean;
  notes: string[];
  autoAnnounced: string | null;
  planned: Array<Pick<PlannedMessage, "templateKey" | "reason"> & { slot: string; month: number | null }>;
  summary: SendSummary;
};

/**
 * The automated reminder engine. Runs on the server (Vercel Cron → /api/cron/scheduler,
 * or the "Run now" button). Duplicate protection comes from unique dedupe keys in
 * notification_logs, so running it twice on the same day never double-sends.
 */
export async function runScheduler(db: AnyDB, opts: { dryRun?: boolean; ignoreAutoSendSwitch?: boolean; now?: Date } = {}): Promise<SchedulerReport> {
  const report: SchedulerReport = {
    ranAt: new Date().toISOString(),
    today: null,
    dryRun: Boolean(opts.dryRun),
    ran: false,
    notes: [],
    autoAnnounced: null,
    planned: [],
    summary: emptySummary(),
  };

  const settings = await getSettings(db);
  if (!settings) {
    report.notes.push("Committee settings are missing. Run the database seed script.");
    return report;
  }
  report.today = todayInTimeZone(settings.timezone, opts.now);

  if (!settings.auto_send_enabled && !opts.ignoreAutoSendSwitch && !opts.dryRun) {
    report.notes.push("Automatic sending is switched off in Settings, so nothing was sent.");
    return report;
  }

  let [schedules, payments, members, templates] = await Promise.all([
    getSchedules(db),
    getPayments(db),
    getMembers(db),
    getTemplates(db),
  ]);

  let plan = planNotifications({ settings, today: report.today, schedules, payments, members });

  // Optional automatic winner announcement (uses the configured sequence).
  if (plan.autoAnnounceScheduleId) {
    const sch = schedules.find((s) => s.id === plan.autoAnnounceScheduleId);
    if (opts.dryRun) {
      report.notes.push(`Would announce Slot ${sch?.winner_slot} as the month ${sch?.month_number} winner.`);
    } else if (sch?.winner_slot) {
      const { error } = await db.rpc("announce_winner", {
        p_schedule_id: sch.id,
        p_confirm_slot: sch.winner_slot,
        p_notes: "Announced automatically by the scheduler",
      });
      if (error) {
        report.notes.push(`Automatic announcement failed: ${error.message}`);
      } else {
        report.autoAnnounced = `Month ${sch.month_number}: Slot ${sch.winner_slot}`;
        schedules = await getSchedules(db);
        plan = planNotifications({ settings, today: report.today, schedules, payments, members });
      }
    }
  }

  report.notes.push(...plan.notes);
  const memberById = new Map(members.map((m) => [m.id, m]));
  const scheduleById = new Map(schedules.map((s) => [s.id, s]));
  const templateByKey = new Map(templates.map((t) => [t.key, t]));
  const paymentById = new Map(payments.map((p) => [p.id, p]));

  report.planned = plan.messages.map((m) => ({
    templateKey: m.templateKey,
    reason: m.reason,
    slot: memberById.get(m.memberId)?.slot_code ?? "?",
    month: scheduleById.get(m.scheduleId)?.month_number ?? null,
  }));

  if (opts.dryRun) return report;

  if (plan.messages.length === 0) {
    report.ran = true;
    report.notes.push("Nothing is due to be sent today.");
    return report;
  }
  if (!whatsappConfig().configured) {
    report.notes.push(
      `${plan.messages.length} message(s) are due today, but the WhatsApp Cloud API is not configured. Use Notifications → manual sharing.`,
    );
    return report;
  }

  report.ran = true;
  for (const m of plan.messages) {
    const template = templateByKey.get(m.templateKey);
    const member = memberById.get(m.memberId);
    const label = `${TEMPLATE_LABELS[m.templateKey].name} → Slot ${member?.slot_code ?? "?"}`;
    if (!template || !template.is_active) {
      report.summary.skipped++;
      continue;
    }
    if (!member) continue;
    const payment = m.paymentId ? paymentById.get(m.paymentId) : payments.find((p) => p.schedule_id === m.scheduleId && p.member_id === m.memberId);
    const context = contextFor({ settings, schedules, scheduleId: m.scheduleId, member, payment });
    const outcome = await dispatchNotification(db, {
      template,
      member,
      scheduleId: m.scheduleId,
      context,
      dedupeKey: m.dedupeKey,
      triggeredBy: "scheduler",
    });
    tally(report.summary, outcome, label);
  }
  return report;
}
