"use client";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { ArrowDownAZ, Image as ImageIcon, Loader2, Lock, Megaphone, Pencil, Send, Trophy, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/modal";
import { Badge, Card, Field, Notice } from "@/components/ui";
import { formatDateTime, monthLabel } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import type { ScheduleRow } from "@/lib/types";
import { reportWinnerMessage, WinnerShareModal } from "@/components/winner-message";
import type { WinnerNotifyResult } from "@/lib/winner-notify";
import { announceWinner, resetSequence, saveSequence, voidWinner } from "./actions";

type M = { id: string; slot_code: string; full_name: string | null; has_won: boolean };

export function WinnersClient({
  schedules,
  members,
  isOwner,
  currency,
  timezone,
  slug,
  luckyDraw,
}: {
  schedules: ScheduleRow[];
  members: M[];
  isOwner: boolean;
  currency: string;
  timezone: string;
  slug: string;
  luckyDraw: boolean;
}) {
  const [shareResult, setShareResult] = useState<WinnerNotifyResult | null>(null);
  const [shareMonth, setShareMonth] = useState<number | null>(null);
  const [pending, start] = useTransition();
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [announcing, setAnnouncing] = useState<ScheduleRow | null>(null);
  const [confirm, setConfirm] = useState("");
  const [notes, setNotes] = useState("");
  const [voiding, setVoiding] = useState<ScheduleRow | null>(null);
  const [reason, setReason] = useState("");

  const current = schedules.find((s) => s.phase === "current");
  const upcoming = current ? schedules.find((s) => s.month_number === current.month_number + 1) : schedules.find((s) => s.phase === "upcoming");

  const startEdit = () => {
    setDraft(Object.fromEntries(schedules.map((s) => [s.id, s.winner_member_id ?? ""])));
    setEditMode(true);
  };

  const duplicates = useMemo(() => {
    const seen = new Map<string, number>();
    Object.values(draft).forEach((v) => v && seen.set(v, (seen.get(v) ?? 0) + 1));
    return new Set([...seen].filter(([, c]) => c > 1).map(([k]) => k));
  }, [draft]);

  const run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>, after?: () => void) =>
    start(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(res.message);
        after?.();
      } else toast.error(res.error);
    });

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="card card-pad relative overflow-hidden bg-gradient-to-br from-amber-50 to-white dark:from-amber-400/10 dark:to-slate-900">
          <Trophy className="absolute -right-3 -top-3 size-24 text-amber-400/20" />
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">This month</p>
          {current ? (
            <>
              <p className="mt-1 text-2xl font-bold">{current.winner_slot ? `Slot ${current.winner_slot}` : "Not assigned"}</p>
              <p className="text-sm text-slate-600 dark:text-slate-300">Month {current.month_number} · {monthLabel(current.period_month)} · {formatMoney(current.payout_amount, currency)}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {current.is_announced ? (
                  <>
                    <Badge tone="green">Announced {formatDateTime(current.announced_at, timezone)}</Badge>
                    <Link className="btn btn-secondary btn-sm" href={`/banners?month=${current.month_number}`}><ImageIcon className="size-4" /> Winner banner</Link>
                  </>
                ) : (
                  luckyDraw ? (
                    <Link className="btn btn-primary btn-sm" href="/draw"><Megaphone className="size-4" /> Hold the lucky draw</Link>
                  ) : (
                    current.winner_slot && (
                      <button className="btn btn-primary btn-sm" onClick={() => { setAnnouncing(current); setConfirm(""); setNotes(""); }}>
                        <Megaphone className="size-4" /> Announce winner
                      </button>
                    )
                  )
                )}
              </div>
            </>
          ) : (
            <p className="mt-1 text-sm text-slate-500">No committee month is running today.</p>
          )}
        </div>
        <div className="card card-pad">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Upcoming</p>
          {upcoming ? (
            <>
              <p className="mt-1 text-2xl font-bold">{upcoming.winner_slot ? `Slot ${upcoming.winner_slot}` : "Not assigned"}</p>
              <p className="text-sm text-slate-500">Month {upcoming.month_number} · {monthLabel(upcoming.period_month)}</p>
            </>
          ) : (
            <p className="mt-1 text-sm text-slate-500">No more months.</p>
          )}
        </div>
      </div>

      <Card
        className="mt-5"
        title={`${schedules.length}-month schedule`}
        action={
          editMode ? (
            <div className="flex gap-2">
              <button className="btn btn-secondary btn-sm" onClick={() => setEditMode(false)}>Cancel</button>
              <button
                className="btn btn-primary btn-sm"
                disabled={pending || duplicates.size > 0}
                onClick={() =>
                  run(
                    () => saveSequence(schedules.filter((s) => !s.is_announced).map((s) => ({ schedule_id: s.id, member_id: draft[s.id] || null }))),
                    () => setEditMode(false),
                  )
                }
              >
                {pending && <Loader2 className="size-4 animate-spin" />} Save order
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <button className="btn btn-ghost btn-sm" disabled={pending} onClick={() => confirmReset() && run(resetSequence)}>
                <ArrowDownAZ className="size-4" /> <span className="hidden sm:inline">Reset A→Z</span>
              </button>
              <button className="btn btn-secondary btn-sm" onClick={startEdit}><Pencil className="size-4" /> Change order</button>
            </div>
          )
        }
      >
        {editMode && (
          <div className="mb-4">
            <Notice tone={duplicates.size ? "red" : "blue"}>
              {duplicates.size
                ? "A member is selected for more than one month. Each member can win only once."
                : "Choose the winner for each month. Locked months (already announced) can’t be changed. Past data is never altered."}
            </Notice>
          </div>
        )}
        <ol className="-my-2 divide-y divide-slate-100 dark:divide-slate-800">
          {schedules.map((s) => {
            const canAnnounce = !s.is_announced && s.phase !== "upcoming" && s.winner_slot;
            return (
              <li key={s.id} className={`flex flex-wrap items-center gap-3 py-3 ${s.phase === "current" ? "-mx-2 rounded-xl bg-brand-50/60 px-2 dark:bg-brand-500/5" : ""}`}>
                <div className="grid size-9 place-items-center rounded-lg bg-slate-100 text-sm font-bold tabular-nums dark:bg-slate-800">{s.month_number}</div>
                <div className="min-w-32 flex-1">
                  <p className="text-sm font-medium">{monthLabel(s.period_month)}</p>
                  <p className="text-xs text-slate-500">{formatMoney(s.payout_amount, currency)}</p>
                </div>
                <div className="w-full sm:w-auto sm:min-w-48">
                  {s.reserve_status && !s.is_announced ? (
                    <p className="text-sm text-amber-700 dark:text-amber-300">
                      {s.reserve_status === "given" ? `Reserve given to Slot ${s.reserve_member_slot} (help)` : "Reserved for financial support"}
                    </p>
                  ) : editMode && !s.is_announced ? (
                    <select
                      className={`input py-2 ${draft[s.id] && duplicates.has(draft[s.id]) ? "border-rose-500" : ""}`}
                      value={draft[s.id] ?? ""}
                      onChange={(e) => setDraft({ ...draft, [s.id]: e.target.value })}
                      aria-label={`Winner for month ${s.month_number}`}
                    >
                      <option value="">— Unassigned —</option>
                      {members.filter((m) => !m.has_won).map((m) => (
                        <option key={m.id} value={m.id}>Slot {m.slot_code}{m.full_name ? ` · ${m.full_name}` : ""}</option>
                      ))}
                    </select>
                  ) : (
                    <p className="text-sm">
                      {s.winner_slot ? <span className="font-semibold">Slot {s.winner_slot}</span> : <span className="text-slate-400">Unassigned</span>}
                      {s.winner_name && <span className="text-slate-500"> · {s.winner_name}</span>}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:w-80 sm:justify-end">
                  {s.is_announced ? (
                    <>
                      <Badge tone="green"><Lock className="size-3" /> Announced {formatDateTime(s.announced_at, timezone)}</Badge>
                      {!editMode && (
                        <>
                          <Link className="btn btn-ghost btn-sm" href={`/banners?month=${s.month_number}`} title="Winner banner"><ImageIcon className="size-4" /></Link>
                          <Link className="btn btn-ghost btn-sm" href={`/notifications?template=winner_announcement&month=${s.month_number}`} title="Send to members"><Send className="size-4" /></Link>
                          {isOwner && (
                            <button className="btn btn-ghost btn-sm text-rose-600" onClick={() => { setVoiding(s); setReason(""); }} title="Correct (void) announcement">
                              <Undo2 className="size-4" />
                            </button>
                          )}
                        </>
                      )}
                    </>
                  ) : s.reserve_status ? (
                    <>
                      <Badge tone="amber">{s.reserve_status === "given" ? "Reserve given" : "Reserved"}</Badge>
                      {!editMode && <Link className="btn btn-ghost btn-sm" href="/draw#reserves">Manage</Link>}
                    </>
                  ) : s.phase === "upcoming" ? (
                    <>
                      <Badge>Upcoming</Badge>
                      {luckyDraw && !editMode && (
                        <Link className="btn btn-ghost btn-sm" href={`/draw?month=${s.month_number}`} title="Draw this month in advance"><Megaphone className="size-4" /> Draw early</Link>
                      )}
                    </>
                  ) : (
                    <>
                      <Badge tone="amber">Not announced</Badge>
                      {luckyDraw && !editMode && (
                        <Link className="btn btn-primary btn-sm" href={`/draw?month=${s.month_number}`}><Megaphone className="size-4" /> Lucky draw</Link>
                      )}
                      {canAnnounce && !editMode && !luckyDraw && (
                        <button className="btn btn-primary btn-sm" onClick={() => { setAnnouncing(s); setConfirm(""); setNotes(""); }}>
                          <Megaphone className="size-4" /> Announce
                        </button>
                      )}
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </Card>

      <Modal
        open={!!announcing}
        onClose={() => setAnnouncing(null)}
        title={`Announce month ${announcing?.month_number} winner`}
        description="This is saved permanently with the date and time. It can only be undone by an owner, with a reason."
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setAnnouncing(null)}>Cancel</button>
            <button
              className="btn btn-primary"
              disabled={pending || confirm.trim().toUpperCase() !== announcing?.winner_slot}
              onClick={() =>
                announcing &&
                start(async () => {
                  const res = await announceWinner(announcing.id, confirm, notes);
                  if (!res.ok) {
                    toast.error(res.error);
                    return;
                  }
                  toast.success(res.message);
                  const month = announcing.month_number;
                  setAnnouncing(null);
                  if (reportWinnerMessage(res.data)) {
                    setShareMonth(month);
                    setShareResult(res.data!);
                  }
                })
              }
            >
              {pending && <Loader2 className="size-4 animate-spin" />} Confirm announcement
            </button>
          </>
        }
      >
        {announcing && (
          <div className="space-y-4">
            <div className="rounded-2xl bg-gradient-to-br from-brand-700 to-brand-900 p-5 text-center text-white">
              <p className="text-xs uppercase tracking-widest text-brand-100">{monthLabel(announcing.period_month)}</p>
              <p className="mt-1 text-4xl font-black">Slot {announcing.winner_slot}</p>
              <p className="mt-1 text-gold-300">{formatMoney(announcing.payout_amount, currency)}</p>
            </div>
            <Field label={`Type ${announcing.winner_slot} to confirm`} htmlFor="confirm">
              <input id="confirm" className="input uppercase" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
            </Field>
            <Field label="Note (optional)" htmlFor="anote">
              <input id="anote" className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Announced at family dinner" />
            </Field>
          </div>
        )}
      </Modal>

      <Modal
        open={!!voiding}
        onClose={() => setVoiding(null)}
        title={`Correct month ${voiding?.month_number} announcement`}
        description="The original announcement stays in the records as “voided”. You can then change the winner and announce again."
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setVoiding(null)}>Cancel</button>
            <button
              className="btn btn-danger"
              disabled={pending || reason.trim().length < 5}
              onClick={() => voiding?.announcement_id && run(() => voidWinner(voiding.announcement_id!, reason), () => setVoiding(null))}
            >
              {pending && <Loader2 className="size-4 animate-spin" />} Void announcement
            </button>
          </>
        }
      >
        <Field label="Reason for the correction (required)" htmlFor="vreason">
          <textarea id="vreason" className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </Modal>
      <WinnerShareModal
        result={shareResult}
        bannerSrc={shareMonth ? `/api/banner/${slug}/${shareMonth}` : null}
        onClose={() => setShareResult(null)}
      />
    </>
  );
}

function confirmReset() {
  return window.confirm("Reset every unannounced month to alphabetical slot order? Announced months are not affected.");
}
