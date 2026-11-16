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
