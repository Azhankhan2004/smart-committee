import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient, type DB } from "./supabase/server";
import type { Committee } from "./types";

export const COMMITTEE_COOKIE = "sc_committee";

export type UserContext = {
  db: DB;
  userId: string;
  email: string;
  committees: Committee[];
};

export type AdminContext = UserContext & {
  committeeId: string;
  committee: Committee;
  role: "owner" | "admin";
};

/** All committees this user can manage (owner or admin). */
async function loadCommittees(db: DB, userId: string): Promise<Committee[]> {
  const { data, error } = await db
    .from("committee_admins")
    .select("role, committees(id, slug, public_enabled, logo_data, committee_settings(committee_name))")
    .eq("user_id", userId);
  if (error) throw new Error(`Could not load your committees: ${error.message}`);
  type Row = {
    role: "owner" | "admin";
    committees: { id: string; slug: string; public_enabled: boolean; logo_data: string | null; committee_settings: { committee_name: string } | { committee_name: string }[] | null } | null;
  };
  return ((data ?? []) as unknown as Row[])
    .filter((r) => r.committees)
    .map((r) => {
      const c = r.committees!;
      const s = Array.isArray(c.committee_settings) ? c.committee_settings[0] : c.committee_settings;
      return { id: c.id, slug: c.slug, public_enabled: c.public_enabled, logo: c.logo_data, name: s?.committee_name ?? c.slug, role: r.role };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function loadUser(): Promise<UserContext | null> {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return null;
  const committees = await loadCommittees(db, user.id);
  return { db, userId: user.id, email: user.email ?? "", committees };
}

async function pickCommittee(u: UserContext): Promise<AdminContext | null> {
  if (u.committees.length === 0) return null;
  const store = await cookies();
  const wanted = store.get(COMMITTEE_COOKIE)?.value;
  const committee = u.committees.find((c) => c.id === wanted) ?? u.committees[0];
  return { ...u, committeeId: committee.id, committee, role: committee.role };
}

/** For pages that only need a signed-in user (e.g. creating a first committee). */
export async function requireUser(): Promise<UserContext> {
  const u = await loadUser();
  if (!u) redirect("/login");
  return u;
}

/** For committee admin pages: redirects to /login or /committees when needed. */
export async function requireAdmin(): Promise<AdminContext> {
  const u = await loadUser();
  if (!u) redirect("/login");
  const ctx = await pickCommittee(u);
  if (!ctx) redirect("/committees?welcome=1");
  return ctx;
}

/** For server actions: throws instead of redirecting. */
export async function adminForAction(): Promise<AdminContext> {
  const u = await loadUser();
  if (!u) throw new Error("You are not signed in. Please sign in again.");
  const ctx = await pickCommittee(u);
  if (!ctx) throw new Error("Create or select a committee first.");
  return ctx;
}

export async function userForAction(): Promise<UserContext> {
  const u = await loadUser();
  if (!u) throw new Error("You are not signed in. Please sign in again.");
  return u;
}
