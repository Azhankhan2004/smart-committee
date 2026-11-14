-- Smart Committee: ALL-IN-ONE setup for the Supabase SQL Editor (run once on a fresh project).
-- Generated from supabase/migrations/*.sql + supabase/seed.sql

-- ==================== supabase/migrations/20261111000001_schema.sql ====================
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

-- ==================== supabase/migrations/20261111000002_functions.sql ====================
-- =====================================================================
-- Smart Committee Management System — 02: Helpers, triggers, business RPCs
-- =====================================================================

-- ---------------------------------------------------------------------
-- Identity helpers
-- ---------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.admin_users where id = auth.uid() and is_active
  );
$$;

create or replace function public.is_owner()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.admin_users where id = auth.uid() and is_active and role = 'owner'
  );
$$;

-- Trusted callers: the service role (backend scheduler) and direct database
-- sessions (Supabase SQL editor / migrations). Browser and app users always
-- arrive through PostgREST as session_user "authenticator".
create or replace function public.is_trusted_backend()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(auth.role(), '') = 'service_role' or session_user <> 'authenticator';
$$;

create or replace function public.assert_admin()
returns void
language plpgsql stable security definer set search_path = public
as $$
begin
  if public.is_trusted_backend() or public.is_admin() then
    return;
  end if;
  raise exception 'You are not authorized to perform this action.' using errcode = '42501';
end;
$$;

create or replace function public.current_actor_email()
returns text
language sql stable security definer set search_path = public
as $$
  select coalesce(
    nullif(auth.jwt() ->> 'email', ''),
    case when coalesce(auth.role(), '') = 'service_role' then 'system (scheduler)' else 'system' end
  );
$$;

-- Today's date and current month in the committee's time zone.
create or replace function public.committee_today()
returns date
language sql stable security definer set search_path = public
as $$
  select (now() at time zone coalesce(
    (select timezone from public.committee_settings where id = 1), 'Asia/Karachi'))::date;
$$;

create or replace function public.current_period()
returns date
language sql stable security definer set search_path = public
as $$
  select date_trunc('month', public.committee_today())::date;
$$;

-- A month is "frozen" once it has history: an announced winner or any recorded money.
create or replace function public.schedule_is_frozen(p_schedule_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.winners  where schedule_id = p_schedule_id and status = 'announced')
      or exists (select 1 from public.payments where schedule_id = p_schedule_id and amount_paid > 0);
$$;

-- ---------------------------------------------------------------------
-- Audit helpers
-- ---------------------------------------------------------------------
create or replace function public.log_activity(
  p_action text, p_entity_type text, p_entity_id text, p_summary text,
  p_reason text default null, p_data jsonb default null)
returns void
language sql security definer set search_path = public
as $$
  insert into public.audit_logs (actor_id, actor_email, action, entity_type, entity_id, summary, reason, new_data)
  values (auth.uid(), public.current_actor_email(), p_action, p_entity_type, p_entity_id, p_summary, p_reason, p_data);
$$;

create or replace function public.audit_row_change()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
begin
  -- Ignore updates that only touched updated_at.
  if tg_op = 'UPDATE' and (v_old - 'updated_at') = (v_new - 'updated_at') then
    return new;
  end if;
  insert into public.audit_logs (actor_id, actor_email, action, entity_type, entity_id, old_data, new_data)
  values (auth.uid(), public.current_actor_email(), lower(tg_op), tg_table_name,
          coalesce(v_new ->> 'id', v_old ->> 'id'), v_old, v_new);
  return coalesce(new, old);
end;
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Integrity triggers
-- ---------------------------------------------------------------------

-- Payment status always follows the amounts (never set by hand).
create or replace function public.payments_derive_status()
returns trigger
language plpgsql
as $$
begin
  new.status := case
    when new.amount_paid >= new.required_amount and new.required_amount > 0 then 'paid'
    when new.amount_paid > 0 then 'partially_paid'
    else 'pending'
  end;
  if new.amount_paid = 0 then
    new.payment_date := null;
  end if;
  return new;
end;
$$;

-- Protect months that already have history.
create or replace function public.schedules_protect_history()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.winner_member_id is distinct from old.winner_member_id
     and exists (select 1 from public.winners where schedule_id = old.id and status = 'announced') then
    raise exception 'Month % already has an announced winner. Void the announcement before changing it.', old.month_number;
  end if;

  if (new.contribution_amount, new.payout_amount, new.period_month, new.due_date)
       is distinct from (old.contribution_amount, old.payout_amount, old.period_month, old.due_date)
     and public.schedule_is_frozen(old.id) then
    raise exception 'Month % has recorded history, so its dates and amounts cannot change.', old.month_number;
  end if;
  return new;
end;
$$;

-- Start month can't move once the committee has any history.
create or replace function public.settings_protect_history()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.start_month is distinct from old.start_month and (
       exists (select 1 from public.payments where amount_paid > 0)
       or exists (select 1 from public.winners where status = 'announced')) then
    raise exception 'The start month cannot change after payments or winners have been recorded.';
  end if;
  return new;
end;
$$;

-- New / re-joined members get payment rows for every month from their joining month.
create or replace function public.ensure_payment_rows_internal()
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_count int;
begin
  insert into public.payments (schedule_id, member_id, required_amount)
  select ms.id, m.id, ms.contribution_amount
  from public.monthly_schedules ms
  cross join public.members m
  where m.is_active and ms.period_month >= m.joined_month
  on conflict (schedule_id, member_id) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.members_sync_payments()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.is_active then
    perform public.ensure_payment_rows_internal();
  end if;
  return new;
end;
$$;

-- updated_at triggers
create trigger trg_settings_touch  before update on public.committee_settings     for each row execute function public.touch_updated_at();
create trigger trg_members_touch   before update on public.members                for each row execute function public.touch_updated_at();
create trigger trg_schedules_touch before update on public.monthly_schedules      for each row execute function public.touch_updated_at();
create trigger trg_payments_touch  before update on public.payments               for each row execute function public.touch_updated_at();
create trigger trg_templates_touch before update on public.notification_templates for each row execute function public.touch_updated_at();
create trigger trg_logs_touch      before update on public.notification_logs      for each row execute function public.touch_updated_at();

-- integrity triggers
create trigger trg_payments_status before insert or update on public.payments
  for each row execute function public.payments_derive_status();
create trigger trg_schedules_protect before update on public.monthly_schedules
  for each row execute function public.schedules_protect_history();
create trigger trg_settings_protect before update on public.committee_settings
  for each row execute function public.settings_protect_history();
create trigger trg_members_sync after insert or update of is_active, joined_month on public.members
  for each row execute function public.members_sync_payments();

-- audit triggers
create trigger trg_audit_settings  after insert or update or delete on public.committee_settings     for each row execute function public.audit_row_change();
create trigger trg_audit_members   after insert or update or delete on public.members                for each row execute function public.audit_row_change();
create trigger trg_audit_schedules after insert or update or delete on public.monthly_schedules      for each row execute function public.audit_row_change();
create trigger trg_audit_winners   after insert or update or delete on public.winners                for each row execute function public.audit_row_change();
create trigger trg_audit_payments  after update of amount_paid, payment_date, payment_method, transaction_ref, remarks or delete
  on public.payments for each row execute function public.audit_row_change();
create trigger trg_audit_templates after insert or update or delete on public.notification_templates for each row execute function public.audit_row_change();
create trigger trg_audit_admins    after insert or update or delete on public.admin_users            for each row execute function public.audit_row_change();

-- ---------------------------------------------------------------------
-- Schedule management
-- ---------------------------------------------------------------------

-- Give every unassigned month the next available active member (alphabetical slot order).
create or replace function public.fill_unassigned_winners_internal()
returns int
language plpgsql security definer set search_path = public
as $$
declare
  r record;
  v_member uuid;
  v_count int := 0;
begin
  for r in select id from public.monthly_schedules where winner_member_id is null order by month_number loop
    select m.id into v_member
    from public.members m
    where m.is_active
      and not exists (select 1 from public.monthly_schedules x where x.winner_member_id = m.id)
      and not exists (select 1 from public.winners w where w.member_id = m.id and w.status = 'announced')
    order by m.display_order, m.slot_code
    limit 1;
    exit when v_member is null;
    update public.monthly_schedules set winner_member_id = v_member where id = r.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Create / refresh the schedule from settings. Months with history are never touched.
create or replace function public.generate_schedule()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  s public.committee_settings%rowtype;
  r public.monthly_schedules%rowtype;
  n int;
  v_period date;
  v_due date;
  v_created int := 0;
  v_updated int := 0;
  v_removed int := 0;
  v_skipped int := 0;
  v_rows int;
  v_assigned int;
begin
  perform public.assert_admin();

  select * into s from public.committee_settings where id = 1 for update;
  if not found then
    raise exception 'Committee settings are missing. Run the seed script first.';
  end if;

  for n in 1..s.total_members loop
    v_period := (s.start_month + make_interval(months => n - 1))::date;
    v_due := v_period + (s.payment_due_day - 1);

    select * into r from public.monthly_schedules where month_number = n;
    if not found then
      insert into public.monthly_schedules (month_number, period_month, due_date, contribution_amount, payout_amount)
      values (n, v_period, v_due, s.monthly_contribution, s.payout_amount);
      v_created := v_created + 1;
    elsif (r.period_month, r.due_date, r.contribution_amount, r.payout_amount)
            is distinct from (v_period, v_due, s.monthly_contribution, s.payout_amount) then
      if public.schedule_is_frozen(r.id) then
        v_skipped := v_skipped + 1;   -- preserve history
      else
        update public.monthly_schedules
           set period_month = v_period, due_date = v_due,
               contribution_amount = s.monthly_contribution, payout_amount = s.payout_amount
         where id = r.id;
        update public.payments set required_amount = s.monthly_contribution
         where schedule_id = r.id and amount_paid = 0;
        v_updated := v_updated + 1;
      end if;
    end if;
  end loop;

  -- Remove months beyond the configured length (only if they have no history).
  for r in select * from public.monthly_schedules where month_number > s.total_members order by month_number desc loop
    if public.schedule_is_frozen(r.id) then
      raise exception 'Month % already has payments or a winner, so the committee cannot be shortened below % months.',
        r.month_number, r.month_number;
    end if;
    delete from public.payments where schedule_id = r.id;
    delete from public.monthly_schedules where id = r.id;
    v_removed := v_removed + 1;
  end loop;

  v_rows := public.ensure_payment_rows_internal();
  v_assigned := public.fill_unassigned_winners_internal();

  perform public.log_activity('schedule.generated', 'monthly_schedules', null,
    format('Schedule refreshed: %s created, %s updated, %s removed, %s protected months kept as-is',
           v_created, v_updated, v_removed, v_skipped));

  return jsonb_build_object(
    'created', v_created, 'updated', v_updated, 'removed', v_removed,
    'protected', v_skipped, 'payment_rows_added', v_rows, 'winners_assigned', v_assigned);
end;
$$;

-- Save an admin-defined winner order. Input: [{ "schedule_id": "...", "member_id": "..." | null }, ...]
create or replace function public.save_winner_sequence(p_assignments jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  r record;
  v_changed int := 0;
  v_dupe text;
begin
  perform public.assert_admin();

  if jsonb_typeof(p_assignments) <> 'array' then
    raise exception 'Assignments must be a list.';
  end if;

  for r in
    select x.schedule_id, x.member_id, ms.month_number, ms.winner_member_id as current_member
    from jsonb_to_recordset(p_assignments) as x(schedule_id uuid, member_id uuid)
    join public.monthly_schedules ms on ms.id = x.schedule_id
  loop
    if r.member_id is not distinct from r.current_member then
      continue;
    end if;
    if exists (select 1 from public.winners where schedule_id = r.schedule_id and status = 'announced') then
      raise exception 'Month % is locked because its winner has been announced.', r.month_number;
    end if;
    if r.member_id is not null and not exists (select 1 from public.members where id = r.member_id and is_active) then
      raise exception 'Month %: the selected member is not active.', r.month_number;
    end if;
    if r.member_id is not null and exists (
         select 1 from public.winners where member_id = r.member_id and status = 'announced') then
      raise exception 'Month %: the selected member has already won in another month.', r.month_number;
    end if;
    update public.monthly_schedules set winner_member_id = r.member_id where id = r.schedule_id;
    v_changed := v_changed + 1;
  end loop;

  select m.slot_code into v_dupe
  from public.monthly_schedules ms join public.members m on m.id = ms.winner_member_id
  group by m.slot_code having count(*) > 1 limit 1;
  if v_dupe is not null then
    raise exception 'Slot % is assigned to more than one month. Each member can win only once.', v_dupe;
  end if;

  if v_changed > 0 then
    perform public.log_activity('schedule.sequence_saved', 'monthly_schedules', null,
      format('Winner sequence updated (%s months changed)', v_changed));
  end if;
  return jsonb_build_object('changed', v_changed);
end;
$$;

-- Re-apply alphabetical order to every month that is not yet announced.
create or replace function public.reset_winner_sequence()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_assigned int;
begin
  perform public.assert_admin();
  update public.monthly_schedules ms set winner_member_id = null
   where not exists (select 1 from public.winners w where w.schedule_id = ms.id and w.status = 'announced');
  v_assigned := public.fill_unassigned_winners_internal();
  perform public.log_activity('schedule.sequence_reset', 'monthly_schedules', null,
    'Unannounced months reset to alphabetical slot order');
  return jsonb_build_object('assigned', v_assigned);
end;
$$;

-- ---------------------------------------------------------------------
-- Winner announcements
-- ---------------------------------------------------------------------
create or replace function public.announce_winner(p_schedule_id uuid, p_confirm_slot text, p_notes text default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_s public.monthly_schedules%rowtype;
  v_slot text;
  v_w public.winners%rowtype;
begin
  perform public.assert_admin();

  select * into v_s from public.monthly_schedules where id = p_schedule_id for update;
  if not found then
    raise exception 'That committee month does not exist.';
  end if;
  if v_s.winner_member_id is null then
    raise exception 'Month % has no designated winner yet. Set the winner order first.', v_s.month_number;
  end if;
  if v_s.period_month > public.current_period() then
    raise exception 'Month % has not started yet. Winners can only be announced for the current or a past month.', v_s.month_number;
  end if;
  if exists (select 1 from public.winners where schedule_id = v_s.id and status = 'announced') then
    raise exception 'The winner for month % has already been announced.', v_s.month_number;
  end if;

  select slot_code into v_slot from public.members where id = v_s.winner_member_id;
  if p_confirm_slot is null or upper(trim(p_confirm_slot)) <> v_slot then
    raise exception 'Confirmation does not match. Type the winner slot (%) to confirm.', v_slot;
  end if;

  insert into public.winners (schedule_id, member_id, payout_amount, announced_by, announced_by_email, notes)
  values (v_s.id, v_s.winner_member_id, v_s.payout_amount, auth.uid(), public.current_actor_email(), nullif(trim(p_notes), ''))
  returning * into v_w;

  perform public.log_activity('winner.announced', 'winners', v_w.id::text,
    format('Month %s winner announced: Slot %s', v_s.month_number, v_slot));

  return to_jsonb(v_w);
end;
$$;

create or replace function public.void_winner(p_winner_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_w public.winners%rowtype;
  v_month int;
begin
  if not (public.is_trusted_backend() or public.is_owner()) then
    raise exception 'Only an owner can correct a winner announcement.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Please give a clear reason (at least 5 characters).';
  end if;

  update public.winners
     set status = 'voided', voided_at = now(), voided_by = auth.uid(), void_reason = trim(p_reason)
   where id = p_winner_id and status = 'announced'
  returning * into v_w;
  if not found then
    raise exception 'Announcement not found or already voided.';
  end if;

  select month_number into v_month from public.monthly_schedules where id = v_w.schedule_id;
  perform public.log_activity('winner.voided', 'winners', v_w.id::text,
    format('Month %s winner announcement voided', v_month), trim(p_reason));
  return to_jsonb(v_w);
end;
$$;

-- ---------------------------------------------------------------------
-- Payments
-- ---------------------------------------------------------------------
create or replace function public.record_payment(
  p_payment_id uuid, p_amount_paid numeric, p_payment_date date,
  p_method text, p_reference text, p_remarks text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_p public.payments%rowtype;
  v_slot text;
  v_month int;
begin
  perform public.assert_admin();

  select * into v_p from public.payments where id = p_payment_id for update;
  if not found then
    raise exception 'Payment record not found.';
  end if;
  if p_amount_paid is null or p_amount_paid < 0 or p_amount_paid > v_p.required_amount then
    raise exception 'Amount must be between 0 and %.', v_p.required_amount;
  end if;
  if p_amount_paid > 0 and p_payment_date is null then
    raise exception 'Please enter the payment date.';
  end if;
  if p_payment_date > public.committee_today() then
    raise exception 'The payment date cannot be in the future.';
  end if;
  if p_amount_paid < v_p.amount_paid and length(trim(coalesce(p_remarks, ''))) < 3 then
    raise exception 'You are reducing a recorded amount. Please add a remark explaining why.';
  end if;

  update public.payments
     set amount_paid = p_amount_paid,
         payment_date = case when p_amount_paid > 0 then p_payment_date end,
         payment_method = case when p_amount_paid > 0 then nullif(p_method, '') end,
         transaction_ref = nullif(trim(coalesce(p_reference, '')), ''),
         remarks = nullif(trim(coalesce(p_remarks, '')), ''),
         confirmed_by = auth.uid(),
         confirmed_by_email = public.current_actor_email(),
         confirmed_at = now()
   where id = p_payment_id
  returning * into v_p;

  select m.slot_code, ms.month_number into v_slot, v_month
  from public.members m, public.monthly_schedules ms
  where m.id = v_p.member_id and ms.id = v_p.schedule_id;

  perform public.log_activity('payment.recorded', 'payments', v_p.id::text,
    format('Slot %s, month %s: %s of %s recorded (%s)', v_slot, v_month,
           v_p.amount_paid, v_p.required_amount, v_p.status));
  return to_jsonb(v_p);
end;
$$;

-- ---------------------------------------------------------------------
-- Members
-- ---------------------------------------------------------------------
create or replace function public.set_member_active(p_member_id uuid, p_active boolean, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_m public.members%rowtype;
  v_removed int := 0;
  v_unassigned int := 0;
begin
  perform public.assert_admin();
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Please give a short reason.';
  end if;

  select * into v_m from public.members where id = p_member_id for update;
  if not found then
    raise exception 'Member not found.';
  end if;

  if not p_active then
    update public.members set is_active = false, deactivated_at = now() where id = p_member_id;
    -- Remove only future, unpaid rows. Past and paid rows stay as history.
    delete from public.payments p
     using public.monthly_schedules ms
     where p.schedule_id = ms.id and p.member_id = p_member_id
       and p.amount_paid = 0 and ms.period_month > public.current_period();
    get diagnostics v_removed = row_count;
    update public.monthly_schedules ms set winner_member_id = null
     where ms.winner_member_id = p_member_id
       and not exists (select 1 from public.winners w where w.schedule_id = ms.id and w.status = 'announced');
    get diagnostics v_unassigned = row_count;
  else
    update public.members set is_active = true, deactivated_at = null where id = p_member_id;
  end if;

  perform public.log_activity(
    case when p_active then 'member.reactivated' else 'member.deactivated' end,
    'members', p_member_id::text,
    format('Slot %s %s', v_m.slot_code, case when p_active then 'reactivated' else 'deactivated' end),
    trim(p_reason));

  return jsonb_build_object('future_rows_removed', v_removed, 'months_unassigned', v_unassigned);
end;
$$;

-- ---------------------------------------------------------------------
-- Reporting views (security_invoker so RLS of the caller applies)
-- ---------------------------------------------------------------------
create or replace view public.v_payments
with (security_invoker = true) as
select
  p.*,
  m.slot_code,
  m.full_name,
  m.phone_e164,
  m.is_active as member_active,
  ms.month_number,
  ms.period_month,
  ms.due_date,
  (p.required_amount - p.amount_paid) as balance,
  (p.status <> 'paid' and ms.due_date < public.committee_today()) as is_overdue,
  case
    when p.status = 'paid' then 'paid'
    when p.amount_paid > 0 then 'partially_paid'
    when ms.due_date < public.committee_today() then 'overdue'
    else 'pending'
  end as effective_status,
  greatest(public.committee_today() - ms.due_date, 0) as days_overdue
from public.payments p
join public.members m on m.id = p.member_id
join public.monthly_schedules ms on ms.id = p.schedule_id;

create or replace view public.v_schedule
with (security_invoker = true) as
select
  ms.*,
  wm.slot_code  as winner_slot,
  wm.full_name  as winner_name,
  w.id          as announcement_id,
  w.announced_at,
  w.announced_by_email,
  (w.id is not null) as is_announced,
  case
    when ms.period_month < public.current_period() then 'past'
    when ms.period_month = public.current_period() then 'current'
    else 'upcoming'
  end as phase,
  coalesce(agg.expected_total, 0)  as expected_total,
  coalesce(agg.collected_total, 0) as collected_total,
  coalesce(agg.member_count, 0)    as member_count,
  coalesce(agg.paid_count, 0)      as paid_count,
  coalesce(agg.partial_count, 0)   as partial_count,
  coalesce(agg.unpaid_count, 0)    as unpaid_count
from public.monthly_schedules ms
left join public.members wm on wm.id = ms.winner_member_id
left join public.winners w on w.schedule_id = ms.id and w.status = 'announced'
left join lateral (
  select sum(p.required_amount) as expected_total,
         sum(p.amount_paid)     as collected_total,
         count(*)               as member_count,
         count(*) filter (where p.status = 'paid')           as paid_count,
         count(*) filter (where p.status = 'partially_paid') as partial_count,
         count(*) filter (where p.status = 'pending')        as unpaid_count
  from public.payments p where p.schedule_id = ms.id
) agg on true;

create or replace view public.v_member_summary
with (security_invoker = true) as
select
  m.*,
  ms.id           as winner_schedule_id,
  ms.month_number as winner_month_number,
  ms.period_month as winner_period_month,
  exists (select 1 from public.winners w where w.member_id = m.id and w.status = 'announced') as has_won,
  coalesce((select sum(p.amount_paid) from public.payments p where p.member_id = m.id), 0) as total_contributed,
  coalesce((select sum(p.required_amount - p.amount_paid)
              from public.payments p join public.monthly_schedules s on s.id = p.schedule_id
             where p.member_id = m.id and s.period_month <= public.current_period()), 0) as outstanding_to_date,
  (select vp.effective_status from public.v_payments vp
    where vp.member_id = m.id and vp.period_month = public.current_period()) as current_status
from public.members m
left join public.monthly_schedules ms on ms.winner_member_id = m.id;

-- ==================== supabase/migrations/20261111000003_security.sql ====================
-- =====================================================================
-- Smart Committee Management System — 03: Row Level Security & grants
-- Only active admin users can read or change anything. Anonymous users
-- get nothing. The backend scheduler uses the service role key.
-- =====================================================================

alter table public.admin_users            enable row level security;
alter table public.committee_settings     enable row level security;
alter table public.members                enable row level security;
alter table public.monthly_schedules      enable row level security;
alter table public.winners                enable row level security;
alter table public.payments               enable row level security;
alter table public.notification_templates enable row level security;
alter table public.notification_logs      enable row level security;
alter table public.audit_logs             enable row level security;

-- admin_users: admins can see the admin list; changes are made in SQL by the owner.
create policy admin_users_select on public.admin_users
  for select to authenticated using (public.is_admin());

-- committee_settings: read + update (single row is created by the seed).
create policy settings_select on public.committee_settings
  for select to authenticated using (public.is_admin());
create policy settings_update on public.committee_settings
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- members: read, add, edit. No delete (deactivate instead, to keep history).
create policy members_select on public.members
  for select to authenticated using (public.is_admin());
create policy members_insert on public.members
  for insert to authenticated with check (public.is_admin());
create policy members_update on public.members
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- schedules: read only from the app. Changes go through RPC functions.
create policy schedules_select on public.monthly_schedules
  for select to authenticated using (public.is_admin());

-- winners: read only. Announce / void through RPC functions.
create policy winners_select on public.winners
  for select to authenticated using (public.is_admin());

-- payments: read only. Recording goes through record_payment().
create policy payments_select on public.payments
  for select to authenticated using (public.is_admin());

-- templates: read + edit.
create policy templates_select on public.notification_templates
  for select to authenticated using (public.is_admin());
create policy templates_update on public.notification_templates
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- notification logs: read, create, update (for retries / status). No delete.
create policy logs_select on public.notification_logs
  for select to authenticated using (public.is_admin());
create policy logs_insert on public.notification_logs
  for insert to authenticated with check (public.is_admin());
create policy logs_update on public.notification_logs
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- audit logs: read only for admins; rows are written by triggers/functions.
create policy audit_select on public.audit_logs
  for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------
-- Table privileges: nothing for anon; only what the policies need for authenticated.
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;

grant select                 on public.admin_users            to authenticated;
grant select, update         on public.committee_settings     to authenticated;
grant select, insert, update on public.members                to authenticated;
grant select                 on public.monthly_schedules      to authenticated;
grant select                 on public.winners                to authenticated;
grant select                 on public.payments               to authenticated;
grant select, update         on public.notification_templates to authenticated;
grant select, insert, update on public.notification_logs      to authenticated;
grant select                 on public.audit_logs             to authenticated;
grant select on public.v_payments, public.v_schedule, public.v_member_summary to authenticated;

-- Audit log is append-only even for the service role.
revoke update, delete, truncate on public.audit_logs from service_role;

-- ---------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function
  public.is_admin(), public.is_owner(), public.committee_today(), public.current_period(),
  public.schedule_is_frozen(uuid),
  public.generate_schedule(), public.save_winner_sequence(jsonb), public.reset_winner_sequence(),
  public.announce_winner(uuid, text, text), public.void_winner(uuid, text),
  public.record_payment(uuid, numeric, date, text, text, text),
  public.set_member_active(uuid, boolean, text)
to authenticated, service_role;

-- Internal helpers stay callable only from other functions / the backend.
grant execute on function
  public.ensure_payment_rows_internal(), public.fill_unassigned_winners_internal(),
  public.log_activity(text, text, text, text, text, jsonb),
  public.assert_admin(), public.is_trusted_backend(), public.current_actor_email()
to service_role;

-- Future functions should not be callable by anon by default.
alter default privileges in schema public revoke execute on functions from public, anon;

-- ==================== supabase/seed.sql ====================
-- =====================================================================
-- Smart Committee Management System — seed data
-- Safe to run once on a fresh database (after the three migrations).
-- Creates: settings, 17 member slots (A–Q), 6 notification templates,
-- and the 17-month schedule with payment rows.
--
-- BEFORE RUNNING: change the start month below if your committee did not
-- start this month. You can also change it later in Settings, as long as
-- no payments or winners have been recorded yet.
-- =====================================================================

insert into public.committee_settings (id, committee_name, total_members, monthly_contribution, payout_amount, start_month)
values (1, 'Family Committee', 17, 10000, 170000, date_trunc('month', (now() at time zone 'Asia/Karachi'))::date)
on conflict (id) do nothing;

-- 17 alphabetical slots: A … Q
insert into public.members (slot_code, display_order, joined_month)
select chr(64 + n), n, (select start_month from public.committee_settings where id = 1)
from generate_series(1, 17) as n
on conflict (slot_code) do nothing;

insert into public.notification_templates (key, name, description, body, meta_template_name, meta_language_code, meta_body_params) values
('monthly_reminder', 'Monthly Committee Reminder',
 'Sent at the start of each month to members who have not paid yet.',
 E'Assalam-o-Alaikum {{member_name}},\n\nFriendly reminder for *{{committee_name}}* – Month {{month_number}} of {{total_months}} ({{month_label}}).\n\nYour contribution: *{{amount}}*\nDue date: *{{due_date}}*\nThis month''s winner: Slot {{winner_slot}}\n\nPlease share the transaction reference after paying. JazakAllah!',
 'committee_monthly_reminder', 'en',
 array['member_name','committee_name','month_number','total_months','month_label','amount','due_date','winner_slot']),

('winner_announcement', 'Winner Announcement',
 'Sent to all members after the monthly winner is announced.',
 E'Assalam-o-Alaikum {{member_name}},\n\n*Winner announcement – {{month_label}}*\n\nThe winner of {{committee_name}} for Month {{month_number}} is *Slot {{winner_slot}}*.\nPayout: *{{payout}}*\n\nNext month''s winner: Slot {{next_winner_slot}}.\nThank you all for your contributions!',
 'committee_winner_announcement', 'en',
 array['member_name','month_label','committee_name','month_number','winner_slot','payout','next_winner_slot']),

('payment_due', 'Payment Due Reminder',
 'Sent before and on the due date to members who still owe money.',
 E'Assalam-o-Alaikum {{member_name}},\n\nYour committee contribution of *{{balance}}* for {{month_label}} is due on *{{due_date}}*.\n\nKindly pay on time and share the transaction reference. Thank you!',
 'committee_payment_due', 'en',
 array['member_name','balance','month_label','due_date']),

('payment_overdue', 'Payment Overdue Alert',
 'Sent every few days after the due date while a payment is still unpaid.',
 E'Assalam-o-Alaikum {{member_name}},\n\nYour contribution for {{month_label}} was due on {{due_date}} ({{days_overdue}} days ago).\nRemaining amount: *{{balance}}*\n\nPlease clear it soon so the payout is not delayed. If you have already paid, please share the transaction reference.',
 'committee_payment_overdue', 'en',
 array['member_name','month_label','due_date','days_overdue','balance']),

('payment_received', 'Payment Received Confirmation',
 'Sent after an admin records a payment.',
 E'Assalam-o-Alaikum {{member_name}},\n\nWe have received *{{amount_paid}}* for {{month_label}} (Slot {{slot}}).\nReference: {{transaction_ref}}\nRemaining for this month: {{balance}}\n\nJazakAllah for your payment!',
 'committee_payment_received', 'en',
 array['member_name','amount_paid','month_label','slot','transaction_ref','balance']),

('new_month_update', 'New Month Committee Update',
 'Sent to everyone when a new committee month starts.',
 E'Assalam-o-Alaikum {{member_name}},\n\n*{{committee_name}} – {{month_label}}*\nMonth {{month_number}} of {{total_months}} has started.\n\nContribution: {{amount}} per member\nDue date: {{due_date}}\nThis month''s winner: Slot {{winner_slot}}\nPayout: {{payout}}\n\nRemaining months after this one: {{remaining_months}}.',
 'committee_new_month_update', 'en',
 array['member_name','committee_name','month_label','month_number','total_months','amount','due_date','winner_slot','payout','remaining_months'])
on conflict (key) do nothing;

-- Build the 17-month schedule, payment rows and the default A→Q winner order.
select public.generate_schedule();
