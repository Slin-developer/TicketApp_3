# Architecture & Structure

## 1. Strict Separation of Concerns & Data Flow

The data flow is a strict one-way chain. No layer may skip a level:

**UI Component → Custom Hook → TanStack Query → services/supabase/ → Supabase**

* **UI Components** manage only local visual state. They invoke custom hooks and never call services or Supabase directly. They must be written as functional skeleton primitives (clean props/slots) easily swappable for Radix UI / Shadcn/ui later.
* **Custom Hooks (`hooks/`)** wrap TanStack Query's `useQuery` and `useMutation`. They own server-state concerns (caching, loading, errors). They never import the Supabase client.
* **Services (`services/supabase/`)** contain database queries, RPC calls, auth, and payment calls. They are the *only* files that import `lib/supabaseClient.ts`.
* **Error Convention:** Service-layer methods always `throw` on failure — *except* the scanner RPC, which returns typed success/failure business-logic states (`success`, `already_scanned`, `not_found`). These are expected outcomes, not exceptions.

## 2. Repository Pattern (Swappable Data Access)

Data-access services implement typed interfaces (e.g., `IRepository<T>`, `IScanRepository`). This keeps UI and hooks decoupled from the concrete Supabase implementation and makes the service layer testable with mocks.

> **Scanning is online-only.** There is no local SQLite/IndexedDB scan store. The atomic server RPC is the *only* authority for ticket validation and double-spend prevention. The repository pattern here is for testability and clean boundaries, **not** for offline operation. Do not introduce a local scan cache that returns `ScanResult` — a cache cannot enforce the single-scan guarantee.

## 3. Stripe Handling (Pre-Integration Phase)

Payments are NOT to be implemented yet. Reserve the structure and trust boundaries only.

* **Frontend UI:** Displays "Advisory" prices and a "Checkout" button.
* **Service Layer (`paymentsService.ts`):** Implements `IPaymentProvider` but currently contains a stub `createCheckout` method. It resolves a fake `CheckoutSession` object with a dummy URL to simulate a redirect, allowing UI testing without Stripe keys.
* **Strict Rule:** The Stripe SDK must *never* touch the frontend. It will exclusively live in Supabase Edge Functions (`supabase/functions/`).
* **Trust boundary (for the real integration later):** A ticket only becomes valid/issued when the `stripe-webhook` Edge Function verifies a `checkout.session.completed` event. The frontend success redirect is cosmetic and must never be trusted to issue a ticket — users can forge it.

## 4. Order & Ticket Lifecycle (State Machine)

`orders` and `tickets` are distinct. An order represents an intent to purchase; tickets are only the issued, scannable artifacts.

```text
ORDER:   pending ──► paid ──► fulfilled
              │
              └─► failed / expired   (no tickets issued)

TICKET:  (created only after ORDER reaches "paid", by the webhook)
         valid ──► scanned
              │
              └─► void   (refund / chargeback / manual revoke)
```

Rules implied by this machine:

* Tickets are **created by the server** (webhook / Edge Function) when an order becomes `paid`. The frontend never inserts tickets.
* The scan RPC only ever transitions a ticket from `valid` → `scanned`. Any other current state returns `already_scanned` (if `scanned`) or `not_found` (if missing/void).
* A refund/chargeback sets the ticket to `void`; voided tickets must fail the scan as `not_found` (do not leak that the ticket once existed beyond what the scanner needs).

During the stubbed phase, `seed.sql` may insert `valid` tickets directly to exercise the scanner without a real payment.

## 5. Scan Token Model (Security-Critical)

The QR code carries a **high-entropy bearer secret** (a UUIDv4 has 122 bits of entropy — infeasible to brute-force). To avoid storing a directly-usable bearer token in a readable column:

* The database stores **`token_hash`** (e.g., a SHA-256 of the secret), never the raw secret.
* The QR/scan flow sends the raw secret to the RPC; the RPC hashes it and looks up by `token_hash`.
* This means a leak of the `tickets` table rows does not hand an attacker working scan tokens.

See `RULES.md` Rule 4 for the exact RPC contract.

## 6. Directory Tree

```text
.vscode/
└── mcp.json                       # Supabase MCP server config (dev-time only)

supabase/
├── functions/
│   ├── create-checkout/index.ts   # (Stub) Creates Stripe Checkout
│   └── stripe-webhook/index.ts    # (Stub) Verifies Stripe events; issues tickets on paid
├── migrations/                    # Schema, RLS, scan_ticket RPC, RLS helper fns
└── seed.sql                       # Roles and mock data for testing

src/
├── lib/
│   └── supabaseClient.ts          # createClient() singleton
├── services/
│   └── supabase/
│       ├── IRepository.ts
│       ├── IScanRepository.ts
│       ├── IAuthProvider.ts
│       ├── IPaymentProvider.ts
│       ├── ticketsService.ts
│       ├── eventsService.ts
│       ├── scanService.ts
│       ├── authService.ts
│       └── paymentsService.ts     # Stubbed for dummy checkouts
├── hooks/
│   ├── useTickets.ts
│   ├── useScanner.ts
│   ├── useEvents.ts
│   └── useCheckout.ts
├── components/
│   ├── ui/                        # Unstyled semantic HTML components
│   │   ├── Button.tsx
│   │   ├── Input.tsx
│   │   └── Select.tsx
│   └── features/
│       ├── ticket-selection/
│       ├── scanner/
│       ├── admin/
│       └── checkout/
├── context/
│   ├── AuthContext.tsx
│   └── TenantContext.tsx
├── router/
│   └── index.tsx
├── types/
│   ├── database.types.ts          # GENERATED — never edited by hand
│   └── domain.ts                  # Hand-authored domain types
├── App.tsx
└── main.tsx

.env.example
supabase/functions/.env.example
```