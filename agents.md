# Agent Instructions — TicketApp_3

Read this before starting any task. It exists to prevent wasted tokens re-deriving project context.

---

## What this project is

A multi-tenant B2B2C ticketing platform. Organizations host events and sell tickets through their own Stripe Connect accounts. Buyers purchase and are issued scannable QR tickets. Door staff scan tickets via a phone UI.

Tech stack: **React + TypeScript + Vite** (frontend) · **Supabase Cloud** (database, auth, RLS, Edge Functions) · **Stripe Cloud** (payments via Connect).

---

## How to interact with the project's cloud services

**All database and payment operations run in the cloud — not locally.**

- **Supabase** is accessible via MCP (`mcp__supabase__*` tools). Use these directly for schema inspection, running SQL, checking logs, listing tables, applying migrations. There is no local Supabase CLI or local DB in this environment.
- **Stripe** is accessible via MCP (`mcp__stripe__*` tools). The connected account is `acct_1TcMYCCA5RPRxc6O` ("TicketApp"), currently in **test mode** (`livemode: false`).
- When you need to verify the DB state, query via `mcp__supabase__execute_sql`. Do not ask the user to run queries manually.
- When you need to inspect Stripe objects, use `mcp__stripe__*` tools. Do not ask the user to open the Stripe Dashboard.

---

## Current implementation state (as of 2026-05-29)

All Phases 1–7 of TODOS.md are complete:

| Phase | What's done |
|-------|-------------|
| 1 | Vite/TS scaffold, folder structure, tsconfig, env files, mcp.json |
| 2 | Full DB schema (7 tables), RLS on all tables, `has_org_role` helper, seed data |
| 3 | `supabaseClient`, auth/scan/events/payments services and interfaces, `AuthContext`, `TenantContext` |
| 4 | UI primitives (`Button`, `Input`, `Select`), React Router with protected routes |
| 5 | `scan_ticket(input_token)` RPC (atomic UPDATE, sha256 token model), scanner UI |
| 6 | `reserve_tickets` RPC, `eventsService`, `paymentsService`, `create-checkout` stub, `stripe-webhook` stub, checkout UI |
| 7 | RLS audit (column-level grant on `organizations.stripe_account_id` via migration 0007), TanStack Query error handling |

**What is stubbed and needs real Stripe to go live:**

- `supabase/functions/create-checkout/index.ts` — returns a fake redirect URL. Needs `stripe.checkout.sessions.create({...})` with the org's `stripe_account_id` as the Connect destination.
- `supabase/functions/stripe-webhook/index.ts` — skips signature verification. Needs `stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET)` before acting.
- `paymentsService.ts` — calls the stub Edge Function. No changes needed here when Stripe goes live; only the Edge Functions change.

---

## Key files

| File | Purpose |
|------|---------|
| `ARCHITECTURE.md` | Data flow rules, directory tree, Stripe trust boundaries |
| `RULES.md` | RLS rules, scan RPC contract, env var rules, component rules |
| `TicketingSystem.md` | Domain logic, RBAC matrix, purchase/scan/webhook flows |
| `TODOS.md` | Chronological build log with completion status |
| `supabase/migrations/` | All schema migrations (0001–0007), applied to Supabase Cloud |
| `src/types/database.types.ts` | GENERATED — never edit by hand. Regenerate after every migration via `mcp__supabase__generate_typescript_types` |
| `src/types/domain.ts` | Hand-authored domain types (`ScanResult`, etc.) |
| `src/services/supabase/` | All DB/RPC/auth/payment calls. Only layer that imports `supabaseClient` |

---

## Architecture rules (enforced — do not violate)

1. **Data flow is one-way:** UI → Hook → TanStack Query → Service → Supabase. No layer skips a level. Hooks never import `supabaseClient`. UI never calls services directly.
2. **Scan is server-authoritative:** `scan_ticket` RPC is the only valid scan path. No local cache, no read-then-write. Atomic conditional UPDATE only.
3. **Stripe SDK never touches the frontend.** Only Edge Functions.
4. **Tickets are issued only by `stripe-webhook`** after verifying the Stripe signature. Frontend success redirect is cosmetic.
5. **RLS is the trust boundary**, not the service layer. Every table has `ENABLE` + `FORCE` RLS.
6. **`database.types.ts` is generated** — regenerate after every migration, never hand-edit.

---

## Environment variables & secrets

| Variable | Where it lives | What it is |
|----------|---------------|------------|
| `VITE_SUPABASE_URL` | root `.env` (gitignored) | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | root `.env` (gitignored) | Supabase anon/public key |
| `VITE_STRIPE_PUBLISHABLE_KEY` | root `.env` (gitignored) | Stripe publishable key (frontend only) |
| `STRIPE_SECRET_KEY` | `supabase/functions/.env` (gitignored) + Supabase Edge Function secrets | Stripe secret key (Edge Functions only) |
| `STRIPE_WEBHOOK_SECRET` | same as above | Stripe webhook signing secret |
| `STRIPE_MCP_KEY` | shell rc / OS keychain, referenced as `${STRIPE_MCP_KEY}` in `.mcp.json` | MCP server restricted key |

**Critical:** `.vscode/mcp.json` and `.mcp.json` are both committed. Never inline secrets into them. Use `${env:VAR}` expansion. Before any commit touching these files, run: `git diff --staged | grep -E 'rk_(live|test)|sk_(live|test)'`.

---

## DB schema summary

| Table | Key columns | Notes |
|-------|------------|-------|
| `profiles` | `id` (= auth.uid), `role`, `org_id` | Mirrors Supabase Auth users |
| `organizations` | `id`, `name`, `stripe_account_id` | `stripe_account_id` is hidden from public (migration 0007) |
| `organization_members` | `profile_id`, `org_id`, `role` | `has_org_role(p_org_id, p_role)` helper used in RLS |
| `events` | `id`, `org_id`, `title`, `venue`, `starts_at` | |
| `ticket_tiers` | `id`, `event_id`, `price_cents`, `capacity`, `sold_count`, `reserved_count` | Capacity management via atomic math |
| `orders` | `id`, `org_id`, `event_id`, `attendee_id`, `status`, `stripe_session_id` | Status: pending → paid → fulfilled |
| `tickets` | `id`, `order_id`, `tier_id`, `token_hash`, `status` | `token_hash` = sha256 of raw QR secret. Never store raw token. |

RPCs deployed: `scan_ticket(input_token text)`, `reserve_tickets(p_tier_id uuid, p_quantity int, p_buyer_id uuid)`, `has_org_role(p_org_id uuid, p_role text)`.
