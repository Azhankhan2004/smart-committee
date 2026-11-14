"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, CheckCircle2, Download, Loader2, Share2, Trophy, Wallet } from "lucide-react";
import { toast } from "sonner";
import { toBlob } from "html-to-image";
import { Card, Field, Notice } from "@/components/ui";
import { formatDate, monthLabel } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import type { ScheduleRow } from "@/lib/types";

export type PosterType = "reminder" | "winner" | "confirmation" | "update";

type P = { id: string; schedule_id: string; member_id: string; amount_paid: number; required_amount: number; payment_date: string | null; transaction_ref: string | null; status: string };
type M = { id: string; slot_code: string; full_name: string | null; is_active: boolean };

const SIZE = 1080;
const FOOTERS: Record<PosterType, string> = {
  reminder: "Please pay on time • Share your transaction reference",
  winner: "Thank you all for your contributions",
  confirmation: "Thank you for paying on time",
  update: "Together we save, together we grow",
};

const LABELS: Record<PosterType, string> = {
  reminder: "Payment reminder",
  winner: "Winner announcement",
  confirmation: "Payment confirmation",
  update: "Monthly update",
};

export function PostersClient({
  settings,
  schedules,
  members,
  payments,
  initialType,
  initialScheduleId,
}: {
  settings: { committee_name: string; currency: string };
  schedules: ScheduleRow[];
  members: M[];
  payments: P[];
  initialType: PosterType;
  initialScheduleId: string;
}) {
  const [type, setType] = useState<PosterType>(initialType);
  const [scheduleId, setScheduleId] = useState(initialScheduleId);
  const [memberId, setMemberId] = useState("");
  const [showName, setShowName] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [scale, setScale] = useState(0.4);
  const wrapRef = useRef<HTMLDivElement>(null);
  const posterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(el.clientWidth / SIZE));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const idx = schedules.findIndex((s) => s.id === scheduleId);
  const s = schedules[idx];
  const next = schedules[idx + 1] ?? null;
  const paidMembers = payments.filter((p) => p.schedule_id === scheduleId && p.amount_paid > 0);
  const payment = payments.find((p) => p.schedule_id === scheduleId && p.member_id === memberId) ?? null;
  const member = members.find((m) => m.id === memberId) ?? null;

  useEffect(() => {
    if (type === "confirmation" && !paidMembers.some((p) => p.member_id === memberId)) setMemberId(paidMembers[0]?.member_id ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, scheduleId]);

  const totalCollected = useMemo(() => schedules.reduce((a, x) => a + x.collected_total, 0), [schedules]);
  const money = (n: number) => formatMoney(n, settings.currency);

  const problem =
    type === "winner" && !s?.winner_slot ? "This month has no winner assigned yet." :
    type === "winner" && !s?.is_announced ? "Heads-up: this month’s winner hasn’t been officially announced in the app yet." :
    type === "confirmation" && !payment ? "No payment has been recorded for this month yet." : null;

  async function render(): Promise<Blob | null> {
    if (!posterRef.current) return null;
    return toBlob(posterRef.current, { width: SIZE, height: SIZE, pixelRatio: 1, cacheBust: true, style: { transform: "none" } });
  }

  const fileName = `${settings.committee_name}-${LABELS[type]}-month-${s?.month_number}`.toLowerCase().replace(/[^a-z0-9]+/g, "-") + ".png";

  async function download() {
    setBusy(true);
    try {
      const blob = await render();
      if (!blob) throw new Error("Could not create the image.");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create the image.");
    } finally {
      setBusy(false);
    }
  }

  async function share() {
    setBusy(true);
    try {
      const blob = await render();
      if (!blob) throw new Error("Could not create the image.");
      const file = new File([blob], fileName, { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: LABELS[type] });
      } else {
        toast.info("Sharing isn’t supported in this browser. The image was downloaded instead — attach it in WhatsApp.");
        await download();
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) toast.error(e instanceof Error ? e.message : "Sharing failed.");
    } finally {
      setBusy(false);
    }
  }

  const who = (m: M | null) => (m ? (showName && m.full_name ? m.full_name : `Slot ${m.slot_code}`) : "—");
  const winnerMember = members.find((m) => m.id === s?.winner_member_id) ?? null;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,320px)_1fr]">
      <Card title="Design">
        <div className="space-y-4">
          <Field label="Poster type" htmlFor="ptype">
            <select id="ptype" className="input" value={type} onChange={(e) => setType(e.target.value as PosterType)}>
              {(Object.keys(LABELS) as PosterType[]).map((k) => <option key={k} value={k}>{LABELS[k]}</option>)}
            </select>
          </Field>
          <Field label="Committee month" htmlFor="pmonth">
            <select id="pmonth" className="input" value={scheduleId} onChange={(e) => setScheduleId(e.target.value)}>
              {schedules.map((x) => <option key={x.id} value={x.id}>Month {x.month_number} · {monthLabel(x.period_month)}</option>)}
            </select>
          </Field>
          {type === "confirmation" && (
            <Field label="Member" htmlFor="pmember">
              <select id="pmember" className="input" value={memberId} onChange={(e) => setMemberId(e.target.value)}>
                {paidMembers.length === 0 && <option value="">No payments recorded</option>}
                {paidMembers.map((p) => {
                  const m = members.find((x) => x.id === p.member_id)!;
                  return <option key={p.id} value={p.member_id}>Slot {m.slot_code}{m.full_name ? ` · ${m.full_name}` : ""}</option>;
                })}
              </select>
            </Field>
          )}
          <Field label="Extra line (optional)" htmlFor="pnote">
            <input id="pnote" className="input" maxLength={90} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. JazakAllah for your trust!" />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-brand-600" checked={showName} onChange={(e) => setShowName(e.target.checked)} />
            Show real names instead of slots
          </label>
          {problem && <Notice tone="amber">{problem}</Notice>}
          <div className="grid grid-cols-2 gap-2">
            <button className="btn btn-primary" onClick={download} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />} PNG
            </button>
            <button className="btn btn-whatsapp" onClick={share} disabled={busy}>
              <Share2 className="size-4" /> Share
            </button>
          </div>
        </div>
      </Card>

      <div>
        <div ref={wrapRef} className="relative mx-auto w-full max-w-[640px] overflow-hidden rounded-2xl shadow-xl" style={{ height: SIZE * scale }}>
          <div style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: SIZE, height: SIZE }}>
            {s && (
              <div
                ref={posterRef}
                style={{ width: SIZE, height: SIZE, fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif" }}
                className="relative flex flex-col overflow-hidden bg-[#022c22] text-white"
              >
                {/* Background */}
                <div className="absolute inset-0" style={{ background: "radial-gradient(1200px 700px at 85% -10%, #0f766e 0%, transparent 60%), radial-gradient(900px 600px at -10% 110%, #065f46 0%, transparent 60%), linear-gradient(160deg, #064e3b 0%, #022c22 70%)" }} />
                <div className="absolute -right-40 -top-40 size-[560px] rounded-full border-[2px] border-[#d4a437]/30" />
                <div className="absolute -right-24 -top-24 size-[420px] rounded-full border border-[#d4a437]/20" />
                <div className="absolute -bottom-52 -left-40 size-[620px] rounded-full bg-[#d4a437]/10 blur-2xl" />
                <div className="absolute inset-x-0 top-0 h-3" style={{ background: "linear-gradient(90deg, #b5862a, #f5d68a, #b5862a)" }} />

                {/* Header */}
                <div className="relative flex items-center justify-between px-[84px] pt-[84px]">
                  <div className="flex items-center gap-5">
                    <div className="grid size-[76px] place-items-center rounded-[22px] bg-white/10 text-[30px] font-black ring-1 ring-white/25">SC</div>
                    <div>
                      <p className="text-[34px] font-bold leading-tight">{settings.committee_name}</p>
                      <p className="text-[24px] text-emerald-100/70">Month {s.month_number} of {schedules.length} · {monthLabel(s.period_month)}</p>
                    </div>
                  </div>
                </div>

                {/* Body */}
                <div className="relative flex flex-1 flex-col justify-center px-[84px]">
                  {type === "reminder" && (
                    <>
                      <Kicker icon={<CalendarDays size={34} />}>Payment reminder</Kicker>
                      <p className="mt-6 text-[130px] font-black leading-none tracking-tight">{money(s.contribution_amount)}</p>
                      <p className="mt-6 text-[40px] text-emerald-50/90">Monthly contribution due by</p>
                      <p className="text-[64px] font-bold text-[#f5d68a]">{formatDate(s.due_date)}</p>
                      <div className="mt-10 flex gap-5">
                        <Chip label="This month’s winner" value={winnerMember ? who(winnerMember) : "TBA"} />
                        <Chip label="Payout" value={money(s.payout_amount)} />
                      </div>
                    </>
                  )}
                  {type === "winner" && (
                    <div className="text-center">
                      <div className="mx-auto grid size-[150px] place-items-center rounded-full bg-gradient-to-br from-[#f5d68a] to-[#b5862a] text-[#3b2a06] shadow-2xl shadow-black/40">
                        <Trophy size={80} strokeWidth={1.8} />
                      </div>
                      <p className="mt-8 text-[34px] font-semibold uppercase tracking-[0.3em] text-[#f5d68a]">Winner</p>
                      <p className="mt-2 text-[150px] font-black leading-none tracking-tight">{winnerMember ? who(winnerMember) : "—"}</p>
                      <p className="mt-6 text-[56px] font-bold">{money(s.payout_amount)}</p>
                      <p className="mt-2 text-[30px] text-emerald-100/80">Congratulations! 🎉</p>
                      {next?.winner_slot && <p className="mt-8 text-[28px] text-emerald-100/70">Next month: Slot {next.winner_slot}</p>}
                    </div>
                  )}
                  {type === "confirmation" && (
                    <>
                      <Kicker icon={<CheckCircle2 size={34} />}>Payment received</Kicker>
                      <p className="mt-6 text-[120px] font-black leading-none tracking-tight">{money(payment?.amount_paid ?? 0)}</p>
                      <p className="mt-6 text-[44px]">from <span className="font-bold text-[#f5d68a]">{who(member)}</span></p>
                      <div className="mt-10 flex flex-wrap gap-5">
                        <Chip label="Date" value={formatDate(payment?.payment_date)} />
                        <Chip label="Reference" value={payment?.transaction_ref || "—"} />
                        {payment && payment.amount_paid < payment.required_amount && <Chip label="Remaining" value={money(payment.required_amount - payment.amount_paid)} />}
                      </div>
                      <p className="mt-10 text-[32px] text-emerald-100/80">JazakAllah for your contribution.</p>
                    </>
                  )}
                  {type === "update" && (
                    <>
                      <Kicker icon={<Wallet size={34} />}>Committee update</Kicker>
                      <p className="mt-6 text-[88px] font-black leading-[1.05] tracking-tight">Month {s.month_number} is here</p>
                      <div className="mt-10 grid grid-cols-2 gap-5">
                        <Chip big label="Contribution" value={money(s.contribution_amount)} />
                        <Chip big label="Due date" value={formatDate(s.due_date)} />
                        <Chip big label="Winner this month" value={winnerMember ? who(winnerMember) : "TBA"} />
                        <Chip big label="Paid so far" value={`${s.paid_count} of ${s.member_count}`} />
                      </div>
                      <p className="mt-8 text-[28px] text-emerald-100/75">Collected across the committee: {money(totalCollected)}</p>
                    </>
                  )}
                </div>

                {/* Footer */}
                <div className="relative flex items-center justify-between border-t border-white/10 px-[84px] py-[44px] text-[26px] text-emerald-100/75">
                  <span>{note || FOOTERS[type]}</span>
                  <span className="whitespace-nowrap pl-6 font-semibold text-[#f5d68a]">{LABELS[type]}</span>
                </div>
              </div>
            )}
          </div>
        </div>
        <p className="mt-3 text-center text-xs text-slate-500">Preview scaled down — the downloaded image is 1080 × 1080 px.</p>
      </div>
    </div>
  );
}

function Kicker({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <p className="inline-flex w-fit items-center gap-4 rounded-full bg-[#d4a437]/15 px-7 py-3 text-[32px] font-semibold text-[#f5d68a] ring-1 ring-[#d4a437]/40">
      {icon}
      {children}
    </p>
  );
}

function Chip({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div className="rounded-[28px] bg-white/[0.07] px-8 py-6 ring-1 ring-white/15">
      <p className="text-[24px] uppercase tracking-wider text-emerald-100/70">{label}</p>
      <p className={`${big ? "text-[44px]" : "text-[40px]"} mt-1 font-bold`}>{value}</p>
    </div>
  );
}
