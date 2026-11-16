import "server-only";
import { getMembers, getPayments, getSchedules, getSettings, getTemplates, type AnyDB } from "./data";
import { todayInTimeZone } from "./dates";
import { contextFor, dispatchNotification, emptySummary, tally, type SendSummary } from "./notifications";
import { planNotifications, type PlannedMessage } from "./scheduler-plan";
import { TEMPLATE_LABELS } from "./templates";
import { getWhatsAppConfig } from "./whatsapp";
import { notifyWinner } from "./winner-notify";

export type SchedulerReport = {
  committeeId: string;
  committeeName: string;
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
 * The automated reminder engine for ONE committee. Duplicate protection comes from
 * unique dedupe keys in notification_logs, so running it twice on the same day never double-sends.
 */
export async function runScheduler(
  db: AnyDB,
  committeeId: string,
  opts: { dryRun?: boolean; ignoreAutoSendSwitch?: boolean; now?: Date; slug?: string } = {},
): Promise<SchedulerReport> {
  const report: SchedulerReport = {
    committeeId,
    committeeName: "",
    ranAt: new Date().toISOString(),
    today: null,
    dryRun: Boolean(opts.dryRun),
    ran: false,
    notes: [],
    autoAnnounced: null,
    planned: [],
    summary: emptySummary(),
  };

  const settings = await getSettings(db, committeeId);
  if (!settings) {
    report.notes.push("Committee settings are missing.");
    return report;
  }
  report.committeeName = settings.committee_name;
  report.today = todayInTimeZone(settings.timezone, opts.now);

  if (!settings.auto_send_enabled && !opts.ignoreAutoSendSwitch && !opts.dryRun) {
    report.notes.push("Automatic sending is switched off in Settings, so nothing was sent.");
    return report;
  }

  let [schedules, payments, members, templates, cfg] = await Promise.all([
    getSchedules(db, committeeId),
    getPayments(db, committeeId),
    getMembers(db, committeeId),
    getTemplates(db, committeeId),
    getWhatsAppConfig(committeeId),
  ]);

  let plan = planNotifications({ settings, today: report.today, schedules, payments, members });

  // Automatic winner: either the next person in the saved order, or a lucky draw.
  if (plan.autoAnnounceScheduleId) {
    const sch = schedules.find((s) => s.id === plan.autoAnnounceScheduleId);
    const isDraw = settings.winner_selection === "lucky_draw";
    if (opts.dryRun) {
      report.notes.push(
        isDraw
          ? `Would hold the month ${sch?.month_number} lucky draw automatically.`
          : `Would announce Slot ${sch?.winner_slot} as the month ${sch?.month_number} winner.`,
      );
    } else if (sch) {
      const { data, error } = isDraw
        ? await db.rpc("run_lucky_draw", { p_schedule_id: sch.id, p_mode: "scheduler", p_card_count: 4 })
        : await db.rpc("announce_winner", { p_schedule_id: sch.id, p_confirm_slot: sch.winner_slot, p_notes: "Announced automatically by the scheduler" });
      if (error) {
        report.notes.push(`Automatic ${isDraw ? "lucky draw" : "announcement"} failed: ${error.message}`);
      } else {
        const slot = isDraw ? (data as { winner_slot: string }).winner_slot : sch.winner_slot;
        report.autoAnnounced = `Month ${sch.month_number}: Slot ${slot}${isDraw ? " (lucky draw)" : ""}`;
        if (opts.slug) {
          const w = await notifyWinner(db, { committeeId, slug: opts.slug, scheduleId: sch.id, triggeredBy: "scheduler", today: report.today });
          report.notes.push(`Winner message: ${w.status}${"error" in w ? ` – ${w.error}` : ""}`);
        }
        schedules = await getSchedules(db, committeeId);
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
  if (!cfg.configured) {
    report.notes.push(
      `${plan.messages.length} message(s) are due today, but WhatsApp is not connected for this committee. Use Notifications → manual sharing.`,
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
      cfg,
      committeeId,
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

/** Cron entry point: runs every committee that has automatic sending switched on. */
export async function runAllCommittees(db: AnyDB, opts: { dryRun?: boolean } = {}) {
  const { data, error } = await db
    .from("committee_settings")
    .select("committee_id, auto_send_enabled, committees(slug)")
    .eq("auto_send_enabled", true);
  if (error) throw new Error(error.message);
  const reports: SchedulerReport[] = [];
  for (const row of (data ?? []) as unknown as { committee_id: string; committees: { slug: string } | null }[]) {
    try {
      reports.push(await runScheduler(db, row.committee_id, { dryRun: opts.dryRun, slug: row.committees?.slug }));
    } catch (e) {
      reports.push({
        committeeId: row.committee_id,
        committeeName: "",
        ranAt: new Date().toISOString(),
        today: null,
        dryRun: Boolean(opts.dryRun),
        ran: false,
        notes: [`Failed: ${e instanceof Error ? e.message : String(e)}`],
        autoAnnounced: null,
        planned: [],
        summary: emptySummary(),
      });
    }
  }
  return { committees: reports.length, reports };
}
