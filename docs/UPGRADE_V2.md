# Upgrade to v2 (multi-committee platform)

## What changes
- The database gets `committees`, `committee_admins`, `draws` and `committee_whatsapp` tables, and every existing table gets a `committee_id`.
- Your existing committee becomes the first committee (public address `/p/family-committee` or similar). All members, payments, winners, notifications and the activity log are kept.
- Every active row in the old `admin_users` table becomes an admin/owner of that committee.

## Steps (already done for the live site)
1. **Backup** (Supabase → Database → Backups, or export tables to CSV).
2. Supabase → SQL Editor → paste `supabase/migrations/20261117000004_multi_committee.sql` → Run. It is one transaction: if anything fails, nothing changes.
3. Supabase → Authentication → **Sign In / Providers → Email**: turn **on** “Allow new users to sign up” (needed for registration).
4. Supabase → Authentication → **URL Configuration**: Site URL = your Vercel URL; Redirect URLs include `https://<your-app>.vercel.app/auth/callback` and `/auth/update-password`.
5. Deploy the new code (push to GitHub → Vercel deploys automatically).
6. In the app: **Settings → WhatsApp** to connect the committee's sending number; **Settings → How is each month's winner chosen?** to switch to lucky draws.

## Rolling back
The migration only adds columns/tables, but the old app code will not work with the new database. To roll back, restore the backup from step 1 and redeploy the previous commit in Vercel (Deployments → previous → Promote).
