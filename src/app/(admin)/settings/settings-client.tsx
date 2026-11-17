"use client";
import { useState, useTransition } from "react";
import { CheckCircle2, Copy, Loader2, Play, Save, Search, Send, Trash2, UserPlus, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/modal";
import { Badge, Card, Field, Notice } from "@/components/ui";
import { formatMoney } from "@/lib/format";
import type { SchedulerReport } from "@/lib/scheduler-engine";
import { TEMPLATE_LABELS } from "@/lib/templates";
import type { Settings } from "@/lib/types";
import type { WhatsAppStatus } from "@/lib/whatsapp";
import {
  changeStartMonth,
  addAdmin, clearWhatsApp, removeAdmin, runSchedulerNow, saveLogo, savePublicPage, saveSettings, saveWhatsApp, sendTestMessage, type SettingsInput,
} from "./actions";

type WA = WhatsAppStatus;

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <span className="relative mt-0.5 inline-flex">
        <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="h-6 w-11 rounded-full bg-slate-300 transition peer-checked:bg-brand-600 peer-focus-visible:ring-4 peer-focus-visible:ring-brand-500/30 dark:bg-slate-700" />
        <span className="absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
      </span>
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-slate-500">{hint}</span>}
      </span>
    </label>
  );
}

/** Shrinks an image to fit a size×size square and returns a PNG data URL. */
function resizeImage(file: File, size: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(size / img.width, size / img.height, 1);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(img.src);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

function Status({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      {ok ? <CheckCircle2 className="size-4 text-emerald-600" /> : <XCircle className="size-4 text-rose-500" />}
      {label}
    </li>
  );
}

export function SettingsClient({
  settings,
  isOwner,
  hasHistory,
  admins,
  wa,
  server,
  committee,
  currentUserId,
}: {
  settings: Settings;
  isOwner: boolean;
  hasHistory: boolean;
  admins: { user_id: string; email: string | null; role: string }[];
  wa: WA;
  server: { cronSecret: boolean; serviceRole: boolean; appUrl: string };
  committee: { slug: string; publicEnabled: boolean; logo: string | null };
  currentUserId: string;
}) {
  const { committee_id: _id, updated_at: _u, ...initial } = settings;
  const [pub, setPub] = useState({ slug: committee.slug, public_enabled: committee.publicEnabled });
  const [newAdmin, setNewAdmin] = useState({ email: "", role: "admin" as "owner" | "admin" });
  const [waForm, setWaForm] = useState({ phoneNumberId: "", accessToken: "", businessAccountId: "", displayPhone: wa.displayPhone ?? "" });
  const [busy, startBusy] = useTransition();
  const act = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>, after?: () => void) =>
    startBusy(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(r.message);
        after?.();
      } else toast.error(r.error);
    });
  const publicUrl = `${server.appUrl}/p/${committee.slug}`;
  const [f, setF] = useState<SettingsInput>(initial);
  const [move, setMove] = useState<{ month: string; reason: string } | null>(null);
  const [pending, start] = useTransition();
  const [running, startRun] = useTransition();
  const [report, setReport] = useState<SchedulerReport | null>(null);
  const [testPhone, setTestPhone] = useState("");
  const [testing, startTest] = useTransition();

  const set = <K extends keyof SettingsInput>(k: K, v: SettingsInput[K]) => setF((cur) => ({ ...cur, [k]: v }));
  const num = (k: keyof SettingsInput) => (e: React.ChangeEvent<HTMLInputElement>) => set(k, Number(e.target.value) as never);
  const computedPayout = f.monthly_contribution * f.total_members;

  const save = () =>
    start(async () => {
      const res = await saveSettings(f);
      if (res.ok) toast.success(res.message);
      else toast.error(res.error);
    });

  const run = (dry: boolean) => {
    if (!dry && !window.confirm("Run the scheduler now? Messages due today will be sent through WhatsApp (duplicates are skipped automatically).")) return;
    startRun(async () => {
      const res = await runSchedulerNow(dry);
      if (res.ok) {
        setReport(res.data!);
        if (!dry) toast.success(`Scheduler finished: ${res.data!.summary.sent} sent.`);
      } else toast.error(res.error);
    });
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Committee & money">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="Committee name" htmlFor="cname">
                <input id="cname" className="input" value={f.committee_name} onChange={(e) => set("committee_name", e.target.value)} />
              </Field>
            </div>
            <Field label="Number of members / months" htmlFor="tm">
              <input id="tm" className="input" type="number" min={2} max={60} value={f.total_members} onChange={num("total_members")} />
            </Field>
            <Field label="Currency" htmlFor="cur">
              <input id="cur" className="input uppercase" maxLength={3} value={f.currency} onChange={(e) => set("currency", e.target.value.toUpperCase())} />
            </Field>
            <Field label="Monthly contribution per member" htmlFor="mc">
              <input id="mc" className="input" type="number" min={1} value={f.monthly_contribution} onChange={num("monthly_contribution")} />
            </Field>
            <Field
              label="Monthly winner payout"
              htmlFor="po"
              hint={
                computedPayout !== f.payout_amount ? (
                  <button type="button" className="text-brand-700 underline dark:text-brand-300" onClick={() => set("payout_amount", computedPayout)}>
                    Use {formatMoney(computedPayout, f.currency)} (members × contribution)
                  </button>
                ) : (
                  "Matches members × contribution."
                )
              }
            >
              <input id="po" className="input" type="number" min={1} value={f.payout_amount} onChange={num("payout_amount")} />
            </Field>
            <Field label="Start month" htmlFor="sm" hint={hasHistory ? "Payments are recorded, so use “Change start month” to move it safely." : "Month 1 of the committee."}>
              <div className="grid gap-2">
                <input id="sm" className="input" type="month" disabled={hasHistory} value={f.start_month.slice(0, 7)} onChange={(e) => set("start_month", `${e.target.value}-01`)} />
                {hasHistory && isOwner && (
                  <button type="button" className="btn btn-secondary btn-sm justify-self-start" onClick={() => { setMove({ month: f.start_month.slice(0, 7), reason: "" }); }}>
                    Change start month
                  </button>
                )}
              </div>
            </Field>
            <Field label="Time zone" htmlFor="tz">
              <input id="tz" className="input" value={f.timezone} onChange={(e) => set("timezone", e.target.value)} />
            </Field>
          </div>
          <div className="mt-4">
            <Notice tone="blue">Changing amounts or dates only affects months with no recorded payments and no announced winner. History is never rewritten.</Notice>
          </div>
        </Card>

        <Card title="Reminder schedule">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Payment due day (of month)" htmlFor="dd">
              <input id="dd" className="input" type="number" min={1} max={28} value={f.payment_due_day} onChange={num("payment_due_day")} />
            </Field>
            <Field label="Reminder before due date (days)" htmlFor="rb" hint="0 = off">
              <input id="rb" className="input" type="number" min={0} max={27} value={f.reminder_days_before} onChange={num("reminder_days_before")} />
            </Field>
            <Field label="Overdue alert every (days)" htmlFor="ov" hint="0 = off">
              <input id="ov" className="input" type="number" min={0} max={30} value={f.overdue_reminder_every_days} onChange={num("overdue_reminder_every_days")} />
            </Field>
            <Field label="Monthly reminder day" htmlFor="mr">
              <input id="mr" className="input" type="number" min={1} max={28} value={f.monthly_reminder_day} onChange={num("monthly_reminder_day")} />
            </Field>
            <Field label="New month update day" htmlFor="mu">
              <input id="mu" className="input" type="number" min={1} max={28} value={f.monthly_update_day} onChange={num("monthly_update_day")} />
            </Field>
            <Field label="Winner announcement day" htmlFor="wd">
              <input id="wd" className="input" type="number" min={1} max={28} value={f.winner_announcement_day} onChange={num("winner_announcement_day")} />
            </Field>
          </div>
          <div className="mt-5">
            <Field label="How is each month’s winner chosen?" htmlFor="ws">
              <select id="ws" className="input" value={f.winner_selection} onChange={(e) => set("winner_selection", e.target.value as SettingsInput["winner_selection"])}>
                <option value="sequence">Fixed order (A → Q, or the order you set on the Winners page)</option>
                <option value="lucky_draw">Lucky draw every month (random, among members who haven’t won)</option>
              </select>
            </Field>
          </div>
          <div className="mt-5 space-y-4">
            <Toggle checked={f.remind_on_due_date} onChange={(v) => set("remind_on_due_date", v)} label="Remind on the due date" />
            <Toggle
              checked={f.auto_send_enabled}
              onChange={(v) => set("auto_send_enabled", v)}
              label="Send reminders automatically"
              hint="The daily scheduler sends due messages through the WhatsApp Cloud API."
            />
            <Toggle
              checked={f.auto_announce_winner}
              onChange={(v) => set("auto_announce_winner", v)}
              label="Pick the winner automatically on the announcement day"
              hint={f.winner_selection === "lucky_draw" ? "The scheduler holds the lucky draw by itself and messages the winner." : "Uses the saved winner order. Leave off to announce manually."}
            />
          </div>
        </Card>
      </div>

      <div className="flex justify-end">
        <button className="btn btn-primary" onClick={save} disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save settings & update schedule
        </button>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Automated scheduler">
          <ul className="space-y-1.5">
            <Status ok={server.cronSecret} label="CRON_SECRET set (protects the scheduler URL)" />
            <Status ok={server.serviceRole} label="Service role key set (lets the scheduler run without a signed-in admin)" />
            <Status ok={wa.configured} label="WhatsApp Cloud API connected" />
            <Status ok={settings.auto_send_enabled} label="Automatic sending switched on (saved setting)" />
          </ul>
          <p className="mt-3 text-xs text-slate-500">
            On Vercel the scheduler runs once a day at about 9:00 AM Pakistan time (vercel.json). Messages missed on one day are caught up within 2 days, and duplicates are blocked.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button className="btn btn-secondary" onClick={() => run(true)} disabled={running}>
              {running ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />} Preview today (dry run)
            </button>
            <button className="btn btn-primary" onClick={() => run(false)} disabled={running}>
              <Play className="size-4" /> Run now
            </button>
          </div>
          {report && (
            <div className="mt-4 space-y-2 rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
              <p className="font-semibold">
                {report.dryRun ? "Dry run" : "Run"} for {report.today} — {report.planned.length} message(s) due
              </p>
              {!report.dryRun && report.ran && (
                <p>{report.summary.sent} sent · {report.summary.failed} failed · {report.summary.skipped} skipped · {report.summary.duplicate} already sent</p>
              )}
              {report.autoAnnounced && <p>Announced: {report.autoAnnounced}</p>}
              {report.notes.map((n, i) => <p key={i} className="text-slate-600 dark:text-slate-300">• {n}</p>)}
              {report.planned.length > 0 && (
                <ul className="max-h-48 overflow-y-auto text-xs">
                  {report.planned.map((p, i) => (
                    <li key={i}>{TEMPLATE_LABELS[p.templateKey].name} → Slot {p.slot}{p.month ? ` (month ${p.month})` : ""} — {p.reason}</li>
                  ))}
                </ul>
              )}
              {report.summary.errors.length > 0 && (
                <ul className="text-xs text-rose-600">{report.summary.errors.slice(0, 10).map((e, i) => <li key={i}>{e}</li>)}</ul>
              )}
            </div>
          )}
        </Card>

        <Card title="WhatsApp (this committee’s sending number)">
          {wa.configured ? (
            <>
              <p className="text-sm">
                <Badge tone="green">Connected</Badge> {wa.displayPhone ? <b className="ml-1">{wa.displayPhone}</b> : null} · phone number ID {wa.phoneNumberIdHint}
              </p>
              <p className="mt-1 text-sm">Delivery receipts: {wa.webhookConfigured ? <Badge tone="green">on</Badge> : <Badge tone="amber">off</Badge>}</p>
              <p className="mt-1 break-all text-xs text-slate-500">Webhook URL: {server.appUrl}/api/whatsapp/webhook</p>
              <div className="mt-4 flex gap-2">
                <input className="input" placeholder="+92 300 1234567" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} aria-label="Test number" />
                <button
                  className="btn btn-secondary shrink-0"
                  disabled={testing || !testPhone}
                  onClick={() => startTest(async () => {
                    const r = await sendTestMessage(testPhone);
                    if (r.ok) toast.success(r.message);
                    else toast.error(r.error);
                  })}
                >
                  {testing ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Test
                </button>
              </div>
              <p className="mt-1 text-xs text-slate-500">Sends Meta’s built-in “hello_world” template.</p>
            </>
          ) : (
            <Notice tone="amber" title="Not connected yet">
              Until a number is connected, every message can still be sent manually with a ready-made WhatsApp link.
            </Notice>
          )}
          {isOwner && (
            <details className="mt-4 rounded-xl border border-slate-200 p-3 dark:border-slate-700" open={!wa.configured}>
              <summary className="cursor-pointer text-sm font-semibold">{wa.configured ? "Change WhatsApp credentials" : "Connect a WhatsApp number"}</summary>
              <form
                className="mt-3 space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  act(() => saveWhatsApp(waForm), () => setWaForm({ ...waForm, accessToken: "" }));
                }}
              >
                <Field label="Phone number ID" htmlFor="wa-pnid" hint="Meta → WhatsApp → API Setup (digits only)">
                  <input id="wa-pnid" className="input" inputMode="numeric" value={waForm.phoneNumberId} onChange={(e) => setWaForm({ ...waForm, phoneNumberId: e.target.value })} placeholder={wa.phoneNumberIdHint ?? ""} />
                </Field>
                <Field label="Access token" htmlFor="wa-token" hint={wa.configured ? "Leave empty to keep the saved token." : "Permanent token from a Meta system user. Stored securely; never shown again."}>
                  <input id="wa-token" className="input" type="password" autoComplete="off" value={waForm.accessToken} onChange={(e) => setWaForm({ ...waForm, accessToken: e.target.value })} />
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Business account ID (optional)" htmlFor="wa-waba">
                    <input id="wa-waba" className="input" inputMode="numeric" value={waForm.businessAccountId} onChange={(e) => setWaForm({ ...waForm, businessAccountId: e.target.value })} />
                  </Field>
                  <Field label="Number shown to admins" htmlFor="wa-disp">
                    <input id="wa-disp" className="input" value={waForm.displayPhone} onChange={(e) => setWaForm({ ...waForm, displayPhone: e.target.value })} placeholder="+92 300 1234567" />
                  </Field>
                </div>
                <div className="flex gap-2">
                  <button className="btn btn-primary" disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" />} Save</button>
                  {wa.configured && (
                    <button type="button" className="btn btn-ghost text-rose-600" disabled={busy} onClick={() => window.confirm("Disconnect WhatsApp for this committee?") && act(clearWhatsApp)}>
                      Disconnect
                    </button>
                  )}
                </div>
              </form>
            </details>
          )}
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Public page (letters only)">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Anyone with the link sees the committee name, the letters A–Q, winners by letter and the draw history. Names, numbers and individual payments stay private.
          </p>
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/60">
            <span className="min-w-0 flex-1 truncate">{publicUrl}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => navigator.clipboard.writeText(publicUrl).then(() => toast.success("Link copied"))} aria-label="Copy link">
              <Copy className="size-4" />
            </button>
          </div>
          {isOwner && (
            <div className="mt-4 space-y-3">
              <Field label="Web address" htmlFor="slug" hint="Lowercase letters, numbers and dashes.">
                <input id="slug" className="input" value={pub.slug} onChange={(e) => setPub({ ...pub, slug: e.target.value.toLowerCase() })} />
              </Field>
              <Toggle checked={pub.public_enabled} onChange={(v) => setPub({ ...pub, public_enabled: v })} label="Public page is visible" />
              <div>
                <p className="label">Committee logo</p>
                <div className="flex items-center gap-3">
                  {committee.logo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={committee.logo} alt="Logo" className="size-14 rounded-xl bg-white object-contain p-1 ring-1 ring-slate-200" />
                  ) : (
                    <div className="grid size-14 place-items-center rounded-xl bg-slate-100 text-xs text-slate-400 dark:bg-slate-800">None</div>
                  )}
                  <label className="btn btn-secondary btn-sm cursor-pointer">
                    Upload
                    <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      resizeImage(file, 256).then((url) => act(() => saveLogo(url))).catch(() => toast.error("Could not read that image."));
                    }} />
                  </label>
                  {committee.logo && <button className="btn btn-ghost btn-sm text-rose-600" onClick={() => act(() => saveLogo(null))}>Remove</button>}
                </div>
                <p className="mt-1 text-xs text-slate-500">Shown in the app, on the public page and on winner banners.</p>
              </div>
              <button className="btn btn-secondary" disabled={busy} onClick={() => act(() => savePublicPage(pub))}>Save public page</button>
            </div>
          )}
        </Card>

        <Card title="Admins of this committee">
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {admins.map((a) => (
              <li key={a.user_id} className="flex items-center gap-2 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{a.email ?? a.user_id}</span>
                <Badge tone={a.role === "owner" ? "gold" : "gray"}>{a.role}</Badge>
                {isOwner && a.user_id !== currentUserId && (
                  <button className="btn btn-ghost btn-sm text-rose-600" aria-label={`Remove ${a.email}`} disabled={busy}
                    onClick={() => window.confirm(`Remove ${a.email ?? "this admin"}?`) && act(() => removeAdmin(a.user_id))}>
                    <Trash2 className="size-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {isOwner ? (
            <form
              className="mt-4 flex flex-col gap-2 sm:flex-row"
              onSubmit={(e) => {
                e.preventDefault();
                act(() => addAdmin(newAdmin.email, newAdmin.role), () => setNewAdmin({ email: "", role: "admin" }));
              }}
            >
              <input className="input" type="email" required placeholder="their@email.com" value={newAdmin.email} onChange={(e) => setNewAdmin({ ...newAdmin, email: e.target.value })} aria-label="Admin email" />
              <select className="input sm:w-32" value={newAdmin.role} onChange={(e) => setNewAdmin({ ...newAdmin, role: e.target.value as "owner" | "admin" })} aria-label="Role">
                <option value="admin">Admin</option>
                <option value="owner">Owner</option>
              </select>
              <button className="btn btn-primary shrink-0" disabled={busy}><UserPlus className="size-4" /> Add</button>
            </form>
          ) : (
            <p className="mt-3 text-xs text-slate-500">Only owners can add or remove admins.</p>
          )}
          <p className="mt-2 text-xs text-slate-500">Sign-ups are turned off, so only people who already have an account can be added. Leave this empty to stay the only admin.</p>
        </Card>
      </div>

      <Modal
        open={!!move}
        onClose={() => setMove(null)}
        title="Change the committee start month"
        description="Every month keeps its number, its payments and its winner. Only the calendar months move. Example: if month 1 becomes September, month 3 becomes November."
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setMove(null)}>Cancel</button>
            <button
              className="btn btn-primary"
              disabled={busy || !move || move.month === f.start_month.slice(0, 7) || move.reason.trim().length < 5}
              onClick={() => move && act(() => changeStartMonth(move.month, move.reason), () => { setF({ ...f, start_month: `${move.month}-01` }); setMove(null); })}
            >
              {busy && <Loader2 className="size-4 animate-spin" />} Change start month
            </button>
          </>
        }
      >
        {move && (
          <div className="space-y-4">
            <Field label="Month 1 should be" htmlFor="mv-month">
              <input id="mv-month" className="input" type="month" value={move.month} onChange={(e) => setMove({ ...move, month: e.target.value })} />
            </Field>
            <Field label="Reason (saved in the activity log)" htmlFor="mv-reason" hint="At least 5 characters.">
              <input id="mv-reason" className="input" value={move.reason} onChange={(e) => setMove({ ...move, reason: e.target.value })} placeholder="e.g. The committee actually started in September" />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
