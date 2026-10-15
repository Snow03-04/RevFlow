# Google billed-cost reconciliation

`metrics.cost_micros` and Ads Scripts report served cost, not final billed cost.
Do not clamp historical spend to twice the **current** campaign budget: budget
changes, shared budgets, total budgets and pay-for-conversion campaigns have
different rules. The billed-cost report is the source used here.

Apply `supabase/migrations/0038_google_billing_reports.sql` before importing.
In Connections, select the store and its Google customer ID, then upload the
CSV exported from Reports → Billing → Billed cost, for all campaign budgets.
Keep the default Budget name / Day / Currency code / Served cost / Billed cost
columns. Portuguese and English comma-separated exports are supported.

The account/day snapshots survive hourly scripts. Recalculation derives a
virtual Google credit; it does not rewrite raw expenses, create revenue, or
double-deduct existing reconciled billing adjustments. Promotion-funded zero
remains zero. Dashboard rollups and P&L use the same corrected costs. The
dashboard's Overspend badge reports the confirmed served-versus-billed gap.

Billing can be newer than an hourly import, so its served baseline is included.
Activity beyond that baseline remains included until a newer billing report
confirms its billed cost. This is not a continuously available billed-cost API:
import a newer report to reconcile further overdelivery or billing revisions.
The UI explicitly identifies this limitation. Raw campaign gross cost remains
available for advertising performance analysis.

Interactive refresh publishes imported sales, metrics and P&L first, then
reconciles Shopify payments and final reports. A pending payment check is shown
separately and never advances the full-success timestamp. Automatic payment
checks reuse a successful ledger for at most two minutes; manual refresh always
checks it. Changed payment dates narrow recalculation; legacy interrupted jobs
without exact dates still repair the full affected month/history.
