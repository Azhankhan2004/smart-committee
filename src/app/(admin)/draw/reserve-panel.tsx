"use client";
import { useState } from "react";
import { HandHeart, Loader2, PiggyBank, RotateCcw, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/modal";
import { Badge, Card, Field } from "@/components/ui";
import { formatMoney } from "@/lib/format";
import type { ActionResult } from "@/lib/types";
import { giveReserve, releaseReserve, reserveMonth, undoReserveGift } from "./actions";

type OpenMonth = { id: string; month_number: number; label: string; payout: number };
type Reserved = OpenMonth & {
  status: "reserved" | "given";
  type: "payout" | "help" | null;
  slot: string | null;
  reason: string | null;
  note: string | null;
};
type Member = { id: string; slot: string; name: string | null; hasWon: boolean };

type Dialog =
  | { kind: "reserve"; monthId: string; reason: string }
  | { kind: "give"; month: Reserved; memberId: string; type: "payout" | "help"; note: string }
  | { kind: "release" | "undo"; month: Reserved; reason: string };

/** Reserve months: keep a month's payout aside for a member who needs financial support. */
export function ReservePanel({ isOwner, currency, open, reserved, members }: {
  isOwner: boolean;
  currency: string;
  open: OpenMonth[];
  reserved: Reserved[];
  members: Member[];
}) {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busy, setBusy] = useState(false);
  const kept = reserved.filter((r) => r.status === "reserved").reduce((a, r) => a + r.payout, 0);

  async function run(fn: () => Promise<ActionResult>) {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(res.message);
    setDialog(null);
    window.location.assign("/draw");
  }

  const reasonOk = (t: string) => t.trim().length >= 5;
  const giveMembers = dialog?.kind === "give" ? members.filter((m) => dialog.type === "help" || !m.hasWon) : [];

  return (
    <div id="reserves" className="scroll-mt-20">
    <Card className="mt-6" title="Reserve months (financial support)">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Instead of a draw, a month can be <b>reserved</b>. Its payout is kept aside and can be given to a member who genuinely needs financial support.
        Reserved months are skipped by the lucky draw and the automatic scheduler.
      </p>
      {reserved.length > 0 && (
        <p className="mt-2 text-sm">
          Kept aside now: <b>{formatMoney(kept, currency)}</b> ({reserved.filter((r) => r.status === "reserved").length} month
          {reserved.filter((r) => r.status === "reserved").length === 1 ? "" : "s"})
        </p>
      )}

      <ul className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
        {reserved.length === 0 && <li className="py-2 text-sm text-slate-500">No months are reserved.</li>}
        {reserved.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="font-semibold">
                Month {r.month_number} · {r.label}{" "}
                {r.status === "reserved" ? <Badge tone="amber">Reserved · {formatMoney(r.payout, currency)}</Badge> : <Badge tone="green">Given</Badge>}
              </p>
              <p className="text-xs text-slate-500">
                {r.status === "given"
                  ? `Given to Slot ${r.slot} · ${r.type === "payout" ? "counts as their committee payout" : "help only (stays in future draws)"}${r.note ? ` · ${r.note}` : ""}`
                  : r.reason ?? ""}
              </p>
            </div>
            {isOwner && (
              <div className="flex flex-wrap gap-2">
                {r.status === "reserved" ? (
                  <>
                    <button className="btn btn-primary btn-sm" onClick={() => setDialog({ kind: "give", month: r, memberId: "", type: "payout", note: "" })}>
                      <HandHeart className="size-4" /> Give to a member
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={() => setDialog({ kind: "release", month: r, reason: "" })}>
                      <RotateCcw className="size-4" /> Release to draw
                    </button>
                  </>
                ) : (
                  <button className="btn btn-secondary btn-sm" onClick={() => setDialog({ kind: "undo", month: r, reason: "" })}>
                    <Undo2 className="size-4" /> Undo
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      {isOwner && open.length > 0 && (
        <button className="btn btn-secondary mt-3" onClick={() => setDialog({ kind: "reserve", monthId: open[0].id, reason: "" })}>
          <PiggyBank className="size-4" /> Reserve a month
        </button>
      )}
      {!isOwner && <p className="mt-3 text-xs text-slate-500">Only an owner can reserve months or give out reserves.</p>}

      {/* Reserve a month */}
      <Modal
        open={dialog?.kind === "reserve"}
        onClose={() => setDialog(null)}
        title="Reserve a month"
        description="There is no draw for this month. Its payout is kept aside for a member who needs financial support."
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setDialog(null)}>Cancel</button>
            <button
              className="btn btn-primary"
              disabled={busy || dialog?.kind !== "reserve" || !reasonOk(dialog.reason)}
              onClick={() => dialog?.kind === "reserve" && run(() => reserveMonth(dialog.monthId, dialog.reason))}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <PiggyBank className="size-4" />} Reserve month
            </button>
          </>
        }
      >
        {dialog?.kind === "reserve" && (
          <div className="space-y-4">
            <Field label="Month" htmlFor="rs-month">
              <select id="rs-month" className="input" value={dialog.monthId} onChange={(e) => setDialog({ ...dialog, monthId: e.target.value })}>
                {open.map((m) => (
                  <option key={m.id} value={m.id}>Month {m.month_number} · {m.label} · {formatMoney(m.payout, currency)}</option>
                ))}
              </select>
            </Field>
            <Field label="Reason (saved in the activity log)" htmlFor="rs-reason" hint="At least 5 characters.">
              <input id="rs-reason" className="input" value={dialog.reason} placeholder="e.g. Kept aside for members who need help"
                onChange={(e) => setDialog({ ...dialog, reason: e.target.value })} />
            </Field>
          </div>
        )}
      </Modal>

      {/* Give a reserve */}
      <Modal
        open={dialog?.kind === "give"}
        onClose={() => setDialog(null)}
        title={dialog?.kind === "give" ? `Give the month ${dialog.month.month_number} reserve` : ""}
        description={dialog?.kind === "give" ? `${formatMoney(dialog.month.payout, currency)} goes to the member you choose.` : ""}
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setDialog(null)}>Cancel</button>
            <button
              className="btn btn-primary"
              disabled={busy || dialog?.kind !== "give" || !dialog.memberId || !reasonOk(dialog.note)}
              onClick={() => dialog?.kind === "give" && run(() => giveReserve(dialog.month.id, dialog.memberId, dialog.type, dialog.note))}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <HandHeart className="size-4" />} Give reserve
            </button>
          </>
        }
      >
        {dialog?.kind === "give" && (
          <div className="space-y-4">
            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-medium">How is it given?</legend>
              {([
                ["payout", "Counts as their committee payout", "This is their winning month. They are removed from future draws."],
                ["help", "Help only", "Support for a difficult time. They stay in future draws."],
              ] as const).map(([v, title, hint]) => (
                <label key={v} className={`flex cursor-pointer gap-3 rounded-xl border p-3 ${dialog.type === v ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10" : "border-slate-200 dark:border-slate-700"}`}>
                  <input type="radio" name="give-type" className="mt-1" checked={dialog.type === v} onChange={() => setDialog({ ...dialog, type: v, memberId: "" })} />
                  <span>
                    <span className="block text-sm font-semibold">{title}</span>
                    <span className="block text-xs text-slate-500">{hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <Field label="Member" htmlFor="gv-member" hint={dialog.type === "payout" ? "Members who have already won are not listed." : undefined}>
              <select id="gv-member" className="input" value={dialog.memberId} onChange={(e) => setDialog({ ...dialog, memberId: e.target.value })}>
                <option value="">Choose a member…</option>
                {giveMembers.map((m) => (
                  <option key={m.id} value={m.id}>Slot {m.slot}{m.name ? ` · ${m.name}` : ""}</option>
                ))}
              </select>
            </Field>
            <Field label="Note (saved in the activity log)" htmlFor="gv-note" hint="At least 5 characters. Keep it short and respectful.">
              <input id="gv-note" className="input" value={dialog.note} placeholder="e.g. Medical emergency"
                onChange={(e) => setDialog({ ...dialog, note: e.target.value })} />
            </Field>
          </div>
        )}
      </Modal>

      {/* Release / Undo */}
      <Modal
        open={dialog?.kind === "release" || dialog?.kind === "undo"}
        onClose={() => setDialog(null)}
        title={dialog?.kind === "release" ? `Release the month ${dialog.month.month_number} reserve?` : dialog?.kind === "undo" ? `Undo the month ${dialog.month.month_number} reserve gift?` : ""}
        description={dialog?.kind === "release"
          ? "The month goes back to a normal lucky draw."
          : "The gift is cancelled and the month is reserved again. If it counted as a payout, that winner announcement is voided."}
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setDialog(null)}>Cancel</button>
            <button
              className="btn btn-danger"
              disabled={busy || (dialog?.kind !== "release" && dialog?.kind !== "undo") || !reasonOk(dialog.reason)}
              onClick={() => {
                if (dialog?.kind === "release") void run(() => releaseReserve(dialog.month.id, dialog.reason));
                if (dialog?.kind === "undo") void run(() => undoReserveGift(dialog.month.id, dialog.reason));
              }}
            >
              {busy && <Loader2 className="size-4 animate-spin" />} {dialog?.kind === "release" ? "Release" : "Undo gift"}
            </button>
          </>
        }
      >
        {(dialog?.kind === "release" || dialog?.kind === "undo") && (
          <Field label="Reason (saved in the activity log)" htmlFor="rl-reason" hint="At least 5 characters.">
            <input id="rl-reason" className="input" value={dialog.reason} onChange={(e) => setDialog({ ...dialog, reason: e.target.value })} />
          </Field>
        )}
      </Modal>
    </Card>
    </div>
  );
}
