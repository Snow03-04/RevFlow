process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.invalid';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-only';
require('../scripts/register-ts.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { memoryDb } = require('./helpers/memory-db.cjs');
const { EU_COUNTRY_CODES, EU_ORDER_FEE_EUR, EU_ORDER_FEE_BEFORE_EUR, euOrderFee, sheetIncludedEuFee, configuredIncludedEuFee } = require('../src/lib/cogs/eu-order-fee.ts');
const { buildOrderCostConfig, costOrder, allocateOrderCost } = require('../src/lib/cogs/order-cost.ts');
const { recomputeDailyMetrics, summarize } = require('../src/lib/metrics.ts');
const { calcPnlDay, summariseMonth } = require('../src/lib/trackers/pnl.ts');
const { allocateMetaPnl, summariseMetaPnl } = require('../src/lib/trackers/meta-pnl.ts');
const { projectPnlMonth } = require('../src/lib/trackers/pnl-import.ts');
const { projectRoasMonth } = require('../src/lib/trackers/roas-import.ts');
const { fetchTrackerOrderSales } = require('../src/lib/trackers/sales.ts');
const { getProductPerformance } = require('../src/lib/queries.ts');
const { loadCogsAudit } = require('../src/lib/cogs/audit.ts');
const { ymdInTz } = require('../src/lib/date.ts');

test('EU fee is EUR 3 before 23 October and EUR 5 from it, in all 27 member states and never other destinations', () => {
  assert.equal(EU_ORDER_FEE_EUR, 5);
  assert.equal(EU_ORDER_FEE_BEFORE_EUR, 3);
  assert.equal(EU_COUNTRY_CODES.size, 27);
  for (const country of EU_COUNTRY_CODES) {
    assert.equal(euOrderFee('2025-01-01', country, 2), 6);
    assert.equal(euOrderFee('2026-10-22', country, 2), 6);
    assert.equal(euOrderFee('2026-10-23', country, 2), 10);
    assert.equal(euOrderFee('2026-10-24', country, 2), 10);
  }
  for (const country of ['GB','UK','CH','NO','US','CA','TR',null,'']) {
    assert.equal(euOrderFee('2026-10-23',country,2),0); assert.equal(euOrderFee('2026-10-22',country,2),0);
  }
  assert.equal(euOrderFee('2026-10-23',' ro ',2),10);
  assert.equal(euOrderFee('2026-10-23','RO',0),0); assert.equal(euOrderFee('2026-10-22','RO',0),0);
  assert.throws(()=>euOrderFee('2026-10-23','RO',-1));
  assert.equal(euOrderFee(ymdInTz(new Date('2026-10-22T21:59:59Z'),'Europe/Budapest'),'HU',2),6);
  assert.equal(euOrderFee(ymdInTz(new Date('2026-10-22T22:00:00Z'),'Europe/Budapest'),'HU',2),10);
});

function config() {
  return { ...buildOrderCostConfig({productCosts:[],tiers:[],collections:[],collectionProducts:[],collectionTiers:[]},
    {storeToDisplay:1,fallbackCostPct:30,costByVariant:new Map()}), destinationCountry:'IT',euOrderFeeRate:1 };
}
const item = (id, qty=1) => ({shopify_product_id:id,shopify_variant_id:id,quantity:qty,current_quantity:qty,price:30,unit_cost:10});
test('one order fee survives supplier overrides and refunds without adding units or changing supplier prices', () => {
  const items=[item('a',2),item('b',3)];
  const priced=costOrder(items,'2026-10-23',{...config(),supplierCost:{cost:40,currency:null}});
  assert.equal(priced.cost,40); assert.equal(priced.euOrderFee,5); assert.equal(priced.computedCost,50); assert.equal(priced.units,5);
  assert.deepEqual(priced.lines.filter(l=>l.source==='eu_order_fee').map(l=>l.lineCost),[5]);
  assert.equal(allocateOrderCost(items,priced).reduce((s,n)=>s+n,0),40);
  const zero=costOrder(items,'2026-10-23',{...config(),supplierCost:{cost:0,currency:null}});
  assert.equal(zero.cost,0); assert.equal(zero.euOrderFee,undefined);
  const refunded=items.map(i=>({...i,current_quantity:0}));
  const refundPrice=costOrder(refunded,'2026-10-23',{...config(),supplierCost:{cost:40,currency:null}});
  assert.equal(refundPrice.cost,40);assert.equal(refundPrice.units,0);
  assert.equal(allocateOrderCost(refunded,refundPrice).reduce((s,n)=>s+n,0),40);
  const earlier=costOrder(items,'2026-10-22',config());
  // Configured prices already carried the EUR 3 charged before 23 October.
  assert.equal(earlier.euOrderFee,3); assert.equal(earlier.cost,50);
});

test('a sheet total already includes the EU fee: 20 EUR is 15 merchandise + 5 fee, never 25', () => {
  const items=[item('a')];
  const sheet=costOrder(items,'2026-10-23',{...config(),supplierCost:{cost:20,currency:null}});
  assert.equal(sheet.source,'sheet'); assert.equal(sheet.cost,20); assert.equal(sheet.euOrderFee,5);
  assert.equal(sheet.cost-sheet.euOrderFee,15);
  const estimated=costOrder(items,'2026-10-23',config());
  // A configured price (here the order line's unit cost) was copied from a
  // supplier total that already had EUR 3: only the EUR 2 increase is added.
  assert.equal(estimated.source,'computed'); assert.equal(estimated.cost,12); assert.equal(estimated.euOrderFee,5);
  assert.equal(estimated.lines.reduce((s,l)=>s+l.lineCost,0),12);
  for (const cfg of [{...config(),destinationCountry:'CH'},{...config(),euOrderFeeRate:0}]) {
    const outside=costOrder(items,'2026-10-23',{...cfg,supplierCost:{cost:20,currency:null}});
    assert.equal(outside.cost,20); assert.equal(outside.euOrderFee,undefined);
  }
  // Before 23 October the supplier's totals already carried EUR 3 of the fee.
  const before=costOrder(items,'2026-10-22',{...config(),supplierCost:{cost:20,currency:null}});
  assert.equal(before.cost,20); assert.equal(before.euOrderFee,3);
  const estimatedBefore=costOrder(items,'2026-10-22',config());
  assert.equal(estimatedBefore.cost,10); assert.equal(estimatedBefore.euOrderFee,3);
  const small=costOrder(items,'2026-10-23',{...config(),supplierCost:{cost:3,currency:null}});
  assert.equal(small.cost,3); assert.equal(small.euOrderFee,3);
  assert.equal(configuredIncludedEuFee(13,1),3); assert.equal(configuredIncludedEuFee(2,1),2); assert.equal(configuredIncludedEuFee(13,0),0);
  assert.equal(sheetIncludedEuFee(20,5),5); assert.equal(sheetIncludedEuFee(3,5),3); assert.equal(sheetIncludedEuFee(-1,5),0);
});

test('learned supplier prices get the whole fee, configured prices only what they did not already carry', () => {
  const learned={...config(),manualCostFor:()=>15,manualCostSourceFor:()=>'sheet'};
  const quote=costOrder([item('a')],'2026-10-23',learned);
  assert.equal(quote.lines[0].source,'supplier_quote'); assert.equal(quote.cost,20); assert.equal(quote.euOrderFee,5);
  assert.equal(costOrder([item('a')],'2026-10-22',learned).cost,18);
  const manual={...config(),manualCostFor:()=>13,manualCostSourceFor:()=>'manual'};
  const priced=costOrder([item('a')],'2026-10-23',manual);
  assert.equal(priced.cost,15); assert.equal(priced.euOrderFee,5); assert.equal(priced.cost-priced.euOrderFee,10);
  assert.equal(priced.lines.find(l=>l.source==='manual').lineCost,10);
  assert.match(priced.lines.find(l=>l.source==='eu_order_fee').title,/3 € já no preço configurado/);
  assert.equal(costOrder([item('a')],'2026-10-22',manual).cost,13);
  // Once per order, shared across configured lines, never per line.
  const two=costOrder([item('a'),item('b')],'2026-10-23',manual);
  assert.equal(two.cost,26-3+5); assert.equal(allocateOrderCost([item('a'),item('b')],two).reduce((s,n)=>s+n,0),28);
  // Outside the EU or with the fee off, configured prices are untouched.
  assert.equal(costOrder([item('a')],'2026-10-23',{...manual,destinationCountry:'CH'}).cost,13);
  assert.equal(costOrder([item('a')],'2026-10-23',{...manual,euOrderFeeRate:0}).cost,13);
});

function fixture() {
  const order={id:'o',user_id:'u',shopify_connection_id:'s',shopify_order_id:'1',order_number:'#1',
    processed_at:'2026-10-23T12:00:00Z',currency:'EUR',country:'IT',test:false,cancelled_at:null,financial_status:'paid',
    landing_site:null,subtotal_price:60,total_price:60,total_shipping:0,total_refunded:0,total_discounts:0};
  return {
    settings:[{user_id:'u',currency:'EUR',timezone:'UTC',fx_rate_override:null,default_product_cost_pct:30,payment_fee_pct:0,payment_fee_fixed:0,default_shipping_cost:0}],
    shopify_connections:[{id:'s',user_id:'u',shop_name:'EU store',shop_domain:'test.invalid',reporting_base_currency:'EUR',eu_order_fee_enabled:true}],
    meta_connections:[{id:'meta',user_id:'u',shopify_connection_id:'s'}],
    products:[{id:'p1',user_id:'u',shopify_connection_id:'s',shopify_product_id:'p',shopify_variant_id:'v',title:'Shirt',handle:'shirt',price:30,cost:12}],
    orders:[order], order_line_items:[{id:'l',user_id:'u',order_id:'o',...item('p',2),shopify_variant_id:'v',total_discount:0,title:'Shirt'}],
    order_supplier_costs:[{user_id:'u',shopify_connection_id:'s',order_number:'1',cost:18,currency:'EUR',paid:false}],
    campaign_links:[{id:'cl',user_id:'u',campaign_id:'a',product_handle:'shirt'}],
    campaigns:[{id:'a',user_id:'u',meta_connection_id:'meta',campaign_id:'a',campaign_name:'Shirt',date:'2026-10-23',spend:10,clicks:10,purchases:1,purchase_value:60,atc:2}],
    pnl_settings:[{user_id:'u',currency:'€',payment_fee_pct:0,transaction_fee:0}],roas_settings:[{user_id:'u',currency:'€'}],
  };
}
const range={from:'2026-10-23',to:'2026-10-23'};
test('dashboard, P&L, ROAS, product margins and audit read the EUR 5 fee inside the sheet total and never add it',async()=>{
  const db=memoryDb(fixture(),{projectColumns:true});
  const suppliers=structuredClone(db.tables.order_supplier_costs);
  for(const enabled of [true,true,false]) {
    db.tables.shopify_connections[0].eu_order_fee_enabled=enabled;
    const expected=18, merchandise=enabled?13:18, fee=enabled?5:0;
    await recomputeDailyMetrics(db,'u',range);
    assert.equal(db.tables.daily_metrics[0].product_cost,expected);
    assert.equal(db.tables.daily_metrics[0].eu_order_fees,fee);
    const summary=summarize(db.tables.daily_metrics);
    assert.equal(summary.productCost,merchandise);
    assert.equal(summary.euOrderFees,fee);
    assert.equal(db.tables.daily_metrics[0].profit,50-expected);
    await projectPnlMonth(db,'u',2026,10);
    assert.equal(db.tables.pnl_days[0].cogs,expected);
    assert.equal(db.tables.pnl_days[0].eu_order_fees,fee);
    await projectRoasMonth(db,'u',2026,10);
    assert.equal(db.tables.roas_entries.reduce((s,r)=>s+r.cog*r.units_sold,0),expected);
    const tracker=await fetchTrackerOrderSales(db,'u',range,'UTC','all');
    assert.equal(tracker[0].cost,expected);
    assert.equal(tracker[0].euOrderFee,fee);
    assert.equal(tracker[0].items.reduce((s,i)=>s+i.euOrderFee,0),fee);
    const campaign={key:'c',date:range.from,name:'Shirt',storeId:'s',target:{productId:'p',via:'link'},rate:1,spend:10,purchases:1,purchaseValue:60};
    const meta=summariseMetaPnl(allocateMetaPnl([campaign],tracker),()=>({feeFb:0,feeGoogle:0,txFee:0,paymentPct:0}));
    assert.equal(meta.cogsImpact,merchandise/60);
    assert.equal(meta.sheetCogs,merchandise);
    assert.equal(meta.input.euOrderFees,fee);
    assert.equal(meta.profit,50-expected);
    const products=await getProductPerformance(db,'u',range,'profit','UTC');
    assert.equal(products.reduce((s,p)=>s+p.cost,0),merchandise);
    assert.equal(products.reduce((s,p)=>s+(p.euOrderFees??0),0),fee);
    assert.equal(products.reduce((s,p)=>s+p.profit,0),60-expected);
    const audit=await loadCogsAudit(db,'u',range,'s');
    assert.equal(audit.totalCost,expected); assert.equal(audit.reconciles,true);
    assert.equal(audit.orders[0].euOrderFee,fee);
    assert.deepEqual(db.tables.order_supplier_costs,suppliers);
  }
});

test('store and user isolation, exclusions, local date and EUR conversion hold under projected database reads',async()=>{
  const data=fixture();
  data.settings[0].timezone='Europe/Budapest';
  data.settings[0].fx_override_currency='HUF';data.settings[0].fx_rate_override=354;
  data.shopify_connections[0].reporting_base_currency='HUF';
  data.shopify_connections.push({...data.shopify_connections[0],id:'disabled',reporting_base_currency:'EUR',eu_order_fee_enabled:false});
  data.shopify_connections.push({...data.shopify_connections[0],id:'foreign',user_id:'other',reporting_base_currency:'EUR'});
  data.products=[];data.campaigns=[];data.order_supplier_costs=[];
  const base={...data.orders[0],subtotal_price:100,total_price:100};
  const rows=[
    {...base,id:'start',processed_at:'2026-10-22T22:00:00Z'},
    {...base,id:'before',processed_at:'2026-10-22T21:59:59Z'},
    {...base,id:'canada',country:'CA'}, {...base,id:'unknown',country:null},
    {...base,id:'test',test:true}, {...base,id:'cancelled',cancelled_at:'2026-10-23T12:30:00Z'},
    {...base,id:'unpaid',financial_status:'pending'},
    {...base,id:'disabled',shopify_connection_id:'disabled'},
    {...base,id:'foreign',user_id:'other',shopify_connection_id:'foreign'},
  ];
  data.orders=rows;
  data.order_line_items=rows.map(o=>({...data.order_line_items[0],id:o.id,user_id:o.user_id,order_id:o.id,quantity:1,current_quantity:1,unit_cost:0}));
  const db=memoryDb(data,{projectColumns:true});
  await recomputeDailyMetrics(db,'u',{from:'2026-10-22',to:'2026-10-23'});
  const store=db.tables.daily_metrics.filter(m=>m.shopify_connection_id==='s');
  assert.equal(store.find(m=>m.date==='2026-10-22').product_cost,1062);
  assert.equal(store.find(m=>m.date==='2026-10-22').eu_order_fees,1062);
  assert.equal(store.find(m=>m.date==='2026-10-23').product_cost,1770);
  assert.equal(store.find(m=>m.date==='2026-10-23').eu_order_fees,1770);
  await projectPnlMonth(db,'u',2026,10);
  const pnl=db.tables.pnl_days.find(d=>d.day===23);
  assert.equal(pnl.eu_order_fees,5);
  const input={grossRevenue:pnl.gross_revenue,refunds:pnl.refunds,cogs:pnl.cogs,euOrderFees:pnl.eu_order_fees,adspendFb:0,adspendGoogle:0,orders:pnl.orders};
  const fees={feeFb:0,feeGoogle:0,txFee:0,paymentPct:0};
  assert.equal(calcPnlDay(input,fees).cogImpactPct,0);
  assert.equal(calcPnlDay(input,fees).profit,calcPnlDay({...input,euOrderFees:0},fees).profit);
  assert.equal(summariseMonth(10,[input],fees).cogs,0);
  assert.equal(summariseMonth(10,[input],fees).euOrderFees,5);
  assert.equal(store.find(m=>m.date==='2026-10-23').orders_count,3);
  assert.equal(db.tables.daily_metrics.find(m=>m.shopify_connection_id==='disabled'&&m.date==='2026-10-23').product_cost,0);
  assert.ok(db.tables.daily_metrics.every(m=>m.user_id==='u'&&m.shopify_connection_id!=='foreign'));
});
