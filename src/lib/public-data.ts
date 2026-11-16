import "server-only";
import { cache } from "react";
import { createAnonClient } from "./supabase/anon";

export type PublicMonth = {
  month_number: number;
  period_month: string;
  due_date: string;
  phase: "past" | "current" | "upcoming";
  is_announced: boolean;
  announced_at: string | null;
  winner_slot: string | null;
  paid_count: number;
  member_count: number;
};

export type PublicCommittee = {
  slug: string;
  name: string;
  logo: string | null;
  currency: string;
  monthly_contribution: number;
  payout_amount: number;
  total_members: number;
  winner_selection: "sequence" | "lucky_draw";
  today: string;
  slots: string[];
  months: PublicMonth[];
  draws: { month_number: number; candidates: string[]; winner_slot: string; created_at: string }[];
};

export const getPublicCommittee = cache(async (slug: string): Promise<PublicCommittee | null> => {
  if (!/^[a-z0-9-]{3,48}$/.test(slug)) return null;
  const { data, error } = await createAnonClient().rpc("public_committee", { p_slug: slug });
  if (error) throw new Error(error.message);
  return (data as PublicCommittee | null) ?? null;
});
