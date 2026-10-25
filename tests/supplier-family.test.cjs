process.env.NEXT_PUBLIC_SUPABASE_URL='https://test.invalid';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='test-only';
require('../scripts/register-ts.cjs');
const test=require('node:test'),assert=require('node:assert/strict');
const {buildFamilyQuotes}=require('../src/lib/supplier/family-quotes.ts');
const {buildQuantityQuotes}=require('../src/lib/supplier/quantity-quotes.ts');
const {buildOrderCostConfig,costOrder,allocateOrderCost}=require('../src/lib/cogs/order-cost.ts');
const {loadCostData}=require('../src/lib/cogs/data.ts');
const {memoryDb}=require('./helpers/memory-db.cjs');
const item=(pid,qty=1,extra={})=>({shopify_product_id:pid,shopify_variant_id:null,title:`Quilted laundry basket ${pid}`,quantity:qty,current_quantity:qty,price:45,unit_cost:null,...extra});
function fixture(extra=[],factor=1){
 const entries=[['1','01',[['a',1]],13],['2','02',[['b',1]],13],['3','03',[['c',1]],13],
  ['4','04',[['a',1],['b',1]],22],['5','05',[['b',2]],22],['6','06',[['a',2],['b',2],['c',2]],60],...extra];
 const orders=[],items=[],invoices=[];
 for(const [id,day,basket,cost,attrs={}]of entries){
  orders.push({id,shopify_connection_id:'s',order_number:id,processed_at:`2026-10-${day}T12:00:00Z`,financial_status:'paid',...attrs});
  items.push(...basket.map(([pid,qty])=>({...item(pid,qty),order_id:id})));
  invoices.push({shopify_connection_id:attrs.shopify_connection_id??'s',order_number:id,cost,currency:'EUR'});
 }
 const catalogue=['a','b','c','new1','new2','new3'].map(productId=>({productId,title:item(productId).title}));
 const options={storeId:'s',timezone:'UTC',toBase:n=>n*factor,catalogue};
 const family=buildFamilyQuotes(orders,items,invoices,options);
 const quantities=buildQuantityQuotes(orders,items,invoices,options);
 const cfg=buildOrderCostConfig({productCosts:[],tiers:[],collections:[],collectionProducts:[],collectionTiers:[]},
  {storeToDisplay:1/factor,currencyToBase:new Map([['EUR',factor]]),costByVariant:new Map(),fallbackCostPct:30});
 return {orders,items,invoices,catalogue,family,cfg:{...cfg,supplierFamilyGroupsFor:family,supplierBasketQuoteFor:quantities.basket,supplierProductQuoteFor:quantities.product,supplierUnitQuoteFor:quantities.unit}};
}
test('AfterSell lines and different designs share a dated family total, fee is once per order',()=>{
 const {cfg}=fixture();
 const basket=[item('new1'),item('new1'),item('new2',2),item('new3',2)];
 const result=costOrder(basket,'2026-10-25',{...cfg,destinationCountry:'HU',euOrderFeeBase:2});
 assert.equal(result.computedCost,60);assert.equal(result.cost,62);assert.equal(result.euOrderFee,2);
 assert.equal(result.units,6);assert.ok(result.lines.slice(0,-1).every(l=>l.source==='supplier_family'));
 assert.match(result.lines[0].note,/#6 \(6 unidades\)/);
 assert.ok(Math.abs(allocateOrderCost(basket,result).reduce((s,c)=>s+c,0)-62)<1e-9);
 assert.equal(costOrder([item('new1'),item('new2')],'2026-10-25',cfg).cost,22);
 assert.equal(costOrder([item('new1',7)],'2026-10-25',cfg).cost,73);
});
test('Specific supplier invoices and baskets win; known unit prices and explicit rules remain authoritative',()=>{
 const {cfg}=fixture([['7','07',[['a',2]],24]]);
 assert.equal(costOrder([item('a',2)],'2026-10-25',cfg).cost,24);
 assert.equal(costOrder([item('new1',6)],'2026-10-25',{...cfg,supplierCost:{cost:57,currency:'EUR'}}).cost,57);
 assert.equal(costOrder([item('new1')],'2026-10-25',cfg).cost,13);
 assert.equal(costOrder([item('new1')],'2026-10-25',{...cfg,manualCostFor:()=>15,manualCostSourceFor:()=> 'sheet'}).cost,15);
 assert.equal(costOrder([item('new1',2)],'2026-10-25',{...cfg,manualCostFor:()=>19}).cost,38);
 assert.equal(costOrder([item('new1',2)],'2026-10-25',{...cfg,productTiers:new Map([['new1',[{minQty:2,total:20}]]])}).cost,20);
 assert.equal(costOrder([item('new1',2)],'2026-10-25',{...cfg,supplierCost:{cost:0,currency:'EUR'}}).cost,0);
});
test('Unrelated items, weak name evidence, incompatible prices and future quotes cannot receive a group discount',()=>{
 const f=fixture();
 assert.equal(costOrder([item('new1',2)],'2026-10-03',f.cfg).cost,27);
 assert.equal(costOrder([item('unknown',2)],'2026-10-25',f.cfg).cost,27);
 assert.equal(costOrder([item('new1'),item('unknown')],'2026-10-25',f.cfg).cost,26.5);
 const options={storeId:'s',timezone:'UTC',toBase:n=>n,catalogue:f.catalogue};
 const weak=buildFamilyQuotes(f.orders.filter(o=>o.id!=='3'),f.items,f.invoices,options);
 assert.deepEqual(weak([item('new1',2)],'2026-10-25'),[]);
 const mixed=fixture([['7','07',[['c',1]],30]]);
 assert.deepEqual(mixed.family([item('new1',2)],'2026-10-25'),[]);
 const names=buildFamilyQuotes(f.orders,f.items,f.invoices,{...options,catalogue:f.catalogue.map(p=>({...p,title:p.productId+' baskets'}))});
 assert.deepEqual(names([item('new1',2)],'2026-10-25'),[]);
});
test('A manual unit price equal to supplier invoices does not block a known quantity discount',()=>{
 const {cfg}=fixture([['7','07',[['a',2]],18]]);
 const manual={...cfg,manualCostFor:()=>13,manualCostSourceFor:()=> 'manual'};
 assert.equal(costOrder([item('a',1),item('a',1)],'2026-10-25',manual).cost,18);
 assert.equal(costOrder([item('a')],'2026-10-25',manual).cost,13);
 assert.equal(costOrder([item('a',2)],'2026-10-25',{...manual,manualCostFor:()=>20}).cost,40);
});
test('Cancelled, edited, refunded and foreign orders do not teach discounts; converted group totals conserve currency',()=>{
 const f=fixture([['7','07',[['new1',6]],1,{financial_status:'pending'}],
  ['8','08',[['new1',6]],1,{total_refunded:1}],['9','09',[['new1',6]],1,{test:true}],
  ['10','10',[['new1',6]],1,{cancelled_at:'2026-10-10'}],['11','11',[['new1',6]],1,{shopify_connection_id:'other'}]],354);
 assert.equal(costOrder([item('new1',6)],'2026-10-25',f.cfg).cost,60*354);
 f.items.find(i=>i.order_id==='6').current_quantity=1;
 const family=buildFamilyQuotes(f.orders,f.items,f.invoices,{storeId:'s',timezone:'UTC',toBase:n=>n,catalogue:f.catalogue});
 assert.equal(family([item('new1',6)],'2026-10-25')[0].quote.quantity,2);
});
test('A single anomalous cheap group invoice is not propagated until repeated',()=>{
 const f=fixture([['7','07',[['a',1],['c',1]],1],['8','08',[['a',1],['c',1]],1]]);
 assert.equal(costOrder([item('new1',2)],'2026-10-07',f.cfg).cost,22);
 assert.equal(costOrder([item('new1',2)],'2026-10-08',f.cfg).cost,1);
});
test('Cost loader learns from order titles when a store has no synced product catalogue',async()=>{
 const f=fixture();
 const db=memoryDb({orders:f.orders.map(o=>({...o,user_id:'u',currency:'EUR'})),
  order_line_items:f.items.map(i=>({...i,user_id:'u'})),order_supplier_costs:f.invoices.map(i=>({...i,user_id:'u'})),
  shopify_connections:[{user_id:'u',id:'s',reporting_base_currency:'EUR',eu_order_fee_enabled:true}]});
 const data=await loadCostData(db,'u','s');
 const cfg=await data.forStore('s',[item('new1'),item('new2'),item('new3')],{currency:'EUR',timezone:'UTC',default_product_cost_pct:30});
 assert.equal(costOrder([item('new1',6)],'2026-10-25',cfg).cost,60);
 assert.equal(db.writes.length,0);
});

test('Daily metrics and per-order audit agree for new designs, independent of report range',async()=>{
 const {recomputeDailyMetrics}=require('../src/lib/metrics.ts');
 const {loadCogsAudit}=require('../src/lib/cogs/audit.ts');
 const f=fixture();
 const db=memoryDb({
  settings:[{user_id:'u',currency:'EUR',timezone:'UTC',fx_rate_override:null,default_product_cost_pct:30,payment_fee_pct:0,payment_fee_fixed:0,default_shipping_cost:0}],
  shopify_connections:[{user_id:'u',id:'s',shop_name:'Test',shop_domain:'test.invalid',reporting_base_currency:'EUR',eu_order_fee_enabled:true}],
  orders:[...f.orders,{id:'today',shopify_connection_id:'s',order_number:'25',processed_at:'2026-10-25T12:00:00Z',financial_status:'paid'}]
   .map(o=>({...o,user_id:'u',shopify_order_id:o.id,currency:'EUR',country:'HU',test:false,cancelled_at:null,subtotal_price:270,total_price:270,total_shipping:0,total_refunded:0,total_discounts:0})),
  order_line_items:[...f.items,{...item('new-design',6),order_id:'today'}].map((i,n)=>({...i,id:'line'+n,user_id:'u',total_discount:0})),
  order_supplier_costs:f.invoices.map(i=>({...i,user_id:'u'})),
 },{projectColumns:true});
 const day={from:'2026-10-25',to:'2026-10-25'};
 await recomputeDailyMetrics(db,'u',day);
 const row=db.tables.daily_metrics.find(r=>r.date===day.from);
 assert.equal(row.product_cost,62);assert.equal(row.eu_order_fees,2);assert.equal(row.profit,208);
 const audit=await loadCogsAudit(db,'u',day,'s');
 assert.equal(audit.totalCost,62);assert.equal(audit.reconciles,true);
 assert.equal(audit.orders[0].lines[0].source,'supplier_family');
 await recomputeDailyMetrics(db,'u',{from:'2026-10-01',to:day.to});
 assert.equal(db.tables.daily_metrics.find(r=>r.date===day.from).product_cost,62);
});
