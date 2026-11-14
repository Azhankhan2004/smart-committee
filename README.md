# Smart Committee Management System

A mobile-friendly web app for running a family savings committee (kameti / BC):
17 members, PKR 10,000 a month each, one member receives PKR 170,000 every month for 17 months.

Built with **Next.js 16 + TypeScript + Tailwind CSS**, **Supabase (PostgreSQL + Auth)**, the
**official WhatsApp Business Cloud API**, and **Vercel** (free plan + free `*.vercel.app` subdomain).

---

## What it does

| Area | Features |
|---|---|
| **Dashboard** | Committee amount, total collected, current month, current & upcoming winner, paid / pending count, completion %, remaining months, next deadline, collection chart, “who has paid” table, setup warnings |
| **Members** | Alphabetical slots (A–Q by default), optional real name, WhatsApp number with country code (validated), joining month, winner month, payment history, total contributed, deactivate / reactivate with reason |
| **Winners** | 17-month schedule, admin-defined order (change any unannounced month, or reset to A→Z), announce with typed confirmation, date/time stored, duplicate announcements blocked by the database, owner-only corrections with a reason in the audit log, announcement card |
| **Payments** | Per month per member: required amount, amount paid, status (Pending / Paid / Partially paid / Overdue), date, method, transaction reference, admin remarks. Payments are only recorded when an admin confirms them. |
| **WhatsApp** | 6 message types (A–F), preview before sending, send to all / unpaid / one member, editable templates, Meta-approved template support, sent / failed logs, retry, delivery receipts (webhook). **Manual mode** with prefilled `wa.me` links if API credentials are missing. |
| **Scheduler** | Daily server-side job (Vercel Cron), configurable due day, reminder N days before, on due date, overdue every N days, winner announcement day, monthly update day. Duplicate-proof and catches up missed days. |
| **Posters** | 1080×1080 PNG posters (reminder, winner, payment confirmation, monthly update), download or share directly to WhatsApp from a phone |
| **Reports** | Monthly collections, member payment history, pending payments, winner history, notification history, overall progress — each exportable as **CSV** and **PDF** |
| **Activity log** | Permanent, read-only log of every change (who, when, old → new values, reason) |
| **UI** | Mobile-first, sidebar on desktop, bottom navigation on phones, light & dark mode |

### What needs external credentials

| Feature | Needs | Without it |
|---|---|---|
| Everything except WhatsApp API sending | Supabase project (free) | App shows a setup page |
| Automatic WhatsApp sending, bulk send, retries | WhatsApp Cloud API token + phone number ID | Manual sharing via prefilled WhatsApp links (logged as “Opened in WhatsApp”, never as “delivered”) |
| Delivery / read receipts | WhatsApp webhook verify token + app secret | Messages show as “Sent” (accepted by Meta) |
| Daily automatic reminders | `CRON_SECRET` + service role key + hosting with cron (Vercel) | Use **Settings → Run now** manually |

The app never shows a fake “success”: a message is only marked **Sent** when Meta returns a message ID.

---

## Quick start (local computer)

You need **Node.js 20.9+** and a free **Supabase** account.

### 1. Create the Supabase project
1. Go to [supabase.com](https://supabase.com) → **New project**. Choose a region close to Pakistan (e.g. Mumbai / Singapore). Save the database password.
2. Open **SQL Editor** → **New query**, paste the whole of `supabase/setup_all.sql`, then click **Run**.
   This creates all tables, security rules, functions, the 17 slots (A–Q), the 6 message templates and the 17-month schedule starting **this month**.
   - Committee started in a different month? Change it later in **Settings → Start month** (allowed until the first payment is recorded).
   - Prefer separate files? Run `supabase/migrations/*.sql` in order, then `supabase/seed.sql`.
3. **Authentication → Sign In / Providers → Email**: turn **off** “Allow new users to sign up”. Only people you create can log in.

### 2. Create the admin login
1. **Authentication → Users → Add user → Create new user**: enter your email and a strong password, tick **Auto Confirm User**.
2. **SQL Editor**, run (with your email):
   ```sql
   insert into public.admin_users (id, email, role)
   select id, email, 'owner' from auth.users where email = 'you@example.com';
   ```
   Use `'admin'` instead of `'owner'` for helpers. Only **owners** can void (correct) a winner announcement.
   To remove someone: `update public.admin_users set is_active = false where email = '...';`
3. If you invite an admin instead, they can set their password from **Sign in → Forgot password**. In Supabase **Authentication → URL Configuration**, allow `http://localhost:3000/auth/update-password` for local development and add your deployed URL later.

### 3. Configure and run
```bash
cp .env.example .env.local      # then fill in the values (see below)
npm install
npm run dev                     # open http://localhost:3000
```
Values come from Supabase → **Project Settings → API**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (anon/public key),
`SUPABASE_SERVICE_ROLE_KEY` (service_role key, **secret**). Set `CRON_SECRET` to any long random string.

### 4. First things to do in the app
1. **Settings** → check committee name, start month, due day and reminder days → **Save**.
2. **Members** → add names (optional) and WhatsApp numbers for each slot.
3. **Winners** → **Change order** if your family agreed on an order other than A→Z.
4. **Payments** → record payments as they arrive.

---

## Documentation

| Guide | What’s inside |
|---|---|
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Free deployment on Vercel (`your-app.vercel.app`), environment variables, cron, custom domain later |
| [docs/WHATSAPP_SETUP.md](docs/WHATSAPP_SETUP.md) | Meta developer app, test number, permanent token, template approval, webhook, going live |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Database tables, security model, business rules, folder structure |
| [docs/TESTING.md](docs/TESTING.md) | Unit tests, database rule tests, manual test checklist |

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / server |
| `npm test` | Unit tests (scheduler, templates, phone numbers, dates) |
| `npm run typecheck` | TypeScript check |

## Security summary
- Every table has **Row Level Security**: only active rows in `admin_users` can read or change data. Anonymous visitors get nothing.
- Money and winner changes go through database functions that validate input (no over-payment, no future dates, no duplicate winners, history can’t be rewritten).
- WhatsApp tokens, the service role key and the cron secret live **only** in server environment variables — never in browser code.
- The audit log is append-only.
