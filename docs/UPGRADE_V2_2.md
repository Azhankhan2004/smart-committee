# Upgrade v2.2 (17 Nov 2026): Reserve months + several winners per session

Run once in Supabase → SQL Editor: `supabase/migrations/20261117000006_reserve_months.sql` (safe to run again).

- **Several winners in one session**: Lucky draw → "Winners in this session" (1–6). Months are drawn one after another, one winner each. Upcoming months can be drawn in advance by an admin; the automatic scheduler still only draws months that have started.
- **Reserve months** (owner): Lucky draw → "Reserve months (financial support)". A reserved month has no draw; its payout is kept aside. Then:
  - *Give to a member*: either **counts as their committee payout** (they are removed from future draws) or **help only** (they stay in future draws),
  - *Release to draw*: the month goes back to a normal draw,
  - *Undo*: cancels a gift; the month is reserved again.
- Reserved months show on Winners, Dashboard, the public page (no names or notes) and in the new **Reserves** report. Every action is in the Activity log with its reason.
