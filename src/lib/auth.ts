import "server-only";
import { redirect } from "next/navigation";
import { createClient, type DB } from "./supabase/server";

export type AdminContext = {
  db: DB;
  userId: string;
  email: string;
  role: "owner" | "admin";
};

type LoadResult = { kind: "signed_out" } | { kind: "not_admin"; email: string } | { kind: "admin"; ctx: AdminContext };

async function loadAdmin(): Promise<LoadResult> {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return { kind: "signed_out" };

  const { data: admin } = await db.from("admin_users").select("role, is_active").eq("id", user.id).maybeSingle();
  if (!admin || !admin.is_active) return { kind: "not_admin", email: user.email ?? "" };

  return {
    kind: "admin",
    ctx: { db, userId: user.id, email: user.email ?? "", role: admin.role === "owner" ? "owner" : "admin" },
  };
}

/** For pages: redirects to /login or /not-authorized when needed. */
export async function requireAdmin(): Promise<AdminContext> {
  const res = await loadAdmin();
  if (res.kind === "signed_out") redirect("/login");
  if (res.kind === "not_admin") redirect("/not-authorized");
  return res.ctx;
}

/** For server actions: throws instead of redirecting. */
export async function adminForAction(): Promise<AdminContext> {
  const res = await loadAdmin();
  if (res.kind !== "admin") throw new Error("You are not authorized. Please sign in again.");
  return res.ctx;
}
