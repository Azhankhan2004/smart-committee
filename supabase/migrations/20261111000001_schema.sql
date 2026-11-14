-- =====================================================================
-- Smart Committee Management System — 01: Tables, constraints, indexes
-- Target: Supabase PostgreSQL 15+
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Admin users (linked 1:1 to Supabase Auth users)
-- ---------------------------------------------------------------------
create table public.admin_users (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null unique,
  full_name   text,
  role        text not null default 'admin' check (role in ('owner', 'admin')),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

comment on table public.admin_users is
  'People allowed to use the admin app. Owners can also make corrections such as voiding a winner.';

-- ---------------------------------------------------------------------
-- Committee settings (single row, id = 1)
-- ---------------------------------------------------------------------
create table public.committee_settings (
  id                            smallint primary key default 1 check (id = 1),
  committee_name                text not null default 'Family Committee'
                                  check (length(trim(committee_name)) between 2 and 80),
  currency                      text not null default 'PKR' check (currency ~ '^[A-Z]{3}$'),
  total_members                 int  not null default 17 check (total_members between 2 and 60),
  monthly_contribution          numeric(12, 2) not null default 10000 check (monthly_contribution > 0),
  payout_amount                 numeric(12, 2) not null default 170000 check (payout_amount > 0),
  start_month                   date not null default date_trunc('month', now())::date
                                  check (start_month = date_trunc('month', start_month)::date),
  timezone                      text not null default 'Asia/Karachi',
  -- Scheduler configuration (days are day-of-month, 1..28 so every month has them)
  payment_due_day               int  not null default 10 check (payment_due_day between 1 and 28),
  reminder_days_before          int  not null default 3  check (reminder_days_before between 0 and 27),
  remind_on_due_date            boolean not null default true,
  overdue_reminder_every_days   int  not null default 3  check (overdue_reminder_every_days between 0 and 30),
  monthly_reminder_day          int  not null default 1  check (monthly_reminder_day between 1 and 28),
  monthly_update_day            int  not null default 1  check (monthly_update_day between 1 and 28),
  winner_announcement_day       int  not null default 15 check (winner_announcement_day between 1 and 28),
  auto_send_enabled             boolean not null default false,
  auto_announce_winner          boolean not null default false,
  updated_at                    timestamptz not null default now()
);

comment on column public.committee_settings.overdue_reminder_every_days is
  '0 disables overdue alerts. Otherwise an alert is sent every N days after the due date while unpaid.';

-- ---------------------------------------------------------------------
-- Members (identified by alphabetical slot codes)
-- ---------------------------------------------------------------------
create table public.members (
  id              uuid primary key default gen_random_uuid(),
  slot_code       text not null unique check (slot_code ~ '^[A-Z]{1,3}[0-9]{0,2}$'),
  display_order   int  not null,
  full_name       text check (full_name is null or length(trim(full_name)) between 1 and 80),
  phone_e164      text check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  joined_month    date not null check (joined_month = date_trunc('month', joined_month)::date),
  is_active       boolean not null default true,
  notes           text,
  deactivated_at  timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index members_active_order_idx on public.members (is_active, display_order);

-- ---------------------------------------------------------------------
-- Monthly schedule (one row per committee month)
-- ---------------------------------------------------------------------
create table public.monthly_schedules (
  id                   uuid primary key default gen_random_uuid(),
  month_number         int  not null check (month_number > 0),
  period_month         date not null check (period_month = date_trunc('month', period_month)::date),
  due_date             date not null,
  contribution_amount  numeric(12, 2) not null check (contribution_amount > 0),
  payout_amount        numeric(12, 2) not null check (payout_amount > 0),
  winner_member_id     uuid references public.members (id) on delete restrict,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint monthly_schedules_month_number_key unique (month_number) deferrable initially deferred,
  constraint monthly_schedules_period_key unique (period_month) deferrable initially deferred,
  -- A member can be the designated winner of only one month.
  constraint monthly_schedules_winner_key unique (winner_member_id) deferrable initially deferred,
  constraint monthly_schedules_due_in_month check (
    due_date >= period_month and due_date < (period_month + interval '1 month')::date
  )
);

-- ---------------------------------------------------------------------
-- Winners (announcements). Voided rows are kept for the audit trail.
-- ---------------------------------------------------------------------
create table public.winners (
  id                  uuid primary key default gen_random_uuid(),
  schedule_id         uuid not null references public.monthly_schedules (id) on delete restrict,
  member_id           uuid not null references public.members (id) on delete restrict,
  payout_amount       numeric(12, 2) not null check (payout_amount > 0),
  status              text not null default 'announced' check (status in ('announced', 'voided')),
  announced_at        timestamptz not null default now(),
  announced_by        uuid references auth.users (id) on delete set null,
  announced_by_email  text,
  notes               text,
  voided_at           timestamptz,
  voided_by           uuid references auth.users (id) on delete set null,
  void_reason         text,
  created_at          timestamptz not null default now(),
  constraint winners_void_consistency check (
    (status = 'announced' and voided_at is null)
    or (status = 'voided' and voided_at is not null and length(trim(coalesce(void_reason, ''))) >= 5)
  )
);

-- Never two active announcements for the same month, and a member never wins twice.
create unique index winners_one_per_month_idx on public.winners (schedule_id) where status = 'announced';
create unique index winners_member_once_idx  on public.winners (member_id)   where status = 'announced';
create index winners_announced_at_idx on public.winners (announced_at desc);

-- ---------------------------------------------------------------------
-- Payments (one row per member per month)
-- ---------------------------------------------------------------------
create table public.payments (
  id                  uuid primary key default gen_random_uuid(),
  schedule_id         uuid not null references public.monthly_schedules (id) on delete restrict,
  member_id           uuid not null references public.members (id) on delete restrict,
  required_amount     numeric(12, 2) not null check (required_amount >= 0),
  amount_paid         numeric(12, 2) not null default 0 check (amount_paid >= 0),
  status              text not null default 'pending' check (status in ('pending', 'partially_paid', 'paid')),
  payment_date        date,
  payment_method      text check (payment_method is null or payment_method in
                        ('cash', 'bank_transfer', 'easypaisa', 'jazzcash', 'raast', 'other')),
  transaction_ref     text check (transaction_ref is null or length(transaction_ref) <= 120),
  remarks             text check (remarks is null or length(remarks) <= 500),
  confirmed_by        uuid references auth.users (id) on delete set null,
  confirmed_by_email  text,
  confirmed_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint payments_one_per_member_month unique (schedule_id, member_id),
  constraint payments_not_over_required check (amount_paid <= required_amount),
  constraint payments_date_when_paid check (amount_paid = 0 or payment_date is not null)
);

create index payments_member_idx on public.payments (member_id);
create index payments_schedule_status_idx on public.payments (schedule_id, status);

-- ---------------------------------------------------------------------
-- Notification templates
-- ---------------------------------------------------------------------
create table public.notification_templates (
  id                  uuid primary key default gen_random_uuid(),
  key                 text not null unique check (key in (
                        'monthly_reminder', 'winner_announcement', 'payment_due',
                        'payment_overdue', 'payment_received', 'new_month_update')),
  name                text not null,
  description         text,
  body                text not null check (length(body) between 10 and 1024),
  meta_template_name  text check (meta_template_name is null or (meta_template_name ~ '^[a-z0-9_]+$' and length(meta_template_name) <= 512)),
  meta_language_code  text not null default 'en',
  meta_body_params    text[] not null default '{}',
  is_active           boolean not null default true,
  updated_at          timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Notification logs
-- ---------------------------------------------------------------------
create table public.notification_logs (
  id                   uuid primary key default gen_random_uuid(),
  template_key         text not null,
  member_id            uuid references public.members (id) on delete set null,
  schedule_id          uuid references public.monthly_schedules (id) on delete set null,
  recipient_phone      text,
  message_body         text not null,
  request_payload      jsonb,           -- exact WhatsApp API payload, used for retries
  channel             text not null check (channel in ('whatsapp_api', 'manual_link')),
  status               text not null default 'queued' check (status in
                         ('queued', 'sent', 'delivered', 'read', 'failed', 'skipped', 'manual_opened')),
  provider_message_id  text,
  error_message        text,
  attempts             int  not null default 0,
  dedupe_key           text unique,
  triggered_by         text not null default 'admin' check (triggered_by in ('admin', 'scheduler', 'retry')),
  created_by           uuid references auth.users (id) on delete set null,
  created_at           timestamptz not null default now(),
  sent_at              timestamptz,
  updated_at           timestamptz not null default now()
);

create index notification_logs_created_idx on public.notification_logs (created_at desc);
create index notification_logs_status_idx  on public.notification_logs (status);
create index notification_logs_member_idx  on public.notification_logs (member_id);
create index notification_logs_provider_idx on public.notification_logs (provider_message_id)
  where provider_message_id is not null;

-- ---------------------------------------------------------------------
-- Audit / activity log (append-only)
-- ---------------------------------------------------------------------
create table public.audit_logs (
  id           bigint generated always as identity primary key,
  occurred_at  timestamptz not null default now(),
  actor_id     uuid,
  actor_email  text,
  action       text not null,
  entity_type  text not null,
  entity_id    text,
  summary      text,
  reason       text,
  old_data     jsonb,
  new_data     jsonb
);

create index audit_logs_occurred_idx on public.audit_logs (occurred_at desc);
create index audit_logs_entity_idx   on public.audit_logs (entity_type, entity_id);
