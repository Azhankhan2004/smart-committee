import type { Metadata } from "next";
import Link from "next/link";
import { UpdatePasswordForm } from "./update-password-form";

export const metadata: Metadata = { title: "Set password" };

export default function UpdatePasswordPage() {
  return (
    <div className="grid min-h-dvh place-items-center px-5 py-12">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold">Set a new password</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Choose a new password for your admin account.
        </p>
        <UpdatePasswordForm />
        <p className="mt-5 text-center text-sm">
          <Link href="/login/forgot-password" className="font-medium text-brand-700 hover:underline dark:text-brand-300">
            Request another reset link
          </Link>
        </p>
      </div>
    </div>
  );
}
