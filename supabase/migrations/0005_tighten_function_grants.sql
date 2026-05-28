-- Restrict EXECUTE on SECURITY DEFINER helpers so anon can't call them via
-- /rest/v1/rpc/...  (advisor lints 0028/0029).
--
-- - handle_new_user(): trigger function — must not be REST-callable. Triggers
--   fire regardless of EXECUTE grants, so no grant-back is needed.
-- - has_org_role(), current_organizer_id(): used by RLS policies under the
--   authenticated role, so they must remain executable by `authenticated`,
--   just not by `anon` (PUBLIC).

revoke execute on function public.handle_new_user() from public;

revoke execute on function public.has_org_role(uuid, public.org_member_role) from public;
grant  execute on function public.has_org_role(uuid, public.org_member_role) to authenticated;

revoke execute on function public.current_organizer_id() from public;
grant  execute on function public.current_organizer_id() to authenticated;
