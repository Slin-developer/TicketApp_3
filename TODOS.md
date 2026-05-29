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
- [x] **Stripe secret handling (app integration)** — the secret API key used by the app belongs ONLY in `supabase/functions/.env` (gitignored, local dev) and in Supabase Edge Function secrets via `supabase secrets set STRIPE_SECRET_KEY=...` (prod). Never paste into source, frontend env, commits, chat, or screenshots. The frontend uses only the publishable key (`VITE_STRIPE_PUBLISHABLE_KEY`).
  - Test keys already placed: `sk_test_...` in `supabase/functions/.env`, `pk_test_...` in root `.env`. Webhook secret slot left blank until `stripe listen` is run in Phase 6.
  - Before going live, swap `sk_test_` → `sk_live_` in Supabase secrets (not in any committed file), configure the production webhook in Stripe Dashboard, and audit history: `git log -p -S 'sk_live' -S 'rk_live'`.

## Cross-cutting: Stripe MCP key
- [x] **REVOKE the `rk_live_...` MCP key pasted in chat on 2026-05-28** in Stripe Dashboard → Developers → API keys. It's burned regardless of scope.
- [x] When re-issuing the Stripe MCP key, do NOT inline it into `.vscode/mcp.json` or `.mcp.json` — both files are committed (`.gitignore` un-ignores `mcp.json`). Instead, reference it via an env var (e.g. `${env:STRIPE_MCP_KEY}` in `.vscode/mcp.json`) and store the actual value in your shell rc / direnv / OS keychain. Verify with `git ls-files | grep mcp.json` before each commit that no key sits in a tracked file.
- [x] Write the PostgreSQL function `reserve_tickets(p_tier_id UUID, p_quantity INT, p_buyer_id UUID)` with `SELECT ... FOR UPDATE` on `ticket_tiers` to prevent overselling.
- [x] Implement `eventsService.ts` and `useEvents.ts` for organizer CRUD operations (managing events and tiers).
- [x] Implement `paymentsService.ts` with a mock `createCheckout` method that calls the Supabase Edge Function.
- [x] Stub `supabase/functions/create-checkout`: Accept an `order_id`, look up `organizations.stripe_account_id`, and return a fake redirect URL.
- [x] Stub `supabase/functions/stripe-webhook`: Mock the event that updates `orders.status` to `paid` and generates the final `tickets` rows with unique `qr_hash`es. *(Token model now SHA-256 `token_hash` per Phase 5; webhook generates raw UUID per ticket and stores only the hash.)*
- [x] Build a skeleton checkout UI that successfully triggers the `reserve_tickets` RPC and mock payment pipeline.

## Phase 7: Polish & RLS Verification
- [x] Verify that all tables have RLS enabled and cannot be bypassed via the browser console.
  - All 7 tables (`profiles`, `organizations`, `organization_members`, `events`, `ticket_tiers`, `orders`, `tickets`) have `enable` + `force` RLS. All RPCs/helpers `revoke ... from public`, `grant to authenticated`.
  - Fixed over-exposure: `orgs_public_read using (true)` leaked `organizations.stripe_account_id` to any browser-console client. Migration `0007` uses column-level grants so `id/name/created_at` stay public-readable but the Stripe Connect id is deny-by-default. (No client code reads it; service role bypasses for Edge Functions.)
  - NOTE: static migration audit only — no local Supabase/CLI in this env, so this was not re-verified against a running DB. Run `supabase db reset` + `supabase status` (or the dashboard advisors) to confirm live.
- [x] Ensure all TanStack Queries correctly and gracefully handle the `throw` errors from the service layer.
  - Both wired consumers (`ScannerPanel`, `CheckoutPanel`) render `role="alert"` on `isError`/mutation errors. Remaining `useEvents` query/mutation hooks are not yet wired to UI (admin/events pages are stubs), so nothing is left un-handled.

---

## Phase 8: Guest Checkout & In-App QR (Full End-to-End Flow)

**MOTIVATION:** The app is ~90% architecturally complete but **cannot complete a real purchase**:
- `stripe-webhook` mints raw tokens but discards them — issued tickets are unscannable.
- All pages are behind a login wall; ordering requires `auth.uid()`.
- Login, Events pages are stubs; checkout says "(stub)" and shows a URL link instead of redirecting.

**DESIGN (from think-about-what-still-fuzzy-whisper.md):**
- **Guest checkout:** buyers never log in; only door staff (scanner/admin) authenticate.
- **Derived QR tokens:** each ticket's token = `HMAC_SHA256(TICKET_TOKEN_SECRET, ticket_id)`. The DB stores only `token_hash` (unchanged); tokens are computed on-demand by edge functions. Nothing secret at rest.
- **Inventory reclaim:** pending orders expire after 35 min (5 min past Stripe's 30-min session minimum). `reserve_tickets` lazily reclaims expired holds under the tier lock — cron-free, self-healing.
- **In-app My Tickets:** buyer lands on `/tickets/{order_reference}` after payment, sees "Finalizing…" (polling the webhook), then QR codes appear.
- **Seeded events:** no admin event-creation UI this phase.

**CURRENT STATUS (2026-05-29):**

**Phase 0 — COMPLETE:**
- [x] Verified STRIPE_SECRET_KEY in supabase/functions/.env is active (test key).
- [x] Discovered remote DB is at **migration 0006** (0007/0008/0009 were local-only, never pushed).
- [x] Applied migrations 0007, 0008, 0009 to remote via MCP.
- [x] Generated TICKET_TOKEN_SECRET (`106a3991...`); added to supabase/functions/.env + .env.example.
- [x] Installed `qrcode.react@^4` npm dep.
- [x] Created migration 0010_guest_checkout.sql (local file, ready to apply).

**TODO — Remaining Phases:**

**Phase 1 — Apply migration 0010 + regenerate types:**
- [ ] `mcp__supabase__apply_migration` for 0010_guest_checkout.sql (orders: buyer_email, order_reference, expires_at, attendee_id nullable; reserve_tickets rewrite with lazy reclaim; fulfill_paid_order signature change to explicit ticket ids).
- [ ] `mcp__supabase__generate_typescript_types` to regenerate `src/types/database.types.ts`.

**Phase 2 — Edge functions (3 functions, 1 new secret):**
- [ ] **Update `supabase/functions/create-checkout/index.ts`:**
  - Select `order_reference`, `buyer_email` from orders (line 79).
  - Set `success_url = ${appUrl}/tickets/${order.order_reference}`.
  - Set `cancel_url` to the events page.
  - Pass `customer_email: order.buyer_email` and `expires_at = now + 30 min` to `stripe.checkout.sessions.create()`.
- [ ] **Update `supabase/functions/stripe-webhook/index.ts`:**
  - Generate `quantity` ticket UUIDs (via `crypto.randomUUID()`).
  - For each ticket, compute `token = HMAC_SHA256(TICKET_TOKEN_SECRET, ticket_id)` using Web Crypto.
  - Compute `token_hash = sha256Hex(token)` (same hash logic as scanner).
  - Pass `(p_ticket_ids[], p_token_hashes[])` to `fulfill_paid_order` RPC.
  - Update the NOTE comment (lines 13–16) to describe derived-token delivery via get-tickets.
- [ ] **New `supabase/functions/get-tickets/index.ts`** (anon-callable):
  - POST endpoint: input `{ order_reference }`.
  - Service-role lookup of the order + its tickets (id, status, tier.name, event.name).
  - If `order.status === 'paid'`, recompute `token = HMAC(TICKET_TOKEN_SECRET, ticket.id)` per ticket.
  - Return `{ status, tickets: [{ id, status, token, tier_name }], event_name }`.
  - While pending, return `{ status: 'pending', tickets: [] }`.
  - Add CORS headers (like `create-checkout`).
- [ ] **Deploy all 3 functions via MCP** (`mcp__supabase__deploy_edge_function`):
  - `stripe-webhook` with `verify_jwt: false` (Stripe cannot provide a Supabase JWT).
  - `create-checkout` with default `verify_jwt: true`.
  - `get-tickets` with default `verify_jwt: true`.
- [ ] **Set function secrets in Supabase Dashboard** (MCP cannot do this):
  - `TICKET_TOKEN_SECRET` = the value from `supabase/functions/.env`.
  - Verify `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are set.

**Phase 3 — Frontend: public browsing, guest checkout, My Tickets:**
- [ ] **Update `src/router/index.tsx`:**
  - Pull `/events`, `/checkout`, new `/tickets/:ref` out of `ProtectedRoute` (public routes).
  - Keep `/scanner`, `/admin` protected.
  - Root redirects to `/events`.
- [ ] **Implement `EventsPage`:**
  - List seeded events (public read via `useEvents` / `eventsService`).
  - "Buy tickets" button → `/checkout?event=<id>`.
- [ ] **Update `CheckoutPanel`:**
  - Remove `!user` gating (lines 30, 47, 70, 78, 100, 107).
  - Add a **required email input** field.
  - Reserve with `{ tierId, quantity, email }` (not `buyerId`).
  - On checkout success, `window.location.assign(session.url)` (redirect to Stripe, not render stub link).
  - Drop "(stub)" label (line 125).
  - Handle `order_not_pending` error → "Reservation expired. Please try again."
- [ ] **Update `src/services/supabase/paymentsService.ts`:**
  - Change `reserveTickets(buyerId, ...)` signature to `reserveTickets(email, ...)`.
  - RPC call now passes `p_buyer_email` instead of `p_buyer_id`.
  - Extract `order_reference` from the RPC result; return it so the redirect knows where to go.
- [ ] **Implement `MyTicketsPage`** at `/tickets/:ref`:
  - `useOrderTickets(ref)` hook calling the `get-tickets` edge function via `ticketsService`.
  - Poll with `refetchInterval: 2000` while `status === 'pending'` (webhook is async).
  - Show "Finalizing your order…" during pending.
  - Cap retries (e.g., stop after 2 min if still pending) and show "Order not paid yet. Check your email or try again."
  - Once `status === 'paid'`, render one `<QRCodeSVG value={token} />` per ticket.
  - Show tier name + event name alongside each QR.
- [ ] **Implement stubs:**
  - `src/services/supabase/ticketsService.ts`: `async getOrderByReference(ref: string)` → invokes `get-tickets` edge function.
  - `src/hooks/useTickets.ts`: `useOrderTickets(ref)` → TanStack Query wrapper around `ticketsService.getOrderByReference` with polling.

**Phase 4 — Staff login UI:**
- [ ] **Implement `LoginPage`:**
  - Email + password form using existing `authService.signIn()` / `useAuth()`.
  - POST to `authService.signIn({ email, password })`.
  - On success, redirect to `/events` or `/scanner` (depending on role / query param).
  - On error, show "Invalid credentials" message.
  - This is staff-only now; `ProtectedRoute` redirects non-auth visitors here.

**Phase 5 — Documentation:**
- [ ] **Update `ARCHITECTURE.md` §5 (token model):**
  - Record that tokens are now derived (`HMAC(secret, ticket_id)`), not stored.
  - Explain why: nothing secret persists; tokens are re-derivable for all phases of the ticket lifecycle.
  - Note the rotation caveat: rotating `TICKET_TOKEN_SECRET` invalidates already-issued QRs.
- [ ] **Update `RULES.md`:**
  - Document the guest checkout model (orders with email + reference, no attendee_id).
  - Document `order_reference` as the bearer key for ticket retrieval.
  - Document the 35-min hold window and how `reserve_tickets` reclaims expired orders.
- [ ] **Update `TODOS.md`:**
  - Add Phase 8 completion notes and archive the pending tasks above once done.

**Verification (end-to-end):**
- [ ] **DB checks:**
  - `mcp__supabase__list_migrations` confirms 0010 is applied.
  - `execute_sql` verifies the new `reserve_tickets(uuid, int, text)` signature.
  - Verify a stale pending order is reclaimed on the next reserve (query orders with `status='expired'`).
- [ ] **Token round-trip:**
  - Confirm a fulfilled ticket's `token_hash` equals `sha256Hex(HMAC(secret, ticket.id))`.
  - Confirm `get-tickets` returns a token the scanner `/scanner` path accepts (hash match).
- [ ] **App flow** (Stripe test mode, `npm run dev`):
  - `/events` (logged out) → event list renders.
  - `/checkout?event=<seeded>` → email + tier + reserve → "Proceed to checkout" → redirected to Stripe.
  - Pay with `4242 4242 4242 4242` / future date / CVC 123 → redirected to `/tickets/<ref>` → "Finalizing…" → QR codes appear.
  - Log in as a seeded scanner (`scanner@test.local` / `password123`) → `/scanner` → scan QR token → `success`.
  - Rescan same QR → `already_scanned`.
  - Refund the PaymentIntent in Stripe → webhook voids tickets → rescan → `not_found`.
  - Expired reservation → `create-checkout` returns `order_not_pending` → UI shows "Expired, retry."
- [ ] **Build + advisors:**
  - `npm run build` (tsc) passes.
  - `mcp__supabase__get_advisors security` shows no new RLS/security warnings from 0010.

**DEFERRED (follow-up phases):**
- Email/SMS QR delivery to buyer's inbox (requires email service integration).
- Per-IP rate limiting on `reserve_tickets` / `create-checkout` (soft-DoS hardening).
- Out-of-order refund-before-fulfilment race mitigation.
- Admin event/tier creation UI (for organizers to self-service event setup).

**SEE ALSO:** `/Users/nilskozeluha/.claude/plans/think-about-what-still-fuzzy-whisper.md` for the full approved plan (context, token model rationale, stability review, all 5 phases).