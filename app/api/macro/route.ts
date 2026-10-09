import { NextResponse } from "next/server";

type UnknownRow=Record<string,unknown>;
type MarketRow={symbol:string;price:number|null;change7d:number|null;change30d:number|null;spot24h:number|null;spot4h:number|null;perp24h:number|null;perp4h:number|null;openInterest:number|null;funding8h:number|null;takerBuy24h:number|null;takerBuy4h:number|null;source:string};

const COINS=[
  {symbol:"BTC",id:"bitcoin",binance:"BTCUSDT"},{symbol:"ETH",id:"ethereum",binance:"ETHUSDT"},{symbol:"SOL",id:"solana",binance:"SOLUSDT"},
  {symbol:"HYPE",id:"hyperliquid",binance:"HYPEUSDT"},{symbol:"UNI",id:"uniswap",binance:"UNIUSDT"},{symbol:"ZEC",id:"zcash",binance:"ZECUSDT"},
] as const;

async function json(url:string,options:RequestInit={}){
  const response=await fetch(url,{cache:"no-store",headers:{accept:"application/json",...(options.headers||{})},signal:AbortSignal.timeout(9_000),...options});
  if(!response.ok)throw new Error(`${response.status} ${url}`);
  return response.json();
}
const number=(value:unknown)=>{const parsed=Number(value);return Number.isFinite(parsed)?parsed:null};
const sum=(rows:unknown[],index:number)=>rows.reduce((total,row)=>total+(Array.isArray(row)?Number(row[index])||0:0),0);

async function stablecoins(){
  const rows=await json("https://stablecoins.llama.fi/stablecoincharts/all") as UnknownRow[];
  const normalized=(Array.isArray(rows)?rows:[]).map(row=>({date:Number(row.date)*1000,value:number((row.totalCirculatingUSD as UnknownRow)?.peggedUSD??row.totalCirculatingUSD)})).filter(row=>row.date&&row.value!=null) as Array<{date:number;value:number}>;
  const last=normalized.at(-1),at=(days:number)=>normalized.findLast(row=>row.date<=(last?.date??0)-days*86_400_000)??normalized.at(Math.max(0,normalized.length-days-1));
  if(!last)throw new Error("Stablecoin history unavailable");
  const change=(days:number)=>{const prior=at(days);return prior&&prior.value>0?(last.value/prior.value-1)*100:null};
  return {marketCap:last.value,change7d:change(7),change30d:change(30),updatedAt:new Date(last.date).toISOString(),source:"DeFiLlama"};
}

async function priceHistory(){
  const ids=COINS.map(coin=>coin.id).join(","),headers:Record<string,string>={accept:"application/json"};
  if(process.env.COINGECKO_API_KEY)headers["x-cg-demo-api-key"]=process.env.COINGECKO_API_KEY;
  const current=await json(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&price_change_percentage=7d,30d`,{headers}) as UnknownRow[];
  return new Map((Array.isArray(current)?current:[]).map(row=>[String(row.id),{price:number(row.current_price),change7d:number(row.price_change_percentage_7d_in_currency),change30d:number(row.price_change_percentage_30d_in_currency)}]));
}

async function binanceMarket(symbol:string){
  const base="https://api.binance.com/api/v3",futures="https://fapi.binance.com/fapi/v1";
  const [spotTicker,spotKlines,dailyKlines,perpTicker,perpKlines,oi,premium]=await Promise.allSettled([
    json(`${base}/ticker/24hr?symbol=${symbol}`),json(`${base}/klines?symbol=${symbol}&interval=4h&limit=6`),json(`${base}/klines?symbol=${symbol}&interval=1d&limit=31`),json(`${futures}/ticker/24hr?symbol=${symbol}`),json(`${futures}/klines?symbol=${symbol}&interval=4h&limit=6`),json(`${futures}/openInterest?symbol=${symbol}`),json(`${futures}/premiumIndex?symbol=${symbol}`),
  ]);
  const s=spotTicker.status==="fulfilled"?spotTicker.value as UnknownRow:null,sk=spotKlines.status==="fulfilled"?spotKlines.value as unknown[]:[],dk=dailyKlines.status==="fulfilled"?dailyKlines.value as unknown[][]:[],p=perpTicker.status==="fulfilled"?perpTicker.value as UnknownRow:null,pk=perpKlines.status==="fulfilled"?perpKlines.value as unknown[]:[],o=oi.status==="fulfilled"?oi.value as UnknownRow:null,f=premium.status==="fulfilled"?premium.value as UnknownRow:null;
  const spot24=number(s?.quoteVolume),perp24=number(p?.quoteVolume),mark=number(f?.markPrice);
  const takerQuote=sum(pk,10),perpQuote=sum(pk,7);
  const lastClose=number(dk.at(-1)?.[4])??number(s?.lastPrice),close7=number(dk.at(-8)?.[4]),close30=number(dk.at(-31)?.[4]),change=(prior:number|null)=>lastClose!=null&&prior!=null&&prior>0?(lastClose/prior-1)*100:null;
  return {price:lastClose,change7d:change(close7),change30d:change(close30),spot24h:spot24,spot4h:sum(sk.slice(-1),7)||null,perp24h:perp24,perp4h:sum(pk.slice(-1),7)||null,openInterest:o&&mark!=null?(number(o.openInterest)??0)*mark:null,funding8h:f?number(f.lastFundingRate)!=null?number(f.lastFundingRate)!*100:null:null,takerBuy24h:perpQuote>0?takerQuote/perpQuote*100:null,takerBuy4h:sum(pk.slice(-1),7)>0?sum(pk.slice(-1),10)/sum(pk.slice(-1),7)*100:null,available:!!(s||p)};
}

async function hyperliquid(){
  const request=(body:UnknownRow)=>json("https://api.hyperliquid.xyz/info",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
  const [payload,candles]=await Promise.all([
    request({type:"metaAndAssetCtxs"}) as Promise<[UnknownRow,{name:string}[]]>,
    request({type:"candleSnapshot",req:{coin:"HYPE",interval:"1d",startTime:Date.now()-35*86_400_000,endTime:Date.now()}}).catch(()=>[]) as Promise<UnknownRow[]>,
  ]);
  const universe=(payload?.[0] as UnknownRow)?.universe as Array<{name:string}>??[],contexts=payload?.[1] as UnknownRow[]??[];
  const byCoin=new Map<string,UnknownRow>();
  universe.forEach((coin,index)=>byCoin.set(coin.name,contexts[index]??{}));
  const all=contexts.reduce((total,row)=>total+(number(row.openInterest)??0)*(number(row.markPx)??0),0);
  const closes=(Array.isArray(candles)?candles:[]).map(row=>number(row.c)).filter((value):value is number=>value!=null),last=closes.at(-1)??null,change=(days:number)=>last!=null&&closes.length>days&&closes.at(-1-days)!>0?(last/closes.at(-1-days)!-1)*100:null;
  return {byCoin,totalOpenInterest:all,hypeTrend:{change7d:change(7),change30d:change(30)}};
}

const strip=(html:string)=>html.replace(/<[^>]+>/g," ").replace(/&nbsp;|&#160;/g," ").replace(/&amp;/g,"&").replace(/\s+/g," ").trim();
const flowNumber=(text:string)=>{const clean=text.replace(/[$,]/g,"").trim();if(!clean||clean==="-"||clean==="—")return null;const value=Number(clean.replace(/[()]/g,""));return Number.isFinite(value)?(clean.includes("(")?-value:value):null};
async function etfTable(url:string,label:string){
  const response=await fetch(url,{cache:"no-store",signal:AbortSignal.timeout(9_000),headers:{"user-agent":"Mozilla/5.0 TokenLens/1.0"}});if(!response.ok)throw new Error(`${label} ETF unavailable`);const html=await response.text();
  const rows=[...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(match=>[...match[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(cell=>strip(cell[1]))).filter(cells=>cells.length>=3&&/\d{1,2}\s+[A-Za-z]{3}\s+\d{4}|\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}/.test(cells[0]));
  const parsed=rows.map(cells=>{const values=cells.slice(1).map(flowNumber),total=values.at(-1)??null,issuers=values.slice(0,-1).filter((value):value is number=>value!=null);return {date:cells[0],total,positive:issuers.filter(value=>value>0).length,active:issuers.filter(value=>value!==0).length,reported:issuers.length}}).filter(row=>row.total!=null);
  const latest=parsed.at(-1);if(!latest)throw new Error(`${label} ETF parse failed`);return {asset:label,...latest,flow5d:parsed.slice(-5).reduce((total,row)=>total+(row.total??0),0)};
}

async function defillamaOpenInterest(){
  const payload=await json("https://api.llama.fi/overview/open-interest") as UnknownRow,chart=payload.totalDataChart as Array<[number,number]>??[],last=chart.at(-1);return last?Number(last[1]):null;
}

export async function GET(){
  const [stableResult,priceResult,hyperResult,globalOiResult,btcEtfResult,ethEtfResult,markets]=await Promise.all([
    stablecoins().catch(()=>null),priceHistory().catch(()=>new Map()),hyperliquid().catch(()=>null),defillamaOpenInterest().catch(()=>null),etfTable("https://farside.co.uk/bitcoin-etf-flow-all-data/","BTC").catch(()=>null),etfTable("https://farside.co.uk/ethereum-etf-flow-all-data/","ETH").catch(()=>null),Promise.all(COINS.map(coin=>binanceMarket(coin.binance).catch(()=>null))),
  ]);
  const priceMap=priceResult as Map<string,{price:number|null;change7d:number|null;change30d:number|null}>;
  const assets:MarketRow[]=COINS.map((coin,index)=>{
    const price=priceMap.get(coin.id),binance=markets[index],hl=hyperResult?.byCoin.get(coin.symbol),hlMark=number(hl?.markPx),hlOi=hl&&hlMark!=null?(number(hl.openInterest)??0)*hlMark:null;
    return {symbol:coin.symbol,price:price?.price??binance?.price??hlMark,change7d:price?.change7d??binance?.change7d??(coin.symbol==="HYPE"?hyperResult?.hypeTrend.change7d:null)??null,change30d:price?.change30d??binance?.change30d??(coin.symbol==="HYPE"?hyperResult?.hypeTrend.change30d:null)??null,spot24h:binance?.spot24h??null,spot4h:binance?.spot4h??null,perp24h:binance?.perp24h??number(hl?.dayNtlVlm),perp4h:binance?.perp4h??null,openInterest:binance?.openInterest??hlOi,funding8h:binance?.funding8h??(number(hl?.funding)!=null?number(hl?.funding)!*8*100:null),takerBuy24h:binance?.takerBuy24h??null,takerBuy4h:binance?.takerBuy4h??null,source:binance?.available?"Binance":"Hyperliquid"};
  });
  const failedSources=[!stableResult&&"DeFiLlama 稳定币",priceMap.size<COINS.length&&"CoinGecko 价格",!hyperResult&&"Hyperliquid",!globalOiResult&&"DeFiLlama OI",!btcEtfResult&&"BTC ETF",!ethEtfResult&&"ETH ETF"].filter(Boolean);
  return NextResponse.json({stablecoins:stableResult,assets,derivatives:{globalOpenInterest:globalOiResult,hyperliquidOpenInterest:hyperResult?.totalOpenInterest??null},etf:[btcEtfResult,ethEtfResult].filter(Boolean),failedSources,updatedAt:new Date().toISOString()},{headers:{"Cache-Control":"public, max-age=30, s-maxage=30, stale-while-revalidate=120"}});
}
