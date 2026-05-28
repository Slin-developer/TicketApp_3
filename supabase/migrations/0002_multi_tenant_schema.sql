-- Revert Phase 1 tables that conflict with Phase 2 Multi-Tenant
drop table if exists public.tickets cascade;
drop table if exists public.orders cascade;
drop table if exists public.event_scanners cascade;
drop table if exists public.events cascade;
drop table if exists public.profiles cascade;
drop type if exists public.user_role cascade;

-- 1. Custom Enums
create type public.org_member_role as enum ('owner', 'admin', 'scanner');
-- order_status and ticket_status still exist from 0001_init_schema.sql

-- 2. Tables
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  stripe_account_id text,
  created_at timestamptz not null default now()
);

create table public.organization_members (
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.org_member_role not null default 'scanner',
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.ticket_tiers (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  name text not null,
  price_cents integer not null check (price_cents >= 0),
  capacity integer not null check (capacity >= 0),
  reserved_count integer not null default 0 check (reserved_count >= 0),
  sold_count integer not null default 0 check (sold_count >= 0),
  created_at timestamptz not null default now(),
  constraint ticket_tiers_capacity_check_v2 check (reserved_count + sold_count <= capacity)
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete restrict,
  attendee_id uuid not null references auth.users(id) on delete restrict,
  status public.order_status not null default 'pending',
  amount_cents integer not null check (amount_cents >= 0),
  created_at timestamptz not null default now()
);

create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete restrict,
  tier_id uuid not null references public.ticket_tiers(id) on delete restrict,
  order_id uuid references public.orders(id) on delete set null,
  attendee_id uuid references auth.users(id) on delete set null,
  qr_hash uuid not null unique default gen_random_uuid(),
  status public.ticket_status not null default 'valid',
  scanned_at timestamptz,
  created_at timestamptz not null default now(),
  constraint tickets_scanned_at_consistency_v2
    check ((status = 'scanned') = (scanned_at is not null))
);

-- 3. Trigger for profiles
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

-- 4. Helper Function for RLS
create or replace function public.has_org_role(p_org_id uuid, p_role public.org_member_role)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.organization_members
    where org_id = p_org_id
      and user_id = auth.uid()
      and (
         role = p_role
         or (p_role = 'admin' and role = 'owner')
         or (p_role = 'scanner' and role in ('owner', 'admin'))
      )
  );
$$;

-- 5. Row Level Security Policies
alter table public.profiles enable row level security;
alter table public.profiles force row level security;

alter table public.organizations enable row level security;
alter table public.organizations force row level security;

alter table public.organization_members enable row level security;
alter table public.organization_members force row level security;

alter table public.events enable row level security;
alter table public.events force row level security;

alter table public.ticket_tiers enable row level security;
alter table public.ticket_tiers force row level security;

alter table public.orders enable row level security;
alter table public.orders force row level security;

alter table public.tickets enable row level security;
alter table public.tickets force row level security;

-- Profiles
create policy profiles_self_read on public.profiles for select using (id = auth.uid());

-- Organizations
create policy orgs_public_read on public.organizations for select using (true);
create policy orgs_admin_update on public.organizations for update using (public.has_org_role(id, 'admin'::public.org_member_role));

-- Organization Members
create policy org_members_read on public.organization_members for select using (public.has_org_role(org_id, 'scanner'::public.org_member_role));
create policy org_members_admin_all on public.organization_members for all using (public.has_org_role(org_id, 'admin'::public.org_member_role));

-- Events
create policy events_public_read on public.events for select using (true);
create policy events_admin_all on public.events for all using (public.has_org_role(org_id, 'admin'::public.org_member_role));

-- Ticket Tiers
create policy tiers_public_read on public.ticket_tiers for select using (true);
create policy tiers_admin_all on public.ticket_tiers for all using (
  public.has_org_role((select org_id from public.events where id = event_id), 'admin'::public.org_member_role)
);

-- Orders
create policy orders_attendee_read on public.orders for select using (attendee_id = auth.uid());
create policy orders_attendee_insert on public.orders for insert with check (attendee_id = auth.uid() and status = 'pending');
create policy orders_admin_read on public.orders for select using (public.has_org_role(org_id, 'admin'::public.org_member_role));

-- Tickets
create policy tickets_attendee_read on public.tickets for select using (attendee_id = auth.uid());
create policy tickets_scanner_read on public.tickets for select using (public.has_org_role(org_id, 'scanner'::public.org_member_role));