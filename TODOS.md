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
- [x] Build the bare-bones semantic UI components in `components/ui/` (`Button`, `Input`, `Select`).
- [x] Set up React Router in `router/index.tsx` with basic protected/unprotected routes.

## Phase 5: The Scanner RPC & Validation UI
- [x] Write the PostgreSQL function `scan_ticket(input_token text)` inside a migration file. *(Signature follows RULES.md Rule 4, not the older roadmap signature.)*
- [x] Ensure `scan_ticket` is atomic (conditional UPDATE per Rule 4) and checks scanning permissions via `organization_members` (`has_org_role`).
- [x] Implement `IScanRepository.ts`, `scanService.ts`, and `useScanner.ts`.
- [x] Build the minimal scanner UI to test the RPC against dummy seed data, handling the typed responses (`success`, `already_scanned`, `not_found`, `unauthorized`).

## Phase 6: Inventory Locking & Stripe Connect Stubbing
- [ ] **Stripe secret handling (app integration)** — the secret API key used by the app belongs ONLY in `supabase/functions/.env` (gitignored, local dev) and in Supabase Edge Function secrets via `supabase secrets set STRIPE_SECRET_KEY=...` (prod). Never paste into source, frontend env, commits, chat, or screenshots. The frontend uses only the publishable key (`VITE_STRIPE_PUBLISHABLE_KEY`).
  - Test keys already placed: `sk_test_...` in `supabase/functions/.env`, `pk_test_...` in root `.env`. Webhook secret slot left blank until `stripe listen` is run in Phase 6.
  - Before going live, swap `sk_test_` → `sk_live_` in Supabase secrets (not in any committed file), configure the production webhook in Stripe Dashboard, and audit history: `git log -p -S 'sk_live' -S 'rk_live'`.

## Cross-cutting: Stripe MCP key
- [ ] **REVOKE the `rk_live_...` MCP key pasted in chat on 2026-05-28** in Stripe Dashboard → Developers → API keys. It's burned regardless of scope.
- [ ] When re-issuing the Stripe MCP key, do NOT inline it into `.vscode/mcp.json` or `.mcp.json` — both files are committed (`.gitignore` un-ignores `mcp.json`). Instead, reference it via an env var (e.g. `${env:STRIPE_MCP_KEY}` in `.vscode/mcp.json`) and store the actual value in your shell rc / direnv / OS keychain. Verify with `git ls-files | grep mcp.json` before each commit that no key sits in a tracked file.
- [x] Write the PostgreSQL function `reserve_tickets(p_tier_id UUID, p_quantity INT, p_buyer_id UUID)` with `SELECT ... FOR UPDATE` on `ticket_tiers` to prevent overselling.
- [x] Implement `eventsService.ts` and `useEvents.ts` for organizer CRUD operations (managing events and tiers).
- [x] Implement `paymentsService.ts` with a mock `createCheckout` method that calls the Supabase Edge Function.
- [x] Stub `supabase/functions/create-checkout`: Accept an `order_id`, look up `organizations.stripe_account_id`, and return a fake redirect URL.
- [x] Stub `supabase/functions/stripe-webhook`: Mock the event that updates `orders.status` to `paid` and generates the final `tickets` rows with unique `qr_hash`es. *(Token model now SHA-256 `token_hash` per Phase 5; webhook generates raw UUID per ticket and stores only the hash.)*
- [x] Build a skeleton checkout UI that successfully triggers the `reserve_tickets` RPC and mock payment pipeline.

## Phase 7: Polish & RLS Verification
- [ ] Verify that all tables have RLS enabled and cannot be bypassed via the browser console.
- [ ] Ensure all TanStack Queries correctly and gracefully handle the `throw` errors from the service layer.