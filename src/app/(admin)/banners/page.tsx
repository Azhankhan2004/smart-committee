import { Card, EmptyState, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { getMembers, getSchedules, getSettings } from "@/lib/data";
import { monthLabel } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { themeFor } from "@/lib/letter-themes";
import { BannerActions } from "./banner-actions";

export const metadata = { title: "Winner banners" };

export default async function BannersPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const sp = await searchParams;
  const { db, committeeId, committee } = await requireAdmin();
  const [settings, schedules, members] = await Promise.all([getSettings(db, committeeId), getSchedules(db, committeeId), getMembers(db, committeeId)]);
  if (!settings) return <EmptyState title="Settings missing" />;
  const announced = schedules.filter((s) => s.is_announced && s.winner_slot);
  const focus = announced.find((s) => s.month_number === Number(sp.month)) ?? announced[announced.length - 1] ?? null;
  const payout = formatMoney(settings.payout_amount, settings.currency);
  const sampleQs = (slot: string) =>
    `?c=${committee.slug}&name=${encodeURIComponent(settings.committee_name)}&payout=${encodeURIComponent(payout)}&t=${schedules.length}&label=${encodeURIComponent("Your winning month")}&v=${encodeURIComponent(slot)}`;

  return (
    <>
      <PageHeader
        title="Winner banners"
        description="Every letter has its own design. When a winner is announced, their personalised banner is created automatically and attached to their WhatsApp message."
      />

      {focus ? (
        <Card title={`Month ${focus.month_number} winner · Slot ${focus.winner_slot}`}>
          <div className="grid gap-5 md:grid-cols-[minmax(0,420px)_1fr] md:items-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/banner/${committee.slug}/${focus.month_number}`} alt={`Winner banner for slot ${focus.winner_slot}`} className="w-full rounded-2xl shadow-lg" />
            <div>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                {monthLabel(focus.period_month)} · {formatMoney(focus.payout_amount, settings.currency)} · design “{themeFor(focus.winner_slot!).name}”
              </p>
              <p className="mt-2 text-xs text-slate-500">1080 × 1080 PNG, sized for WhatsApp chats and status. It shows the letter only, never a name.</p>
              <BannerActions src={`/api/banner/${committee.slug}/${focus.month_number}`} fileName={`winner-month-${focus.month_number}-slot-${focus.winner_slot}.png`} />
              {announced.length > 1 && (
                <div className="mt-5">
                  <p className="label">Other winners</p>
                  <div className="flex flex-wrap gap-2">
                    {announced.map((s) => (
                      <a key={s.id} href={`/banners?month=${s.month_number}`} className={`btn btn-sm ${s.id === focus.id ? "btn-primary" : "btn-secondary"}`}>
                        M{s.month_number} · {s.winner_slot}
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </Card>
      ) : (
        <EmptyState title="No winners announced yet">Once a winner is announced or drawn, their banner appears here.</EmptyState>
      )}

      <Card className="mt-6" title={`All ${members.filter((m) => m.is_active).length} letter designs`}>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {members.filter((m) => m.is_active).map((m) => {
            const t = themeFor(m.slot_code);
            return (
              <figure key={m.id} className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img loading="lazy" src={`/api/letter-banner/${m.slot_code}${sampleQs(m.slot_code)}`} alt={`Design for slot ${m.slot_code}`} className="aspect-square w-full" />
                <figcaption className="flex items-center gap-2 px-3 py-2 text-xs">
                  <span className="size-3 rounded-full" style={{ background: t.from }} />
                  <b>Slot {m.slot_code}</b>
                  <span className="truncate text-slate-500">{t.name}</span>
                  {m.has_won && <span className="ml-auto text-amber-600">★ won</span>}
                </figcaption>
              </figure>
            );
          })}
        </div>
      </Card>
    </>
  );
}
