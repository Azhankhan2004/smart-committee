"use client";
import { useState, useTransition } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge, Field, Notice } from "@/components/ui";
import { buildMetaParams, findPlaceholders, PLACEHOLDERS, renderTemplate, TEMPLATE_LABELS } from "@/lib/templates";
import type { Template } from "@/lib/types";
import { saveTemplate } from "../actions";

const SAMPLE: Record<string, string> = {
  member_name: "Ayesha", slot: "C", committee_name: "Family Committee", month_number: "3", total_months: "17",
  month_label: "January 2027", amount: "PKR 10,000", due_date: "10 Jan 2027", payout: "PKR 170,000",
  winner_slot: "C", next_winner_slot: "D", amount_paid: "PKR 10,000", balance: "PKR 0", payment_date: "8 Jan 2027",
  transaction_ref: "TID 4821936", days_overdue: "3", remaining_months: "14",
};

/** Converts our {{name}} body into Meta's {{1}}, {{2}} format using the parameter order. */
function toMetaBody(body: string, params: string[]) {
  return body.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, k: string) => {
    const i = params.indexOf(k);
    return i >= 0 ? `{{${i + 1}}}` : `[${k}?]`;
  });
}

function Editor({ t }: { t: Template }) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState(t.body);
  const [metaName, setMetaName] = useState(t.meta_template_name ?? "");
  const [lang, setLang] = useState(t.meta_language_code);
  const [params, setParams] = useState(t.meta_body_params.join(", "));
  const [active, setActive] = useState(t.is_active);
  const [pending, start] = useTransition();

  const paramList = params.split(",").map((s) => s.trim()).filter(Boolean);
  const used = findPlaceholders(body);
  const missingFromParams = metaName ? used.filter((u) => !paramList.includes(u)) : [];

  const save = () =>
    start(async () => {
      const res = await saveTemplate({ id: t.id, body, meta_template_name: metaName, meta_language_code: lang, meta_body_params: params, is_active: active });
      if (res.ok) toast.success(res.message);
      else toast.error(res.error);
    });

  return (
    <div className="card">
      <button className="flex w-full items-center gap-3 px-4 py-3 text-left sm:px-5" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="grid size-8 place-items-center rounded-lg bg-brand-50 text-sm font-bold text-brand-800 dark:bg-brand-500/10 dark:text-brand-200">{TEMPLATE_LABELS[t.key].letter}</span>
        <div className="flex-1">
          <p className="text-sm font-semibold">{t.name}</p>
          <p className="text-xs text-slate-500">{t.description}</p>
        </div>
        {!t.is_active && <Badge tone="amber">Off</Badge>}
        {t.meta_header_image && <Badge tone="gold">+ winner banner image</Badge>}
        {t.meta_template_name ? <Badge tone="green">Meta: {t.meta_template_name}</Badge> : <Badge>Text only</Badge>}
        <ChevronDown className={`size-4 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="grid gap-5 border-t border-slate-100 p-4 sm:p-5 lg:grid-cols-2 dark:border-slate-800">
          <div className="space-y-4">
            <Field label="Message" htmlFor={`b-${t.id}`} hint={`${body.length}/1024 characters`}>
              <textarea id={`b-${t.id}`} className="input font-mono text-[13px]" rows={10} value={body} onChange={(e) => setBody(e.target.value)} />
            </Field>
            <details className="text-xs text-slate-500">
              <summary className="cursor-pointer font-medium">Available placeholders</summary>
              <ul className="mt-2 grid gap-1">
                {PLACEHOLDERS.map((p) => (
                  <li key={p.key}><code className="text-brand-700 dark:text-brand-300">{`{{${p.key}}}`}</code> — {p.description}</li>
                ))}
              </ul>
            </details>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Approved Meta template name" htmlFor={`m-${t.id}`} hint="Leave empty to send as plain text (only works within 24h of the member messaging you).">
                <input id={`m-${t.id}`} className="input" value={metaName} onChange={(e) => setMetaName(e.target.value)} placeholder="committee_payment_due" />
              </Field>
              <Field label="Template language code" htmlFor={`l-${t.id}`}>
                <input id={`l-${t.id}`} className="input" value={lang} onChange={(e) => setLang(e.target.value)} placeholder="en" />
              </Field>
            </div>
            <Field label="Meta parameter order" htmlFor={`p-${t.id}`} hint="Comma-separated placeholder names, matching {{1}}, {{2}}… in the approved template.">
              <input id={`p-${t.id}`} className="input font-mono text-xs" value={params} onChange={(e) => setParams(e.target.value)} />
            </Field>
            {missingFromParams.length > 0 && (
              <Notice tone="amber">These placeholders are in the message but not in the Meta parameter order, so they won’t appear in API messages: {missingFromParams.join(", ")}</Notice>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-brand-600" checked={active} onChange={(e) => setActive(e.target.checked)} />
              Template is active (used by manual sends and the scheduler)
            </label>
            <button className="btn btn-primary" onClick={save} disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />} Save template</button>
          </div>
          <div className="space-y-4">
            <div>
              <p className="label">Preview (sample data)</p>
              <pre className="whitespace-pre-wrap rounded-2xl bg-[#e7ffdb] p-3 font-sans text-[13px] leading-relaxed text-slate-900">{renderTemplate(body, SAMPLE)}</pre>
            </div>
            {metaName && (
              <div>
                <p className="label">Text to submit to Meta for approval</p>
                <pre className="whitespace-pre-wrap rounded-2xl bg-slate-100 p-3 font-mono text-xs dark:bg-slate-800">{toMetaBody(body, paramList)}</pre>
                <p className="mt-2 text-xs text-slate-500">
                  Sample values for Meta’s review: {buildMetaParams(paramList, SAMPLE).map((v, i) => `{{${i + 1}}} = ${v}`).join(" · ")}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function TemplatesClient({ templates }: { templates: Template[] }) {
  const order = ["monthly_reminder", "winner_announcement", "payment_due", "payment_overdue", "payment_received", "new_month_update", "winner_personal"];
  return (
    <div className="space-y-3">
      <Notice tone="blue">
        WhatsApp only lets businesses start a conversation with a <b>Meta-approved template</b>. If you edit the wording here, submit the updated text to Meta and keep the parameter order the same, or API sends may be rejected.
      </Notice>
      {[...templates].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key)).map((t) => <Editor key={t.id} t={t} />)}
    </div>
  );
}
