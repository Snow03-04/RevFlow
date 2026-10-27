# EU fee breakdown

Apply `supabase/migrations/0048_eu_fee_breakdown.sql` and `supabase/migrations/0050_supplier_history_country.sql` before deploying this release. Until 0050 is applied, the supplier history falls back to a direct query that includes the order country.

The order fee is EUR 3 before local 2026-10-23 and EUR 5 from that day (the supplier raised it by EUR 2). It keeps its eligibility (EU-27 destination country), store setting and currency conversion, and applies to the whole history of an enabled store.

The supplier already charges the fee inside the sheet total of an eligible order. A sheet value is therefore never increased: its first EUR 5 (EUR 3 before 2026-10-23; converted, never above the total) is the EU fee and the rest is merchandise — a 20 EUR sheet value is 15 EUR merchandise + 5 EUR fee = 20 EUR, or 17 EUR + 3 EUR before 2026-10-23. Without a sheet value the fee of the order's day is added to the estimated merchandise cost. Unit, quantity and family prices learned from EU sheet totals subtract the fee of the sheet order's own day first, so estimated orders do not count it twice. The dashboard, P&L, campaign/collection finance, lifetime and product reports show merchandise COGS separately from EU fees. COGS Impact uses merchandise COGS / net revenue.

For compatibility during deployment, `daily_metrics.product_cost` and `pnl_days.cogs` still contain the combined product cost and EU fee. The new `eu_order_fees` column is a component of that existing total, never an extra expense to subtract. `MetricsSummary.productCost`, `MonthSummary.cogs` and displayed product costs exclude the component. Order-level `cost` and `PnlDayInput.cogs` retain the combined total so profit and break-even stay unchanged.

Normal syncs populate both columns together. Existing affected dates need a fee-component backfill from the same order-cost calculation, scoped to the intended user. Verify stored combined costs match before adding the component; preserve revenue, ad spend, profit and notes. Supplier payables remain the sheet totals, which include the fee charged by the supplier. Saving the store setting re-learns that store's sheet prices from its saved invoices (`relearnSupplierPrices`) and recomputes its whole history. After changing the fee amounts, do the same for each enabled store.

The legacy editable ROAS tracker retains its combined cost per unit for its margin calculations and explicitly labels it as including EU fees. Its financial sheets show the separate breakdown.

Validation: `npm run test:financial`, `npm run test:dashboard`, `npm run test:finance-platforms`, `npm run test:lifetime`, `npm run typecheck` and `npm run build`.
