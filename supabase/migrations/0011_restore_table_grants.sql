-- Restore base-table privileges that the RLS-first schema never granted.
--
-- WHY: 0001/0002 created the tables and wrote RLS policies but never issued the
-- table-level GRANTs those policies sit on top of. RLS only *filters* rows that
-- a role is already privileged to touch; with no base grant, Postgres rejects
-- every statement with "permission denied for table ..." before any policy is
-- evaluated. The result: edge functions (service_role) could not read/write
-- orders/tickets, and the public events catalogue (anon) could not be read.
-- Phase 7's audit was static-only, so this was never caught against a live DB.
--
-- MODEL: standard Supabase. service_role is the trusted backend and bypasses
-- RLS, so it gets full DML. anon/authenticated get DML too, but every table has
-- FORCE row level security with deny-by-default policies, so access stays gated
-- exactly by the existing policies (e.g. anon satisfies no write policy; guest
-- orders flow only through the SECURITY DEFINER reserve_tickets RPC).

grant select, insert, update, delete on all tables in schema public
  to service_role;

grant select, insert, update, delete on all tables in schema public
  to anon, authenticated;

-- Re-apply 0007: organizations.stripe_account_id must never be readable by a
-- browser (anon/authenticated) role. The blanket grant above re-exposed the
-- whole row, so narrow it back to the public columns. service_role keeps full
-- access (it needs stripe_account_id for Connect destination charges).
revoke select on public.organizations from anon, authenticated;
grant  select (id, name, created_at) on public.organizations to anon, authenticated;
