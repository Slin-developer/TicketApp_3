# Ticketing System Architecture & Domain Logic

This document defines the core business logic, organizational hierarchy, inventory management, and Role-Based Access Control (RBAC) for the multi-tenant ticketing platform, optimized for high concurrency and strict data integrity. This should be read as a reference while building the backend correctly. Some features might be added later but are referenced for context here.

## 1. The Multi-Tenant Model (B2B2C)

The system operates as a B2B2C (Business-to-Business-to-Consumer) platform.

* **The Platform** provides the infrastructure.
* **Organizations** (Promoters/Tenants) use the platform to host events and sell tickets. They connect their own Stripe accounts (via Stripe Connect) so payouts bypass the platform and go directly to them.
* **Attendees** (Buyers) purchase tickets from Organizations. To prevent cart abandonment, the system supports Guest Checkouts. Orders and tickets are bound to an email string at checkout. **To prevent unauthorized data scraping, unauthenticated guests cannot view orders using just an email; access requires authenticating via a magic link or providing a strict combination of the email and a unique `order_reference_id`.** If the user does not have a Supabase Auth profile, a shadow profile is created or access is granted later via magic link.

### Organizational Structure

* `organizations`: The core tenant entity (e.g., "LiveNation Vienna"). Holds the `stripe_account_id`.
* `profiles`: A global pool of authenticated users (tied to Supabase Auth).
* `organization_members`: The junction table that links a profile to an organization and assigns them a specific Role (Owner, Admin, or Scanner).

---

## 2. Inventory & Ticket Architecture

Inventory is managed through Ticket Tiers, ensuring financial accuracy and granular stock control.

**The Entity Chain:**
`Event (1) ---> (N) Ticket Tiers (1) ---> (N) Order Items (N) <--- (1) Orders`

### A. Events

The container for a physical or virtual gathering.

* Contains metadata: Title, Description, Venue, Start/End time.
* Strictly owned by a single organization.

### B. Ticket Tiers (The Inventory Engine)

Tiers define exactly what is being sold, for how much, and how many exist.

* **Attributes:** `name`, `price` (stored in cents), `capacity`, `sales_start_at`, `sales_end_at`, and `event_id`.
* **Concurrency Controls:** Includes integers for `sold_count` and `reserved_count` to allow atomic math during high-demand spikes without requiring expensive table scans.
* **Privacy Controls:** Promoters' sales metrics are hidden from the public. A `public_ticket_tiers` View strips out capacity, sold_count, and reserved_count, exposing only a boolean `is_sold_out` and the name/price.

### C. Orders & Order Items (The Financial Ledger)

An order represents a single checkout session.

* `orders`: Ties an email (and optionally a `buyer_id`) to an `event_id`, tracks the `total_amount`, and links to a `stripe_session_id`. Status flows: *pending -> paid (or failed/refunded)*.
* `order_items`: Allows users to buy multiple tiers in one transaction.
* **Validation Constraint:** The database strictly enforces that the `event_id` of every requested `tier_id` perfectly matches the `event_id` of the parent order to prevent cross-pollination exploits.

### D. Tickets (The Entry Pass)

A ticket is minted only after an order is successfully paid.

* Links to the `order_id` (who bought it) and the `tier_id` (what it grants access to).
* **The QR Hash:** Each ticket possesses a strictly unique, unguessable UUIDv4 (`qr_hash`). This is the string embedded in the QR code.
* **Lifecycle:** *valid -> scanned (or voided for chargebacks/refunds)*.

---

## 3. Roles & Permissions (RBAC)

Access is enforced strictly at the database level via Supabase Row Level Security (RLS).

### Internal Roles (Organization Members)

* **owner:** The creator of the organization. Has absolute control. The only role that can configure Stripe Connect payouts, delete the organization, or transfer ownership.
* **admin:** Event managers. Can create/edit events, create/manage ticket tiers, view financial orders, and manually void tickets. Cannot touch payout settings.
* **scanner:** Venue door staff. A strictly limited role. Can invoke the `scan_ticket` RPC and read the safe Ticket Tiers view (to know what type of ticket was just scanned). Cannot view financial data, tier capacities, or modify events.

### External Roles

* **attendee:** Any authenticated user or verified guest (via email magic link). They only have permissions to view their own orders and their own tickets.
* **public:** Unauthenticated or authenticated users browsing the site. Can view published events and available `ticket_tiers` (via the restricted view) to make a purchase decision.

---

## 4. Permissions Matrix

This matrix dictates exactly how Supabase RLS policies must be written.

| Resource | Owner | Admin | Scanner | Attendee (Guest/Auth) | Public |
| --- | --- | --- | --- | --- | --- |
| **Organizations** | CRUD | Read | Read | No Access | No Access |
| **Org Members** | CRUD | Read | Read | No Access | No Access |
| **Events** | CRUD | CRUD | Read | Read | Read |
| **Ticket Tiers (Table)** | CRUD | CRUD | No Access | No Access | No Access |
| **Ticket Tiers (View)** | Read | Read | Read | Read | Read (Safe Data) |
| **Orders** | Read, Update | Read, Update | No Access | Read (Own via Auth/ID) | No Access |
| **Tickets** | Read, Void | Read, Void | Read | Read (Own via Auth/ID) | No Access |

---

## 5. Critical Transaction Lifecycles

To handle high-demand traffic spikes ("hot row" lock contention) and prevent overselling or double-scanning, standard CRUD operations are bypassed for highly optimized PostgreSQL Functions (RPCs) and atomic operations.

### A. The Purchase Flow (Preventing Overselling & Bottlenecks)

To survive high-concurrency ticket drops, the system uses an append-only reservation model paired with atomic column updates.

1. The frontend calls the `reserve_tickets(payload)` RPC, passing an array of requested items. Rate limits and CAPTCHA apply here to block bot hoarding.
2. The database validates that `NOW()` falls between `sales_start_at` and `sales_end_at`, and that all tiers belong to the correct event.
3. To prevent deadlocks, the database sorts the requested `tier_ids` alphanumerically.
4. It calculates dynamic availability using basic math: `capacity - (sold_count + reserved_count)`.
5. If enough capacity exists, it atomically increments `reserved_count` on the tier rows, inserts rows into a `reservations` table with an explicit `expires_at` timestamp (`NOW() + 15 mins`), and creates a pending Order.
6. The Edge Function creates a Stripe Checkout session.
7. **Maintenance:** To prevent sluggish inventory releases, a continuous background worker (or Redis TTL keyspace notification) monitors expirations. Once a reservation expires, it instantly deletes the reservation and atomically decrements the `reserved_count` on the respective tiers, keeping inventory fluid.

### B. The Webhook Lifecycle (Payment & Disputes)

1. **Checkout Completed:** When Stripe sends the `checkout.session.completed` webhook, the database executes a strict transaction: `IF order.status == 'paid' THEN RETURN`. This handles Stripe's "at-least-once" delivery.
2. **Late Webhook Failsafe:** The webhook transaction checks if the reservation is still active. If the webhook was delayed and the reservation expired, it re-verifies inventory. If the tier is now sold out, the system automatically triggers a Stripe refund or flags the order for review instead of minting tickets to prevent overselling.
3. **Synchronous Tallying:** If valid, the system marks the order paid, drops the temporary reservations, atomically decrements `reserved_count`, atomically increments `sold_count`, and mints the actual Tickets. **All of these actions occur in a single, synchronous database transaction** to prevent phantom inventory gaps.
4. **Disputes & Refunds:** The system listens for `charge.refunded` and `charge.dispute.created` webhooks. If received, an automated RPC immediately flags the associated tickets as voided to prevent fraudulent entry.

### C. The Door Flow (Preventing Double-Scanning)

When a scanner scans a QR code at the door:

1. The frontend calls `scan_ticket(qr_hash)`.
2. The database executes a `SELECT ... FOR UPDATE` lock on that specific Ticket row.
3. If the ticket is valid, it marks it scanned, records the timestamp and scanner's user ID. It joins the `public_ticket_tiers` view to return the tier name (e.g., "VIP Access") to the scanner's screen.
4. If the ticket is scanned or voided, it returns an error (prompting an angry red screen on the scanner's device).
5. The lock is released, ensuring that even if two scanners scan the same ticket at the exact same millisecond, only one will succeed.