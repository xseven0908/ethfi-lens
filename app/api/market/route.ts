import { NextRequest, NextResponse } from "next/server";

const MAX_SUPPLY = 1_000_000_000;
const VERIFIED_CIRCULATING_SUPPLY = 973_468_000;

type Venue = { name:string; price:number; change24h:number; volume24h:number; high24h:number; low24h:number };
const median=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2};
async function json(url:string,timeout=6500){const response=await fetch(url,{cache:"no-store",headers:{accept:"application/json"},signal:AbortSignal.timeout(timeout)});if(!response.ok)throw new Error(`${response.status} ${url}`);return response.json()}

async function readBinance():Promise<Venue>{const ticker=await json("https://api.binance.com/api/v3/ticker/24hr?symbol=ETHFIUSDT");return {name:"Binance",price:Number(ticker.lastPrice),change24h:Number(ticker.priceChangePercent),volume24h:Number(ticker.quoteVolume),high24h:Number(ticker.highPrice),low24h:Number(ticker.lowPrice)}}
async function readBinanceChart(){const klines=await json("https://api.binance.com/api/v3/klines?symbol=ETHFIUSDT&interval=1d&limit=90");return klines.map((x:unknown[])=>[Number(x[0]),Number(x[4])] as [number,number])}
async function readOkx():Promise<Venue>{
  const payload=await json("https://www.okx.com/api/v5/market/ticker?instId=ETHFI-USDT"),ticker=payload.data?.[0];if(!ticker)throw new Error("OKX empty response");
  const price=Number(ticker.last),open=Number(ticker.open24h);return {name:"OKX",price,change24h:open?((price/open)-1)*100:0,volume24h:Number(ticker.volCcy24h),high24h:Number(ticker.high24h),low24h:Number(ticker.low24h)};
}
async function readBybit():Promise<Venue>{
  const payload=await json("https://api.bybit.com/v5/market/tickers?category=spot&symbol=ETHFIUSDT"),ticker=payload.result?.list?.[0];if(!ticker)throw new Error("Bybit empty response");
  return {name:"Bybit",price:Number(ticker.lastPrice),change24h:Number(ticker.price24hPcnt)*100,volume24h:Number(ticker.turnover24h),high24h:Number(ticker.highPrice24h),low24h:Number(ticker.lowPrice24h)};
}
async function readOkxChart(){const payload=await json("https://www.okx.com/api/v5/market/history-candles?instId=ETHFI-USDT&bar=1Dutc&limit=90");return (payload.data??[]).map((x:string[])=>[Number(x[0]),Number(x[4])] as [number,number]).sort((a:[number,number],b:[number,number])=>a[0]-b[0])}
async function readBybitChart(){const payload=await json("https://api.bybit.com/v5/market/kline?category=spot&symbol=ETHFIUSDT&interval=D&limit=90");return (payload.result?.list??[]).map((x:string[])=>[Number(x[0]),Number(x[4])] as [number,number]).sort((a:[number,number],b:[number,number])=>a[0]-b[0])}
async function readCoinGecko(){
  const headers:Record<string,string>={accept:"application/json"};if(process.env.COINGECKO_API_KEY)headers["x-cg-demo-api-key"]=process.env.COINGECKO_API_KEY;
  const response=await fetch("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=ether-fi&price_change_percentage=24h",{cache:"no-store",headers,signal:AbortSignal.timeout(5500)});if(!response.ok)throw new Error("CoinGecko unavailable");return (await response.json())?.[0]??null;
}
async function readCnyRate(){try{const payload=await json("https://api.coinbase.com/v2/exchange-rates?currency=USD",4500),rate=Number(payload.data?.rates?.CNY);if(Number.isFinite(rate)&&rate>0)return {rate,source:"Coinbase FX",stale:false}}catch{}return {rate:7.17,source:"汇率备用值",stale:true}}

export async function GET(request:NextRequest){
  const currency=request.nextUrl.searchParams.get("currency")==="cny"?"cny":"usd";
  const [binanceResult,okxResult,bybitResult,coinGeckoResult,fx,binanceChart,okxChart,bybitChart]=await Promise.allSettled([readBinance(),readOkx(),readBybit(),readCoinGecko(),readCnyRate(),readBinanceChart(),readOkxChart(),readBybitChart()]);
  const venues:Venue[]=[];
  if(binanceResult.status==="fulfilled")venues.push(binanceResult.value);if(okxResult.status==="fulfilled")venues.push(okxResult.value);if(bybitResult.status==="fulfilled")venues.push(bybitResult.value);
  const cg=coinGeckoResult.status==="fulfilled"?coinGeckoResult.value:null;
  if(!venues.length&&cg)venues.push({name:"CoinGecko",price:Number(cg.current_price),change24h:Number(cg.price_change_percentage_24h??0),volume24h:Number(cg.total_volume??0),high24h:Number(cg.high_24h??cg.current_price),low24h:Number(cg.low_24h??cg.current_price)});
  if(!venues.length)return NextResponse.json({error:"实时行情源暂时不可用",stale:true,updatedAt:new Date().toISOString()},{status:503,headers:{"Cache-Control":"no-store"}});
  const chartCandidates=[binanceChart,okxChart,bybitChart].filter((x):x is PromiseFulfilledResult<Array<[number,number]>>=>x.status==="fulfilled"&&x.value.length>1),chart=chartCandidates[0]?.value??[];
  const fxValue=fx.status==="fulfilled"?fx.value:{rate:7.17,source:"汇率备用值",stale:true},rate=currency==="cny"?fxValue.rate:1;
  const priceUsd=median(venues.map(x=>x.price)),change24h=median(venues.map(x=>x.change24h)),circulatingSupply=Number(cg?.circulating_supply)||VERIFIED_CIRCULATING_SUPPLY,totalSupply=Number(cg?.total_supply)||MAX_SUPPLY,volumeUsd=venues.reduce((sum,x)=>sum+x.volume24h,0);
  return NextResponse.json({price:priceUsd*rate,change24h,marketCap:priceUsd*circulatingSupply*rate,fdv:priceUsd*MAX_SUPPLY*rate,volume24h:volumeUsd*rate,circulatingSupply,totalSupply,high24h:Math.max(...venues.map(x=>x.high24h))*rate,low24h:Math.min(...venues.map(x=>x.low24h))*rate,ath:(Number(cg?.ath)||8.53)*rate,athDate:cg?.ath_date||"2024-03-27T00:00:00.000Z",chart:chart.map(([timestamp,value])=>[timestamp,value*rate]),chartSource:chartCandidates.length?(binanceChart.status==="fulfilled"&&chart===binanceChart.value?"Binance":okxChart.status==="fulfilled"&&chart===okxChart.value?"OKX":"Bybit"):"暂不可用",venues:venues.map(x=>({...x,price:x.price*rate,volume24h:x.volume24h*rate,high24h:x.high24h*rate,low24h:x.low24h*rate})),volumeScope:`${venues.map(x=>x.name).join(" + ")} 现货合计`,circulatingSource:cg?"CoinGecko 市场口径":"Tokenomics.com（2026-08-24 校验）",fxSource:currency==="cny"?fxValue.source:"USD",source:`${venues.map(x=>x.name).join(" · ")} 实时聚合`,stale:(currency==="cny"&&fxValue.stale)||chart.length<2,updatedAt:new Date().toISOString()},{headers:{"Cache-Control":"public, max-age=10, s-maxage=10, stale-while-revalidate=30"}});
}
