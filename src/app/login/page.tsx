import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-gradient-to-br from-brand-700 via-brand-800 to-brand-950 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -right-24 -top-24 size-96 rounded-full bg-gold-400/20 blur-3xl" />
        <div className="absolute -bottom-32 -left-16 size-96 rounded-full bg-brand-400/20 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-2xl bg-white/10 font-black ring-1 ring-white/20">SC</div>
          <p className="text-lg font-semibold">Smart Committee</p>
        </div>
        <div className="relative">
          <h1 className="text-4xl font-bold leading-tight">Your family committee,<br />organised and on time.</h1>
          <p className="mt-4 max-w-md text-brand-100/90">
            Track every contribution, announce winners fairly and send WhatsApp reminders automatically.
          </p>
        </div>
        <p className="relative text-sm text-brand-100/70">Admin access only</p>
      </div>
      <div className="flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <div className="grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-800 font-black text-white">SC</div>
          </div>
          <h2 className="text-2xl font-bold">Admin sign in</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Use the email and password your committee owner set up for you.</p>
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
