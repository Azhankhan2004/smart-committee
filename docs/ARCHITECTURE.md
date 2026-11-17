# Architecture

## Overview

```
Browser (admin)  ──►  Next.js on Vercel  ──►  Supabase PostgreSQL (RLS)
                        │   Server Components / Server Actions (signed-in admin, RLS applies)
                        │   /api/cron/scheduler   ◄── Vercel Cron (daily, Bearer CRON_SECRET)
                        │   /api/whatsapp/webhook ◄── Meta delivery receipts (signed)
                        └──►  WhatsApp Cloud API (graph.facebook.com) — server only
```

- **Reads** happen in Server Components using the admin’s own session, so Postgres Row Level Security protects every query.
- **Writes** go through Server Actions. Anything that touches money or winners calls a **database function** (RPC) that validates and logs the change. The browser can’t update `payments`, `winners` or `monthly_schedules` directly. The database grants don’t allow it.
- The **service role key** is used only by the cron route and the webhook, which have no logged-in user.

## Database (supabase/migrations)

| Table | Purpose | Key rules |
|---|---|---|
| `admin_users` | Who can use the app (`owner` / `admin`) | Linked 1:1 to `auth.users` |
| `committee_settings` | Single row: name, members, contribution, payout, start month, time zone, reminder days, auto-send switches | Start month moves only via `change_start_month` once history exists (records stay on their month numbers) |
| `members` | Slot code (A, B, …), optional name, E.164 WhatsApp number, joining month, active flag | Slot unique, phone format checked, no deletes (deactivate instead) |
| `monthly_schedules` | One row per committee month: dates, contribution & payout snapshot, designated winner | Unique month / period / winner (deferrable for swaps); dates & amounts frozen once the month has history |
| `winners` | Announcements with time, admin, notes; voided rows kept | Partial unique index: one active announcement per month, one win per member |
| `payments` | One row per member per month | Unique (month, member); `amount_paid ≤ required`; status derived by trigger; date required when paid |
| `notification_templates` | The 6 message types, body with `{{placeholders}}`, linked Meta template + parameter order | Body ≤ 1024 chars |
| `notification_logs` | Every API send / manual share: body, exact payload, status, Meta id, error, attempts | `dedupe_key` unique → no duplicate reminders |
| `audit_logs` | Append-only history of every insert/update/delete + readable actions with reasons | No update/delete grants, even for the service role |

Views (`security_invoker`, so RLS still applies): `v_schedule`, `v_payments` (adds overdue status, balance, days overdue), `v_member_summary`.

### Business functions
| Function | What it does |
|---|---|
| `generate_schedule()` | Creates/updates months from settings, never touching months with history; adds payment rows; assigns unassigned months alphabetically |
| `save_winner_sequence(jsonb)` / `reset_winner_sequence()` | Admin-defined winner order for unannounced months |
| `announce_winner(month, confirm_slot, notes)` | Locks the month, requires the typed slot, blocks future months and duplicates |
| `void_winner(id, reason)` | Owner-only correction, keeps the original row |
| `record_payment(...)` | Validates amount/date, requires a remark when reducing an amount, records who confirmed it |
| `set_member_active(id, active, reason)` | Deactivate keeps past/paid history, removes only future unpaid rows |

### Status logic
- `Paid`: amount paid = required · `Partially paid`: some paid · `Overdue`: nothing paid and due date passed · `Pending`: nothing paid, not yet due.
- “Today” is always calculated in the committee time zone (default `Asia/Karachi`).

## Scheduler (src/lib/scheduler-plan.ts + scheduler-engine.ts)

Each daily run plans messages for **today** and sends them:

| Message | When | To |
|---|---|---|
| F. New month update | `monthly_update_day` | all active members |
| A. Monthly reminder | `monthly_reminder_day` (until due date) | members not fully paid |
| C. Payment due | `reminder_days_before` days before due, and on the due date | members not fully paid |
| D. Overdue alert | every `overdue_reminder_every_days` days after due date (any past month) | members not fully paid |
| B. Winner announcement | `winner_announcement_day`, once announced (optionally auto-announces) | all active members |
| E. Payment received | when an admin records a payment (optional tick box) | that member |

- **No duplicates:** each logical message has a dedupe key (e.g. `winner_announcement:<month>:<member>`). Manual sends use the same keys, so a member is never sent the same monthly message twice by accident. There is an explicit “send again” option.
- **Catch-up:** one-time events are sent if they were missed within the last 2 days.
- **Failed messages** are retried automatically on the next run (up to 3 attempts), or manually from History.

## Folder structure
```
src/
  app/
    (admin)/            Dashboard, members, winners, payments, notifications, posters, reports, audit, settings
    api/cron/scheduler  Daily reminder engine (protected by CRON_SECRET)
    api/whatsapp/webhook Delivery status webhook (signature-checked)
    login/ setup/ not-authorized/ auth/signout/
  components/           UI kit, navigation shell, charts, modal
  lib/                  Business logic: dates, phone, templates, scheduler, WhatsApp client, data loaders, auth
  proxy.ts              Session refresh + login redirect (Next.js 16 “proxy”, formerly middleware)
supabase/
  migrations/           Schema, functions, security
  seed.sql              Default settings, slots A–Q, templates, schedule
  setup_all.sql         Everything above in one file for the SQL Editor
tests/                  Vitest unit tests + tests/db SQL rule tests
```
