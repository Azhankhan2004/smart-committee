-- =====================================================================
-- v2.1 fixes (17 Nov 2026)
--  1. Owners can move a committee's start month even after payments exist.
--     Every month keeps its number, payments and winner; only the calendar
--     dates move (e.g. month 1 = September instead of November).
--  2. Two payment methods: "Cash, Najma Israr" and "Online, Najma Israr".
--  3. Lucky draw: one winner is picked from ALL eligible members (no 4 cards).
--  4. A wrong draw can be deleted (its announcement is voided and the month
--     re-opens for a new draw). Everything is written to the activity log.
-- Safe to run more than once.
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1. Start month changes
-- ---------------------------------------------------------------------
create or replace function public.settings_protect_history()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.start_month is distinct from old.start_month
     and coalesce(current_setting('app.start_month_change', true), '') <> 'on'
     and (
       exists (select 1 from public.payments where committee_id = old.committee_id and amount_paid > 0)
       or exists (select 1 from public.winners where committee_id = old.committee_id and status = 'announced')) then
    raise exception 'The start month cannot change after payments or winners have been recorded. Use “Change start month” instead.';
  end if;
  if new.committee_id is distinct from old.committee_id then
    raise exception 'Settings cannot move to another committee.';
  end if;
  return new;
end;
$$;

create or replace function public.schedules_protect_history()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_moving boolean := coalesce(current_setting('app.start_month_change', true), '') = 'on';
begin
  if new.winner_member_id is distinct from old.winner_member_id
     and exists (select 1 from public.winners where schedule_id = old.id and status = 'announced') then
    raise exception 'Month % already has an announced winner. Void the announcement before changing it.', old.month_number;
  end if;
  -- Amounts are always protected once a month has history. Dates may move only
  -- through change_start_month (which keeps every record on its month number).
  if (new.contribution_amount, new.payout_amount) is distinct from (old.contribution_amount, old.payout_amount)
     and public.schedule_is_frozen(old.id) then
    raise exception 'Month % has recorded history, so its amounts cannot change.', old.month_number;
  end if;
  if (new.period_month, new.due_date) is distinct from (old.period_month, old.due_date)
     and not v_moving and public.schedule_is_frozen(old.id) then
    raise exception 'Month % has recorded history, so its dates cannot change. Use “Change start month” instead.', old.month_number;
  end if;
  return new;
end;
$$;

create or replace function public.change_start_month(p_committee_id uuid, p_new_start date, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  s public.committee_settings%rowtype;
  v_new date := date_trunc('month', p_new_start)::date;
  v_old date;
  v_months int;
  v_members int;
  v_rows int;
begin
  if not (public.is_trusted_backend() or public.is_committee_owner(p_committee_id)) then
    raise exception 'Only an owner can change the start month.' using errcode = '42501';
  end if;
  if p_new_start is null then
    raise exception 'Please choose the new start month.';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Please give a clear reason (at least 5 characters).';
  end if;
  select * into s from public.committee_settings where committee_id = p_committee_id for update;
  if not found then
    raise exception 'Committee settings are missing.';
  end if;
  v_old := s.start_month;
  if v_new = v_old then
    raise exception 'The committee already starts in that month.';
  end if;

  perform set_config('app.start_month_change', 'on', true);
  update public.committee_settings set start_month = v_new where committee_id = p_committee_id;

  -- Month N moves to (new start + N-1 months); the due day stays the same.
  update public.monthly_schedules ms
     set period_month = (v_new + make_interval(months => ms.month_number - 1))::date,
         due_date = least(
           ((v_new + make_interval(months => ms.month_number - 1))::date + (s.payment_due_day - 1)),
           ((v_new + make_interval(months => ms.month_number))::date - 1))
   where ms.committee_id = p_committee_id;
  get diagnostics v_months = row_count;
  perform set_config('app.start_month_change', '', true);

  -- Members who joined at the old start now join at the new start.
  update public.members
     set joined_month = v_new
   where committee_id = p_committee_id and (joined_month = v_old or joined_month < v_new);
  get diagnostics v_members = row_count;

  v_rows := public.ensure_payment_rows_internal(p_committee_id);

  perform public.log_activity(p_committee_id, 'committee.start_month_changed', 'committee_settings', p_committee_id::text,
    format('Start month changed from %s to %s (%s months moved, %s members updated, %s payment rows added)',
           to_char(v_old, 'Mon YYYY'), to_char(v_new, 'Mon YYYY'), v_months, v_members, v_rows),
    trim(p_reason));

  return jsonb_build_object('old_start', v_old, 'new_start', v_new, 'months', v_months,
                            'members', v_members, 'payment_rows_added', v_rows);
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Payment methods
-- ---------------------------------------------------------------------
do $$
declare c record;
begin
  for c in
    select con.conname from pg_constraint con
    where con.conrelid = 'public.payments'::regclass and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%payment_method%'
  loop
    execute format('alter table public.payments drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.payments add constraint payments_payment_method_check check (
  payment_method is null or payment_method in
  ('cash_najma', 'online_najma', 'cash', 'bank_transfer', 'easypaisa', 'jazzcash', 'raast', 'other'));

-- ---------------------------------------------------------------------
-- 3. Lucky draw: one winner from all eligible members
-- ---------------------------------------------------------------------
create or replace function public.run_lucky_draw(p_schedule_id uuid, p_mode text default 'manual', p_card_count int default 100)
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

  -- Eligible: every active member who has not won yet (one winner is picked from all of them).
  select array_agg(id), array_agg(slot_code) into v_ids, v_slots
  from (
    select m.id, m.slot_code
    from public.members m
    where m.committee_id = v_s.committee_id and m.is_active
      and not exists (select 1 from public.winners w where w.member_id = m.id and w.status = 'announced')
    order by gen_random_bytes(16)
    limit greatest(1, least(coalesce(p_card_count, 100), 200))
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

  v_w := public.announce_winner_internal(v_s.id, format('Lucky draw (%s) among %s eligible members', p_mode, array_length(v_ids, 1)));

  insert into public.draws (committee_id, schedule_id, mode, candidate_member_ids, candidate_slots,
                            winner_member_id, winner_slot, winner_id, created_by, created_by_email)
  values (v_s.committee_id, v_s.id, p_mode, v_ids, v_slots, v_winner, v_winner_slot, v_w.id,
          auth.uid(), public.current_actor_email())
  returning id into v_draw;

  perform public.log_activity(v_s.committee_id, 'draw.completed', 'draws', v_draw::text,
    format('Lucky draw for month %s: Slot %s won (from %s eligible: %s)', v_s.month_number, v_winner_slot, array_length(v_ids, 1), array_to_string(v_slots, ', ')));

  return jsonb_build_object(
    'draw_id', v_draw, 'winner_id', v_w.id, 'schedule_id', v_s.id, 'month_number', v_s.month_number,
    'winner_member_id', v_winner, 'winner_slot', v_winner_slot,
    'candidates', (select jsonb_agg(jsonb_build_object('member_id', v_ids[i], 'slot', v_slots[i]) order by i)
                   from generate_subscripts(v_ids, 1) as i));
end;
$$;

-- ---------------------------------------------------------------------
-- 4. Delete a wrong draw
-- ---------------------------------------------------------------------
create or replace function public.delete_draw(p_draw_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  d public.draws%rowtype;
  v_month int;
  v_voided boolean := false;
begin
  select * into d from public.draws where id = p_draw_id for update;
  if not found then
    raise exception 'That draw no longer exists.';
  end if;
  if not (public.is_trusted_backend() or public.is_committee_owner(d.committee_id)) then
    raise exception 'Only an owner can delete a draw.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Please give a clear reason (at least 5 characters).';
  end if;
  select month_number into v_month from public.monthly_schedules where id = d.schedule_id;

  if d.winner_id is not null then
    update public.winners
       set status = 'voided', voided_at = now(), voided_by = auth.uid(),
           void_reason = 'Draw deleted: ' || trim(p_reason)
     where id = d.winner_id and status = 'announced';
    v_voided := found;
  end if;

  delete from public.draws where id = d.id;

  perform public.log_activity(d.committee_id, 'draw.deleted', 'draws', d.id::text,
    format('Lucky draw for month %s deleted (Slot %s)%s', v_month, d.winner_slot,
           case when v_voided then '; the winner announcement was voided and the month is open again' else '' end),
    trim(p_reason));

  return jsonb_build_object('month_number', v_month, 'winner_slot', d.winner_slot, 'announcement_voided', v_voided);
end;
$$;

revoke execute on function public.change_start_month(uuid, date, text) from public, anon;
revoke execute on function public.delete_draw(uuid, text) from public, anon;
grant execute on function public.change_start_month(uuid, date, text) to authenticated, service_role;
grant execute on function public.delete_draw(uuid, text) to authenticated, service_role;
grant execute on function public.run_lucky_draw(uuid, text, int) to authenticated, service_role;

commit;
