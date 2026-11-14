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
