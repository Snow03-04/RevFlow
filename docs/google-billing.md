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

For the same store/account/day, a script expense (including a confirmed zero)
replaces OAuth campaign costs, while other accounts remain additive. Legacy
store-wide expenses cannot be safely split into accounts. An account's OAuth
import must not suppress another account's unconfirmed-cost estimate.

A billing report also establishes a cost when no script expense or OAuth import
exists. Recalculation books the billed amount plus any later served activity,
once; the read-only estimate must not add it again. Missing CSV costs (`--`,
`—`, blank) are rejected rather than interpreted as a free advertising day.

The 2× rule is a billing limit for most **average daily** budgets, not a
multiplier for imported spend. On a day with budget edits, Google uses the
highest budget that day; total campaign budgets and pay-for-conversion campaigns
do not have the same daily cap. See [spending limits](https://support.google.com/google-ads/answer/10486637?hl=en)
and [budget changes](https://support.google.com/google-ads/answer/10487143?hl=en).
Never replace a missing billed-cost report with twice today's budget.

Validate reconciliation and daily profit with `npm run test:financial`.

Interactive refresh publishes imported sales, metrics and P&L first, then
reconciles Shopify payments and final reports. A pending payment check is shown
separately and never advances the full-success timestamp. Automatic payment
checks reuse a successful ledger for at most two minutes; manual refresh always
checks it. Changed payment dates narrow recalculation; legacy interrupted jobs
without exact dates still repair the full affected month/history.

## Suspended or inactive script accounts

Connections → Google Ads → Estado das contas Google Ads stores a private,
user-declared state for each store/customer pair. Suspended and inactive accounts
do not produce stale-script prompts. Restore Active when advertising resumes.
This is a monitoring preference, not a Google policy-status lookup; missing
imports never automatically mark an account suspended.

The preference does not alter imports, expenses, credits, estimates or profit.
Received costs awaiting billing confirmation still warn inside the selected
period. Active accounts sharing the store retain their own freshness checks.
Preferences are merged into separate Supabase user-metadata keys, like other
existing reporting preferences, so no schema migration is required.
