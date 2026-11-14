"use client";
import { useEffect, useState, useTransition } from "react";
import { Check, Copy, Eye, Loader2, MessageCircle, Send } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/modal";
import { Badge, Card, EmptyState, Field, LogBadge, Notice } from "@/components/ui";
import { monthLabel } from "@/lib/dates";
import { formatPhone } from "@/lib/phone";
import { TEMPLATE_LABELS } from "@/lib/templates";
import { TEMPLATE_KEYS, type LogStatus, type TemplateKey } from "@/lib/types";
import type { SendSummary } from "@/lib/notifications";
import { buildPreview, logManualShare, sendNotifications, type Audience, type PreviewItem } from "./actions";

type WA = { configured: boolean; version: string; phoneNumberIdHint: string | null; webhookConfigured: boolean };

export function SendClient({
  schedules,
  members,
  initialScheduleId,
  initialTemplate,
  wa,
}: {
  schedules: { id: string; month_number: number; period_month: string }[];
  members: { id: string; slot_code: string; full_name: string | null }[];
  initialScheduleId: string;
  initialTemplate: TemplateKey;
  wa: WA;
}) {
  const [templateKey, setTemplateKey] = useState<TemplateKey>(initialTemplate);
  const [scheduleId, setScheduleId] = useState(initialScheduleId);
  const [audience, setAudience] = useState<Audience>(TEMPLATE_LABELS[initialTemplate].perMember === "all" ? "all" : "unpaid");
  const [memberId, setMemberId] = useState(members[0]?.id ?? "");
  const [items, setItems] = useState<PreviewItem[] | null>(null);
  const [templateActive, setTemplateActive] = useState(true);
  const [resend, setResend] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [summary, setSummary] = useState<SendSummary | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [sending, startSending] = useTransition();

  function preview(keepSummary = false) {
    if (!keepSummary) setSummary(null);
    startLoading(async () => {
      const res = await buildPreview({ templateKey, scheduleId, audience, memberId });
      if (res.ok && res.data) {
        setItems(res.data.items);
        setTemplateActive(res.data.templateActive);
      } else if (!res.ok) toast.error(res.error);
    });
  }

  // Refresh the preview whenever the selection changes.
  useEffect(() => {
    if (scheduleId) preview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateKey, scheduleId, audience, memberId]);

  const willSend = (items ?? []).filter((i) => i.phone && (resend || !i.alreadySent));

  function send() {
    startSending(async () => {
      const res = await sendNotifications({ templateKey, scheduleId, audience, memberId, resend });
      setConfirmOpen(false);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setSummary(res.data!);
      const s = res.data!;
      if (s.failed || s.skipped) toast.warning(`${s.sent} sent, ${s.failed} failed, ${s.skipped} skipped.`);
      else toast.success(`${s.sent} message(s) sent${s.duplicate ? `, ${s.duplicate} already sent earlier (skipped)` : ""}.`);
      preview(true);
    });
  }

  async function copy(item: PreviewItem) {
    await navigator.clipboard.writeText(item.body);
    setCopied(item.memberId);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,340px)_1fr]">
      <div className="space-y-4">
        <Card title="Message">
          <div className="space-y-4">
            <Field label="Notification type" htmlFor="tkey">
              <select
                id="tkey"
                className="input"
                value={templateKey}
                onChange={(e) => {
                  const k = e.target.value as TemplateKey;
                  setTemplateKey(k);
                  setAudience(TEMPLATE_LABELS[k].perMember === "all" ? "all" : TEMPLATE_LABELS[k].perMember === "one" ? "one" : "unpaid");
                }}
              >
                {TEMPLATE_KEYS.map((k) => (
                  <option key={k} value={k}>{TEMPLATE_LABELS[k].letter}. {TEMPLATE_LABELS[k].name}</option>
                ))}
              </select>
            </Field>
            <Field label="Committee month" htmlFor="month">
              <select id="month" className="input" value={scheduleId} onChange={(e) => setScheduleId(e.target.value)}>
                {schedules.map((s) => (
                  <option key={s.id} value={s.id}>Month {s.month_number} · {monthLabel(s.period_month)}</option>
                ))}
              </select>
            </Field>
            <Field label="Send to" htmlFor="aud">
              <select id="aud" className="input" value={audience} onChange={(e) => setAudience(e.target.value as Audience)}>
                <option value="all">All active members</option>
                <option value="unpaid">Members who haven’t fully paid</option>
                <option value="one">One member</option>
              </select>
            </Field>
            {audience === "one" && (
              <Field label="Member" htmlFor="mem">
                <select id="mem" className="input" value={memberId} onChange={(e) => setMemberId(e.target.value)}>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>Slot {m.slot_code}{m.full_name ? ` · ${m.full_name}` : ""}</option>
                  ))}
                </select>
              </Field>
            )}
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 size-4 accent-brand-600" checked={resend} onChange={(e) => setResend(e.target.checked)} />
              <span>Send again to members who already received this message<span className="block text-xs text-slate-500">Off by default to prevent duplicate reminders.</span></span>
            </label>
          </div>
        </Card>

        {wa.configured ? (
          <Notice tone="green" title="WhatsApp Cloud API connected">
            Sending from phone number ID {wa.phoneNumberIdHint} (Graph API {wa.version}).
            {!wa.webhookConfigured && " Delivery receipts are off until the webhook is set up."}
          </Notice>
        ) : (
          <Notice tone="amber" title="Manual sharing mode">
            The WhatsApp Cloud API isn’t configured, so each message opens in WhatsApp with the text ready. You press send yourself. These are logged as “Opened in WhatsApp”, not as delivered.
          </Notice>
        )}
      </div>

      <Card
        title={
          <span className="flex items-center gap-2">
            <Eye className="size-4" /> Preview {items && <Badge>{items.length} recipient{items.length === 1 ? "" : "s"}</Badge>}
            {loading && <Loader2 className="size-4 animate-spin text-slate-400" />}
          </span>
        }
        action={
          wa.configured && (
            <button className="btn btn-primary btn-sm" disabled={!willSend.length || sending || !templateActive} onClick={() => setConfirmOpen(true)}>
              <Send className="size-4" /> Send to {willSend.length}
            </button>
          )
        }
      >
        {!templateActive && <div className="mb-3"><Notice tone="red">This template is switched off. Turn it on under Templates to send it.</Notice></div>}
        {summary && (
          <div className="mb-4">
            <Notice tone={summary.failed ? "red" : "green"} title="Send results">
              {summary.sent} sent · {summary.failed} failed · {summary.skipped} skipped · {summary.duplicate} already sent
              {summary.errors.length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-xs">{summary.errors.slice(0, 10).map((e, i) => <li key={i}>{e}</li>)}</ul>
              )}
            </Notice>
          </div>
        )}
        {!items ? (
          <p className="text-sm text-slate-500">Loading preview…</p>
        ) : items.length === 0 ? (
          <EmptyState title="No recipients">Nobody matches this selection (for example, everyone has already paid).</EmptyState>
        ) : (
          <ul className="space-y-3">
            {items.map((i) => (
              <li key={i.memberId} className="rounded-2xl border border-slate-200 p-3 dark:border-slate-800">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="grid size-7 place-items-center rounded-lg bg-slate-100 text-xs font-bold dark:bg-slate-800">{i.slot}</span>
                  <span className="text-sm font-medium">{i.name ?? `Slot ${i.slot}`}</span>
                  <span className="text-xs text-slate-500">{i.phone ? formatPhone(i.phone) : "No number"}</span>
                  {i.lastStatus && <LogBadge status={i.lastStatus as LogStatus} />}
                  <div className="ml-auto flex gap-1">
                    <button className="btn btn-ghost btn-sm" onClick={() => copy(i)} aria-label="Copy message">
                      {copied === i.memberId ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
                    </button>
                    {!wa.configured && (
                      <a
                        href={i.waUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="btn btn-whatsapp btn-sm"
                        onClick={() => {
                          void logManualShare({ templateKey, memberId: i.memberId, scheduleId, body: i.body, phone: i.phone }).then(() =>
                            setItems((cur) => cur?.map((x) => (x.memberId === i.memberId ? { ...x, alreadySent: true, lastStatus: "manual_opened" } : x)) ?? null),
                          );
                        }}
                      >
                        <MessageCircle className="size-4" /> WhatsApp
                      </a>
                    )}
                  </div>
                </div>
                <pre className="whitespace-pre-wrap rounded-xl bg-[#e7ffdb] px-3 py-2 font-sans text-[13px] leading-relaxed text-slate-900 dark:bg-emerald-950/60 dark:text-emerald-50">{i.body}</pre>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={`Send ${TEMPLATE_LABELS[templateKey].name}?`}
        description={`${willSend.length} WhatsApp message(s) will be sent now through the Cloud API.`}
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setConfirmOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={send} disabled={sending}>
              {sending && <Loader2 className="size-4 animate-spin" />} Send now
            </button>
          </>
        }
      >
        <ul className="flex flex-wrap gap-1.5">
          {willSend.map((i) => <Badge key={i.memberId}>Slot {i.slot}</Badge>)}
        </ul>
        {(items?.length ?? 0) - willSend.length > 0 && (
          <p className="mt-3 text-xs text-slate-500">{(items?.length ?? 0) - willSend.length} member(s) skipped: already sent or no WhatsApp number.</p>
        )}
      </Modal>
    </div>
  );
}
