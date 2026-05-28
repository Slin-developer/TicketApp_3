# Execution Roadmap

> **Recurring rule:** After *any* migration that alters the schema, immediately re-run `supabase gen types typescript` to regenerate `src/types/database.types.ts`. This is not a one-time task.

## Phase 1: Scaffolding & Setup

- [ ] Initialize Vite (React + TS).
- [ ] Set up the exact folder structure defined in `ARCHITECTURE.md` (creating empty/stub files).
- [ ] Configure `tsconfig.json` for strict type checking and path aliases (`@/*`).
- [ ] Set up `.env.example` and `supabase/functions/.env.example`.
- [ ] Confirm `.vscode/mcp.json` is valid JSON and the MCP server is connected (already done).

## Phase 2: Database & Auth Foundation

- [x] Enable the `pgcrypto` extension (needed for token hashing in the scan RPC).
- [x] Write the initial `schema.sql` migration for: `profiles`, `events`, `tickets`, `orders`.
    - [x] `tickets` stores `token_hash` (never the raw secret) and a `status` enum: `valid | scanned | void`.
    - [x] `orders` stores a `status` enum: `pending | paid | fulfilled | failed | expired`.
    - [x] Encode the order/ticket state machine from `ARCHITECTURE.md` §4 as constraints/defaults.
- [x] Create the `current_organizer_id()` `SECURITY DEFINER STABLE` helper function (RULES.md Rule 1).
- [x] Implement explicit RLS policies for `organizer`, `scanner`, and `attendee` using the helper (not inline `profiles` subqueries).
- [x] Create `seed.sql` to inject 4 test users (one per role), a test event, and a few `valid` test tickets (insert `token_hash` for known test secrets).
- [x] Regenerate `database.types.ts`.

## Phase 3: Core Service Layer

- [ ] Implement `lib/supabaseClient.ts`.
- [ ] Implement `IAuthProvider.ts` and `authService.ts`.
- [ ] Build `AuthContext.tsx` and `TenantContext.tsx`.
- [ ] Populate `src/types/domain.ts` with explicit types (`ScanResult`, `Order`, `PaymentStatus`, `CheckoutSession`).

## Phase 4: UI Primitives & Routing

- [ ] Build the bare-bones semantic UI components in `components/ui/` (`Button`, `Input`, `Select`).
- [ ] Set up React Router in `router/index.tsx` with basic protected/unprotected routes.

## Phase 5: The Scanner RPC (Crucial Security Check)

- [ ] Write the PostgreSQL function `scan_ticket(input_token text)` in a migration, using the **conditional UPDATE** pattern (RULES.md Rule 4) — not `SELECT ... FOR UPDATE`.
- [ ] Add the in-function check that the calling `scanner` is authorized for the ticket's event.
- [ ] Regenerate `database.types.ts`.
- [ ] Implement `IScanRepository.ts`, `scanService.ts`, and `useScanner.ts`.
- [ ] Build the minimal scanner UI to test the RPC against dummy seed data (online call only — no local cache).

## Phase 6: Stripe Stubbing & Event Management

- [ ] Implement `eventsService.ts` and `useEvents.ts` for organizer CRUD operations.
- [ ] Implement `paymentsService.ts` with a mock `createCheckout` that logs the payload and returns a fake success URL.
- [ ] Build a skeleton checkout UI that triggers the mocked payment pipeline.
- [ ] **Stub only (note for the real integration):** ticket issuance must happen in the `stripe-webhook` Edge Function on a verified `checkout.session.completed` event — never from the frontend redirect (RULES.md Rule 8).

## Phase 7: Polish & RLS Verification

- [ ] Verify every table has RLS enabled AND forced, and cannot be bypassed via the browser console (test with each role's anon session).
- [ ] Confirm the `current_organizer_id()` helper does not cause recursion and policies perform acceptably.
- [ ] Test the scan RPC for double-spend: fire concurrent scans of the same token and confirm exactly one `success`, the rest `already_scanned`.
- [ ] Ensure all TanStack Queries gracefully handle the `throw` errors from the service layer, and that the scanner path correctly handles its typed (non-throwing) results.