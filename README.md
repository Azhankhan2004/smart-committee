# Smart Committee Management System

A mobile-friendly web app for running a family savings committee (kameti / BC):
17 members, PKR 10,000 a month each, one member receives PKR 170,000 every month for 17 months.

Built with **Next.js 16 + TypeScript + Tailwind CSS**, **Supabase (PostgreSQL + Auth)**, the
**official WhatsApp Business Cloud API**, and **Vercel** (free plan + free `*.vercel.app` subdomain).

---

## What it does

A **multi-committee platform**: anyone can register, create their own committee, and manage it privately.

| Area | Features |
|---|---|
| **Accounts & committees** | Sign-up / sign-in, password reset, create several committees, switch between them, add co-admins by email (owner / admin roles). Each committee's data is completely separate (enforced by the database). |
| **Dashboard** | Committee amount, total collected, current & upcoming winner, paid / pending count, completion %, remaining months, next deadline, chart, "who has paid" |
| **Members** | Alphabetical slots (A–Q by default), optional real name, WhatsApp number, joining month, winner month, payment history, deactivate / reactivate |
| **Winners** | Fixed order (editable) **or** monthly lucky draw. Announce with typed confirmation; duplicates blocked; owner-only corrections with reason |
| **Lucky draw** | Dedicated page with one spinning card: **one winner per draw**, **automatic** or **manual** (stop when you like) mode. Every member who hasn't won takes part; the winner is chosen on the server with secure randomness, saved, announced and messaged automatically. Full draw history; an owner can **delete a wrong draw** (the month re-opens). Can also run by itself on the announcement day. |
| **Winner banners** | A unique design for every letter A–Q (own colours + pattern). A personalised 1080×1080 PNG banner is generated automatically for each winner, shown in the app and on the public page, downloadable, and attached to the winner's WhatsApp message. |
| **Public page** | `/p/<committee>` — letters A–Q only, winners by letter, schedule, draw history. No names, numbers or individual payments. Can be switched off. |
| **Payments** | Per member per month: status (Pending / Paid / Partially paid / Overdue), date, method, reference, remarks |
| **WhatsApp** | Each committee connects its **own** WhatsApp Business number in Settings (e.g. a family member's number). 7 message types incl. the personal winner message with banner. Preview, bulk send, logs, retry, delivery receipts, manual-link fallback. |
| **Scheduler** | Daily job for every committee: reminders, overdue alerts, monthly updates, automatic winner / lucky draw. Duplicate-proof. |
| **Posters, reports, activity log** | PNG posters, CSV/PDF reports, permanent audit log per committee |

### What needs external credentials

| Feature | Needs | Without it |
|---|---|---|
| Everything except WhatsApp API sending | Supabase project (free) | App shows a setup page |
| Automatic WhatsApp sending, bulk send, retries, winner messages | A WhatsApp Business number connected in **Settings → WhatsApp** (phone number ID + token) | Manual sharing via prefilled WhatsApp links (logged as “Opened in WhatsApp”, never as “delivered”) |
| Delivery / read receipts | WhatsApp webhook verify token + app secret | Messages show as “Sent” (accepted by Meta) |
| Daily automatic reminders | `CRON_SECRET` + service role key + hosting with cron (Vercel) | Use **Settings → Run now** manually |

The app never shows a fake “success”: a message is only marked **Sent** when Meta returns a message ID.

---

## Quick start (local computer)

You need **Node.js 20.9+** and a free **Supabase** account.

### 1. Create the Supabase project
1. Go to [supabase.com](https://supabase.com) → **New project**. Choose a region close to Pakistan (e.g. Mumbai / Singapore). Save the database password.
2. Open **SQL Editor** → **New query**, paste the whole of `supabase/setup_all.sql`, then click **Run**.
   **Already running the older single-committee version?** Run only `supabase/migrations/20261117000004_multi_committee.sql` instead — it upgrades in place and keeps all data (see docs/UPGRADE_V2.md).
   This creates all tables, security rules, functions, the 17 slots (A–Q), the 6 message templates and the 17-month schedule starting **this month**.
   - Committee started in a different month? Change it in **Settings → Start month**. After payments exist, an owner uses **Change start month**: every month keeps its number, payments and winner; only the calendar months move.
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
