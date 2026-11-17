import { Card, EmptyState, Notice, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { getDraws, getMembers, getSchedules, getSettings } from "@/lib/data";
import { formatDateTime, monthLabel } from "@/lib/dates";
import { DeleteDrawButton, DrawClient } from "./draw-client";
import { ReservePanel } from "./reserve-panel";

export const metadata = { title: "Lucky draw" };

export default async function DrawPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const sp = await searchParams;
  const { db, committeeId, committee, role } = await requireAdmin();
  const isOwner = role === "owner";
  const [settings, schedules, members, draws] = await Promise.all([
    getSettings(db, committeeId),
    getSchedules(db, committeeId),
    getMembers(db, committeeId),
    getDraws(db, committeeId),
  ]);
  if (!settings || schedules.length === 0) return <EmptyState title="No schedule yet" />;

  // Open = no winner yet and not reserved. Upcoming months can be drawn in advance.
  const open = schedules.filter((s) => !s.is_announced && !s.reserve_status);
  const requested = open.find((s) => s.month_number === Number(sp.month));
  const selected = requested ?? open[0] ?? null;
  const eligible = members.filter((m) => m.is_active && !m.has_won).map((m) => m.slot_code);
  const monthById = new Map(schedules.map((s) => [s.id, s]));

  return (
    <>
      <PageHeader title="Lucky draw" description="One winner per draw. The winner is picked securely on the server from everyone who hasn’t won yet; the spinning card only reveals the result." />
      {settings.winner_selection !== "lucky_draw" && (
        <div className="mb-4">
          <Notice tone="blue">
            This committee currently uses a <b>fixed winner order</b>. You can still hold a draw for a month here. To make every month a lucky draw, change “How is each month’s winner chosen?” in Settings.
          </Notice>
        </div>
      )}
      <DrawClient
        months={open.map((s) => ({ id: s.id, month_number: s.month_number, label: monthLabel(s.period_month), upcoming: s.phase === "upcoming" }))}
        selectedId={selected?.id ?? null}
        eligible={eligible}
        slug={committee.slug}
        payout={selected?.payout_amount ?? settings.payout_amount}
        currency={settings.currency}
      />
      <ReservePanel
        isOwner={isOwner}
        currency={settings.currency}
        open={open.map((s) => ({ id: s.id, month_number: s.month_number, label: monthLabel(s.period_month), payout: s.payout_amount }))}
        reserved={schedules
          .filter((s) => s.reserve_status)
          .map((s) => ({
            id: s.id,
            month_number: s.month_number,
            label: monthLabel(s.period_month),
            payout: s.payout_amount,
            status: s.reserve_status!,
            type: s.reserve_given_type,
            slot: s.reserve_member_slot,
            reason: s.reserve_reason,
            note: s.reserve_given_note,
          }))}
        members={members.filter((m) => m.is_active).map((m) => ({ id: m.id, slot: m.slot_code, name: m.full_name, hasWon: m.has_won }))}
      />
      <Card className="mt-6" title="Draw history">
        {draws.length === 0 ? (
          <p className="text-sm text-slate-500">No draws yet.</p>
        ) : (
          <>
          {isOwner && <p className="mb-3 text-sm text-slate-500">Drawn by mistake? Press the bin icon to delete that draw. The month opens again for a new draw.</p>}
          <div className="table-wrap -mx-4 -mb-4 sm:-mx-5 sm:-mb-5">
            <table className="table">
              <thead><tr><th>Month</th><th>Winner</th><th>Took part</th><th>Mode</th><th>When</th><th>By</th>{isOwner && <th />}</tr></thead>
              <tbody>
                {draws.map((d) => {
                  const m = monthById.get(d.schedule_id);
                  return (
                    <tr key={d.id}>
                      <td className="whitespace-nowrap">{m ? `${m.month_number}. ${monthLabel(m.period_month)}` : "—"}</td>
                      <td className="font-bold">Slot {d.winner_slot}</td>
                      <td className="max-w-56 truncate text-slate-500" title={d.candidate_slots.join(", ")}>{d.candidate_slots.length} members</td>
                      <td className="capitalize">{d.mode}</td>
                      <td className="whitespace-nowrap">{formatDateTime(d.created_at, settings.timezone)}</td>
                      <td className="text-slate-500">{d.created_by_email ?? "system"}</td>
                      {isOwner && (
                        <td className="text-right">
                          <DeleteDrawButton drawId={d.id} label={`Month ${m?.month_number ?? "?"}: Slot ${d.winner_slot}`} />
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </Card>
    </>
  );
}
