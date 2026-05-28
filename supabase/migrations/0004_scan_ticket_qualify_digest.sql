-- Fixup for 0003: scan_ticket pins search_path = public (correct for
-- SECURITY DEFINER), but pgcrypto's digest() lives in the `extensions` schema
-- on Supabase. Reference it fully-qualified rather than widening search_path.

create or replace function public.scan_ticket(input_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text := encode(extensions.digest(input_token, 'sha256'), 'hex');
  v_org_id uuid;
  v_ticket public.tickets%rowtype;
begin
  select org_id into v_org_id from public.tickets where token_hash = v_hash;

  if v_org_id is null then
    return jsonb_build_object('result', 'not_found');
  end if;

  if not public.has_org_role(v_org_id, 'scanner'::public.org_member_role) then
    return jsonb_build_object('result', 'unauthorized');
  end if;

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

  return jsonb_build_object('result', 'not_found');
end;
$$;
