-- Phase 2: Database foundation
--   * extensions
--   * enums + tables (profiles, events, orders, tickets, event_scanners)
--   * current_organizer_id() helper (RULES.md Rule 1)
--   * RLS policies for organizer / scanner / attendee
--
-- Ticket/order state machine encoded as enums; see ARCHITECTURE.md §4.
-- Tickets store token_hash only (ARCHITECTURE.md §5). Inserts/updates on
-- tickets happen via SECURITY DEFINER server code (webhook + scan_ticket
-- RPC in Phase 5) — no DML policies are granted to the anon/auth roles.

--------------------------------------------------------------------------
-- Extensions
--------------------------------------------------------------------------
create extension if not exists pgcrypto;

--------------------------------------------------------------------------
-- Enums
--------------------------------------------------------------------------
do $$ begin
  create type public.user_role as enum ('admin', 'organizer', 'scanner', 'attendee');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.order_status as enum ('pending', 'paid', 'fulfilled', 'failed', 'expired');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.ticket_status as enum ('valid', 'scanned', 'void');
exception when duplicate_object then null; end $$;

--------------------------------------------------------------------------
-- Tables
--------------------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text not null,
  role          public.user_role not null default 'attendee',
  organizer_id  uuid,
  created_at    timestamptz not null default now()
);

create table if not exists public.events (
  id            uuid primary key default gen_random_uuid(),
  organizer_id  uuid not null,
  name          text not null,
  description   text,
  starts_at     timestamptz not null,
  ends_at       timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists events_organizer_idx on public.events (organizer_id);

create table if not exists public.orders (
  id            uuid primary key default gen_random_uuid(),
  organizer_id  uuid not null,
  event_id      uuid not null references public.events(id) on delete restrict,
  attendee_id   uuid not null references auth.users(id) on delete restrict,
  status        public.order_status not null default 'pending',
  amount_cents  integer not null check (amount_cents >= 0),
  created_at    timestamptz not null default now()
);
create index if not exists orders_organizer_idx on public.orders (organizer_id);
create index if not exists orders_attendee_idx  on public.orders (attendee_id);
create index if not exists orders_event_idx     on public.orders (event_id);

create table if not exists public.tickets (
  id            uuid primary key default gen_random_uuid(),
  organizer_id  uuid not null,
  event_id      uuid not null references public.events(id) on delete restrict,
  order_id      uuid references public.orders(id) on delete set null,
  attendee_id   uuid references auth.users(id) on delete set null,
  token_hash    text not null unique,
  status        public.ticket_status not null default 'valid',
  scanned_at    timestamptz,
  created_at    timestamptz not null default now(),
  constraint tickets_scanned_at_consistency
    check ((status = 'scanned') = (scanned_at is not null))
);
create index if not exists tickets_organizer_idx on public.tickets (organizer_id);
create index if not exists tickets_event_idx     on public.tickets (event_id);
create index if not exists tickets_attendee_idx  on public.tickets (attendee_id);

-- Scanner-to-event assignments. The scan RPC (Phase 5) will check this
-- table inside SECURITY DEFINER to authorize the caller for the event.
create table if not exists public.event_scanners (
  event_id      uuid not null references public.events(id) on delete cascade,
  scanner_id    uuid not null references auth.users(id) on delete cascade,
  organizer_id  uuid not null,
  created_at    timestamptz not null default now(),
  primary key (event_id, scanner_id)
);
create index if not exists event_scanners_scanner_idx on public.event_scanners (scanner_id);

--------------------------------------------------------------------------
-- Helper functions
--------------------------------------------------------------------------
-- RULES.md Rule 1: avoid `profiles` subqueries inside policies (recursion
-- risk + per-row cost). Use a SECURITY DEFINER helper instead.
create or replace function public.current_organizer_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select organizer_id from public.profiles where id = auth.uid();
$$;

create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

-- Auto-create a profile row on signup. Role/organizer_id are assigned later
-- (admin tool or seed). Default role = 'attendee'.
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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

--------------------------------------------------------------------------
-- Row-Level Security
--------------------------------------------------------------------------
alter table public.profiles        enable row level security;
alter table public.profiles        force  row level security;
alter table public.events          enable row level security;
alter table public.events          force  row level security;
alter table public.orders          enable row level security;
alter table public.orders          force  row level security;
alter table public.tickets         enable row level security;
alter table public.tickets         force  row level security;
alter table public.event_scanners  enable row level security;
alter table public.event_scanners  force  row level security;

-- profiles -------------------------------------------------------------
drop policy if exists profiles_self_select on public.profiles;
create policy profiles_self_select on public.profiles
  for select
  using (id = auth.uid());
-- No insert/update/delete policies: profiles are created by the
-- on_auth_user_created trigger; role/organizer_id are administered
-- out-of-band (service role).

-- events ---------------------------------------------------------------
drop policy if exists events_organizer_all on public.events;
create policy events_organizer_all on public.events
  for all
  using (organizer_id = public.current_organizer_id())
  with check (organizer_id = public.current_organizer_id());

drop policy if exists events_authenticated_select on public.events;
create policy events_authenticated_select on public.events
  for select
  using (auth.role() = 'authenticated');

-- orders ---------------------------------------------------------------
drop policy if exists orders_organizer_all on public.orders;
create policy orders_organizer_all on public.orders
  for all
  using (organizer_id = public.current_organizer_id())
  with check (organizer_id = public.current_organizer_id());

drop policy if exists orders_attendee_select on public.orders;
create policy orders_attendee_select on public.orders
  for select
  using (attendee_id = auth.uid());

drop policy if exists orders_attendee_insert on public.orders;
create policy orders_attendee_insert on public.orders
  for insert
  with check (attendee_id = auth.uid() and status = 'pending');

-- tickets --------------------------------------------------------------
-- Read-only for organizer and the ticket's attendee. Inserts come from
-- the stripe-webhook (service role bypasses RLS); status transitions go
-- through the scan_ticket RPC (Phase 5, SECURITY DEFINER).
drop policy if exists tickets_organizer_select on public.tickets;
create policy tickets_organizer_select on public.tickets
  for select
  using (organizer_id = public.current_organizer_id());

drop policy if exists tickets_attendee_select on public.tickets;
create policy tickets_attendee_select on public.tickets
  for select
  using (attendee_id = auth.uid());

-- event_scanners -------------------------------------------------------
drop policy if exists event_scanners_organizer_all on public.event_scanners;
create policy event_scanners_organizer_all on public.event_scanners
  for all
  using (organizer_id = public.current_organizer_id())
  with check (organizer_id = public.current_organizer_id());

drop policy if exists event_scanners_self_select on public.event_scanners;
create policy event_scanners_self_select on public.event_scanners
  for select
  using (scanner_id = auth.uid());
