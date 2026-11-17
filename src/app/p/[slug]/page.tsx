import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarDays, Dices, Trophy, Users, Wallet } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { formatDate, formatDateTime, monthLabel } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { themeFor } from "@/lib/letter-themes";
import { getPublicCommittee } from "@/lib/public-data";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const c = await getPublicCommittee(slug).catch(() => null);
  if (!c) return { title: "Committee not found" };
  const last = [...c.months].reverse().find((m) => m.is_announced);
  return {
    title: c.name,
    description: `${c.name}: ${c.months.length}-month committee. Members, winners and lucky draws by letter.`,
    robots: { index: false, follow: false },
    openGraph: last ? { images: [{ url: `/api/banner/${c.slug}/${last.month_number}`, width: 1080, height: 1080 }] } : undefined,
  };
}

export default async function PublicCommitteePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = await getPublicCommittee(slug);
  if (!c) notFound();

  const current = c.months.find((m) => m.phase === "current") ?? null;
  const next = current ? c.months.find((m) => m.month_number === current.month_number + 1) : c.months.find((m) => m.phase === "upcoming");
  const lastAnnounced = [...c.months].reverse().find((m) => m.is_announced) ?? null;
  const wonBy = new Map(c.months.filter((m) => m.is_announced && m.winner_slot).map((m) => [m.winner_slot!, m]));
  const plannedFor = new Map(c.months.filter((m) => !m.is_announced && m.winner_slot).map((m) => [m.winner_slot!, m]));
  const done = c.months.filter((m) => m.is_announced).length;
  const lucky = c.winner_selection === "lucky_draw";

  return (
    <div className="min-h-dvh">
      <header className="relative overflow-hidden bg-gradient-to-br from-brand-700 via-brand-800 to-brand-950 text-white">
        <div className="absolute -right-24 -top-24 size-96 rounded-full bg-gold-400/20 blur-3xl" />
        <div className="relative mx-auto flex max-w-5xl items-center justify-between px-5 py-4">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <span className="grid size-8 place-items-center rounded-lg bg-white/10 text-xs font-black ring-1 ring-white/20">SC</span>
            Smart Committee
          </span>
          <div className="flex items-center gap-1">
            <ThemeToggle className="text-white hover:bg-white/10 dark:text-white" />
            <Link href="/login" className="btn btn-sm border border-white/30 text-white hover:bg-white/10">Admin sign in</Link>
          </div>
        </div>
        <div className="relative mx-auto max-w-5xl px-5 pb-10 pt-4">
          <div className="flex items-center gap-4">
            {c.logo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={c.logo} alt={`${c.name} logo`} className="size-16 rounded-2xl bg-white object-contain p-1.5 shadow-lg sm:size-20" />
            )}
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-gold-300">Committee</p>
              <h1 className="mt-1 text-3xl font-black sm:text-4xl">{c.name}</h1>
            </div>
          </div>
          <p className="mt-2 text-emerald-100/85">
            {current ? `Month ${current.month_number} of ${c.months.length} · ${monthLabel(current.period_month)}` : done === c.months.length ? "Completed" : "Starting soon"}
            {" · "}
            {lucky ? "Winners chosen by lucky draw" : "Winners in a fixed order"}
          </p>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { icon: Users, label: "Members", value: c.slots.length },
              { icon: Wallet, label: "Monthly", value: formatMoney(c.monthly_contribution, c.currency) },
              { icon: Trophy, label: "Payout", value: formatMoney(c.payout_amount, c.currency) },
              { icon: CalendarDays, label: "Winners so far", value: `${done} / ${c.months.length}` },
            ].map(({ icon: Icon, label, value }) => (
              <div key={label} className="rounded-2xl bg-white/10 p-3 ring-1 ring-white/15">
                <Icon className="size-4 text-gold-300" />
                <p className="mt-1 text-[11px] uppercase tracking-wide text-emerald-100/70">{label}</p>
                <p className="text-lg font-bold">{value}</p>
              </div>
            ))}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-8 px-5 py-8">
        {lastAnnounced && (
          <section className="grid gap-5 md:grid-cols-[minmax(0,380px)_1fr] md:items-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/banner/${c.slug}/${lastAnnounced.month_number}`}
              alt={`Month ${lastAnnounced.month_number} winner: slot ${lastAnnounced.winner_slot}`}
              className="w-full rounded-3xl shadow-xl"
            />
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-amber-600">Latest winner</p>
              <p className="mt-1 text-4xl font-black">Slot {lastAnnounced.winner_slot}</p>
              <p className="mt-1 text-slate-600 dark:text-slate-300">
                Month {lastAnnounced.month_number} · {monthLabel(lastAnnounced.period_month)}
                {lastAnnounced.announced_at ? ` · announced ${formatDateTime(lastAnnounced.announced_at)}` : ""}
              </p>
              {next && (
                <p className="mt-4 rounded-xl bg-slate-100 px-4 py-3 text-sm dark:bg-slate-800">
                  Next: <b>Month {next.month_number}</b> ({monthLabel(next.period_month)}) ·{" "}
                  {next.is_announced ? `Slot ${next.winner_slot} (already drawn)` : next.reserved ? "reserved for financial support" : lucky ? "winner by lucky draw" : next.winner_slot ? `Slot ${next.winner_slot}` : "to be decided"}
                </p>
              )}
            </div>
          </section>
        )}

        <section>
          <h2 className="text-lg font-bold">Members</h2>
          <p className="text-sm text-slate-500">Members are shown by letter only.</p>
          <div className="mt-4 grid grid-cols-4 gap-3 sm:grid-cols-6 lg:grid-cols-9">
            {c.slots.map((slot) => {
              const t = themeFor(slot);
              const won = wonBy.get(slot);
              const planned = plannedFor.get(slot);
              return (
                <div
                  key={slot}
                  className="relative flex aspect-[3/4] flex-col items-center justify-center rounded-2xl text-white shadow-md"
                  style={{ background: `linear-gradient(160deg, ${t.from}, ${t.to})`, outline: won ? `3px solid ${t.accent}` : undefined }}
                >
                  {won && <Trophy className="absolute right-1.5 top-1.5 size-4" style={{ color: t.accent }} />}
                  <span className="text-3xl font-black" style={{ color: t.accent }}>{slot}</span>
                  <span className="mt-1 text-[10px] uppercase tracking-wide text-white/80">
                    {won ? `Won M${won.month_number}` : !lucky && planned ? `Month ${planned.month_number}` : "Waiting"}
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        <section>
          <h2 className="text-lg font-bold">Schedule</h2>
          <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <table className="table">
              <thead>
                <tr><th>Month</th><th>Winner</th><th className="hidden sm:table-cell">Due date</th><th>Paid</th></tr>
              </thead>
              <tbody>
                {c.months.map((m) => (
                  <tr key={m.month_number} className={m.phase === "current" ? "bg-brand-50/60 dark:bg-brand-500/5" : ""}>
                    <td className="whitespace-nowrap">
                      <b>{m.month_number}.</b> {monthLabel(m.period_month)}
                      {m.phase === "current" && <span className="ml-2 rounded-full bg-brand-600 px-2 py-0.5 text-[10px] font-bold text-white">NOW</span>}
                    </td>
                    <td className="whitespace-nowrap">
                      {m.is_announced ? (
                        <span className="font-bold"><Trophy className="mr-1 inline size-4 text-amber-500" />Slot {m.winner_slot}</span>
                      ) : m.reserved ? (
                        <span className="text-amber-700 dark:text-amber-300">{m.reserve_used ? "Reserve used (support)" : "Reserved (support fund)"}</span>
                      ) : lucky ? (
                        <span className="text-slate-500"><Dices className="mr-1 inline size-4" />Lucky draw</span>
                      ) : m.winner_slot ? (
                        <span className="text-slate-600 dark:text-slate-300">Slot {m.winner_slot}</span>
                      ) : (
                        <span className="text-slate-400">TBA</span>
                      )}
                    </td>
                    <td className="hidden whitespace-nowrap text-slate-500 sm:table-cell">{formatDate(m.due_date)}</td>
                    <td className="whitespace-nowrap text-slate-600 dark:text-slate-300">
                      {m.phase === "upcoming" ? "—" : `${m.paid_count} / ${m.member_count}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {c.draws.length > 0 && (
          <section>
            <h2 className="text-lg font-bold">Lucky draw history</h2>
            <ul className="mt-3 grid gap-3 sm:grid-cols-2">
              {c.draws.map((d, i) => (
                <li key={i} className="card card-pad">
                  <p className="text-sm text-slate-500">Month {d.month_number} · {formatDateTime(d.created_at)}</p>
                  <div className="mt-2 flex items-center gap-3">
                    <span className="grid size-12 place-items-center rounded-xl bg-amber-400 text-2xl font-black text-amber-950 ring-2 ring-amber-300">{d.winner_slot}</span>
                    <span className="text-sm">
                      <b>Slot {d.winner_slot} won</b>
                      <span className="block text-slate-500">Drawn from {d.candidates.length} member{d.candidates.length === 1 ? "" : "s"} who hadn’t won yet</span>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="pb-6 text-center text-xs text-slate-400">Names, phone numbers and individual payments are private and only visible to committee admins.</p>
      </main>
    </div>
  );
}
