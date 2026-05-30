# TicketApp 3 – Multi-Tenant B2B2C Ticketing Platform

A production-ready, security-focused ticketing platform where organizations sell tickets through their own Stripe accounts. Built with atomic database operations, server-authoritative scanning, and enterprise-grade multi-tenant isolation via Supabase RLS.

**Key strengths:**
- 🔒 **Enterprise security:** Row-Level Security (RLS) enforced on every table; Stripe SDK isolated to Edge Functions
- ⚡ **Atomic operations:** Server-side RPCs prevent overselling and double-scanning under high load
- 🎟️ **QR tokens:** Derived (not stored) bearer tokens ensure leaked databases don't expose valid tickets
- 🏢 **True multi-tenant:** Complete isolation via Supabase Auth + RLS + custom JWT claims
- 📱 **Mobile-ready:** HTTPS-enabled dev server with local network testing for iOS scanning

---

## Table of Contents

1. [What This Is](#what-this-is)
2. [Architecture at a Glance](#architecture-at-a-glance)
3. [Quick Start](#quick-start)
4. [Understanding the Code](#understanding-the-code)
5. [Key Concepts](#key-concepts)
6. [Project Status](#project-status)

---

## What This Is

**TicketApp 3** is a **B2B2C (Business-to-Business-to-Consumer)** ticketing system:

- **Organizations** (promoters, venues) host events and issue tickets via the platform
- **They control payouts** by connecting their own Stripe accounts (Stripe Connect)
- **Attendees** (guests or authenticated users) purchase and receive QR-scannable tickets
- **Door staff** scan tickets at the venue using a web UI on their phone

**Example flow:**
1. Organizer creates an event and connects their Stripe account
2. Attendee purchases tickets → Stripe Checkout
3. Stripe webhook triggers ticket issuance (server-authoritative, not frontend)
4. Attendee gets a QR code to print or show on their phone
5. Door staff scans it → atomic database RPC validates and marks it scanned

The platform is **fully cloud-native** — no local backend, no polling. Supabase handles database, auth, and serverless functions. Payments flow directly to organizers' Stripe accounts.

---

## Architecture at a Glance

### Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 19 + TypeScript + Vite |
| **Database** | Supabase Cloud (Postgres 15+) with Row-Level Security (RLS) |
| **Auth** | Supabase Auth + custom JWT claims for performance |
| **Payments** | Stripe Connect (in test mode) via Edge Functions |
| **Type Safety** | Generated TypeScript types from Postgres schema |

### One-Way Data Flow

The architecture enforces a strict, unidirectional data flow:

```
UI Component → Custom Hook → TanStack Query → Service Layer → Supabase
```

- **UI components** are presentation-only; they never call services or Supabase directly
- **Hooks** wrap TanStack Query and manage server state (caching, errors, loading)
- **Services** (`services/supabase/`) are the **only** files that import the Supabase client
- **Supabase** is the single source of truth (no local cache for critical operations like scanning)

### Multi-Tenant Isolation

Every request flows through Supabase Auth. The JWT contains:
- User ID (`auth.uid()`)
- Organization ID (custom claim)
- Role (custom claim)

Supabase **RLS policies** enforce access at the database row level — no organizer can read another's data, even if they guess the API.

### Atomic Operations (RPCs)

High-concurrency operations bypass read-then-write patterns and use PostgreSQL functions:

- **`scan_ticket(input_token)`** — Atomically validates and marks a ticket as scanned. No overselling, no double-scanning, even under load.
- **`reserve_tickets(tier_ids, quantities)`** — Atomically reserves inventory and creates an order. Prevents checkout race conditions.
- **`has_org_role(org_id, role)`** — Helper RPC for RLS policies to check user roles.

These are the trust boundaries. Frontend cannot bypass them.

### Derived QR Tokens (Security Innovation)

Instead of storing and distributing bearer tokens, this system **derives them on demand**:

```
HMAC-SHA256(TICKET_TOKEN_SECRET, ticket.id) = bearer token (not stored)
SHA-256(bearer token) = token_hash (stored in DB)
```

**Advantage:** If the database is leaked, the token_hash cannot be used directly (attacker must hash-crack the secret). Tokens are re-derivable at every step (issue → deliver → scan) without storing secrets in the database.

---

## Quick Start

### Prerequisites

- **Node.js** 18+
- **npm** or **yarn**
- `.env` file with Supabase credentials (see `.env.example`)

### Installation

```bash
npm install
```

### Development

**HTTPS only (for camera/QR scanning):**
```bash
npm run dev
```
Opens on `https://localhost:5173` with a self-signed certificate.

**HTTPS + HTTP (for local network testing on iOS):**
```bash
npm run dev:both
```
Runs on:
- `https://localhost:5173` — for camera/scanning features
- `http://localhost:5174` — for faster iteration on other UI

The script prints your machine's IP so you can test on iOS/Android:
```
https://<your-machine-ip>:5173  (use for scanner)
http://<your-machine-ip>:5174   (use for checkout/admin UI)
```

### Build & Deploy

```bash
npm run build    # TypeScript + Vite → dist/
npm run preview  # Preview production build locally
npm run lint     # ESLint check
```

---

## Understanding the Code

### Project Structure

```
TicketApp_3/
├── supabase/
│   ├── migrations/               # Schema, RLS policies, RPCs (0001–0007)
│   ├── functions/                # Edge Functions (stubs: create-checkout, stripe-webhook)
│   └── seed.sql                  # Dev seed data + roles
│
├── src/
│   ├── lib/
│   │   └── supabaseClient.ts     # Singleton Supabase client
│   │
│   ├── services/supabase/        # ONLY layer that imports supabaseClient
│   │   ├── authService.ts
│   │   ├── scanService.ts        # Calls scan_ticket RPC
│   │   ├── eventsService.ts
│   │   ├── ticketsService.ts
│   │   ├── paymentsService.ts    # Calls create-checkout Edge Function
│   │   └── *.ts (+ interfaces)
│   │
│   ├── hooks/                    # TanStack Query wrappers
│   │   ├── useScanner.ts         # Wraps scanService, manages scan state
│   │   ├── useTickets.ts
│   │   ├── useEvents.ts
│   │   └── useCheckout.ts
│   │
│   ├── components/
│   │   ├── ui/                   # Unstyled semantic HTML (Button, Input, Select)
│   │   └── features/             # Feature-specific: scanner, checkout, admin, etc.
│   │
│   ├── context/
│   │   ├── AuthContext.tsx       # Current user + org + role
│   │   └── TenantContext.tsx     # Active organization (multi-org users)
│   │
│   ├── types/
│   │   ├── database.types.ts     # GENERATED from Postgres schema (never edit)
│   │   └── domain.ts             # Hand-written domain types (ScanResult, etc.)
│   │
│   └── router/                   # Protected routes + redirects
│
├── ARCHITECTURE.md               # Detailed technical decisions
├── RULES.md                      # Security rules & enforcement
├── TicketingSystem.md            # Business logic & RBAC matrix
└── TODOS.md                      # Build progress log
```

### Key Files to Read First

1. **`ARCHITECTURE.md`** — Data flow rules, stripe trust boundary, token model, detailed directory tree
2. **`TicketingSystem.md`** — B2B2C model, RBAC, order/ticket lifecycle, inventory management
3. **`RULES.md`** — Multi-tenant isolation, RLS patterns, component abstraction, atomic operations
4. **`supabase/migrations/`** — See the schema and RPCs directly

### Critical Implementation Patterns

#### 1. Service Layer (Only layer that touches Supabase)

```typescript
// services/supabase/scanService.ts
export class ScanService implements IScanRepository {
  async scan(inputToken: string): Promise<ScanResult> {
    const { data, error } = await supabaseClient.rpc('scan_ticket', { input_token: inputToken });
    if (error) throw error;
    
    return {
      result: data.result, // 'success' | 'already_scanned' | 'not_found'
      ticketId: data.ticket_id,
    };
  }
}
```

#### 2. Custom Hook (TanStack Query wrapper)

```typescript
// hooks/useScanner.ts
export function useScanner() {
  return useMutation({
    mutationFn: (token: string) => scanService.scan(token),
    onSuccess: (result) => {
      if (result.result === 'success') {
        // Scanner sees green
      } else {
        // Scanner sees red
      }
    },
  });
}
```

#### 3. Component (Calls hook, never service)

```typescript
export function ScannerUI() {
  const { mutate: scan, isPending } = useScanner();

  const handleQRDetected = (token: string) => {
    scan(token); // That's it — the hook handles all RPC calls
  };

  return <CameraFeed onQRDetected={handleQRDetected} />;
}
```

#### 4. RLS Policy (Database-level enforcement)

```sql
-- Organizers can only read their own events
create policy "Organizers read their events"
  on events for select
  using (org_id = public.current_org_id());
```

Every table has `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`. RLS is the trust boundary.

---

## Key Concepts

### Order & Ticket Lifecycle

```
ORDER:   pending → paid → fulfilled (or failed/expired)
         
TICKET:  (created only when ORDER is paid, by stripe-webhook)
         valid → scanned
              ↓
              void (for refunds/chargebacks)
```

**Critical rule:** Tickets are created **only by the server** (via `stripe-webhook` Edge Function), never by the frontend.

### Atomic Scanning

The `scan_ticket(input_token)` RPC is the single source of truth:

```sql
-- Atomically claim a ticket (or fail if not valid/found)
update tickets
  set status = 'scanned', scanned_at = now()
where token_hash = sha256(input_token)
  and status = 'valid'
returning *;
```

**No frontend read-then-write.** The RPC is atomic and prevents double-scanning and race conditions automatically.

### Inventory Management

During checkout:
1. Frontend calls `reserve_tickets` RPC → reserves inventory, creates pending order
2. Edge Function creates Stripe Checkout
3. Stripe webhook → `stripe-webhook` Edge Function → fulfills order, issues tickets

Capacity is tracked via atomic column math (no expensive table scans):
```
available = capacity - (sold_count + reserved_count)
```

### Guest Checkout

Attendees don't need a Supabase Auth account. They can:
- Provide an email during checkout
- Receive tickets via a magic link or a secure `order_reference_id`
- A shadow profile is created if needed

(RLS still applies: unauthenticated guests cannot enumerate orders by email alone.)

### Role-Based Access Control (RBAC)

| Role | Permissions |
|------|---|
| **Owner** | Full org control: create events, connect Stripe, manage members, void tickets |
| **Admin** | Event management: CRUD events & tiers, view orders, void tickets |
| **Scanner** | Scan only: call `scan_ticket`, read safe tier metadata (no financial data) |
| **Attendee** | View own tickets & orders (via auth or `order_reference_id`) |
| **Public** | Browse events & available tiers (safe public view) |

Enforced via RLS policies + TenantContext.

---

## Project Status

### Completed Phases (1–7 of TODOS.md)

| Phase | What's Done |
|-------|---|
| **1** | Vite/TypeScript scaffold, folder structure, environment setup |
| **2** | Full DB schema (7 tables), RLS on all tables, helper RPCs, seed data |
| **3** | Supabase client, auth/scan/events/payments services, AuthContext, TenantContext |
| **4** | UI primitives (Button, Input, Select), React Router with protected routes |
| **5** | `scan_ticket()` RPC, atomic scanning, scanner UI |
| **6** | `reserve_tickets()` RPC, checkout UI, payment service, Edge Function stubs |
| **7** | RLS audit (column-level grants), TanStack Query error handling |

### What's Stubbed (Ready for Stripe Integration)

The payment flow is **structurally complete** but uses placeholder Stripe calls:

- **`supabase/functions/create-checkout/index.ts`** — Returns a fake redirect URL. Replace with `stripe.checkout.sessions.create({...})`
- **`supabase/functions/stripe-webhook/index.ts`** — Skips signature verification. Replace with `stripe.webhooks.constructEvent(rawBody, sig, secret)`

The service layer and hooks don't change. Only the Edge Functions need real Stripe API calls.

### What's Next

1. Replace Edge Function stubs with real Stripe API calls
2. Add Stripe webhook handling for refunds/disputes
3. Scale: background worker for reservation expiration, caching, monitoring

---

## Development Workflows

### Running Migrations

After changing the schema in `supabase/migrations/`:
```bash
# Apply to Supabase Cloud (via MCP)
mcp__supabase__apply_migration

# Regenerate TypeScript types
mcp__supabase__generate_typescript_types
```

Then restart your dev server to pick up the new types.

### Testing Auth Flows

1. Sign up as Owner/Admin/Scanner/Attendee in the UI
2. Run `supabase/seed.sql` to populate seed data and test users
3. Use the TenantContext to switch between organizations (for multi-org testing)

### Testing Scanning (Offline)

Without real tickets, you can:
1. Insert a test ticket directly via `seed.sql`:
   ```sql
   insert into tickets (id, order_id, tier_id, token_hash, status)
   values (gen_random_uuid(), ..., ..., sha256('test-token'), 'valid');
   ```
2. Scan `test-token` via the UI

---

## Deployment

### Frontend
Build and deploy the `dist/` folder to Netlify, Vercel, or any static host.

### Backend
All backend logic runs on **Supabase Cloud**:
- Postgres database (managed)
- Auth (managed)
- Edge Functions (auto-deploy from `supabase/functions/`)

Environment variables (`.env`) must be set in your Supabase project settings.

---

## Documentation

- **[ARCHITECTURE.md](./ARCHITECTURE.md)** — Deep dive: data flow, Stripe trust boundary, token model, detailed directory tree
- **[TicketingSystem.md](./TicketingSystem.md)** — Business logic, B2B2C model, RBAC matrix, inventory & order lifecycles
- **[RULES.md](./RULES.md)** — Security rules, RLS patterns, component abstraction, atomic operations
- **[TODOS.md](./TODOS.md)** — Build progress log with completion status per phase

---

## Contributing

This project uses:
- **ESLint** (`npm run lint`) — TypeScript + React Hooks
- **Vite** — Fast HMR development
- **TanStack Query** — Server state management
- **Supabase** — Backend as a Service (managed Postgres, Auth, Edge Functions)

Before submitting a PR:
1. Run `npm run lint` and fix any issues
2. Update `TODOS.md` if you complete a phase
3. Regenerate types if you change the schema (`mcp__supabase__generate_typescript_types`)

---

## License

MIT (adjust as needed)

---

## Questions?

- **Security:** See `RULES.md` for RLS patterns, Stripe boundaries, and token handling
- **Architecture:** Read `ARCHITECTURE.md` for data flow and design decisions
- **Domain logic:** Check `TicketingSystem.md` for order/ticket lifecycles and RBAC
- **Build progress:** View `TODOS.md` for what's done and what's next
