# Project Rules & Security Boundaries

## Rule 1: Multi-Tenant Isolation (RLS is King)

The trust hierarchy is strict: **Supabase RLS > services/supabase/ logic > TenantContext (UI convenience).**

* RLS must be explicitly ENABLED and FORCED on all tables. Every table migration includes:

    ```sql
    ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;
    ALTER TABLE <table> FORCE ROW LEVEL SECURITY;
    ```

* Policies must resolve the calling user's organizer ID. **Do not use `organizer_id = auth.uid()`** — `auth.uid()` is the user, not the organizer.
* **Do not write a `profiles` subquery inline in every policy.** That runs per-row and can recurse if `profiles` has its own RLS referencing itself. Instead use a `SECURITY DEFINER`, `STABLE` helper function that bypasses RLS for the lookup:

    ```sql
    create or replace function public.current_organizer_id()
    returns uuid
    language sql
    stable
    security definer
    set search_path = public
    as $$
      select organizer_id from public.profiles where id = auth.uid();
    $$;
    ```

    Policies then read `using (organizer_id = public.current_organizer_id())`.
* **Preferred optimization:** mirror `role` and `organizer_id` into the JWT via custom claims so policies can read `auth.jwt()` without any table hit. Use the table-lookup helper as the correctness baseline; move to JWT claims for performance.

## Rule 2: Auth Model & Testing Roles

Users authenticate via Supabase email/password. A `profiles` table stores the user's `role` and `organizer_id`.

**Roles for immediate testing:**

* `admin` — Full platform access.
* `organizer` — Can CRUD their own events and view their tickets.
* `scanner` — Can only invoke the scan RPC for assigned events.
* `attendee` — Can view their own purchased tickets.

## Rule 3: Component Abstraction (Shadcn/ui Readiness)

All `components/ui/` files must forward a `className` prop and `...rest` props onto their underlying semantic HTML element. Do not invent placeholder class names.

```tsx
type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement>;

export function Button({ className, ...rest }: ButtonProps) {
  return <button className={className} {...rest} />;
}
```

## Rule 4: Atomic Database Operations (The Scan RPC)

Scan validation must invoke a single atomic Supabase RPC. A frontend "read-then-write" sequence is **forbidden**.

* **Signature:** `scan_ticket(input_token text)` — the QR carries the raw high-entropy secret as text. The RPC hashes it internally and looks up by `token_hash`. The raw secret is never stored.
* **Atomicity via conditional UPDATE, not explicit locking.** For a single-row scan, a conditional `UPDATE ... WHERE status='valid' RETURNING` is atomic by itself and avoids lock-contention edge cases. `SELECT ... FOR UPDATE` is **not** required and should not be used for the single-ticket path.
* **Return a typed payload:** `success`, `already_scanned`, or `not_found`.

```sql
create or replace function public.scan_ticket(input_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text := encode(digest(input_token, 'sha256'), 'hex');
  v_ticket tickets%rowtype;
begin
  -- Atomic claim: only a currently-valid ticket flips to scanned.
  update tickets
     set status = 'scanned', scanned_at = now()
   where token_hash = v_hash
     and status = 'valid'
  returning * into v_ticket;

  if found then
    return jsonb_build_object('result', 'success', 'ticket_id', v_ticket.id);
  end if;

  -- Distinguish "already scanned" from "does not exist / void".
  if exists (select 1 from tickets where token_hash = v_hash and status = 'scanned') then
    return jsonb_build_object('result', 'already_scanned');
  end if;

  return jsonb_build_object('result', 'not_found');
end;
$$;
```

> `digest()` requires the `pgcrypto` extension: `create extension if not exists pgcrypto;`. The function is `SECURITY DEFINER` so it can update the row, but it must validate that the calling `scanner` is authorized for the ticket's event before flipping status (add an event-authorization check inside the function, or gate execution via RLS/role grants).

## Rule 5: Type Safety

* `src/types/database.types.ts` must be generated via `supabase gen types typescript` and **NEVER edited by hand**.
* **Regenerate types after *every* migration** that changes the schema — not just once. This includes the scan RPC migration in Phase 5. Treat "regenerate types" as a mandatory substep of any migration.
* `src/types/domain.ts` holds hand-authored types (e.g., the `ScanResult` discriminated union, `CheckoutSession` stubs).

```ts
export type ScanResult =
  | { result: 'success'; ticketId: string }
  | { result: 'already_scanned' }
  | { result: 'not_found' };
```

## Rule 6: Environment Variables

* `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are the **only** variables the frontend reads.
* Stripe keys and webhook secrets go in `supabase/functions/.env` and are **never** `VITE_` prefixed.
* The Supabase service-role key is never exposed to the frontend under any circumstances.

## Rule 7: Supabase MCP Integration

The MCP server connects the AI coding tool to Supabase for **development-time** operations only. It must never weaken runtime boundaries.

* Use a **scoped / read-only token** where possible and point it at a **non-production** project ref. An MCP server with write access can run migrations and read data, so treat it as a sensitive dev surface.
* `.vscode/mcp.json` — note the value is a **plain JSON string** (JSON has no markdown link syntax):

    ```json
    {
      "servers": {
        "supabase": {
          "type": "http",
          "url": "https://mcp.supabase.com/mcp?project_ref=YOUR_PROJECT_REF"
        }
      }
    }
    ```

## Rule 8: Payment Trust Boundary (applies when Stripe goes live)

* Tickets are issued **only** by the `stripe-webhook` Edge Function on a verified `checkout.session.completed` event.
* The frontend checkout-success redirect must never issue or validate a ticket.
* The webhook must verify the Stripe signature before acting.

## Rule 9: Guest Checkout & Order Reference (Phase 8)

Buyers **never authenticate**. Only door staff (`scanner` / `admin` / `organizer`) log in. The purchase and ticket-retrieval flow is keyed on the order itself, not on `auth.uid()`.

* **Guest orders carry an email, not a user.** `orders.attendee_id` is nullable; a guest order stores `buyer_email` and a generated `order_reference`. Do not gate the reserve/checkout/retrieve path on a logged-in user.
* **`order_reference` is the bearer key.** It is the only credential a buyer presents to view their tickets: the buyer lands on `/tickets/{order_reference}` after payment, and `get-tickets` looks up the order (and re-derives QR tokens) from that reference alone. Treat `order_reference` like a capability URL — unguessable, and the sole proof of ownership for a guest.
* **Inventory holds expire after 35 minutes** (5 min past Stripe's 30-min Checkout session minimum, so the DB never reclaims a hold that still has a live payment session). `reserve_tickets` reclaims expired `pending` orders **lazily, under the tier row lock**, on the next reservation for that tier — no cron job, self-healing. An expired hold flips the order to `expired` and returns its quantity to the tier.
* **`create-checkout` on a stale hold returns `order_not_pending`.** The UI maps this to "Reservation expired. Please try again." The buyer must re-reserve; a checkout session is never created against a reclaimed order.
* **Trust:** the bearer-token caveats of Rule 8 still hold — the success redirect to `/tickets/{ref}` is cosmetic. Tickets exist only after the webhook fulfils the `paid` order.