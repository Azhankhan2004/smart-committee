# Testing

## 1. Unit tests (no database needed)
```bash
npm install
npm test
```
32 tests cover: scheduler planning (who gets what message on which day, catch-up window, overdue frequency, inactive members, auto-announce, unique dedupe keys), template rendering and Meta parameters, phone number normalisation, payment status, time-zone-correct dates.

```bash
npm run typecheck   # TypeScript
npm run build       # production build
```

## 2. Database rule tests (optional, needs local PostgreSQL 15+)
`tests/db/` checks the security and business rules directly in Postgres, using a small stand-in for Supabase’s `auth` schema:
```bash
bash tests/db/run.sh        # needs psql + a Postgres server; see the comments in run.sh
```
It verifies, among other things:
- anonymous users are denied, and non-admin logged-in users see 0 rows and can’t call functions
- over-payment, future payment dates and unexplained reductions are rejected
- direct table updates to payments are blocked (functions only)
- wrong confirmation slot, duplicate announcement and future-month announcement are rejected
- locked months can’t be reassigned, and duplicate winners in the order are rejected
- only owners can void, and a reason is required
- start month can only move through `change_start_month` (owner + reason) after history exists; records stay on their month numbers; amount changes only affect months without history
- lucky draw picks one winner from all eligible members; only an owner can delete a draw (announcement voided, month re-opens)
- payment methods: `cash_najma` / `online_najma` accepted, unknown values rejected
- deactivation keeps history, and the audit log can’t be deleted

## 3. Manual test checklist (after setup)
Use a test Supabase project or test numbers first.

**Login & security**
- [ ] Wrong password shows “Email or password is incorrect”
- [ ] Opening `/payments` in a private window redirects to `/login`
- [ ] A Supabase user who isn’t in `admin_users` sees “This account is not an admin”

**Members**
- [ ] Add a number as `0300 1234567` → saved as `+92 300 1234567`; `0300-12` is rejected
- [ ] Deactivate a member with a reason → appears in Activity log; past payments remain

**Payments**
- [ ] Record full payment → status Paid; partial → Partially paid; past due & unpaid → Overdue
- [ ] Entering more than the required amount is rejected
- [ ] Reducing an amount without a remark is rejected

**Winners**
- [ ] Announce button only works after typing the correct slot
- [ ] After announcing, the month is locked and can’t be announced again
- [ ] Change order: choosing the same member twice disables Save
- [ ] (Owner) Void with a reason → can announce again; both entries visible in Reports → Winner history

**Notifications**
- [ ] Without API keys: “Manual sharing mode”, each WhatsApp button opens WhatsApp with the text, History shows “Opened in WhatsApp”
- [ ] With API keys: Settings → Test sends `hello_world`; a bulk send shows real sent/failed/skipped counts
- [ ] Sending the same message twice → second time reports “already sent”
- [ ] A failed message can be retried from History

**Scheduler**
- [ ] Settings → Preview today (dry run) lists what would be sent
- [ ] `curl https://<app>/api/cron/scheduler` without the secret → 401
- [ ] `curl -H "Authorization: Bearer <CRON_SECRET>" "https://<app>/api/cron/scheduler?dryRun=1"` → JSON report
- [ ] Running the scheduler twice on the same day sends nothing the second time

**Posters & reports**
- [ ] Each poster type downloads as a 1080×1080 PNG; Share opens the phone’s share sheet
- [ ] Each report downloads as CSV (opens in Excel) and PDF

## What was tested before delivery
- All SQL migrations + seed run on PostgreSQL 16; the DB rule suite passes.
- The full app was run against a real database through PostgREST, and every page was checked on desktop, mobile and dark mode with no browser errors.
- Clicked through end to end: login, payments, winner announcement and order swap, member add, manual sharing, templates, CSV/PDF/PNG exports, cron protection.
- WhatsApp API mode was tested against a mock Graph API: template parameters, failure logging, skipped members, retry, scheduler duplicate protection (second run sent 0).
- Not tested against Meta’s real servers. That needs your credentials (see WHATSAPP_SETUP.md).
