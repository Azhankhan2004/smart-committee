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
