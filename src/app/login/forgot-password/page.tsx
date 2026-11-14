import type { Metadata } from "next";
import Link from "next/link";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <div className="grid min-h-dvh place-items-center px-5 py-12">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold">Reset your password</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Enter your admin email and we’ll send a password reset link.
        </p>
        <ForgotPasswordForm />
        <p className="mt-5 text-center text-sm">
          <Link href="/login" className="font-medium text-brand-700 hover:underline dark:text-brand-300">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
