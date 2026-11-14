\set ON_ERROR_STOP 0
-- setup admin users (as postgres)
\c committee_test postgres
insert into auth.users values ('00000000-0000-0000-0000-000000000001','owner@x.com'),('00000000-0000-0000-0000-000000000002','admin@x.com'),('00000000-0000-0000-0000-000000000003','rando@x.com');
insert into admin_users(id,email,role) values ('00000000-0000-0000-0000-000000000001','owner@x.com','owner'),('00000000-0000-0000-0000-000000000002','admin@x.com','admin');

\c committee_test authenticator
\echo '--- T1 anon sees nothing'
set role anon;
select count(*) from members;
\echo '--- T2 non-admin authenticated: 0 rows + RPC denied'
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated","email":"rando@x.com"}';
select count(*) as visible_members from members;
select generate_schedule();
\echo '--- T3 admin records payment'
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated","email":"admin@x.com"}';
select count(*) as visible_members from members;
select record_payment((select p.id from payments p join members m on m.id=p.member_id join monthly_schedules s on s.id=p.schedule_id where m.slot_code='A' and s.month_number=1), 10000, current_date, 'easypaisa', 'TX123', null)->>'status' as status_full;
select record_payment((select p.id from payments p join members m on m.id=p.member_id join monthly_schedules s on s.id=p.schedule_id where m.slot_code='B' and s.month_number=1), 4000, current_date, 'cash', null, null)->>'status' as status_partial;
\echo '--- T3b over-payment, future date, unexplained reduction rejected'
select record_payment((select p.id from payments p join members m on m.id=p.member_id join monthly_schedules s on s.id=p.schedule_id where m.slot_code='C' and s.month_number=1), 12000, current_date, 'cash', null, null);
select record_payment((select p.id from payments p join members m on m.id=p.member_id join monthly_schedules s on s.id=p.schedule_id where m.slot_code='C' and s.month_number=1), 1000, current_date + 5, 'cash', null, null);
select record_payment((select p.id from payments p join members m on m.id=p.member_id join monthly_schedules s on s.id=p.schedule_id where m.slot_code='A' and s.month_number=1), 0, null, null, null, null);
\echo '--- T3c direct table write blocked'
update payments set amount_paid = 10000;
select slot_code, effective_status, is_overdue, balance from v_payments where month_number=1 and slot_code in ('A','B','C') order by 1;
\echo '--- T4 announce: wrong slot, correct, duplicate, future month'
select announce_winner((select id from monthly_schedules where month_number=1), 'B');
select announce_winner((select id from monthly_schedules where month_number=1), 'a')->>'status' as announced;
select announce_winner((select id from monthly_schedules where month_number=1), 'A');
select announce_winner((select id from monthly_schedules where month_number=2), 'B');
\echo '--- T5 locked month cannot change winner; duplicates rejected'
select save_winner_sequence(jsonb_build_array(jsonb_build_object('schedule_id',(select id from monthly_schedules where month_number=1),'member_id',(select id from members where slot_code='Q'))));
select save_winner_sequence(jsonb_build_array(jsonb_build_object('schedule_id',(select id from monthly_schedules where month_number=2),'member_id',(select id from members where slot_code='C'))));
\echo '--- T5b valid swap of months 2 and 3'
select save_winner_sequence(jsonb_build_array(
  jsonb_build_object('schedule_id',(select id from monthly_schedules where month_number=2),'member_id',(select id from members where slot_code='C')),
  jsonb_build_object('schedule_id',(select id from monthly_schedules where month_number=3),'member_id',(select id from members where slot_code='B'))));
select month_number, winner_slot from v_schedule where month_number<=3 order by 1;
\echo '--- T6 void requires owner'
select void_winner((select id from winners limit 1), 'Wrong slot entered');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated","email":"owner@x.com"}';
select void_winner((select id from winners limit 1), 'no');
select void_winner((select id from winners limit 1), 'Test correction by owner')->>'status' as voided;
select announce_winner((select id from monthly_schedules where month_number=1), 'A')->>'status' as re_announced;
\echo '--- T7 settings: start month blocked, contribution change only hits unfrozen months'
update committee_settings set start_month = '2026-01-01';
update committee_settings set monthly_contribution = 12000, payout_amount = 204000;
select generate_schedule();
select month_number, contribution_amount, payout_amount from monthly_schedules where month_number<=2 order by 1;
select distinct required_amount from payments p join monthly_schedules s on s.id=p.schedule_id where s.month_number=2;
update committee_settings set monthly_contribution = 10000, payout_amount = 170000; select generate_schedule()->>'updated' as reverted;
\echo '--- T8 shrink below frozen month rejected; shrink unfrozen ok'
update committee_settings set total_members = 16; select generate_schedule()->>'removed' as removed;
update committee_settings set total_members = 17; select generate_schedule()->>'created' as recreated;
\echo '--- T9 add member R -> gets payment rows; deactivate Q'
insert into members(slot_code, display_order, joined_month, phone_e164) values ('R', 18, '2026-12-01', '+923001234567');
select count(*) as r_rows from payments where member_id=(select id from members where slot_code='R');
select set_member_active((select id from members where slot_code='Q'), false, 'Left committee');
select count(*) as q_rows_left from payments where member_id=(select id from members where slot_code='Q');
select month_number, winner_slot from v_schedule where month_number=17;
insert into members(slot_code, display_order, joined_month, phone_e164) values ('S', 19, '2026-12-01', '0300123');
\echo '--- T10 audit log append-only'
delete from audit_logs;
select action, actor_email, summary, reason from audit_logs where summary is not null order by id;
select entity_type, action, count(*) from audit_logs group by 1,2 order by 1,2;
\echo '--- T11 member summary view'
select slot_code, winner_month_number, total_contributed, current_status, has_won from v_member_summary order by display_order limit 4;
