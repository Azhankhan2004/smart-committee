-- =====================================================================
-- v2.2 (17 Nov 2026): Reserve months + several winners in one session
--  * A month can be RESERVED instead of drawn. Its payout is kept for a
--    member who needs financial support. The owner can later:
--      - give it to a member as their committee payout (counts as their win), or
--      - give it as help only (the member stays in future draws), or
--      - release it, so the month goes back to a normal draw.
--  * Admins can draw upcoming months in advance (e.g. 4 winners in one
--    family meeting). The automatic scheduler still only draws started months.
-- Safe to run more than once.
-- =====================================================================
begin;

create table if not exists public.month_reserves (
  id               uuid primary key default gen_random_uuid(),
  committee_id     uuid not null references public.committees (id) on delete cascade,
  schedule_id      uuid not null unique,
  status           text not null default 'reserved' check (status in ('reserved', 'given')),
  reason           text,
  reserved_by      uuid references auth.users (id) on delete set null,
  reserved_by_email text,
  reserved_at      timestamptz not null default now(),
  given_member_id  uuid,
  given_type       text check (given_type in ('payout', 'help')),
  given_note       text,
  given_by_email   text,
  given_at         timestamptz,
  winner_id        uuid references public.winners (id) on delete set null,
  foreign key (schedule_id, committee_id) references public.monthly_schedules (id, committee_id) on delete cascade,
  foreign key (given_member_id, committee_id) references public.members (id, committee_id),
  check ((status = 'reserved' and given_member_id is null and given_type is null)
      or (status = 'given' and given_member_id is not null and given_type is not null))
);
create index if not exists month_reserves_committee_idx on public.month_reserves (committee_id);

alter table public.month_reserves enable row level security;
drop policy if exists month_reserves_select on public.month_reserves;
create policy month_reserves_select on public.month_reserves for select to authenticated
  using (public.is_committee_admin(committee_id));
revoke all on public.month_reserves from anon, authenticated;
grant select on public.month_reserves to authenticated;

drop trigger if exists audit_month_reserves on public.month_reserves;

-- Announcing: reserved months are skipped, and advance announcements are allowed
-- only from inside run_lucky_draw / give_reserve (flag set by those functions).
create or replace function public.announce_winner_internal(p_schedule_id uuid, p_notes text)
returns public.winners
language plpgsql security definer set search_path = public
as $$
declare
  v_s public.monthly_schedules%rowtype;
  v_slot text;
  v_w public.winners%rowtype;
  v_advance boolean := coalesce(current_setting('app.advance_announce', true), '') = 'on';
begin
  select * into v_s from public.monthly_schedules where id = p_schedule_id for update;
  if not found then
    raise exception 'That committee month does not exist.';
  end if;
  if v_s.winner_member_id is null then
    raise exception 'Month % has no designated winner yet.', v_s.month_number;
  end if;
  if not v_advance and v_s.period_month > public.current_period(v_s.committee_id) then
    raise exception 'Month % has not started yet. Winners can only be announced for the current or a past month.', v_s.month_number;
  end if;
  if not v_advance and exists (select 1 from public.month_reserves r where r.schedule_id = v_s.id) then
    raise exception 'Month % is reserved for financial support. Give the reserve or release it first.', v_s.month_number;
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

-- The fixed order never plans a winner into a reserved month.
create or replace function public.fill_unassigned_winners_internal(p_committee_id uuid)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  r record;
  v_member uuid;
  v_count int := 0;
begin
  for r in select ms.id from public.monthly_schedules ms
           where ms.committee_id = p_committee_id and ms.winner_member_id is null
             and not exists (select 1 from public.month_reserves x where x.schedule_id = ms.id)
           order by ms.month_number loop
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

-- ---------------------------------------------------------------------
-- Reserve functions (owner only; every action needs a reason and is logged)
-- ---------------------------------------------------------------------
create or replace function public.reserve_month(p_schedule_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_s public.monthly_schedules%rowtype;
begin
  select * into v_s from public.monthly_schedules where id = p_schedule_id for update;
  if not found then
    raise exception 'That committee month does not exist.';
  end if;
  if not (public.is_trusted_backend() or public.is_committee_owner(v_s.committee_id)) then
    raise exception 'Only an owner can reserve a month.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Please give a clear reason (at least 5 characters).';
  end if;
  if exists (select 1 from public.winners where schedule_id = v_s.id and status = 'announced') then
    raise exception 'Month % already has an announced winner, so it cannot be reserved.', v_s.month_number;
  end if;
  if exists (select 1 from public.month_reserves where schedule_id = v_s.id) then
    raise exception 'Month % is already reserved.', v_s.month_number;
  end if;

  -- Nobody is planned for a reserved month.
  update public.monthly_schedules set winner_member_id = null where id = v_s.id;
  insert into public.month_reserves (committee_id, schedule_id, reason, reserved_by, reserved_by_email)
  values (v_s.committee_id, v_s.id, trim(p_reason), auth.uid(), public.current_actor_email());

  perform public.log_activity(v_s.committee_id, 'reserve.created', 'month_reserves', v_s.id::text,
    format('Month %s reserved for financial support (%s %s kept aside)', v_s.month_number,
           (select currency from public.committee_settings where committee_id = v_s.committee_id), to_char(v_s.payout_amount, 'FM999,999,999')),
    trim(p_reason));
  return jsonb_build_object('month_number', v_s.month_number);
end;
$$;

create or replace function public.release_reserve(p_schedule_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  r public.month_reserves%rowtype;
  v_month int;
begin
  select * into r from public.month_reserves where schedule_id = p_schedule_id for update;
  if not found then
    raise exception 'That month is not reserved.';
  end if;
  if not (public.is_trusted_backend() or public.is_committee_owner(r.committee_id)) then
    raise exception 'Only an owner can release a reserve.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Please give a clear reason (at least 5 characters).';
  end if;
  if r.status = 'given' then
    raise exception 'This reserve has already been given. Undo that first.';
  end if;
  select month_number into v_month from public.monthly_schedules where id = r.schedule_id;
  delete from public.month_reserves where id = r.id;
  perform public.fill_unassigned_winners_internal(r.committee_id);
  perform public.log_activity(r.committee_id, 'reserve.released', 'month_reserves', r.schedule_id::text,
    format('Month %s reserve released; the month goes back to a normal draw', v_month), trim(p_reason));
  return jsonb_build_object('month_number', v_month);
end;
$$;

create or replace function public.give_reserve(p_schedule_id uuid, p_member_id uuid, p_type text, p_note text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  r public.month_reserves%rowtype;
  v_s public.monthly_schedules%rowtype;
  m public.members%rowtype;
  v_w public.winners%rowtype;
begin
  select * into r from public.month_reserves where schedule_id = p_schedule_id for update;
  if not found then
    raise exception 'That month is not reserved.';
  end if;
  if not (public.is_trusted_backend() or public.is_committee_owner(r.committee_id)) then
    raise exception 'Only an owner can give out a reserve.' using errcode = '42501';
  end if;
  if r.status = 'given' then
    raise exception 'This reserve has already been given.';
  end if;
  if p_type not in ('payout', 'help') then
    raise exception 'Please choose how the reserve is given.';
  end if;
  if length(trim(coalesce(p_note, ''))) < 5 then
    raise exception 'Please write a short note (at least 5 characters).';
  end if;
  select * into m from public.members where id = p_member_id and committee_id = r.committee_id;
  if not found or not m.is_active then
    raise exception 'Please choose an active member of this committee.';
  end if;
  select * into v_s from public.monthly_schedules where id = r.schedule_id for update;

  if p_type = 'payout' then
    if exists (select 1 from public.winners w where w.member_id = m.id and w.status = 'announced') then
      raise exception 'Slot % has already received a payout. Choose “help only” instead.', m.slot_code;
    end if;
    -- If the member was planned for another (unannounced) month, that month becomes open.
    update public.monthly_schedules set winner_member_id = null
     where winner_member_id = m.id and id <> v_s.id
       and not exists (select 1 from public.winners w where w.schedule_id = monthly_schedules.id and w.status = 'announced');
    update public.monthly_schedules set winner_member_id = m.id where id = v_s.id;
    perform set_config('app.advance_announce', 'on', true);
    v_w := public.announce_winner_internal(v_s.id, 'Reserve given as committee payout: ' || trim(p_note));
    perform set_config('app.advance_announce', '', true);
    perform public.fill_unassigned_winners_internal(r.committee_id);
  end if;

  update public.month_reserves
     set status = 'given', given_member_id = m.id, given_type = p_type, given_note = trim(p_note),
         given_by_email = public.current_actor_email(), given_at = now(), winner_id = v_w.id
   where id = r.id;

  perform public.log_activity(r.committee_id, 'reserve.given', 'month_reserves', r.schedule_id::text,
    format('Month %s reserve given to Slot %s (%s)', v_s.month_number, m.slot_code,
           case when p_type = 'payout' then 'counts as their committee payout' else 'help only; stays in future draws' end),
    trim(p_note));
  return jsonb_build_object('month_number', v_s.month_number, 'slot', m.slot_code, 'type', p_type);
end;
$$;

create or replace function public.undo_reserve_gift(p_schedule_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  r public.month_reserves%rowtype;
  v_month int;
  v_slot text;
begin
  select * into r from public.month_reserves where schedule_id = p_schedule_id for update;
  if not found or r.status <> 'given' then
    raise exception 'That reserve has not been given.';
  end if;
  if not (public.is_trusted_backend() or public.is_committee_owner(r.committee_id)) then
    raise exception 'Only an owner can undo a reserve.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Please give a clear reason (at least 5 characters).';
  end if;
  select month_number into v_month from public.monthly_schedules where id = r.schedule_id;
  select slot_code into v_slot from public.members where id = r.given_member_id;
  if r.winner_id is not null then
    update public.winners set status = 'voided', voided_at = now(), voided_by = auth.uid(),
           void_reason = 'Reserve gift undone: ' || trim(p_reason)
     where id = r.winner_id and status = 'announced';
  end if;
  update public.monthly_schedules set winner_member_id = null where id = r.schedule_id;
  update public.month_reserves
     set status = 'reserved', given_member_id = null, given_type = null, given_note = null,
         given_by_email = null, given_at = null, winner_id = null
   where id = r.id;
  perform public.fill_unassigned_winners_internal(r.committee_id);
  perform public.log_activity(r.committee_id, 'reserve.undone', 'month_reserves', r.schedule_id::text,
    format('Month %s reserve gift to Slot %s undone; the month is reserved again', v_month, v_slot), trim(p_reason));
  return jsonb_build_object('month_number', v_month);
end;
$$;

-- ---------------------------------------------------------------------
-- Lucky draw (reserved months are skipped; admins may draw upcoming months)
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
  if exists (select 1 from public.month_reserves r where r.schedule_id = v_s.id) then
    raise exception 'Month % is reserved for financial support, so it has no draw. Release the reserve first if you want to draw it.', v_s.month_number;
  end if;
  -- The scheduler only draws a month once it has started. Admins may draw upcoming
  -- months in advance (e.g. several winners in one family meeting).
  if p_mode = 'scheduler' and v_s.period_month > public.current_period(v_s.committee_id) then
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

  perform set_config('app.advance_announce', 'on', true);
  v_w := public.announce_winner_internal(v_s.id, format('Lucky draw (%s) among %s eligible members', p_mode, array_length(v_ids, 1)));

  perform set_config('app.advance_announce', '', true);

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
-- Views and public page: show reserved months
-- ---------------------------------------------------------------------
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
    when ms.period_month < public.current_period(ms.committee_id) then 'past'
    when ms.period_month = public.current_period(ms.committee_id) then 'current'
    else 'upcoming'
  end as phase,
  coalesce(agg.expected_total, 0)  as expected_total,
  coalesce(agg.collected_total, 0) as collected_total,
  coalesce(agg.member_count, 0)    as member_count,
  coalesce(agg.paid_count, 0)      as paid_count,
  coalesce(agg.partial_count, 0)   as partial_count,
  coalesce(agg.unpaid_count, 0)    as unpaid_count,
  rs.status        as reserve_status,
  rs.given_type    as reserve_given_type,
  rm.slot_code     as reserve_member_slot,
  rs.reason        as reserve_reason,
  rs.given_note    as reserve_given_note,
  rs.reserved_at   as reserved_at,
  rs.given_at      as reserve_given_at
from public.monthly_schedules ms
left join public.members wm on wm.id = ms.winner_member_id
left join public.winners w on w.schedule_id = ms.id and w.status = 'announced'
left join public.month_reserves rs on rs.schedule_id = ms.id
left join public.members rm on rm.id = rs.given_member_id
left join lateral (
  select sum(p.required_amount) as expected_total,
         sum(p.amount_paid)     as collected_total,
         count(*)               as member_count,
         count(*) filter (where p.status = 'paid')           as paid_count,
         count(*) filter (where p.status = 'partially_paid') as partial_count,
         count(*) filter (where p.status = 'pending')        as unpaid_count
  from public.payments p where p.schedule_id = ms.id
) agg on true;

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
                  'reserved', rs.id is not null,
                  'reserve_used', rs.status = 'given',
                  'announced_at', w.announced_at,
                  'winner_slot', case when w.id is not null or s.winner_selection = 'sequence' then wm.slot_code end,
                  'paid_count', (select count(*) from public.payments p where p.schedule_id = ms.id and p.status = 'paid'),
                  'member_count', (select count(*) from public.payments p where p.schedule_id = ms.id)
                ) order by ms.month_number), '[]'::jsonb)
              from public.monthly_schedules ms
              left join public.winners w on w.schedule_id = ms.id and w.status = 'announced'
              left join public.members wm on wm.id = coalesce(w.member_id, ms.winner_member_id)
              left join public.month_reserves rs on rs.schedule_id = ms.id
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

revoke execute on function public.reserve_month(uuid, text) from public, anon;
revoke execute on function public.release_reserve(uuid, text) from public, anon;
revoke execute on function public.give_reserve(uuid, uuid, text, text) from public, anon;
revoke execute on function public.undo_reserve_gift(uuid, text) from public, anon;
grant execute on function public.reserve_month(uuid, text) to authenticated, service_role;
grant execute on function public.release_reserve(uuid, text) to authenticated, service_role;
grant execute on function public.give_reserve(uuid, uuid, text, text) to authenticated, service_role;
grant execute on function public.undo_reserve_gift(uuid, text) to authenticated, service_role;
grant execute on function public.run_lucky_draw(uuid, text, int) to authenticated, service_role;
grant select on public.v_schedule to authenticated;
grant execute on function public.public_committee(text) to anon, authenticated, service_role;

commit;
