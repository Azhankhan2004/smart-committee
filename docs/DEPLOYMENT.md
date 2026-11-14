# Deployment (free, no custom domain needed)

You get a free address like `https://family-committee.vercel.app`. Both Supabase and Vercel have free plans that are enough for one committee.

> Vercel’s free **Hobby** plan is meant for personal, non-commercial projects. A family committee app fits that.

## 1. Put the code on GitHub
1. Create a free account at <https://github.com>, then a **new private repository** (e.g. `smart-committee`).
2. Upload the project folder. Either drag the files in on GitHub (**Add file → Upload files**), or from a terminal:
   ```bash
   git init && git add . && git commit -m "Smart Committee"
   git branch -M main
   git remote add origin https://github.com/<you>/smart-committee.git
   git push -u origin main
   ```
   `.env.local` is in `.gitignore`. **Never upload your keys.**

## 2. Import into Vercel
1. Sign up at <https://vercel.com> with your GitHub account → **Add New → Project** → import the repository.
2. Framework preset: **Next.js** (auto-detected). Leave the build settings as they are.
3. Open **Environment Variables** and add (for *Production* and *Preview*):

| Name | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon / public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service_role key (**secret**) |
| `CRON_SECRET` | long random string, e.g. output of `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `NEXT_PUBLIC_APP_URL` | `https://<your-project>.vercel.app` (fill in after the first deploy, then redeploy) |
| `WHATSAPP_*` | optional — see `docs/WHATSAPP_SETUP.md` |

4. Click **Deploy**. After about a minute you get your `*.vercel.app` URL. You can change the name under **Settings → Domains**, e.g. `family-committee.vercel.app`.

Never set `WHATSAPP_API_BASE_URL` in production. It exists only for automated tests.

## 3. Tell Supabase about the URL
Supabase → **Authentication → URL Configuration** → **Site URL** = your Vercel URL.
Also add `https://<your-project>.vercel.app/auth/update-password` to **Redirect URLs**. For local password resets, allow `http://localhost:3000/auth/update-password`.

## 4. The daily scheduler
`vercel.json` already contains:
```json
{ "crons": [{ "path": "/api/cron/scheduler", "schedule": "0 4 * * *" }] }
```
- That is **04:00 UTC = 09:00 Pakistan time**, every day. On the free plan Vercel runs cron jobs **once a day**, somewhere within that hour.
- Vercel automatically sends `Authorization: Bearer <CRON_SECRET>`, and the route rejects anything else.
- The job runs on Vercel’s servers. **It does not need anyone’s browser to be open.**
- It only sends when **Settings → “Send reminders automatically”** is on and the WhatsApp API is configured.
- Check it: Vercel → Project → **Settings → Cron Jobs** (you can trigger it there), or **Settings → Run now** in the app.

**Want a different time?** Change the cron expression (UTC) and redeploy. **Want more than once a day** (free plan)?
Use a free external scheduler such as cron-job.org to call
`GET https://<your-app>.vercel.app/api/cron/scheduler` with header `Authorization: Bearer <CRON_SECRET>`.
Duplicate protection makes extra runs safe.

## 5. After deploying — checklist
- [ ] Log in at `https://<your-app>.vercel.app/login`
- [ ] Settings page shows CRON_SECRET ✓ and service role key ✓
- [ ] Settings → **Preview today (dry run)** works
- [ ] (If WhatsApp is set up) Settings → **Test** message arrives
- [ ] Turn on **Send reminders automatically** when you are happy with the templates

## Updating the app later
Push changes to GitHub, and Vercel redeploys automatically. For database changes, add a new SQL file in `supabase/migrations/` and run it in the Supabase SQL Editor. **Never** re-run `seed.sql` on a live database.

## Backups
Supabase free projects are not backed up automatically. Once a month, export your data from **Reports** (CSV), or use Supabase **Database → Backups** on a paid plan. Supabase may pause a free project after a long period with no activity. The daily scheduler call normally keeps it active, and a paused project can be restored from the dashboard.

## Custom domain (optional, later)
Buy a domain anywhere, then Vercel → **Settings → Domains → Add** and follow the DNS instructions. Update `NEXT_PUBLIC_APP_URL`, Supabase Site URL and the WhatsApp webhook URL.
