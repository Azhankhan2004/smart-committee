import type { Metadata } from "next";
import Link from "next/link";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "Create account" };

export default function RegisterPage() {
  return (
    <div className="grid min-h-dvh place-items-center px-5 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-800 font-black text-white">SC</div>
        <h1 className="text-2xl font-bold">Create your account</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Free for families. After signing up you can create your own committee, with its own members, lucky draws and public page.
        </p>
        <RegisterForm />
        <p className="mt-5 text-center text-sm text-slate-600 dark:text-slate-300">
          Already have an account?{" "}
          <Link href="/login" className="font-semibold text-brand-700 hover:underline dark:text-brand-300">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
