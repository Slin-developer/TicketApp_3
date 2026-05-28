# Execution Roadmap

## Phase 1: Scaffolding & Setup
- [x] Initialize Vite (React + TS).
- [x] Set up the exact folder structure defined in `ARCHITECTURE.md` (creating empty/stub files).
- [x] Configure `tsconfig.json` for strict type checking and path aliases (`@/*`).
- [x] Set up `.env.example` and `supabase/functions/.env.example`.
- [x] Configure `.vscode/mcp.json`.

## Phase 2: Database & Auth Foundation (Multi-Tenant)
- [x] Write the initial `schema.sql` migration for custom enums (`user_role`, `order_status`, `ticket_status`).
- [x] Create tables: `profiles`, `organizations`, `organization_members`, `events`, `ticket_tiers`, `orders`, and `tickets`.
- [x] Implement the `has_org_role(p_org_id, p_role)` Postgres helper function for performant RLS checks.
- [x] Implement explicit RLS policies for all tables (e.g., event/tier public read, strict CRUD for org owners/admins via the helper function).
- [x] Create `seed.sql` to inject 1 test organization, 4 test users (owner, admin, scanner, attendee), 1 test event with 2 ticket tiers, and mock orders/tickets.
- [x] Run `supabase gen types typescript` to generate `database.types.ts`.

## Phase 3: Core Service Layer
- [x] Implement `lib/supabaseClient.ts`.
- [x] Implement `IAuthProvider.ts` and `authService.ts`.
- [x] Build `AuthContext.tsx` and `TenantContext.tsx`.
- [x] Populate `src/types/domain.ts` with explicit types (`ScanResult`, `Order`, `PaymentStatus`).

## Phase 4: UI Primitives & Routing
- [ ] Build the bare-bones semantic UI components in `components/ui/` (`Button`, `Input`, `Select`).
- [ ] Set up React Router in `router/index.tsx` with basic protected/unprotected routes.

## Phase 5: The Scanner RPC & Validation UI
- [ ] Write the PostgreSQL function `scan_ticket(p_qr_hash UUID, p_scanner_id UUID)` inside a migration file.
- [ ] Ensure `scan_ticket` uses `SELECT ... FOR UPDATE` on the `tickets` table and checks scanning permissions via `organization_members`.
- [ ] Implement `IScanRepository.ts`, `scanService.ts`, and `useScanner.ts`.
- [ ] Build the minimal scanner UI to test the RPC against dummy seed data, handling the typed responses (`success`, `already_scanned`, `not_found`, `unauthorized`).

## Phase 6: Inventory Locking & Stripe Connect Stubbing
- [ ] Write the PostgreSQL function `reserve_tickets(p_tier_id UUID, p_quantity INT, p_buyer_id UUID)` with `SELECT ... FOR UPDATE` on `ticket_tiers` to prevent overselling.
- [ ] Implement `eventsService.ts` and `useEvents.ts` for organizer CRUD operations (managing events and tiers).
- [ ] Implement `paymentsService.ts` with a mock `createCheckout` method that calls the Supabase Edge Function.
- [ ] Stub `supabase/functions/create-checkout`: Accept an `order_id`, look up `organizations.stripe_account_id`, and return a fake redirect URL.
- [ ] Stub `supabase/functions/stripe-webhook`: Mock the event that updates `orders.status` to `paid` and generates the final `tickets` rows with unique `qr_hash`es.
- [ ] Build a skeleton checkout UI that successfully triggers the `reserve_tickets` RPC and mock payment pipeline.

## Phase 7: Polish & RLS Verification
- [ ] Verify that all tables have RLS enabled and cannot be bypassed via the browser console.
- [ ] Ensure all TanStack Queries correctly and gracefully handle the `throw` errors from the service layer.