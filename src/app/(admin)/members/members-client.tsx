"use client";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { Loader2, Pencil, Plus, Search, UserCheck, UserX } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/modal";
import { Badge, Card, EmptyState, Field, PaymentBadge } from "@/components/ui";
import { monthLabel } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import type { MemberSummary } from "@/lib/types";
import { saveMember, setMemberActive, type MemberInput } from "./actions";

function nextSlot(members: MemberSummary[]): string {
  const used = new Set(members.map((m) => m.slot_code));
  for (let i = 0; i < 26; i++) {
    const c = String.fromCharCode(65 + i);
    if (!used.has(c)) return c;
  }
  for (let i = 0; i < 26; i++) {
    const c = `A${String.fromCharCode(65 + i)}`;
    if (!used.has(c)) return c;
  }
  return "";
}

export function MembersClient({ members, currency, defaultJoinMonth }: { members: MemberSummary[]; currency: string; defaultJoinMonth: string }) {
  const [query, setQuery] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<MemberInput | null>(null);
  const [toggling, setToggling] = useState<MemberSummary | null>(null);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return members.filter(
      (m) =>
        (showInactive || m.is_active) &&
        (!q || m.slot_code.toLowerCase().includes(q) || (m.full_name ?? "").toLowerCase().includes(q) || (m.phone_e164 ?? "").includes(q)),
    );
  }, [members, query, showInactive]);

  const openNew = () =>
    setEditing({ slot_code: nextSlot(members), full_name: "", phone: "", joined_month: new Date().toISOString().slice(0, 7) || defaultJoinMonth, notes: "" });
  const openEdit = (m: MemberSummary) =>
    setEditing({ id: m.id, slot_code: m.slot_code, full_name: m.full_name ?? "", phone: m.phone_e164 ?? "", joined_month: m.joined_month.slice(0, 7), notes: m.notes ?? "" });

  function submit() {
    if (!editing) return;
    start(async () => {
      const res = await saveMember(editing);
      if (res.ok) {
        toast.success(res.message);
        setEditing(null);
      } else toast.error(res.error);
    });
  }

  function submitToggle() {
    if (!toggling) return;
    start(async () => {
      const res = await setMemberActive(toggling.id, !toggling.is_active, reason);
      if (res.ok) {
        toast.success(res.message);
        setToggling(null);
        setReason("");
      } else toast.error(res.error);
    });
  }

  const inactiveCount = members.filter((m) => !m.is_active).length;

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9" placeholder="Search slot, name or number" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        {inactiveCount > 0 && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="size-4 accent-brand-600" />
            Show inactive ({inactiveCount})
          </label>
        )}
        <button className="btn btn-primary" onClick={openNew}>
          <Plus className="size-4" /> Add member
        </button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="No members found" />
      ) : (
        <>
          {/* Desktop table */}
          <Card className="hidden md:block">
            <div className="table-wrap -mx-5 -my-5">
              <table className="table">
                <thead>
                  <tr>
                    <th>Slot</th>
                    <th>Name</th>
                    <th>WhatsApp</th>
                    <th>Winner month</th>
                    <th className="text-right">Contributed</th>
                    <th>This month</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((m) => (
                    <tr key={m.id} className={m.is_active ? "" : "opacity-60"}>
                      <td>
                        <Link href={`/members/${m.id}`} className="inline-grid size-8 place-items-center rounded-lg bg-brand-50 font-bold text-brand-800 dark:bg-brand-500/10 dark:text-brand-200">
                          {m.slot_code}
                        </Link>
                      </td>
                      <td>
                        <Link href={`/members/${m.id}`} className="font-medium hover:underline">{m.full_name || <span className="text-slate-400">Not set</span>}</Link>
                        {!m.is_active && <Badge className="ml-2">Inactive</Badge>}
                      </td>
                      <td className="whitespace-nowrap">{m.phone_e164 ? formatPhone(m.phone_e164) : <Badge tone="amber">Missing</Badge>}</td>
                      <td className="whitespace-nowrap">
                        {m.winner_month_number ? (
                          <span>
                            Month {m.winner_month_number} <span className="text-slate-400">· {monthLabel(m.winner_period_month!)}</span>
                            {m.has_won && <Badge tone="gold" className="ml-2">Won</Badge>}
                          </span>
                        ) : (
                          <span className="text-slate-400">Unassigned</span>
                        )}
                      </td>
                      <td className="text-right tabular-nums">{formatMoney(m.total_contributed, currency)}</td>
                      <td><PaymentBadge status={m.current_status} /></td>
                      <td className="whitespace-nowrap text-right">
                        <button className="btn btn-ghost btn-sm" onClick={() => openEdit(m)} aria-label={`Edit slot ${m.slot_code}`}><Pencil className="size-4" /></button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setToggling(m)} aria-label={m.is_active ? "Deactivate" : "Reactivate"}>
                          {m.is_active ? <UserX className="size-4" /> : <UserCheck className="size-4" />}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Mobile cards */}
          <div className="grid gap-3 md:hidden">
            {filtered.map((m) => (
              <div key={m.id} className={`card card-pad ${m.is_active ? "" : "opacity-60"}`}>
                <div className="flex items-start gap-3">
                  <Link href={`/members/${m.id}`} className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-50 text-lg font-bold text-brand-800 dark:bg-brand-500/10 dark:text-brand-200">
                    {m.slot_code}
                  </Link>
                  <div className="min-w-0 flex-1">
                    <Link href={`/members/${m.id}`} className="font-semibold">{m.full_name || `Slot ${m.slot_code}`}</Link>
                    <p className="text-xs text-slate-500">{m.phone_e164 ? formatPhone(m.phone_e164) : "No WhatsApp number"}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <PaymentBadge status={m.current_status} />
                      {m.winner_month_number && <Badge tone="gold">Wins month {m.winner_month_number}</Badge>}
                      {m.has_won && <Badge tone="green">Won</Badge>}
                      {!m.is_active && <Badge>Inactive</Badge>}
                    </div>
                  </div>
                  <div className="flex flex-col">
                    <button className="btn btn-ghost btn-sm" onClick={() => openEdit(m)} aria-label="Edit"><Pencil className="size-4" /></button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setToggling(m)} aria-label={m.is_active ? "Deactivate" : "Reactivate"}>
                      {m.is_active ? <UserX className="size-4" /> : <UserCheck className="size-4" />}
                    </button>
                  </div>
                </div>
                <p className="mt-3 border-t border-slate-100 pt-2 text-xs text-slate-500 dark:border-slate-800">
                  Contributed {formatMoney(m.total_contributed, currency)}
                </p>
              </div>
            ))}
          </div>
        </>
      )}

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? `Edit slot ${editing.slot_code}` : "Add member"}
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={submit} disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />} Save
            </button>
          </>
        }
      >
        {editing && (
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <Field label="Slot code" htmlFor="slot" hint="Alphabetical ID shown everywhere instead of the real name.">
              <input id="slot" className="input uppercase" maxLength={5} value={editing.slot_code} onChange={(e) => setEditing({ ...editing, slot_code: e.target.value.toUpperCase() })} required />
            </Field>
            <Field label="Name (optional)" htmlFor="name">
              <input id="name" className="input" maxLength={80} value={editing.full_name} onChange={(e) => setEditing({ ...editing, full_name: e.target.value })} />
            </Field>
            <Field label="WhatsApp number" htmlFor="phone" hint="Include the country code, e.g. +92 300 1234567. A number starting with 0 is treated as Pakistani.">
              <input id="phone" className="input" inputMode="tel" placeholder="+92 300 1234567" value={editing.phone} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} />
            </Field>
            <Field label="Joined from month" htmlFor="joined" hint="Payment rows are created from this month onwards.">
              <input id="joined" type="month" className="input" value={editing.joined_month} onChange={(e) => setEditing({ ...editing, joined_month: e.target.value })} required />
            </Field>
            <Field label="Notes (optional)" htmlFor="notes">
              <textarea id="notes" className="input" rows={2} maxLength={500} value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
            </Field>
          </form>
        )}
      </Modal>

      <Modal
        open={!!toggling}
        onClose={() => setToggling(null)}
        title={toggling?.is_active ? `Deactivate slot ${toggling?.slot_code}?` : `Reactivate slot ${toggling?.slot_code}?`}
        description={
          toggling?.is_active
            ? "Past payments stay in the records. Future unpaid months are removed and an unannounced winner month becomes unassigned."
            : "Payment rows will be created again from the member’s joining month."
        }
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setToggling(null)}>Cancel</button>
            <button className={`btn ${toggling?.is_active ? "btn-danger" : "btn-primary"}`} onClick={submitToggle} disabled={pending || reason.trim().length < 3}>
              {pending && <Loader2 className="size-4 animate-spin" />} {toggling?.is_active ? "Deactivate" : "Reactivate"}
            </button>
          </>
        }
      >
        <Field label="Reason (saved in the activity log)" htmlFor="reason">
          <input id="reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Left the committee" />
        </Field>
      </Modal>
    </>
  );
}
