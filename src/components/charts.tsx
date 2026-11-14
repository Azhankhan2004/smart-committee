"use client";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { CheckCircle2, CircleDashed, AlertTriangle, CircleDot } from "lucide-react";
import { formatMoney } from "@/lib/format";

type MonthPoint = { label: string; month: number; collected: number; expected: number };

/** Collected amount per month; the grey track behind each bar is that month's expected total. */
export function CollectionsChart({ data, currency }: { data: MonthPoint[]; currency: string }) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = mounted && resolvedTheme === "dark";
  const bar = dark ? "#34d399" : "#059669";
  const track = dark ? "#1e293b" : "#eef2f6";
  const ink = dark ? "#94a3b8" : "#64748b";
  const grid = dark ? "#1e293b" : "#f1f5f9";
  const max = Math.max(1, ...data.map((d) => d.expected));
  const rows = data.map((d) => ({ ...d, remaining: Math.max(d.expected - d.collected, 0) }));

  return (
    <div className="h-64 w-full" role="img" aria-label="Amount collected for each committee month compared with the expected total">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 4, left: 4, bottom: 0 }} barCategoryGap={6}>
          <CartesianGrid vertical={false} stroke={grid} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: ink, fontSize: 11 }} interval="preserveStartEnd" />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={44}
            domain={[0, max]}
            tick={{ fill: ink, fontSize: 11 }}
            tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
          />
          <Tooltip
            cursor={{ fill: dark ? "rgba(148,163,184,0.08)" : "rgba(15,23,42,0.04)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as MonthPoint;
              const pct = p.expected ? Math.round((p.collected / p.expected) * 100) : 0;
              return (
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-900">
                  <p className="font-semibold">Month {p.month} · {p.label}</p>
                  <p className="mt-1 text-slate-600 dark:text-slate-300">Collected: {formatMoney(p.collected, currency)}</p>
                  <p className="text-slate-500 dark:text-slate-400">Expected: {formatMoney(p.expected, currency)} ({pct}%)</p>
                </div>
              );
            }}
          />
          <Bar dataKey="collected" stackId="m" fill={bar} maxBarSize={28} isAnimationActive={false} />
          <Bar dataKey="remaining" stackId="m" fill={track} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

type Breakdown = { paid: number; partial: number; overdue: number; pending: number };

/** Current-month status split. Each status carries an icon + label, never colour alone. */
export function StatusBreakdown({ counts }: { counts: Breakdown }) {
  const total = counts.paid + counts.partial + counts.overdue + counts.pending;
  const items = [
    { key: "paid", label: "Paid", value: counts.paid, color: "bg-emerald-500", icon: CheckCircle2, text: "text-emerald-600 dark:text-emerald-400" },
    { key: "partial", label: "Partially paid", value: counts.partial, color: "bg-amber-400", icon: CircleDot, text: "text-amber-600 dark:text-amber-400" },
    { key: "overdue", label: "Overdue", value: counts.overdue, color: "bg-rose-500", icon: AlertTriangle, text: "text-rose-600 dark:text-rose-400" },
    { key: "pending", label: "Pending", value: counts.pending, color: "bg-slate-300 dark:bg-slate-600", icon: CircleDashed, text: "text-slate-500 dark:text-slate-400" },
  ];
  return (
    <div>
      <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        {total > 0 &&
          items.filter((i) => i.value > 0).map((i) => (
            <div key={i.key} className={`${i.color} h-full first:rounded-l-full last:rounded-r-full`} style={{ width: `${(i.value / total) * 100}%` }} title={`${i.label}: ${i.value}`} />
          ))}
      </div>
      <ul className="mt-4 grid grid-cols-2 gap-3">
        {items.map(({ key, label, value, icon: Icon, text }) => (
          <li key={key} className="flex items-center gap-2 text-sm">
            <Icon className={`size-4 ${text}`} aria-hidden />
            <span className="text-slate-600 dark:text-slate-300">{label}</span>
            <span className="ml-auto font-semibold tabular-nums">{value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
