-- =====================================================================
-- Smart Committee — 04: Multi-committee platform, lucky draws, public view,
-- per-committee WhatsApp credentials.
--
-- SAFE UPGRADE: existing data is kept. The existing single committee becomes
-- the first committee on the platform, and every existing admin becomes its
-- admin/owner. Runs as one transaction: if anything fails, nothing changes.
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1. New tables: committees + per-committee admins
-- ---------------------------------------------------------------------
create table public.committees (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$'),
  created_by      uuid references auth.users (id) on delete set null,
  public_enabled  boolean not null default true,
  logo_data       text check (logo_data is null or (logo_data ~ '^data:image/(png|jpeg|webp);base64,' and length(logo_data) <= 400000)),
  created_at      timestamptz not null default now()
);
comment on column public.committees.logo_data is 'Small committee logo as a data URL (shown in the app, public page and banners)';
comment on column public.committees.slug is 'Public page address: /p/<slug>';

create table public.committee_admins (
  committee_id  uuid not null references public.committees (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  email         text,
  role          text not null default 'admin' check (role in ('owner', 'admin')),
  created_at    timestamptz not null default now(),
  primary key (committee_id, user_id)
);
create index committee_admins_user_idx on public.committee_admins (user_id);

-- Turns a name into a URL-safe, unique slug.
create or replace function public.make_unique_slug(p_text text)
returns text
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_base text := trim(both '-' from regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', '-', 'g'));
  v_slug text;
  i int := 1;
begin
  if length(v_base) < 3 then v_base := 'committee'; end if;
  v_base := left(v_base, 40);
  v_slug := v_base;
  while exists (select 1 from public.committees where slug = v_slug) loop
    i := i + 1;
    v_slug := v_base || '-' || i;
  end loop;
  return v_slug;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Move the existing committee into the new structure
-- ---------------------------------------------------------------------
alter table public.committee_settings add column committee_id uuid references public.committees (id) on delete cascade;
alter table public.committee_settings
  add column winner_selection text not null default 'sequence' check (winner_selection in ('sequence', 'lucky_draw'));

do $$
declare
  v_cid uuid;
  v_owner uuid;
begin
  if exists (select 1 from public.committee_settings) then
    select id into v_owner from public.admin_users where is_active order by (role = 'owner') desc, created_at limit 1;
    insert into public.committees (slug, created_by)
    values (public.make_unique_slug((select committee_name from public.committee_settings limit 1)), v_owner)
    returning id into v_cid;

    alter table public.committee_settings disable trigger user;
    update public.committee_settings set committee_id = v_cid;
    alter table public.committee_settings enable trigger user;

    insert into public.committee_admins (committee_id, user_id, email, role)
    select v_cid, id, email, role from public.admin_users where is_active
    on conflict do nothing;

    perform set_config('app.legacy_committee', v_cid::text, true);
  end if;
end $$;

-- committee_settings: committee_id becomes the key (the old id = 1 column goes)
alter table public.committee_settings drop column id;
alter table public.committee_settings alter column committee_id set not null;
alter table public.committee_settings add primary key (committee_id);

-- Add committee_id to every committee-owned table and fill it for existing rows.
alter table public.members                add column committee_id uuid references public.committees (id) on delete cascade;
alter table public.monthly_schedules      add column committee_id uuid references public.committees (id) on delete cascade;
alter table public.winners                add column committee_id uuid references public.committees (id) on delete cascade;
alter table public.payments               add column committee_id uuid references public.committees (id) on delete cascade;
alter table public.notification_templates add column committee_id uuid references public.committees (id) on delete cascade;
alter table public.notification_logs      add column committee_id uuid references public.committees (id) on delete cascade;
alter table public.audit_logs             add column committee_id uuid;

-- Backfill quietly (no audit noise, no history-protection checks for this one-time move).
alter table public.members                disable trigger user;
alter table public.monthly_schedules      disable trigger user;
alter table public.winners                disable trigger user;
alter table public.payments               disable trigger user;
alter table public.notification_templates disable trigger user;
alter table public.notification_logs      disable trigger user;

do $$
declare v_cid uuid := nullif(current_setting('app.legacy_committee', true), '')::uuid;
begin
  if v_cid is not null then
    update public.members                set committee_id = v_cid;
    update public.monthly_schedules      set committee_id = v_cid;
    update public.winners                set committee_id = v_cid;
    update public.payments               set committee_id = v_cid;
    update public.notification_templates set committee_id = v_cid;
    update public.notification_logs      set committee_id = v_cid;
    update public.audit_logs             set committee_id = v_cid;
  end if;
end $$;

alter table public.members                enable trigger user;
alter table public.monthly_schedules      enable trigger user;
alter table public.winners                enable trigger user;
alter table public.payments               enable trigger user;
alter table public.notification_templates enable trigger user;
alter table public.notification_logs      enable trigger user;

alter table public.members                alter column committee_id set not null;
alter table public.monthly_schedules      alter column committee_id set not null;
alter table public.winners                alter column committee_id set not null;
alter table public.payments               alter column committee_id set not null;
alter table public.notification_templates alter column committee_id set not null;

create index audit_logs_committee_idx on public.audit_logs (committee_id, occurred_at desc);
create index notification_logs_committee_idx on public.notification_logs (committee_id, created_at desc);

-- Uniqueness is now per committee (two committees can both have slot "A").
alter table public.members drop constraint members_slot_code_key;
alter table public.members add constraint members_committee_slot_key unique (committee_id, slot_code);
alter table public.members add constraint members_id_committee_key unique (id, committee_id);

alter table public.monthly_schedules drop constraint monthly_schedules_month_number_key;
alter table public.monthly_schedules drop constraint monthly_schedules_period_key;
alter table public.monthly_schedules add constraint monthly_schedules_month_number_key
  unique (committee_id, month_number) deferrable initially deferred;
alter table public.monthly_schedules add constraint monthly_schedules_period_key
  unique (committee_id, period_month) deferrable initially deferred;
alter table public.monthly_schedules add constraint monthly_schedules_id_committee_key unique (id, committee_id);

-- Child rows must belong to the same committee as the rows they point to.
alter table public.monthly_schedules add constraint monthly_schedules_winner_same_committee
  foreign key (winner_member_id, committee_id) references public.members (id, committee_id);
alter table public.payments add constraint payments_member_same_committee
  foreign key (member_id, committee_id) references public.members (id, committee_id);
alter table public.payments add constraint payments_schedule_same_committee
  foreign key (schedule_id, committee_id) references public.monthly_schedules (id, committee_id);
alter table public.winners add constraint winners_member_same_committee
  foreign key (member_id, committee_id) references public.members (id, committee_id);
alter table public.winners add constraint winners_schedule_same_committee
  foreign key (schedule_id, committee_id) references public.monthly_schedules (id, committee_id);

-- Templates: one of each type per committee, plus the new personal winner message.
alter table public.notification_templates drop constraint notification_templates_key_key;
alter table public.notification_templates drop constraint notification_templates_key_check;
alter table public.notification_templates add constraint notification_templates_key_check check (key in (
  'monthly_reminder', 'winner_announcement', 'payment_due', 'payment_overdue',
  'payment_received', 'new_month_update', 'winner_personal'));
alter table public.notification_templates add constraint notification_templates_committee_key unique (committee_id, key);
alter table public.notification_templates add column meta_header_image boolean not null default false;

-- ---------------------------------------------------------------------
-- 3. Lucky draws
-- ---------------------------------------------------------------------
create table public.draws (
  id                    uuid primary key default gen_random_uuid(),
  committee_id          uuid not null references public.committees (id) on delete cascade,
  schedule_id           uuid not null,
  mode                  text not null check (mode in ('manual', 'auto', 'scheduler')),
  candidate_member_ids  uuid[] not null,
  candidate_slots       text[] not null,
  winner_member_id      uuid not null,
  winner_slot           text not null,
  winner_id             uuid references public.winners (id) on delete set null,
  created_by            uuid references auth.users (id) on delete set null,
  created_by_email      text,
  created_at            timestamptz not null default now(),
  foreign key (schedule_id, committee_id) references public.monthly_schedules (id, committee_id),
  foreign key (winner_member_id, committee_id) references public.members (id, committee_id)
);
create index draws_committee_idx on public.draws (committee_id, created_at desc);

-- ---------------------------------------------------------------------
-- 4. Per-committee WhatsApp credentials (never readable from the browser)
-- ---------------------------------------------------------------------
create table public.committee_whatsapp (
  committee_id         uuid primary key references public.committees (id) on delete cascade,
  phone_number_id      text not null check (phone_number_id ~ '^[0-9]{5,30}$'),
  access_token         text not null check (length(access_token) between 20 and 1000),
  business_account_id  text check (business_account_id is null or business_account_id ~ '^[0-9]{5,30}$'),
  display_phone        text,
  updated_at           timestamptz not null default now(),
  updated_by           uuid references auth.users (id) on delete set null
);
alter table public.committee_whatsapp enable row level security;   -- no policies: only the server (service role) reads it
revoke all on public.committee_whatsapp from anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. Replace single-committee helpers with committee-aware versions
-- ---------------------------------------------------------------------
drop view if exists public.v_member_summary;
drop view if exists public.v_schedule;
drop view if exists public.v_payments;

drop function if exists public.generate_schedule();
drop function if exists public.reset_winner_sequence();
drop function if exists public.save_winner_sequence(jsonb);
drop function if exists public.ensure_payment_rows_internal();
drop function if exists public.fill_unassigned_winners_internal();
drop function if exists public.committee_today();
drop function if exists public.current_period();
drop function if exists public.assert_admin();
drop function if exists public.log_activity(text, text, text, text, text, jsonb);

create or replace function public.is_committee_admin(p_committee_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.committee_admins where committee_id = p_committee_id and user_id = auth.uid());
$$;

create or replace function public.is_committee_owner(p_committee_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.committee_admins
                 where committee_id = p_committee_id and user_id = auth.uid() and role = 'owner');
$$;

create or replace function public.assert_admin(p_committee_id uuid)
returns void
language plpgsql stable security definer set search_path = public
as $$
begin
  if p_committee_id is null then
    raise exception 'Committee not found.';
  end if;
  if public.is_trusted_backend() or public.is_committee_admin(p_committee_id) then
    return;
  end if;
  raise exception 'You are not authorized to perform this action.' using errcode = '42501';
end;
$$;

create or replace function public.committee_today(p_committee_id uuid)
returns date
language sql stable security definer set search_path = public
as $$
  select (now() at time zone coalesce(
    (select timezone from public.committee_settings where committee_id = p_committee_id), 'Asia/Karachi'))::date;
$$;

create or replace function public.current_period(p_committee_id uuid)
returns date
language sql stable security definer set search_path = public
as $$
  select date_trunc('month', public.committee_today(p_committee_id))::date;
$$;

create or replace function public.log_activity(
  p_committee_id uuid, p_action text, p_entity_type text, p_entity_id text, p_summary text,
  p_reason text default null, p_data jsonb default null)
returns void
language sql security definer set search_path = public
as $$
  insert into public.audit_logs (committee_id, actor_id, actor_email, action, entity_type, entity_id, summary, reason, new_data)
  values (p_committee_id, auth.uid(), public.current_actor_email(), p_action, p_entity_type, p_entity_id, p_summary, p_reason, p_data);
$$;

create or replace function public.audit_row_change()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
begin
  if tg_op = 'UPDATE' and (v_old - 'updated_at') = (v_new - 'updated_at') then
    return new;
  end if;
  insert into public.audit_logs (committee_id, actor_id, actor_email, action, entity_type, entity_id, old_data, new_data)
  values (nullif(v_row ->> 'committee_id', '')::uuid, auth.uid(), public.current_actor_email(), lower(tg_op), tg_table_name,
          coalesce(v_row ->> 'id', v_row ->> 'committee_id'), v_old, v_new);
  return coalesce(new, old);
end;
$$;

create or replace function public.settings_protect_history()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.start_month is distinct from old.start_month and (
       exists (select 1 from public.payments where committee_id = old.committee_id and amount_paid > 0)
       or exists (select 1 from public.winners where committee_id = old.committee_id and status = 'announced')) then
    raise exception 'The start month cannot change after payments or winners have been recorded.';
  end if;
  if new.committee_id is distinct from old.committee_id then
    raise exception 'Settings cannot move to another committee.';
  end if;
  return new;
end;
$$;

create or replace function public.ensure_payment_rows_internal(p_committee_id uuid default null)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_count int;
begin
  insert into public.payments (committee_id, schedule_id, member_id, required_amount)
  select m.committee_id, ms.id, m.id, ms.contribution_amount
  from public.members m
  join public.monthly_schedules ms on ms.committee_id = m.committee_id and ms.period_month >= m.joined_month
  where m.is_active and (p_committee_id is null or m.committee_id = p_committee_id)
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
    perform public.ensure_payment_rows_internal(new.committee_id);
  end if;
  return new;
end;
$$;

create or replace function public.fill_unassigned_winners_internal(p_committee_id uuid)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  r record;
  v_member uuid;
  v_count int := 0;
begin
  for r in select id from public.monthly_schedules
           where committee_id = p_committee_id and winner_member_id is null order by month_number loop
    select m.id into v_member
    from public.members m
    where m.committee_id = p_committee_id and m.is_active
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

create or replace function public.generate_schedule(p_committee_id uuid)
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
  perform public.assert_admin(p_committee_id);

  select * into s from public.committee_settings where committee_id = p_committee_id for update;
  if not found then
    raise exception 'Committee settings are missing.';
  end if;

  for n in 1..s.total_members loop
    v_period := (s.start_month + make_interval(months => n - 1))::date;
    v_due := v_period + (s.payment_due_day - 1);

    select * into r from public.monthly_schedules where committee_id = p_committee_id and month_number = n;
    if not found then
      insert into public.monthly_schedules (committee_id, month_number, period_month, due_date, contribution_amount, payout_amount)
      values (p_committee_id, n, v_period, v_due, s.monthly_contribution, s.payout_amount);
      v_created := v_created + 1;
    elsif (r.period_month, r.due_date, r.contribution_amount, r.payout_amount)
            is distinct from (v_period, v_due, s.monthly_contribution, s.payout_amount) then
      if public.schedule_is_frozen(r.id) then
        v_skipped := v_skipped + 1;
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

  for r in select * from public.monthly_schedules
           where committee_id = p_committee_id and month_number > s.total_members order by month_number desc loop
    if public.schedule_is_frozen(r.id) then
      raise exception 'Month % already has payments or a winner, so the committee cannot be shortened below % months.',
        r.month_number, r.month_number;
    end if;
    delete from public.draws where schedule_id = r.id;
    delete from public.payments where schedule_id = r.id;
    delete from public.monthly_schedules where id = r.id;
    v_removed := v_removed + 1;
  end loop;

  v_rows := public.ensure_payment_rows_internal(p_committee_id);
  v_assigned := public.fill_unassigned_winners_internal(p_committee_id);

  perform public.log_activity(p_committee_id, 'schedule.generated', 'monthly_schedules', null,
    format('Schedule refreshed: %s created, %s updated, %s removed, %s protected months kept as-is',
           v_created, v_updated, v_removed, v_skipped));

  return jsonb_build_object(
    'created', v_created, 'updated', v_updated, 'removed', v_removed,
    'protected', v_skipped, 'payment_rows_added', v_rows, 'winners_assigned', v_assigned);
end;
$$;

create or replace function public.save_winner_sequence(p_committee_id uuid, p_assignments jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  r record;
  v_changed int := 0;
  v_dupe text;
begin
  perform public.assert_admin(p_committee_id);
  if jsonb_typeof(p_assignments) <> 'array' then
    raise exception 'Assignments must be a list.';
  end if;

  for r in
    select x.schedule_id, x.member_id, ms.month_number, ms.winner_member_id as current_member, ms.committee_id
    from jsonb_to_recordset(p_assignments) as x(schedule_id uuid, member_id uuid)
    join public.monthly_schedules ms on ms.id = x.schedule_id
  loop
    if r.committee_id <> p_committee_id then
      raise exception 'That month belongs to another committee.';
    end if;
    if r.member_id is not distinct from r.current_member then
      continue;
    end if;
    if exists (select 1 from public.winners where schedule_id = r.schedule_id and status = 'announced') then
      raise exception 'Month % is locked because its winner has been announced.', r.month_number;
    end if;
    if r.member_id is not null and not exists (
         select 1 from public.members where id = r.member_id and is_active and committee_id = p_committee_id) then
      raise exception 'Month %: the selected member is not an active member of this committee.', r.month_number;
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
  where ms.committee_id = p_committee_id
  group by m.slot_code having count(*) > 1 limit 1;
  if v_dupe is not null then
    raise exception 'Slot % is assigned to more than one month. Each member can win only once.', v_dupe;
  end if;

  if v_changed > 0 then
    perform public.log_activity(p_committee_id, 'schedule.sequence_saved', 'monthly_schedules', null,
      format('Winner sequence updated (%s months changed)', v_changed));
  end if;
  return jsonb_build_object('changed', v_changed);
end;
$$;

create or replace function public.reset_winner_sequence(p_committee_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_assigned int;
begin
  perform public.assert_admin(p_committee_id);
  update public.monthly_schedules ms set winner_member_id = null
   where ms.committee_id = p_committee_id
     and not exists (select 1 from public.winners w where w.schedule_id = ms.id and w.status = 'announced');
  v_assigned := public.fill_unassigned_winners_internal(p_committee_id);
  perform public.log_activity(p_committee_id, 'schedule.sequence_reset', 'monthly_schedules', null,
    'Unannounced months reset to alphabetical slot order');
  return jsonb_build_object('assigned', v_assigned);
end;
$$;

-- Shared by manual announcements, lucky draws and the scheduler.
create or replace function public.announce_winner_internal(p_schedule_id uuid, p_notes text)
returns public.winners
language plpgsql security definer set search_path = public
as $$
declare
  v_s public.monthly_schedules%rowtype;
  v_slot text;
  v_w public.winners%rowtype;
begin
  select * into v_s from public.monthly_schedules where id = p_schedule_id for update;
  if not found then
    raise exception 'That committee month does not exist.';
  end if;
  if v_s.winner_member_id is null then
    raise exception 'Month % has no designated winner yet.', v_s.month_number;
  end if;
  if v_s.period_month > public.current_period(v_s.committee_id) then
    raise exception 'Month % has not started yet. Winners can only be announced for the current or a past month.', v_s.month_number;
  end if;
  if exists (select 1 from public.winners where schedule_id = v_s.id and status = 'announced') then
    raise exception 'The winner for month % has already been announced.', v_s.month_number;
  end if;

  select slot_code into v_slot from public.members where id = v_s.winner_member_id;
  insert into public.winners (committee_id, schedule_id, member_id, payout_amount, announced_by, announced_by_email, notes)
  values (v_s.committee_id, v_s.id, v_s.winner_member_id, v_s.payout_amount, auth.uid(), public.current_actor_email(),
          nullif(trim(p_notes), ''))
  returning * into v_w;

  perform public.log_activity(v_s.committee_id, 'winner.announced', 'winners', v_w.id::text,
    format('Month %s winner announced: Slot %s', v_s.month_number, v_slot));
  return v_w;
end;
$$;

drop function if exists public.announce_winner(uuid, text, text);
create or replace function public.announce_winner(p_schedule_id uuid, p_confirm_slot text, p_notes text default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_cid uuid;
  v_slot text;
begin
  select ms.committee_id, m.slot_code into v_cid, v_slot
  from public.monthly_schedules ms left join public.members m on m.id = ms.winner_member_id
  where ms.id = p_schedule_id;
  perform public.assert_admin(v_cid);
  if v_slot is not null and (p_confirm_slot is null or upper(trim(p_confirm_slot)) <> v_slot) then
    raise exception 'Confirmation does not match. Type the winner slot (%) to confirm.', v_slot;
  end if;
  return to_jsonb(public.announce_winner_internal(p_schedule_id, p_notes));
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
  select * into v_w from public.winners where id = p_winner_id;
  if not found then
    raise exception 'Announcement not found.';
  end if;
  if not (public.is_trusted_backend() or public.is_committee_owner(v_w.committee_id)) then
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
  perform public.log_activity(v_w.committee_id, 'winner.voided', 'winners', v_w.id::text,
    format('Month %s winner announcement voided', v_month), trim(p_reason));
  return to_jsonb(v_w);
end;
$$;

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
  select * into v_p from public.payments where id = p_payment_id for update;
  if not found then
    raise exception 'Payment record not found.';
  end if;
  perform public.assert_admin(v_p.committee_id);
  if p_amount_paid is null or p_amount_paid < 0 or p_amount_paid > v_p.required_amount then
    raise exception 'Amount must be between 0 and %.', v_p.required_amount;
  end if;
  if p_amount_paid > 0 and p_payment_date is null then
    raise exception 'Please enter the payment date.';
  end if;
  if p_payment_date > public.committee_today(v_p.committee_id) then
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

  perform public.log_activity(v_p.committee_id, 'payment.recorded', 'payments', v_p.id::text,
    format('Slot %s, month %s: %s of %s recorded (%s)', v_slot, v_month,
           v_p.amount_paid, v_p.required_amount, v_p.status));
  return to_jsonb(v_p);
end;
$$;

create or replace function public.set_member_active(p_member_id uuid, p_active boolean, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_m public.members%rowtype;
  v_removed int := 0;
  v_unassigned int := 0;
begin
  select * into v_m from public.members where id = p_member_id for update;
  if not found then
    raise exception 'Member not found.';
  end if;
  perform public.assert_admin(v_m.committee_id);
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Please give a short reason.';
  end if;

  if not p_active then
    update public.members set is_active = false, deactivated_at = now() where id = p_member_id;
    delete from public.payments p
     using public.monthly_schedules ms
     where p.schedule_id = ms.id and p.member_id = p_member_id
       and p.amount_paid = 0 and ms.period_month > public.current_period(v_m.committee_id);
    get diagnostics v_removed = row_count;
    update public.monthly_schedules ms set winner_member_id = null
     where ms.winner_member_id = p_member_id
       and not exists (select 1 from public.winners w where w.schedule_id = ms.id and w.status = 'announced');
    get diagnostics v_unassigned = row_count;
  else
    update public.members set is_active = true, deactivated_at = null where id = p_member_id;
  end if;

  perform public.log_activity(v_m.committee_id,
    case when p_active then 'member.reactivated' else 'member.deactivated' end,
    'members', p_member_id::text,
    format('Slot %s %s', v_m.slot_code, case when p_active then 'reactivated' else 'deactivated' end),
    trim(p_reason));

  return jsonb_build_object('future_rows_removed', v_removed, 'months_unassigned', v_unassigned);
end;
$$;

-- ---------------------------------------------------------------------
-- 6. Lucky draw (the winner is chosen here, on the server, with a
--    cryptographically secure random source. The animation only reveals it.)
-- ---------------------------------------------------------------------
create or replace function public.secure_random_below(p_n int)
returns int
language plpgsql volatile security definer set search_path = public, extensions
as $$
declare
  b bytea;
  v bigint;
  v_limit bigint;
begin
  if p_n <= 0 then raise exception 'n must be positive'; end if;
  v_limit := (4294967296 / p_n) * p_n;          -- rejection sampling: no modulo bias
  loop
    b := gen_random_bytes(4);
    v := (get_byte(b, 0)::bigint << 24) | (get_byte(b, 1)::bigint << 16) | (get_byte(b, 2)::bigint << 8) | get_byte(b, 3)::bigint;
    exit when v < v_limit;
  end loop;
  return (v % p_n)::int;
end;
$$;

create or replace function public.run_lucky_draw(p_schedule_id uuid, p_mode text default 'manual', p_card_count int default 4)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_s public.monthly_schedules%rowtype;
  v_ids uuid[];
  v_slots text[];
  v_pick int;
  v_winner uuid;
  v_winner_slot text;
  v_other uuid;
  v_w public.winners%rowtype;
  v_draw uuid;
begin
  if p_mode not in ('manual', 'auto', 'scheduler') then
    raise exception 'Unknown draw mode.';
  end if;
  select * into v_s from public.monthly_schedules where id = p_schedule_id for update;
  if not found then
    raise exception 'That committee month does not exist.';
  end if;
  perform public.assert_admin(v_s.committee_id);

  if exists (select 1 from public.winners where schedule_id = v_s.id and status = 'announced') then
    raise exception 'The winner for month % has already been announced.', v_s.month_number;
  end if;
  if v_s.period_month > public.current_period(v_s.committee_id) then
    raise exception 'Month % has not started yet.', v_s.month_number;
  end if;

  -- Eligible: active members who have not won yet. Pick up to N cards at random.
  select array_agg(id), array_agg(slot_code) into v_ids, v_slots
  from (
    select m.id, m.slot_code
    from public.members m
    where m.committee_id = v_s.committee_id and m.is_active
      and not exists (select 1 from public.winners w where w.member_id = m.id and w.status = 'announced')
    order by gen_random_bytes(16)
    limit greatest(1, least(coalesce(p_card_count, 4), 8))
  ) c;
  if v_ids is null then
    raise exception 'Every active member has already won. There is nobody left to draw.';
  end if;

  v_pick := public.secure_random_below(array_length(v_ids, 1)) + 1;
  v_winner := v_ids[v_pick];
  v_winner_slot := v_slots[v_pick];

  -- Make the drawn member this month's winner. If they were planned for another
  -- (not yet announced) month, that month takes this month's planned member instead.
  select id into v_other from public.monthly_schedules
   where winner_member_id = v_winner and id <> v_s.id
     and not exists (select 1 from public.winners w where w.schedule_id = monthly_schedules.id and w.status = 'announced');
  if v_other is not null then
    update public.monthly_schedules set winner_member_id = v_s.winner_member_id where id = v_other;
  end if;
  update public.monthly_schedules set winner_member_id = v_winner where id = v_s.id;

  v_w := public.announce_winner_internal(v_s.id, format('Lucky draw (%s) between slots %s', p_mode, array_to_string(v_slots, ', ')));

  insert into public.draws (committee_id, schedule_id, mode, candidate_member_ids, candidate_slots,
                            winner_member_id, winner_slot, winner_id, created_by, created_by_email)
  values (v_s.committee_id, v_s.id, p_mode, v_ids, v_slots, v_winner, v_winner_slot, v_w.id,
          auth.uid(), public.current_actor_email())
  returning id into v_draw;

  perform public.log_activity(v_s.committee_id, 'draw.completed', 'draws', v_draw::text,
    format('Lucky draw for month %s: Slot %s won (cards: %s)', v_s.month_number, v_winner_slot, array_to_string(v_slots, ', ')));

  return jsonb_build_object(
    'draw_id', v_draw, 'winner_id', v_w.id, 'schedule_id', v_s.id, 'month_number', v_s.month_number,
    'winner_member_id', v_winner, 'winner_slot', v_winner_slot,
    'candidates', (select jsonb_agg(jsonb_build_object('member_id', v_ids[i], 'slot', v_slots[i]) order by i)
                   from generate_subscripts(v_ids, 1) as i));
end;
$$;

-- ---------------------------------------------------------------------
-- 7. Creating committees, managing admins, WhatsApp credentials
-- ---------------------------------------------------------------------
create or replace function public.seed_committee_templates(p_committee_id uuid)
returns void
language sql security definer set search_path = public
as $$
  insert into public.notification_templates (committee_id, key, name, description, body, meta_template_name, meta_language_code, meta_body_params, meta_header_image) values
  (p_committee_id, 'monthly_reminder', 'Monthly Committee Reminder',
   'Sent at the start of each month to members who have not paid yet.',
   E'Assalam-o-Alaikum {{member_name}},\n\nFriendly reminder for *{{committee_name}}* – Month {{month_number}} of {{total_months}} ({{month_label}}).\n\nYour contribution: *{{amount}}*\nDue date: *{{due_date}}*\nThis month''s winner: Slot {{winner_slot}}\n\nPlease share the transaction reference after paying. JazakAllah!',
   'committee_monthly_reminder', 'en',
   array['member_name','committee_name','month_number','total_months','month_label','amount','due_date','winner_slot'], false),
  (p_committee_id, 'winner_announcement', 'Winner Announcement',
   'Sent to all members after the monthly winner is announced.',
   E'Assalam-o-Alaikum {{member_name}},\n\n*Winner announcement – {{month_label}}*\n\nThe winner of {{committee_name}} for Month {{month_number}} is *Slot {{winner_slot}}*.\nPayout: *{{payout}}*\n\nNext month''s winner: Slot {{next_winner_slot}}.\nThank you all for your contributions!',
   'committee_winner_announcement', 'en',
   array['member_name','month_label','committee_name','month_number','winner_slot','payout','next_winner_slot'], false),
  (p_committee_id, 'payment_due', 'Payment Due Reminder',
   'Sent before and on the due date to members who still owe money.',
   E'Assalam-o-Alaikum {{member_name}},\n\nYour committee contribution of *{{balance}}* for {{month_label}} is due on *{{due_date}}*.\n\nKindly pay on time and share the transaction reference. Thank you!',
   'committee_payment_due', 'en', array['member_name','balance','month_label','due_date'], false),
  (p_committee_id, 'payment_overdue', 'Payment Overdue Alert',
   'Sent every few days after the due date while a payment is still unpaid.',
   E'Assalam-o-Alaikum {{member_name}},\n\nYour contribution for {{month_label}} was due on {{due_date}} ({{days_overdue}} days ago).\nRemaining amount: *{{balance}}*\n\nPlease clear it soon so the payout is not delayed. If you have already paid, please share the transaction reference.',
   'committee_payment_overdue', 'en', array['member_name','month_label','due_date','days_overdue','balance'], false),
  (p_committee_id, 'payment_received', 'Payment Received Confirmation',
   'Sent after an admin records a payment.',
   E'Assalam-o-Alaikum {{member_name}},\n\nWe have received *{{amount_paid}}* for {{month_label}} (Slot {{slot}}).\nReference: {{transaction_ref}}\nRemaining for this month: {{balance}}\n\nJazakAllah for your payment!',
   'committee_payment_received', 'en', array['member_name','amount_paid','month_label','slot','transaction_ref','balance'], false),
  (p_committee_id, 'new_month_update', 'New Month Committee Update',
   'Sent to everyone when a new committee month starts.',
   E'Assalam-o-Alaikum {{member_name}},\n\n*{{committee_name}} – {{month_label}}*\nMonth {{month_number}} of {{total_months}} has started.\n\nContribution: {{amount}} per member\nDue date: {{due_date}}\nThis month''s winner: Slot {{winner_slot}}\nPayout: {{payout}}\n\nRemaining months after this one: {{remaining_months}}.',
   'committee_new_month_update', 'en',
   array['member_name','committee_name','month_label','month_number','total_months','amount','due_date','winner_slot','payout','remaining_months'], false),
  (p_committee_id, 'winner_personal', 'Personal Winner Message',
   'Sent automatically to the winner as soon as they are announced or drawn.',
   E'Assalam-o-Alaikum {{member_name}}!\n\nCongratulations, you are the winner of *{{committee_name}}* for {{month_label}} (Month {{month_number}}).\nYour payout: *{{payout}}*\n\nThe committee admin will contact you about receiving the payout. JazakAllah!',
   'committee_winner_personal', 'en', array['member_name','committee_name','month_label','month_number','payout'], true)
  on conflict (committee_id, key) do nothing;
$$;

-- Existing committee gets the new personal-winner template too.
do $$
declare r record;
begin
  for r in select id from public.committees loop
    perform public.seed_committee_templates(r.id);
  end loop;
end $$;

create or replace function public.create_committee(
  p_name text, p_slug text default null, p_total_members int default 17,
  p_monthly_contribution numeric default 10000, p_start_month date default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_cid uuid;
  v_slug text;
  v_start date;
  v_email text := nullif(auth.jwt() ->> 'email', '');
  n int;
begin
  if v_uid is null then
    raise exception 'Please sign in first.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_name, ''))) < 2 then
    raise exception 'Please enter a committee name.';
  end if;
  if p_total_members is null or p_total_members not between 2 and 60 then
    raise exception 'Number of members must be between 2 and 60.';
  end if;
  if p_monthly_contribution is null or p_monthly_contribution <= 0 then
    raise exception 'Monthly contribution must be more than zero.';
  end if;
  if (select count(*) from public.committee_admins where user_id = v_uid and role = 'owner') >= 10 then
    raise exception 'You can own up to 10 committees.';
  end if;

  if p_slug is not null and length(trim(p_slug)) > 0 then
    v_slug := lower(trim(p_slug));
    if v_slug !~ '^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$' then
      raise exception 'The web address may only use lowercase letters, numbers and dashes (3–48 characters).';
    end if;
    if exists (select 1 from public.committees where slug = v_slug) then
      raise exception 'That web address is already taken. Try another one.';
    end if;
  else
    v_slug := public.make_unique_slug(p_name);
  end if;

  v_start := coalesce(date_trunc('month', p_start_month)::date,
                      date_trunc('month', (now() at time zone 'Asia/Karachi'))::date);

  insert into public.committees (slug, created_by) values (v_slug, v_uid) returning id into v_cid;
  insert into public.committee_admins (committee_id, user_id, email, role) values (v_cid, v_uid, v_email, 'owner');
  insert into public.committee_settings (committee_id, committee_name, total_members, monthly_contribution, payout_amount, start_month)
  values (v_cid, trim(p_name), p_total_members, p_monthly_contribution, p_monthly_contribution * p_total_members, v_start);

  -- Slots A, B, C … (AA, AB … after Z)
  for n in 1..p_total_members loop
    insert into public.members (committee_id, slot_code, display_order, joined_month)
    values (v_cid,
            case when n <= 26 then chr(64 + n) else 'A' || chr(64 + n - 26) end,
            n, v_start);
  end loop;

  perform public.seed_committee_templates(v_cid);
  perform public.generate_schedule(v_cid);
  perform public.log_activity(v_cid, 'committee.created', 'committees', v_cid::text,
    format('Committee “%s” created with %s members', trim(p_name), p_total_members));
  return v_cid;
end;
$$;

create or replace function public.add_committee_admin(p_committee_id uuid, p_email text, p_role text default 'admin')
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid;
begin
  if not (public.is_trusted_backend() or public.is_committee_owner(p_committee_id)) then
    raise exception 'Only an owner can add admins.' using errcode = '42501';
  end if;
  if p_role not in ('owner', 'admin') then
    raise exception 'Role must be owner or admin.';
  end if;
  select id into v_user from auth.users where lower(email) = lower(trim(p_email));
  if v_user is null then
    raise exception 'No account uses that email yet. Ask them to register first, then add them again.';
  end if;
  insert into public.committee_admins (committee_id, user_id, email, role)
  values (p_committee_id, v_user, lower(trim(p_email)), p_role)
  on conflict (committee_id, user_id) do update set role = excluded.role;
  perform public.log_activity(p_committee_id, 'admin.added', 'committee_admins', v_user::text,
    format('%s added as %s', lower(trim(p_email)), p_role));
  return jsonb_build_object('user_id', v_user);
end;
$$;

create or replace function public.remove_committee_admin(p_committee_id uuid, p_user_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_email text;
begin
  if not (public.is_trusted_backend() or public.is_committee_owner(p_committee_id)) then
    raise exception 'Only an owner can remove admins.' using errcode = '42501';
  end if;
  if (select role from public.committee_admins where committee_id = p_committee_id and user_id = p_user_id) = 'owner'
     and (select count(*) from public.committee_admins where committee_id = p_committee_id and role = 'owner') <= 1 then
    raise exception 'A committee must keep at least one owner.';
  end if;
  delete from public.committee_admins where committee_id = p_committee_id and user_id = p_user_id returning email into v_email;
  perform public.log_activity(p_committee_id, 'admin.removed', 'committee_admins', p_user_id::text,
    format('%s removed', coalesce(v_email, 'admin')));
end;
$$;

create or replace function public.set_whatsapp_credentials(
  p_committee_id uuid, p_phone_number_id text, p_access_token text, p_business_account_id text, p_display_phone text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  if not (public.is_trusted_backend() or public.is_committee_owner(p_committee_id)) then
    raise exception 'Only an owner can change WhatsApp settings.' using errcode = '42501';
  end if;
  insert into public.committee_whatsapp (committee_id, phone_number_id, access_token, business_account_id, display_phone, updated_by)
  values (p_committee_id, trim(p_phone_number_id),
          coalesce(nullif(trim(p_access_token), ''), (select access_token from public.committee_whatsapp where committee_id = p_committee_id)),
          nullif(trim(p_business_account_id), ''), nullif(trim(p_display_phone), ''), auth.uid())
  on conflict (committee_id) do update set
    phone_number_id = excluded.phone_number_id,
    access_token = excluded.access_token,
    business_account_id = excluded.business_account_id,
    display_phone = excluded.display_phone,
    updated_at = now(),
    updated_by = auth.uid();
  perform public.log_activity(p_committee_id, 'whatsapp.updated', 'committee_whatsapp', p_committee_id::text,
    'WhatsApp API credentials updated');
  return public.whatsapp_status(p_committee_id);
end;
$$;

create or replace function public.clear_whatsapp_credentials(p_committee_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not (public.is_trusted_backend() or public.is_committee_owner(p_committee_id)) then
    raise exception 'Only an owner can change WhatsApp settings.' using errcode = '42501';
  end if;
  delete from public.committee_whatsapp where committee_id = p_committee_id;
  perform public.log_activity(p_committee_id, 'whatsapp.removed', 'committee_whatsapp', p_committee_id::text,
    'WhatsApp API credentials removed');
end;
$$;

-- Safe status for the admin screen: never returns the token.
create or replace function public.whatsapp_status(p_committee_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  w public.committee_whatsapp%rowtype;
begin
  perform public.assert_admin(p_committee_id);
  select * into w from public.committee_whatsapp where committee_id = p_committee_id;
  if not found then
    return jsonb_build_object('configured', false);
  end if;
  return jsonb_build_object(
    'configured', true,
    'phone_number_id_hint', '…' || right(w.phone_number_id, 4),
    'display_phone', w.display_phone,
    'business_account_id', w.business_account_id,
    'token_hint', '…' || right(w.access_token, 4),
    'updated_at', w.updated_at);
end;
$$;

-- ---------------------------------------------------------------------
-- 8. Public committee page (letters only; no names, numbers or money per person)
-- ---------------------------------------------------------------------
create or replace function public.public_committee(p_slug text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  c public.committees%rowtype;
  s public.committee_settings%rowtype;
  v_period date;
begin
  select * into c from public.committees where slug = lower(trim(p_slug)) and public_enabled;
  if not found then
    return null;
  end if;
  select * into s from public.committee_settings where committee_id = c.id;
  v_period := public.current_period(c.id);

  return jsonb_build_object(
    'slug', c.slug,
    'name', s.committee_name,
    'logo', c.logo_data,
    'currency', s.currency,
    'monthly_contribution', s.monthly_contribution,
    'payout_amount', s.payout_amount,
    'total_members', s.total_members,
    'winner_selection', s.winner_selection,
    'today', public.committee_today(c.id),
    'slots', (select coalesce(jsonb_agg(m.slot_code order by m.display_order, m.slot_code), '[]'::jsonb)
              from public.members m where m.committee_id = c.id and m.is_active),
    'months', (select coalesce(jsonb_agg(jsonb_build_object(
                  'month_number', ms.month_number,
                  'period_month', ms.period_month,
                  'due_date', ms.due_date,
                  'phase', case when ms.period_month < v_period then 'past'
                                when ms.period_month = v_period then 'current' else 'upcoming' end,
                  'is_announced', w.id is not null,
                  'announced_at', w.announced_at,
                  'winner_slot', case when w.id is not null or s.winner_selection = 'sequence' then wm.slot_code end,
                  'paid_count', (select count(*) from public.payments p where p.schedule_id = ms.id and p.status = 'paid'),
                  'member_count', (select count(*) from public.payments p where p.schedule_id = ms.id)
                ) order by ms.month_number), '[]'::jsonb)
              from public.monthly_schedules ms
              left join public.winners w on w.schedule_id = ms.id and w.status = 'announced'
              left join public.members wm on wm.id = coalesce(w.member_id, ms.winner_member_id)
              where ms.committee_id = c.id),
    'draws', (select coalesce(jsonb_agg(jsonb_build_object(
                  'month_number', ms.month_number, 'candidates', d.candidate_slots,
                  'winner_slot', d.winner_slot, 'created_at', d.created_at) order by d.created_at desc), '[]'::jsonb)
              from public.draws d join public.monthly_schedules ms on ms.id = d.schedule_id
              join public.winners w on w.id = d.winner_id and w.status = 'announced'
              where d.committee_id = c.id)
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 9. Views (committee-aware)
-- ---------------------------------------------------------------------
create view public.v_payments
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
  (p.status <> 'paid' and ms.due_date < public.committee_today(p.committee_id)) as is_overdue,
  case
    when p.status = 'paid' then 'paid'
    when p.amount_paid > 0 then 'partially_paid'
    when ms.due_date < public.committee_today(p.committee_id) then 'overdue'
    else 'pending'
  end as effective_status,
  greatest(public.committee_today(p.committee_id) - ms.due_date, 0) as days_overdue
from public.payments p
join public.members m on m.id = p.member_id
join public.monthly_schedules ms on ms.id = p.schedule_id;

create view public.v_schedule
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
    when ms.period_month < public.current_period(ms.committee_id) then 'past'
    when ms.period_month = public.current_period(ms.committee_id) then 'current'
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

create view public.v_member_summary
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
             where p.member_id = m.id and s.period_month <= public.current_period(m.committee_id)), 0) as outstanding_to_date,
  (select vp.effective_status from public.v_payments vp
    where vp.member_id = m.id and vp.period_month = public.current_period(m.committee_id)) as current_status
from public.members m
left join public.monthly_schedules ms on ms.winner_member_id = m.id;

-- ---------------------------------------------------------------------
-- 10. Row Level Security: every row is visible only to that committee's admins
-- ---------------------------------------------------------------------
alter table public.committees       enable row level security;
alter table public.committee_admins enable row level security;
alter table public.draws            enable row level security;

drop policy if exists settings_select  on public.committee_settings;
drop policy if exists settings_update  on public.committee_settings;
drop policy if exists members_select   on public.members;
drop policy if exists members_insert   on public.members;
drop policy if exists members_update   on public.members;
drop policy if exists schedules_select on public.monthly_schedules;
drop policy if exists winners_select   on public.winners;
drop policy if exists payments_select  on public.payments;
drop policy if exists templates_select on public.notification_templates;
drop policy if exists templates_update on public.notification_templates;
drop policy if exists logs_select      on public.notification_logs;
drop policy if exists logs_insert      on public.notification_logs;
drop policy if exists logs_update      on public.notification_logs;
drop policy if exists audit_select     on public.audit_logs;

create policy committees_select on public.committees for select to authenticated using (public.is_committee_admin(id));
create policy committees_update on public.committees for update to authenticated
  using (public.is_committee_owner(id)) with check (public.is_committee_owner(id));
create policy committee_admins_select on public.committee_admins for select to authenticated
  using (public.is_committee_admin(committee_id));

create policy settings_select  on public.committee_settings for select to authenticated using (public.is_committee_admin(committee_id));
create policy settings_update  on public.committee_settings for update to authenticated
  using (public.is_committee_admin(committee_id)) with check (public.is_committee_admin(committee_id));
create policy members_select   on public.members for select to authenticated using (public.is_committee_admin(committee_id));
create policy members_insert   on public.members for insert to authenticated with check (public.is_committee_admin(committee_id));
create policy members_update   on public.members for update to authenticated
  using (public.is_committee_admin(committee_id)) with check (public.is_committee_admin(committee_id));
create policy schedules_select on public.monthly_schedules for select to authenticated using (public.is_committee_admin(committee_id));
create policy winners_select   on public.winners for select to authenticated using (public.is_committee_admin(committee_id));
create policy payments_select  on public.payments for select to authenticated using (public.is_committee_admin(committee_id));
create policy draws_select     on public.draws for select to authenticated using (public.is_committee_admin(committee_id));
create policy templates_select on public.notification_templates for select to authenticated using (public.is_committee_admin(committee_id));
create policy templates_update on public.notification_templates for update to authenticated
  using (public.is_committee_admin(committee_id)) with check (public.is_committee_admin(committee_id));
create policy logs_select      on public.notification_logs for select to authenticated using (public.is_committee_admin(committee_id));
create policy logs_insert      on public.notification_logs for insert to authenticated with check (public.is_committee_admin(committee_id));
create policy logs_update      on public.notification_logs for update to authenticated
  using (public.is_committee_admin(committee_id)) with check (public.is_committee_admin(committee_id));
create policy audit_select     on public.audit_logs for select to authenticated using (public.is_committee_admin(committee_id));

-- notification_logs.committee_id is required for new rows from now on
alter table public.notification_logs alter column committee_id set not null;

-- ---------------------------------------------------------------------
-- 11. Privileges
-- ---------------------------------------------------------------------
revoke all on public.committees, public.committee_admins, public.draws from anon, authenticated;
grant select, update on public.committees to authenticated;
grant select on public.committee_admins, public.draws to authenticated;
grant select on public.v_payments, public.v_schedule, public.v_member_summary to authenticated;
revoke update, delete, truncate on public.audit_logs from service_role;

revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function
  public.is_admin(), public.is_owner(), public.is_committee_admin(uuid), public.is_committee_owner(uuid),
  public.committee_today(uuid), public.current_period(uuid), public.schedule_is_frozen(uuid),
  public.generate_schedule(uuid), public.save_winner_sequence(uuid, jsonb), public.reset_winner_sequence(uuid),
  public.announce_winner(uuid, text, text), public.void_winner(uuid, text),
  public.record_payment(uuid, numeric, date, text, text, text),
  public.set_member_active(uuid, boolean, text),
  public.run_lucky_draw(uuid, text, int),
  public.create_committee(text, text, int, numeric, date),
  public.add_committee_admin(uuid, text, text), public.remove_committee_admin(uuid, uuid),
  public.set_whatsapp_credentials(uuid, text, text, text, text), public.clear_whatsapp_credentials(uuid),
  public.whatsapp_status(uuid)
to authenticated, service_role;

grant execute on function public.public_committee(text) to anon, authenticated, service_role;

grant execute on function
  public.ensure_payment_rows_internal(uuid), public.fill_unassigned_winners_internal(uuid),
  public.announce_winner_internal(uuid, text), public.secure_random_below(int),
  public.log_activity(uuid, text, text, text, text, text, jsonb), public.seed_committee_templates(uuid),
  public.make_unique_slug(text), public.assert_admin(uuid), public.is_trusted_backend(), public.current_actor_email()
to service_role;

commit;
