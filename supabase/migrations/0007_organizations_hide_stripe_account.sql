-- Phase 7: RLS verification hardening.
--
-- Finding: `orgs_public_read` is `using (true)`, so any anon/authenticated
-- client could `select stripe_account_id` on every organization straight from
-- the browser console. RLS is row-level only and cannot hide a single column,
-- so we use column-level privileges (checked independently of, and in addition
-- to, RLS) to keep the row public-readable while denying the Stripe Connect id.
--
-- Non-breaking: no frontend code selects `organizations` columns today; the
-- public storefront only ever needs id/name/created_at. Edge Functions read
-- stripe_account_id via the service role, which bypasses both RLS and column
-- grants, so the create-checkout lookup is unaffected.

revoke select on public.organizations from anon, authenticated;
grant  select (id, name, created_at) on public.organizations to anon, authenticated;

-- `orgs_admin_update` still governs which rows an admin may update; column
-- grants for update are unchanged (admins manage their own org, including its
-- stripe_account_id, via the service-role onboarding flow rather than the
-- anon/authenticated client, so no update column grant is widened here).
