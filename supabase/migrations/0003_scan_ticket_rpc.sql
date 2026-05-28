-- Phase 5: scan_ticket RPC per RULES.md Rule 4.
-- - QR carries the raw high-entropy secret as text; the DB stores only its SHA-256.
-- - Atomicity is a conditional UPDATE (no SELECT ... FOR UPDATE).
-- - SECURITY DEFINER + explicit scanner authorization via organization_members.

create extension if not exists pgcrypto;

-- 1. Replace tickets.qr_hash (uuid) with tickets.token_hash (text, sha256 hex).
-- The bearer model changes (raw secret hashed at scan time, never stored), so
-- prior qr_hash values are unusable. Existing rows are dropped; reseed after.
truncate table public.tickets;
alter table public.tickets drop column qr_hash;
alter table public.tickets add column token_hash text not null unique;

-- 2. Scanner RPC.
create or replace function public.scan_ticket(input_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text := encode(digest(input_token, 'sha256'), 'hex');
  v_org_id uuid;
  v_ticket public.tickets%rowtype;
begin
  -- Resolve the ticket's org. If the caller is not authorized, we return
  -- 'unauthorized' (not 'not_found'), which intentionally reveals that the
  -- token maps to a real ticket — acceptable UX for scanner staff.
  select org_id into v_org_id from public.tickets where token_hash = v_hash;

  if v_org_id is null then
    return jsonb_build_object('result', 'not_found');
  end if;

  -- Authorization: caller must be a scanner (or admin/owner) for the ticket's org.
  if not public.has_org_role(v_org_id, 'scanner'::public.org_member_role) then
    return jsonb_build_object('result', 'unauthorized');
  end if;

  -- Atomic claim: only flips valid -> scanned. Concurrent scans race here;
  -- exactly one wins because the UPDATE locks the row internally.
  update public.tickets
     set status = 'scanned', scanned_at = now()
   where token_hash = v_hash
     and status = 'valid'
  returning * into v_ticket;

  if found then
    return jsonb_build_object('result', 'success', 'ticket_id', v_ticket.id);
  end if;

  if exists (
    select 1 from public.tickets where token_hash = v_hash and status = 'scanned'
  ) then
    return jsonb_build_object('result', 'already_scanned');
  end if;

  -- Ticket exists but is void (or otherwise non-scannable): do not leak that.
  return jsonb_build_object('result', 'not_found');
end;
$$;

revoke all on function public.scan_ticket(text) from public;
grant execute on function public.scan_ticket(text) to authenticated;
