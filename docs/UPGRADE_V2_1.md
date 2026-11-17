# Upgrade v2.1 (17 Nov 2026)

Run once in Supabase → SQL Editor: `supabase/migrations/20261117000005_fixes_v2_1.sql` (safe to run again).

What changed
- **Member form**: typing no longer loses focus after each letter (the pop-up re-focused on every key press).
- **Start month**: owners can move the committee calendar from Settings → *Change start month* even after payments exist. Each month keeps its number, payments and winner; only the calendar months move. Logged in the activity log with the reason.
- **Lucky draw**: one spinning card, one winner per draw, picked from every member who hasn't won. Run the next month as a separate draw. Owners can delete a wrong draw from the draw history (its announcement is voided and the month re-opens).
- **Payment methods**: "Cash, Najma Israr" and "Online, Najma Israr" (required when an amount is entered). Older methods still display on old records.
- **Reports**: *Member payment history* has a Payment method filter; new *By payment method* report (per month and totals).
