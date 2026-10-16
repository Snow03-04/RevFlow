# Supabase bandwidth

Financial reads use migration `0039_financial_read_windows.sql`:

- `financial_payment_snapshots` returns charge/refund evidence for orders in the
  requested accounting window, including transactions posted outside that window.
  Disputes and other profit adjustments use their posting date. Payouts remain in
  the full stored ledger and are not read for profit calculations.
- `cogs_quantity_history` returns only paid, unedited, non-refunded baskets with
  supplier invoices and at least two units. It retains all dated examples used by
  quantity pricing; the client still validates products, quantities and prices.
- Both functions are `SECURITY INVOKER`, obey table RLS and disallow anonymous
  execution. A missing migration falls back to the existing complete readers;
  other errors propagate rather than replacing evidence with zero.

Single-store calculations scope payment and supplier reads to that store. Order
reads select capture proof and source timestamp rather than the full raw JSON.
The scheduled sync still runs every 15 minutes, but calculates recent account
totals once after all sources finish. Historical corrections and failed rollup
retries remain enabled. Open, visible tabs refresh every five minutes; manual
refresh remains immediate and failures retry after 30 seconds.

Validation on 16 October 2026, read-only Anna rollup for four Lisbon days:
1,735,242 response bytes with the previous full-history readers versus 563,281
with the scoped readers (67.5% fewer). The generated daily metric rows had the
same SHA-256 digest. This measures decoded database responses for one operation,
not the billing meter or a guarantee about total monthly usage.

Apply the migration and publish the matching app build. Push alone is insufficient
when Netlify production is locked. Already consumed bandwidth is not refunded.
Check the organization usage page after publication; its meter updates hourly.

Regression coverage: `node --test tests/egress.test.cjs`, `npm run test:financial`,
`npm run test:refresh`. No financial records are deleted to reduce bandwidth.
