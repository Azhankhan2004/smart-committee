\set ON_ERROR_STOP 0
\set QUIET 1
\c committee_test postgres
insert into auth.users values ('00000000-0000-0000-0000-000000000003','newuser@test.pk');
\c committee_test authenticator
\echo '=== M1 new user registers and creates a committee'
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated","email":"newuser@test.pk"}';
select create_committee('Cousins Kameti', null, 6, 5000) is not null as created;
select slug, (select count(*) from members) as my_members, (select count(*) from monthly_schedules) as my_months, (select count(*) from notification_templates) as my_templates from committees;
\echo '=== M2 new user sees ONLY their committee (expect 6 members, 0 of family committee)'
select count(*) filter (where full_name='Ayesha') as sees_ayesha, count(*) as total from members;
\echo '=== M3 new user cannot act on family committee (expect errors)'
select record_payment((select p.id from payments p limit 1), 1, current_date, null, null, null);
\c committee_test postgres
\c committee_test authenticator
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated","email":"newuser@test.pk"}';
select generate_schedule((select id from committees where slug='family-committee'));
select run_lucky_draw((select id from monthly_schedules where month_number=1 and committee_id=(select id from committees where slug='family-committee')));
\echo '=== M4 family owner still sees their data intact'
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated","email":"owner@test.pk"}';
select count(*) as members, count(*) filter (where full_name is not null) as named from members;
select slot_code, effective_status, amount_paid from v_payments where month_number=1 and slot_code in ('A','B') order by 1;
select month_number, winner_slot, is_announced, phase from v_schedule where month_number<=2 order by 1;
\echo '=== D1 lucky draw on announced month fails; on new committee works'
select run_lucky_draw((select id from monthly_schedules where month_number=1 and committee_id=(select id from committees where slug='family-committee')));
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated","email":"newuser@test.pk"}';
select jsonb_array_length(r->'candidates') as cards, r->>'winner_slot' as winner, (select is_announced from v_schedule where month_number=1) as announced
  from (select run_lucky_draw((select id from monthly_schedules where month_number=1), 'auto') r) x;
\echo '=== D2 second draw same month fails; future month fails'
select run_lucky_draw((select id from monthly_schedules where month_number=1));
select run_lucky_draw((select id from monthly_schedules where month_number=2));
\echo '=== D3 winner not reassigned elsewhere; each member planned at most once'
select count(*) as dup_plans from (select winner_member_id from monthly_schedules where winner_member_id is not null group by 1 having count(*)>1) z;
\echo '=== P1 public view as anon: letters only'
set role anon; reset request.jwt.claims;
select (j->>'name') as name, jsonb_array_length(j->'slots') as slots, (j::text like '%Ayesha%' or j::text like '%+92300%') as leaks_private,
       (j->'months'->0->>'winner_slot') as m1_winner, (j->'months'->0->>'paid_count') as m1_paid from (select public_committee('family-committee') j) x;
select public_committee('does-not-exist') is null as unknown_is_null;
select count(*) from members;
\echo '=== W1 WhatsApp creds: helper(admin) cannot set, owner can, nobody can read token'
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated","email":"helper@test.pk"}';
select set_whatsapp_credentials((select id from committees), '1234567890', 'EAAtesttokentesttoken1234', null, '+92 300 0000000');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated","email":"owner@test.pk"}';
select set_whatsapp_credentials((select id from committees), '1234567890', 'EAAtesttokentesttoken1234', null, '+92 300 0000000')->>'token_hint' as hint;
select * from committee_whatsapp;
\echo '=== A1 owner adds helper by email; unknown email rejected'
select add_committee_admin((select id from committees), 'newuser@test.pk', 'admin') is not null as added;
select add_committee_admin((select id from committees), 'nobody@x.pk', 'admin');
select remove_committee_admin((select id from committees), '00000000-0000-0000-0000-000000000001');
\echo '=== R1 randomness: 40000 picks of 4 (expect ~10000 each)'
\c committee_test postgres
select r, count(*) from (select secure_random_below(4) r from generate_series(1,40000)) z group by 1 order by 1;
\echo '=== V21-1 draw picks ONE winner from ALL eligible members (new committee: 6 members, 1 already won)'
\c committee_test authenticator
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated","email":"newuser@test.pk"}';
select candidate_slots, array_length(candidate_slots,1) as eligible_count, winner_slot from draws;
\echo '=== V21-2 helper (admin) cannot delete a draw; reason required (expect 2 errors)'
\c committee_test postgres
insert into committee_admins (committee_id, user_id, email, role) select id, '00000000-0000-0000-0000-000000000002', 'helper@test.pk', 'admin' from committees where slug='cousins-kameti' on conflict do nothing;
\c committee_test authenticator
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated","email":"helper@test.pk"}';
select delete_draw((select id from draws limit 1), 'wrong draw by mistake');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated","email":"newuser@test.pk"}';
select delete_draw((select id from draws limit 1), 'x');
\echo '=== V21-3 owner deletes the draw: announcement voided, month open again, draw again works'
select delete_draw((select id from draws limit 1), 'Wrong draw by mistake')->>'announcement_voided' as voided;
select count(*) as draws_left, (select is_announced from v_schedule where month_number=1 and committee_id=(select id from committees where slug='cousins-kameti')) as m1_announced from draws;
select (run_lucky_draw((select id from monthly_schedules where month_number=1 and committee_id=(select id from committees where slug='cousins-kameti')), 'manual')->>'winner_slot') is not null as redrawn;
select count(*) as draws_now from draws;
\echo '=== V21-4 payment methods: new values accepted, unknown rejected (expect 1 error)'
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated","email":"owner@test.pk"}';
select (record_payment((select p.id from v_payments p where p.slot_code='C' and p.month_number=1), 10000, current_date, 'cash_najma', null, null)->>'status') as cash_najma;
select (record_payment((select p.id from v_payments p where p.slot_code='D' and p.month_number=1), 10000, current_date, 'online_najma', 'TRX1', null)->>'status') as online_najma;
select record_payment((select p.id from v_payments p where p.slot_code='E' and p.month_number=1), 10000, current_date, 'bitcoin', null, null);
\echo '=== V21-5 start month: helper cannot; owner moves family committee 2 months earlier; data stays with month numbers'
select month_number, period_month, due_date from monthly_schedules where month_number in (1,2,17) and committee_id=(select id from committees where slug='family-committee') order by 1;
select slot_code, amount_paid, payment_method from v_payments where month_number=1 and amount_paid>0 and committee_id=(select id from committees where slug='family-committee') order by 1;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated","email":"helper@test.pk"}';
select change_start_month((select id from committees where slug='family-committee'), (select start_month - interval '2 months' from committee_settings where committee_id=(select id from committees where slug='family-committee'))::date, 'Committee really started earlier');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated","email":"owner@test.pk"}';
update committee_settings set start_month = (start_month - interval '2 months')::date where committee_id=(select id from committees where slug='family-committee');
select change_start_month((select id from committees where slug='family-committee'), (select start_month - interval '2 months' from committee_settings where committee_id=(select id from committees where slug='family-committee'))::date, 'Committee really started earlier');
select month_number, period_month, due_date from monthly_schedules where month_number in (1,2,17) and committee_id=(select id from committees where slug='family-committee') order by 1;
select slot_code, amount_paid, payment_method from v_payments where month_number=1 and amount_paid>0 and committee_id=(select id from committees where slug='family-committee') order by 1;
select month_number, period_month, winner_slot, is_announced, phase from v_schedule where month_number<=3 and committee_id=(select id from committees where slug='family-committee') order by 1;
select count(distinct joined_month) as join_months, min(joined_month) from members where committee_id=(select id from committees where slug='family-committee');
select count(*) as payment_rows, count(*) filter (where amount_paid>0) as paid_rows from payments where committee_id=(select id from committees where slug='family-committee');
select action, summary, reason from audit_logs where action='committee.start_month_changed';
\echo '=== V21-6 direct date edit on a month with history is still blocked (expect 1 error)'
update monthly_schedules set due_date = due_date + 1 where month_number=1 and committee_id=(select id from committees where slug='family-committee');


\echo '=== V22-1 owner reserves months 6 and 7; helper cannot (expect 1 error); reason required (expect 1 error)'
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated","email":"helper@test.pk"}';
select reserve_month((select id from monthly_schedules where committee_id=(select id from committees where slug='family-committee') and month_number=6), 'Kept aside for emergencies');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated","email":"owner@test.pk"}';
select reserve_month((select id from monthly_schedules where committee_id=(select id from committees where slug='family-committee') and month_number=6), 'x');
select reserve_month((select id from monthly_schedules where committee_id=(select id from committees where slug='family-committee') and month_number=6), 'Kept aside for emergencies')->>'month_number' as reserved6;
select reserve_month((select id from monthly_schedules where committee_id=(select id from committees where slug='family-committee') and month_number=7), 'Kept aside for emergencies')->>'month_number' as reserved7;
select month_number, winner_slot, reserve_status from v_schedule where committee_id=(select id from committees where slug='family-committee') and month_number between 5 and 8 order by 1;
\echo '=== V22-2 reserved month cannot be drawn (expect 1 error); advance draw of upcoming months 4 and 5 works'
select run_lucky_draw((select id from monthly_schedules where committee_id=(select id from committees where slug='family-committee') and month_number=6), 'manual');
select (run_lucky_draw((select id from monthly_schedules where committee_id=(select id from committees where slug='family-committee') and month_number=4), 'manual')->>'winner_slot') is not null as m4_drawn_in_advance;
select (run_lucky_draw((select id from monthly_schedules where committee_id=(select id from committees where slug='family-committee') and month_number=5), 'auto')->>'winner_slot') is not null as m5_drawn_in_advance;
\echo '=== V22-3 scheduler cannot draw a future month (expect 1 error)'
select run_lucky_draw((select id from monthly_schedules where committee_id=(select id from committees where slug='family-committee') and month_number=8), 'scheduler');
\echo '=== V22-4 give month 6 as payout to a member who has not won; already-won member rejected (expect 1 error)'
select give_reserve((select id from monthly_schedules where committee_id=(select id from committees where slug='family-committee') and month_number=6), (select member_id from winners where committee_id=(select id from committees where slug='family-committee') and status='announced' limit 1), 'payout', 'Medical emergency in family');
select give_reserve((select id from monthly_schedules where committee_id=(select id from committees where slug='family-committee') and month_number=6), (select m.id from members m where m.committee_id=(select id from committees where slug='family-committee') and m.is_active and not exists (select 1 from winners w where w.member_id=m.id and w.status='announced') order by m.slot_code desc limit 1), 'payout', 'Medical emergency in family')->>'type' as given6;
select month_number, winner_slot, is_announced, reserve_status, reserve_given_type, reserve_member_slot from v_schedule where committee_id=(select id from committees where slug='family-committee') and month_number=6;
\echo '=== V22-5 give month 7 as help only (member stays eligible); undo month 6 (announcement voided)'
select give_reserve((select id from monthly_schedules where committee_id=(select id from committees where slug='family-committee') and month_number=7), (select id from members where committee_id=(select id from committees where slug='family-committee') and slot_code='Q'), 'help', 'School fees support')->>'type' as given7;
select undo_reserve_gift((select id from monthly_schedules where committee_id=(select id from committees where slug='family-committee') and month_number=6), 'Given to the wrong member')->>'month_number' as undone6;
select month_number, is_announced, reserve_status from v_schedule where committee_id=(select id from committees where slug='family-committee') and month_number in (6,7) order by 1;
\echo '=== V22-6 release a given reserve rejected (expect 1 error); release month 6 works and fixed order refills'
select release_reserve((select id from monthly_schedules where committee_id=(select id from committees where slug='family-committee') and month_number=7), 'No longer needed');
select release_reserve((select id from monthly_schedules where committee_id=(select id from committees where slug='family-committee') and month_number=6), 'No longer needed')->>'month_number' as released6;
select month_number, reserve_status, winner_slot is not null as planned from v_schedule where committee_id=(select id from committees where slug='family-committee') and month_number=6;
\echo '=== V22-7 public page shows reserved flags, no names'
select m->>'month_number' as month, m->>'reserved' as reserved, m->>'reserve_used' as used from jsonb_array_elements(public_committee('family-committee')->'months') m where (m->>'month_number')::int between 6 and 7;
select action, summary from audit_logs where action like 'reserve.%' order by id;
