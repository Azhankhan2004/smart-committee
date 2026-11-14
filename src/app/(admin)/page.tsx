import Link from "next/link";
import { AlertTriangle, Banknote, CalendarClock, CalendarDays, CheckCircle2, Clock, Hourglass, Trophy, Users, Wallet } from "lucide-react";
import { CollectionsChart, StatusBreakdown } from "@/components/charts";
import { Badge, Card, EmptyState, Notice, PageHeader, PaymentBadge, Progress, StatCard } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { committeePosition } from "@/lib/committee";
import { getMembers, getPayments, getSchedules, getSettings } from "@/lib/data";
import { diffDays, formatDate, monthLabel, shortMonthLabel, todayInTimeZone } from "@/lib/dates";
import { formatMoney, memberLabel, percent } from "@/lib/format";
import { whatsappStatus } from "@/lib/whatsapp";

export default async function DashboardPage() {
  const { db } = await requireAdmin();
  const settings = await getSettings(db);
  if (!settings) {
    return <Notice tone="red" title="Database not initialised">Run the migration and seed scripts from the README, then reload.</Notice>;
  }
  const [schedules, members] = await Promise.all([getSchedules(db), getMembers(db)]);
  const today = todayInTimeZone(settings.timezone);
  const pos = committeePosition(schedules, today);
  const cur = pos.current;
  const payments = cur ? await getPayments(db, { scheduleId: cur.id }) : [];
  const cc = settings.currency;

  const totalCollected = schedules.reduce((s, m) => s + m.collected_total, 0);
  const activeMembers = members.filter((m) => m.is_active);
  const counts = {
    paid: payments.filter((p) => p.effective_status === "paid").length,
    partial: payments.filter((p) => p.effective_status === "partially_paid").length,
    overdue: payments.filter((p) => p.effective_status === "overdue").length,
    pending: payments.filter((p) => p.effective_status === "pending").length,
  };
  const pendingCount = counts.partial + counts.overdue + counts.pending;
  const completion = cur ? percent(cur.collected_total, cur.expected_total) : 0;

  // Next deadline: this month's due date, or next month's once it has passed.
  const deadlineMonth = cur && today <= cur.due_date ? cur : pos.next;
  const daysLeft = deadlineMonth ? diffDays(deadlineMonth.due_date, today) : null;

  const wa = whatsappStatus();
  const missingPhones = activeMembers.filter((m) => !m.phone_e164).length;
  const expectedPayout = settings.monthly_contribution * activeMembers.length;

  const chartData = schedules.map((s) => ({
    label: shortMonthLabel(s.period_month),
    month: s.month_number,
    collected: s.collected_total,
    expected: s.expected_total,
  }));

  const unpaidFirst = [...payments].sort((a, b) => {
    const order = { overdue: 0, partially_paid: 1, pending: 2, paid: 3 } as const;
    return order[a.effective_status] - order[b.effective_status] || a.slot_code.localeCompare(b.slot_code);
  });

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={
          pos.state === "running" && cur
            ? `Month ${cur.month_number} of ${schedules.length} · ${monthLabel(cur.period_month)} · Today is ${formatDate(today)}`
            : pos.state === "not_started"
              ? `The committee starts in ${monthLabel(schedules[0].period_month)}`
              : pos.state === "finished"
                ? "All committee months are complete"
                : "No schedule yet"
        }
        actions={
          <>
            <Link href="/payments" className="btn btn-primary">Record a payment</Link>
            <Link href="/notifications" className="btn btn-secondary">Send reminder</Link>
          </>
        }
      />

      <div className="mb-5 space-y-2">
        {!wa.configured && (
          <Notice tone="amber" title="WhatsApp Cloud API not connected">
            Messages can still be shared manually with prefilled WhatsApp links. Add the API credentials to send automatically (see README → WhatsApp setup).
          </Notice>
        )}
        {missingPhones > 0 && (
          <Notice tone="blue">
            {missingPhones} active member{missingPhones > 1 ? "s have" : " has"} no WhatsApp number yet. <Link href="/members" className="font-semibold underline">Add numbers</Link>
          </Notice>
        )}
        {activeMembers.length !== settings.total_members && (
          <Notice tone="amber">
            There are {activeMembers.length} active members but the committee is set to {settings.total_members}. Check Members or Settings.
          </Notice>
        )}
        {expectedPayout !== settings.payout_amount && activeMembers.length > 0 && (
          <Notice tone="amber">
            Payout is set to {formatMoney(settings.payout_amount, cc)}, but {activeMembers.length} members × {formatMoney(settings.monthly_contribution, cc)} = {formatMoney(expectedPayout, cc)}.
          </Notice>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Committee amount" value={formatMoney(settings.payout_amount, cc)} hint={`${formatMoney(settings.monthly_contribution, cc)} × ${settings.total_members} members`} icon={<Wallet className="size-5" />} />
        <StatCard label="Total collected" value={formatMoney(totalCollected, cc)} hint="All months, confirmed payments only" icon={<Banknote className="size-5" />} />
        <StatCard
          label="Current month"
          value={cur ? `Month ${cur.month_number}` : "—"}
          hint={cur ? monthLabel(cur.period_month) : pos.state === "not_started" ? "Not started yet" : "Finished"}
          icon={<CalendarDays className="size-5" />}
          accent="slate"
        />
        <StatCard label="Remaining months" value={pos.remainingMonths} hint={`of ${schedules.length} total`} icon={<Hourglass className="size-5" />} accent="slate" />
        <StatCard
          label="This month’s winner"
          value={cur?.winner_slot ? `Slot ${cur.winner_slot}` : "—"}
          hint={cur ? (cur.is_announced ? <Badge tone="green">Announced</Badge> : "Not announced yet") : undefined}
          icon={<Trophy className="size-5" />}
          accent="gold"
        />
        <StatCard
          label="Upcoming winner"
          value={pos.next?.winner_slot ? `Slot ${pos.next.winner_slot}` : "—"}
          hint={pos.next ? monthLabel(pos.next.period_month) : "No more months"}
          icon={<Trophy className="size-5" />}
          accent="gold"
        />
        <StatCard
          label="Paid / pending"
          value={cur ? `${counts.paid} / ${pendingCount}` : "—"}
          hint={cur ? `${counts.overdue} overdue this month` : undefined}
          icon={counts.overdue > 0 ? <AlertTriangle className="size-5" /> : <CheckCircle2 className="size-5" />}
          accent={counts.overdue > 0 ? "red" : "brand"}
        />
        <StatCard
          label="Next payment deadline"
          value={deadlineMonth ? formatDate(deadlineMonth.due_date) : "—"}
          hint={daysLeft === null ? undefined : daysLeft === 0 ? "Due today" : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`}
          icon={<CalendarClock className="size-5" />}
          accent="slate"
        />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Collected per month" action={<span className="text-xs text-slate-500">Grey track = expected</span>}>
          {schedules.length ? <CollectionsChart data={chartData} currency={cc} /> : <EmptyState title="No schedule yet" />}
        </Card>
        <Card title={cur ? `Month ${cur.month_number} payment progress` : "Payment progress"}>
          {cur ? (
            <>
              <div className="flex items-end justify-between">
                <p className="text-3xl font-bold tabular-nums">{completion}%</p>
                <p className="text-right text-xs text-slate-500">
                  {formatMoney(cur.collected_total, cc)}<br />of {formatMoney(cur.expected_total, cc)}
                </p>
              </div>
              <Progress value={completion} className="mt-3" />
              <div className="mt-5">
                <StatusBreakdown counts={counts} />
              </div>
            </>
          ) : (
            <EmptyState title="No active month" />
          )}
        </Card>
      </div>

      {cur && (
        <Card className="mt-5" title={`Who has paid — ${monthLabel(cur.period_month)}`} action={<Link href={`/payments?month=${cur.month_number}`} className="text-sm font-semibold text-brand-700 dark:text-brand-300">Open payments →</Link>}>
          <div className="table-wrap -mx-4 sm:-mx-5">
            <table className="table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Status</th>
                  <th className="text-right">Paid</th>
                  <th className="hidden sm:table-cell">Date</th>
                </tr>
              </thead>
              <tbody>
                {unpaidFirst.map((p) => (
                  <tr key={p.id}>
                    <td className="font-medium">{memberLabel(p)}</td>
                    <td><PaymentBadge status={p.effective_status} /></td>
                    <td className="text-right tabular-nums">{formatMoney(p.amount_paid, cc)}</td>
                    <td className="hidden text-slate-500 sm:table-cell">{formatDate(p.payment_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <Link href="/winners" className="card card-pad flex items-center gap-3 hover:border-brand-300"><Trophy className="size-5 text-amber-500" /><span className="text-sm font-semibold">Winner schedule</span></Link>
        <Link href="/members" className="card card-pad flex items-center gap-3 hover:border-brand-300"><Users className="size-5 text-brand-600" /><span className="text-sm font-semibold">{activeMembers.length} active members</span></Link>
        <Link href="/notifications/logs" className="card card-pad flex items-center gap-3 hover:border-brand-300"><Clock className="size-5 text-slate-500" /><span className="text-sm font-semibold">Notification history</span></Link>
      </div>
    </>
  );
}
