-- Sample data in the OLD single-committee format (before migration 04).
insert into auth.users values ('00000000-0000-0000-0000-000000000001','owner@test.pk'),('00000000-0000-0000-0000-000000000002','helper@test.pk'),('00000000-0000-0000-0000-000000000009','stranger@test.pk');
insert into admin_users(id,email,role) values ('00000000-0000-0000-0000-000000000001','owner@test.pk','owner'),('00000000-0000-0000-0000-000000000002','helper@test.pk','admin');
update members set full_name='Ayesha', phone_e164='+923001234501' where slot_code='A';
update members set full_name='Bilal' where slot_code='B';
select record_payment((select p.id from payments p join members m on m.id=p.member_id join monthly_schedules s on s.id=p.schedule_id where m.slot_code='A' and s.month_number=1), 10000, current_date, 'cash', 'T1', null);
select record_payment((select p.id from payments p join members m on m.id=p.member_id join monthly_schedules s on s.id=p.schedule_id where m.slot_code='B' and s.month_number=1), 4000, current_date, 'cash', null, null);
select announce_winner((select id from monthly_schedules where month_number=1), 'A');
