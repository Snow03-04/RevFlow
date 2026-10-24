process.env.NEXT_PUBLIC_SUPABASE_URL='https://test.invalid';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='test-only';
require('../scripts/register-ts.cjs');
const test=require('node:test');
const assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {readFileSync}=require('node:fs');
const {projectPnlDays}=require('../src/lib/trackers/pnl-projection.ts');
const {calcPnlDay,summariseMonth}=require('../src/lib/trackers/pnl.ts');
const {buildLifetimeReport}=require('../src/lib/trackers/lifetime.ts');
const {buildParticipationReport}=require('../src/lib/dashboard/report.ts');
const {allocateMetaPnl,summariseMetaPnl}=require('../src/lib/trackers/meta-pnl.ts');
const {sumMetaSummaries}=require('../src/lib/trackers/meta-presentation.ts');
const {buildGeneralCollections,summariseGeneralSheet}=require('../src/lib/trackers/general-sheet.ts');
const {buildGoogleCollections,summariseCollection}=require('../src/lib/trackers/google-collections.ts');
const {allocateGooglePnl,summariseGooglePnl}=require('../src/lib/trackers/google-pnl.ts');
const fees=()=>({feeFb:0,feeGoogle:0,txFee:0,paymentPct:0});
const date='2026-10-23';
const metric={date,shopify_connection_id:'s',gross_revenue:100,shipping_revenue:0,revenue:100,refunds:0,
  product_cost:42,eu_order_fees:2,payment_fees:0,payment_adjustment:0,ad_spend_meta:10,ad_spend_google:0,ad_spend:10,
  orders_count:1,units_sold:2,shipping_cost:0,profit:48,ad_clicks:1,roas:10};
const order={id:'o',storeId:'s',date,collectionHandle:'shirts',landingSite:'/?utm_campaign=campaign',grossRevenue:100,refunds:0,
  cost:42,euOrderFee:2,sheetCost:true,paymentFees:0,items:[
    {productId:'a',units:1,revenue:70,weight:70,cost:31.5,euOrderFee:1.5},
    {productId:'b',units:1,revenue:30,weight:30,cost:10.5,euOrderFee:0.5}]};

test('additive migration is repeatable and preserves existing stored costs and profit',async()=>{
  const db=new PGlite();
  try {
    await db.exec('create table daily_metrics(product_cost numeric,profit numeric);create table pnl_days(cogs numeric);insert into daily_metrics values(42,48);insert into pnl_days values(42);');
    const sql=readFileSync('supabase/migrations/0048_eu_fee_breakdown.sql','utf8');
    await db.exec(sql);await db.exec(sql);
    assert.deepEqual((await db.query('select * from daily_metrics')).rows,[{product_cost:'42',profit:'48',eu_order_fees:'0.00'}]);
    assert.equal((await db.query('select * from pnl_days')).rows[0].cogs,'42');
  }finally{await db.close();}
});

test('FX projection, daily and monthly COG Impact exclude fees without changing profit',()=>{
  const [p]=projectPnlDays([metric],new Map([['s',2]]));
  assert.equal(p.cogs,84);assert.equal(p.eu_order_fees,4);
  const input={grossRevenue:p.gross_revenue,refunds:p.refunds,cogs:p.cogs,euOrderFees:p.eu_order_fees,adspendFb:p.adspend_fb,adspendGoogle:0,orders:1};
  const day=calcPnlDay(input,fees());
  assert.equal(day.profit,96);assert.equal(day.cogImpactPct,0.4);
  const month=summariseMonth(10,[input],fees());
  assert.equal(month.cogs,80);assert.equal(month.euOrderFees,4);assert.equal(month.profit,96);assert.equal(month.cogImpactPct,0.4);
  assert.equal(calcPnlDay({...input,grossRevenue:0},fees()).cogImpactPct,null);
});

test('participations scale fees like other expenses; whole-business COGS remain pure',()=>{
  const range={from:date,to:date};
  const report=buildParticipationReport({rows:[metric],estimates:[],rates:new Map([['s',2]]),percentages:new Map([['s',50]]),current:range,previous:range,chart:range});
  assert.equal(report.totalCurrent.productCost,80);assert.equal(report.totalCurrent.euOrderFees,4);
  assert.equal(report.comparison.current.productCost,40);assert.equal(report.comparison.current.euOrderFees,2);
  assert.equal(report.comparison.current.profit,48);
});

test('lifetime total separates product costs and fees, preserving historical profit',()=>{
  const report=buildLifetimeReport({stores:[{id:'s',shop_name:'Shop',shop_domain:'test.invalid'}],histories:new Map(),metrics:[metric],rates:new Map([['s',2]]),feesForDate:fees,today:date});
  assert.equal(report.total.cogs,80);assert.equal(report.total.euOrderFees,4);assert.equal(report.total.profit,96);
});

test('mixed baskets split fees by the same cost allocation, across Meta campaigns and grouped summaries',()=>{
  const campaigns=['a','b'].map(p=>({key:p,name:p,date,storeId:'s',target:{productId:p,via:'link'},rate:1,spend:5,purchases:1,purchaseValue:50}));
  const rows=allocateMetaPnl(campaigns,[order],new Map());
  const summaries=rows.map(r=>summariseMetaPnl([r],fees));
  assert.equal(rows[0].input.euOrderFees,1.5);assert.equal(rows[1].input.euOrderFees,0.5);
  const total=sumMetaSummaries(summaries);
  assert.equal(total.sheetCogs,40);assert.equal(total.input.euOrderFees,2);assert.equal(total.cogsImpact,0.4);assert.equal(total.profit,48);
});

test('general and Google collection COGS exclude the same fee; break-even still includes it',()=>{
  const definitions=[{key:'s:shirts',storeId:'s',handle:'shirts',name:'Shirts',storeName:'Shop',productIds:['a','b'],rate:1,
    campaigns:[{key:'c',platform:'meta',storeId:'s',collectionHandle:'shirts',active:true}]}];
  const [collection]=buildGeneralCollections(definitions,[{key:'c',platform:'meta',date,spend:10}],[order],{from:date,to:date});
  const general=summariseGeneralSheet(collection.days,true,fees);
  assert.equal(general.cogs,40);assert.equal(general.euOrderFees,2);assert.equal(general.profit,48);assert.equal(general.breakEven,100/58);
  const campaign={key:'c',name:'campaign',campaignId:'1',storeId:'s',collectionHandle:'shirts',rate:1};
  const fact={key:'c',date,spend:10,grossSpend:10,clicks:1,impressions:10,conversions:1,conversionValue:100};
  const campaignSummary=summariseGooglePnl(allocateGooglePnl([campaign],[fact],[order]),fees);
  assert.equal(campaignSummary.input.euOrderFees,2);assert.equal(campaignSummary.input.cogs,42);assert.equal(campaignSummary.profit,48);
  const [google]=buildGoogleCollections([campaign],[fact],[order],[{id:'s',name:'Shop',rate:1}],[],new Map([['s:shirts',['a','b']]]));
  const summary=summariseCollection(google.days);
  assert.equal(summary.cogs,40);assert.equal(summary.euOrderFees,2);assert.equal(summary.cogsPct,0.4);assert.equal(summary.profit,48);assert.equal(summary.breakEven,100/58);
});
