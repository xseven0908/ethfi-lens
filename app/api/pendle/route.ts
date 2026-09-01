import { NextRequest, NextResponse } from "next/server";

type Venue={name:string;price:number;change24h:number;volume24h:number;high24h:number;low24h:number};
type Epoch={timestamp:number;revenue:number;fees:number;buyback:number;airdrops:number};

const median=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2};
const fromWei=(value:unknown)=>{try{return Number(BigInt(String(value)))/1e18}catch{return 0}};

async function json(url:string,options:RequestInit={},timeout=7000){
  const response=await fetch(url,{cache:"no-store",headers:{accept:"application/json",...(options.headers||{})},signal:AbortSignal.timeout(timeout),...options});
  if(!response.ok)throw new Error(`${response.status} ${url}`);
  return response.json();
}

async function readBinance():Promise<Venue>{const ticker=await json("https://api.binance.com/api/v3/ticker/24hr?symbol=PENDLEUSDT");return {name:"Binance",price:Number(ticker.lastPrice),change24h:Number(ticker.priceChangePercent),volume24h:Number(ticker.quoteVolume),high24h:Number(ticker.highPrice),low24h:Number(ticker.lowPrice)}}
async function readOkx():Promise<Venue>{const payload=await json("https://www.okx.com/api/v5/market/ticker?instId=PENDLE-USDT"),ticker=payload.data?.[0];if(!ticker)throw new Error("OKX empty response");const price=Number(ticker.last),open=Number(ticker.open24h);return {name:"OKX",price,change24h:open?((price/open)-1)*100:0,volume24h:Number(ticker.volCcy24h),high24h:Number(ticker.high24h),low24h:Number(ticker.low24h)}}
async function readBybit():Promise<Venue>{const payload=await json("https://api.bybit.com/v5/market/tickers?category=spot&symbol=PENDLEUSDT"),ticker=payload.result?.list?.[0];if(!ticker)throw new Error("Bybit empty response");return {name:"Bybit",price:Number(ticker.lastPrice),change24h:Number(ticker.price24hPcnt)*100,volume24h:Number(ticker.turnover24h),high24h:Number(ticker.highPrice24h),low24h:Number(ticker.lowPrice24h)}}
async function readBinanceChart(){const rows=await json("https://api.binance.com/api/v3/klines?symbol=PENDLEUSDT&interval=1d&limit=90");return rows.map((x:unknown[])=>[Number(x[0]),Number(x[4])] as [number,number])}
async function readOkxChart(){const payload=await json("https://www.okx.com/api/v5/market/history-candles?instId=PENDLE-USDT&bar=1Dutc&limit=90");return (payload.data??[]).map((x:string[])=>[Number(x[0]),Number(x[4])] as [number,number]).sort((a:[number,number],b:[number,number])=>a[0]-b[0])}
async function readCoinGecko(){const headers:Record<string,string>={accept:"application/json"};if(process.env.COINGECKO_API_KEY)headers["x-cg-demo-api-key"]=process.env.COINGECKO_API_KEY;const payload=await json("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=pendle&price_change_percentage=24h",{headers});return payload?.[0]??null}
async function readCnyRate(){try{const payload=await json("https://api.coinbase.com/v2/exchange-rates?currency=USD",{},4500),rate=Number(payload.data?.rates?.CNY);if(Number.isFinite(rate)&&rate>0)return {rate,source:"Coinbase FX",stale:false}}catch{}return {rate:7.17,source:"汇率备用值",stale:true}}
async function readSpendle(){return json("https://api-v2.pendle.finance/core/v1/spendle/data",{},9000)}

export async function GET(request:NextRequest){
  const currency=request.nextUrl.searchParams.get("currency")==="cny"?"cny":"usd";
  const [binance,okx,bybit,binanceChart,okxChart,cgResult,fxResult,spendleResult]=await Promise.allSettled([readBinance(),readOkx(),readBybit(),readBinanceChart(),readOkxChart(),readCoinGecko(),readCnyRate(),readSpendle()]);
  const venues:Venue[]=[];
  if(binance.status==="fulfilled")venues.push(binance.value);if(okx.status==="fulfilled")venues.push(okx.value);if(bybit.status==="fulfilled")venues.push(bybit.value);
  const cg=cgResult.status==="fulfilled"?cgResult.value:null;
  if(!venues.length&&cg)venues.push({name:"CoinGecko",price:Number(cg.current_price),change24h:Number(cg.price_change_percentage_24h??0),volume24h:Number(cg.total_volume??0),high24h:Number(cg.high_24h??cg.current_price),low24h:Number(cg.low_24h??cg.current_price)});
  if(!venues.length)return NextResponse.json({error:"PENDLE 实时行情暂时不可用",updatedAt:new Date().toISOString()},{status:503,headers:{"Cache-Control":"no-store"}});
  const charts=[binanceChart,okxChart].filter((item):item is PromiseFulfilledResult<Array<[number,number]>>=>item.status==="fulfilled"&&item.value.length>1),rawChart=charts[0]?.value??[];
  const fx=fxResult.status==="fulfilled"?fxResult.value:{rate:7.17,source:"汇率备用值",stale:true},rate=currency==="cny"?fx.rate:1;
  const priceUsd=median(venues.map(item=>item.price)),circulatingSupply=Number(cg?.circulating_supply)||0,totalSupply=Number(cg?.total_supply)||0,marketCapUsd=Number(cg?.market_cap)||(circulatingSupply?priceUsd*circulatingSupply:0),fdvUsd=Number(cg?.fully_diluted_valuation)||(totalSupply?priceUsd*totalSupply:0);
  const spendle=spendleResult.status==="fulfilled"?spendleResult.value:null,history=spendle?.sPendleHistoricalData;
  const epochs:Epoch[]=(history?.timestamps??[]).map((timestamp:number,index:number)=>({timestamp:timestamp*1000,revenue:Number(history.revenues?.[index]??0),fees:Number(history.fees?.[index]??0),buyback:Number(history.buybackAmounts?.[index]??0),airdrops:Number(history.airdropInUSDs?.[index]??0)})).sort((a:Epoch,b:Epoch)=>a.timestamp-b.timestamp);
  const latestEpoch=[...epochs].reverse().find(item=>item.revenue>0||item.fees>0||item.buyback>0||item.airdrops>0)??null;
  const latestBuyback=[...epochs].reverse().find(item=>item.buyback>0)??null;
  const failedSources=[!cg&&"CoinGecko",rawChart.length<2&&"交易所 K 线",!spendle&&"Pendle sPENDLE API"].filter(Boolean);
  return NextResponse.json({
    price:priceUsd*rate,change24h:median(venues.map(item=>item.change24h)),marketCap:marketCapUsd*rate,fdv:fdvUsd*rate,volume24h:venues.reduce((sum,item)=>sum+item.volume24h,0)*rate,
    circulatingSupply,totalSupply,ath:Number(cg?.ath??0)*rate,high24h:Math.max(...venues.map(item=>item.high24h))*rate,low24h:Math.min(...venues.map(item=>item.low24h))*rate,
    chart:rawChart.map(([time,value])=>[time,value*rate]),chartSource:binanceChart.status==="fulfilled"&&rawChart===binanceChart.value?"Binance":"OKX",venues:venues.map(item=>({...item,price:item.price*rate,volume24h:item.volume24h*rate,high24h:item.high24h*rate,low24h:item.low24h*rate})),
    spendle:spendle?{totalPendleStaked:fromWei(spendle.totalPendleStaked),directSpendle:fromWei(spendle.totalStakedInSpendle),virtualSpendle:fromWei(spendle.virtualSpendleFromVependle),allTimeRevenue:Number(history?.allTimeRevenues??0)*rate,epochs:epochs.map(item=>({...item,revenue:item.revenue*rate,fees:item.fees*rate,buyback:item.buyback*rate,airdrops:item.airdrops*rate})),latestEpoch:latestEpoch?{...latestEpoch,revenue:latestEpoch.revenue*rate,fees:latestEpoch.fees*rate,buyback:latestEpoch.buyback*rate,airdrops:latestEpoch.airdrops*rate}:null,latestBuyback:latestBuyback?{...latestBuyback,buyback:latestBuyback.buyback*rate}:null,withdrawalDays:14,instantExitFee:5}:null,
    terminalInflationRate:2,vestingStatus:"团队与投资人代币已完成归属",currencyRate:rate,marketSource:venues.map(item=>item.name).join(" · "),sPendleSource:"Pendle Core API /v1/spendle/data",fxSource:currency==="cny"?fx.source:"USD",failedSources,stale:(currency==="cny"&&fx.stale)||failedSources.length>0,updatedAt:new Date().toISOString()
  },{headers:{"Cache-Control":"public, max-age=15, s-maxage=30, stale-while-revalidate=90"}});
}
