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
