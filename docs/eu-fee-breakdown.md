# EU fee breakdown

Apply `supabase/migrations/0048_eu_fee_breakdown.sql` before deploying this release.

The EUR 2 order fee keeps its existing eligibility, effective date, store setting and currency conversion. The dashboard, P&L, campaign/collection finance, lifetime and product reports show merchandise COGS separately from EU fees. COGS Impact uses merchandise COGS / net revenue.

For compatibility during deployment, `daily_metrics.product_cost` and `pnl_days.cogs` still contain the combined product cost and EU fee. The new `eu_order_fees` column is a component of that existing total, never an extra expense to subtract. `MetricsSummary.productCost`, `MonthSummary.cogs` and displayed product costs exclude the component. Order-level `cost` and `PnlDayInput.cogs` retain the combined total so profit and break-even stay unchanged.

Normal syncs populate both columns together. Existing affected dates need a fee-component backfill from the same order-cost calculation, scoped to the intended user. Verify stored combined costs match before adding the component; preserve revenue, ad spend, profit and notes. Days before the fee's effective date retain zero. Supplier costs and payables exclude the fee as before.

The legacy editable ROAS tracker retains its combined cost per unit for its margin calculations and explicitly labels it as including EU fees. Its financial sheets show the separate breakdown.

Validation: `npm run test:financial`, `npm run test:dashboard`, `npm run test:finance-platforms`, `npm run test:lifetime`, `npm run typecheck` and `npm run build`.
