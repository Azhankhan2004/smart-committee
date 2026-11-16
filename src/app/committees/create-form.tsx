"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Field } from "@/components/ui";
import { formatMoney } from "@/lib/format";
import { createCommittee } from "./actions";

export function CreateCommitteeForm({ defaultStart }: { defaultStart: string }) {
  const router = useRouter();
  const [f, setF] = useState({ name: "", slug: "", totalMembers: 17, contribution: 10000, startMonth: defaultStart });
  const [pending, start] = useTransition();
  const autoSlug = f.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

  return (
    <form
      className="mt-5 grid gap-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await createCommittee(f);
          if (!res.ok) {
            toast.error(res.error);
            return;
          }
          toast.success("Committee created! Add your members’ names and WhatsApp numbers next.");
          router.push("/members");
          router.refresh();
        });
      }}
    >
      <div className="sm:col-span-2">
        <Field label="Committee name" htmlFor="c-name">
          <input id="c-name" className="input" required minLength={2} maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Khan Family Committee" />
        </Field>
      </div>
      <Field label="Number of members (= months)" htmlFor="c-members">
        <input id="c-members" type="number" min={2} max={60} className="input" value={f.totalMembers} onChange={(e) => setF({ ...f, totalMembers: Number(e.target.value) })} />
      </Field>
      <Field label="Monthly contribution (PKR)" htmlFor="c-amt" hint={`Monthly payout: ${formatMoney(f.totalMembers * f.contribution)}`}>
        <input id="c-amt" type="number" min={1} className="input" value={f.contribution} onChange={(e) => setF({ ...f, contribution: Number(e.target.value) })} />
      </Field>
      <Field label="First month" htmlFor="c-start">
        <input id="c-start" type="month" className="input" required value={f.startMonth} onChange={(e) => setF({ ...f, startMonth: e.target.value })} />
      </Field>
      <Field label="Public web address (optional)" htmlFor="c-slug" hint={`Your public page: /p/${f.slug || autoSlug || "your-committee"}`}>
        <input id="c-slug" className="input" value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value.toLowerCase() })} placeholder={autoSlug || "khan-family"} />
      </Field>
      <div className="sm:col-span-2">
        <button className="btn btn-primary" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" />} Create committee
        </button>
      </div>
    </form>
  );
}
