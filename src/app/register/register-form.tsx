"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export function RegisterForm() {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", email: "", password: "", confirm: "" });
  const [error, setError] = useState<string | null>(null);
  const [checkEmail, setCheckEmail] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (form.password.length < 8) return setError("Use a password with at least 8 characters.");
    if (form.password !== form.confirm) return setError("The passwords do not match.");
    setLoading(true);
    const { data, error } = await createClient().auth.signUp({
      email: form.email.trim(),
      password: form.password,
      options: {
        data: { full_name: form.name.trim() },
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/committees`,
      },
    });
    setLoading(false);
    if (error) {
      setError(
        /registered|already/i.test(error.message)
          ? "An account with this email already exists. Sign in instead."
          : /signups? not allowed|disabled/i.test(error.message)
            ? "New sign-ups are currently switched off."
            : error.message,
      );
      return;
    }
    if (data.session) {
      router.replace("/committees?welcome=1");
      router.refresh();
    } else {
      setCheckEmail(true);
    }
  }

  if (checkEmail) {
    return (
      <p className="mt-6 rounded-xl bg-emerald-50 px-3 py-3 text-sm text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200">
        Almost done! We sent a confirmation link to <b>{form.email}</b>. Open it to activate your account, then create your committee.
        Check your spam folder if you don’t see it.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4">
      <div>
        <label className="label" htmlFor="r-name">Your name</label>
        <input id="r-name" className="input" required autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </div>
      <div>
        <label className="label" htmlFor="r-email">Email</label>
        <input id="r-email" type="email" className="input" required autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      </div>
      <div>
        <label className="label" htmlFor="r-pass">Password</label>
        <input id="r-pass" type="password" className="input" required minLength={8} autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
      </div>
      <div>
        <label className="label" htmlFor="r-confirm">Confirm password</label>
        <input id="r-confirm" type="password" className="input" required minLength={8} autoComplete="new-password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} />
      </div>
      {error && <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{error}</p>}
      <button type="submit" className="btn btn-primary w-full" disabled={loading}>
        {loading && <Loader2 className="size-4 animate-spin" />} Create account
      </button>
    </form>
  );
}
