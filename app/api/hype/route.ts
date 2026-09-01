import { NextRequest, NextResponse } from "next/server";

type Venue={name:string;price:number;change24h:number;volume24h:number;high24h:number;low24h:number};
type Validator={validator:string;name:string;stake:number;commission:number;isActive:boolean;isJailed:boolean;apr:number;uptime:number};

const ASSISTANCE_FUND="0xfefefefefefefefefefefefefefefefefefefefe";
const median=(values:number[])=>{const rows=[...values].sort((a,b)=>a-b),mid=Math.floor(rows.length/2);return rows.length%2?rows[mid]:(rows[mid-1]+rows[mid])/2};

async function json(url:string,options:RequestInit={},timeout=8000){
  const response=await fetch(url,{cache:"no-store",headers:{accept:"application/json",...(options.headers||{})},signal:AbortSignal.timeout(timeout),...options});
  if(!response.ok)throw new Error(`${response.status} ${url}`);
  return response.json();
}
async function info(body:Record<string,unknown>){return json("https://api.hyperliquid.xyz/info",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)},10_000)}
async function binance():Promise<Venue>{const x=await json("https://api.binance.com/api/v3/ticker/24hr?symbol=HYPEUSDT");return{name:"Binance",price:Number(x.lastPrice),change24h:Number(x.priceChangePercent),volume24h:Number(x.quoteVolume),high24h:Number(x.highPrice),low24h:Number(x.lowPrice)}}
async function okx():Promise<Venue>{const x=(await json("https://www.okx.com/api/v5/market/ticker?instId=HYPE-USDT")).data?.[0];if(!x)throw new Error("OKX empty");const price=Number(x.last),open=Number(x.open24h);return{name:"OKX",price,change24h:open?(price/open-1)*100:0,volume24h:Number(x.volCcy24h),high24h:Number(x.high24h),low24h:Number(x.low24h)}}
async function bybit():Promise<Venue>{const x=(await json("https://api.bybit.com/v5/market/tickers?category=spot&symbol=HYPEUSDT")).result?.list?.[0];if(!x)throw new Error("Bybit empty");return{name:"Bybit",price:Number(x.lastPrice),change24h:Number(x.price24hPcnt)*100,volume24h:Number(x.turnover24h),high24h:Number(x.highPrice24h),low24h:Number(x.lowPrice24h)}}
async function chart(){const rows=await json("https://api.binance.com/api/v3/klines?symbol=HYPEUSDT&interval=1d&limit=90");return rows.map((x:unknown[])=>[Number(x[0]),Number(x[4])] as [number,number])}
async function okxChart(){const rows=(await json("https://www.okx.com/api/v5/market/history-candles?instId=HYPE-USDT&bar=1Dutc&limit=90")).data??[];return rows.map((x:string[])=>[Number(x[0]),Number(x[4])] as [number,number]).sort((a:[number,number],b:[number,number])=>a[0]-b[0])}
async function coinGecko(){const headers:Record<string,string>={accept:"application/json"};if(process.env.COINGECKO_API_KEY)headers["x-cg-demo-api-key"]=process.env.COINGECKO_API_KEY;return (await json("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=hyperliquid&price_change_percentage=24h",{headers}))?.[0]??null}
async function coinPaprika(){return json("https://api.coinpaprika.com/v1/tickers/hype-hyperliquid",{},7000)}
async function fx(){try{const rate=Number((await json("https://api.coinbase.com/v2/exchange-rates?currency=USD",{},4500)).data?.rates?.CNY);if(rate>0)return{rate,source:"Coinbase FX",stale:false}}catch{}return{rate:7.17,source:"汇率备用值",stale:true}}

export async function GET(request:NextRequest){
  const currency=request.nextUrl.searchParams.get("currency")==="cny"?"cny":"usd";
  const results=await Promise.allSettled([binance(),okx(),bybit(),chart(),okxChart(),coinGecko(),coinPaprika(),fx(),info({type:"metaAndAssetCtxs"}),info({type:"spotMetaAndAssetCtxs"}),info({type:"validatorSummaries"}),info({type:"spotClearinghouseState",user:ASSISTANCE_FUND})]);
  const [binanceResult,okxResult,bybitResult,chartResult,okxChartResult,cgResult,paprikaResult,fxResult,perpsResult,spotResult,validatorsResult,fundResult]=results;
  const venues:Venue[]=[];for(const result of [binanceResult,okxResult,bybitResult])if(result.status==="fulfilled")venues.push(result.value as Venue);
  const cg=cgResult.status==="fulfilled"?cgResult.value:null,paprika=paprikaResult.status==="fulfilled"?paprikaResult.value:null;
  if(!venues.length&&cg)venues.push({name:"CoinGecko",price:Number(cg.current_price),change24h:Number(cg.price_change_percentage_24h??0),volume24h:Number(cg.total_volume??0),high24h:Number(cg.high_24h??cg.current_price),low24h:Number(cg.low_24h??cg.current_price)});
  if(!venues.length)return NextResponse.json({error:"HYPE 实时行情暂时不可用",updatedAt:new Date().toISOString()},{status:503,headers:{"Cache-Control":"no-store"}});
  const fxData=fxResult.status==="fulfilled"?fxResult.value:{rate:7.17,source:"汇率备用值",stale:true},rate=currency==="cny"?fxData.rate:1,priceUsd=median(venues.map(x=>x.price));
  const perps=perpsResult.status==="fulfilled"?perpsResult.value:null,perpMeta=perps?.[0]?.universe??[],perpCtx=perps?.[1]??[];
  const perpsVolume=perpCtx.reduce((sum:number,x:{dayNtlVlm?:string})=>sum+Number(x.dayNtlVlm??0),0),openInterest=perpCtx.reduce((sum:number,x:{openInterest?:string;markPx?:string})=>sum+Number(x.openInterest??0)*Number(x.markPx??0),0);
  const spot=spotResult.status==="fulfilled"?spotResult.value:null,spotCtx=spot?.[1]??[],spotVolume=spotCtx.reduce((sum:number,x:{dayNtlVlm?:string})=>sum+Number(x.dayNtlVlm??0),0);
  const rawValidators=validatorsResult.status==="fulfilled"?(validatorsResult.value as Array<Record<string,unknown>>):[];
  const validators:Validator[]=rawValidators.map(x=>{const stats=Array.isArray(x.stats)?x.stats as Array<[string,{predictedApr?:string;uptimeFraction?:string}]>:[],day=stats.find(row=>row[0]==="day")?.[1];return{validator:String(x.validator??""),name:String(x.name??"Unnamed"),stake:Number(x.stake??0)/1e8,commission:Number(x.commission??0),isActive:Boolean(x.isActive),isJailed:Boolean(x.isJailed),apr:Number(day?.predictedApr??0),uptime:Number(day?.uptimeFraction??0)}}).sort((a,b)=>b.stake-a.stake);
  const activeValidators=validators.filter(x=>x.isActive&&!x.isJailed),totalStaked=activeValidators.reduce((sum,x)=>sum+x.stake,0),weightedApr=totalStaked?activeValidators.reduce((sum,x)=>sum+x.apr*x.stake,0)/totalStaked:0,top5Stake=activeValidators.slice(0,5).reduce((sum,x)=>sum+x.stake,0);
  const fund=fundResult.status==="fulfilled"?fundResult.value:null,fundHype=Number(fund?.balances?.find((x:{coin?:string})=>x.coin==="HYPE")?.total??0);
  const paprikaPrice=Number(paprika?.quotes?.USD?.price??0),paprikaMarketCap=Number(paprika?.quotes?.USD?.market_cap??0),circulatingSupply=Number(cg?.circulating_supply)||(paprikaPrice>0?paprikaMarketCap/paprikaPrice:0),totalSupply=Number(cg?.total_supply)||Number(paprika?.total_supply??0),maxSupply=Number(cg?.max_supply)||Number(paprika?.max_supply??1_000_000_000),marketCapUsd=Number(cg?.market_cap)||paprikaMarketCap||(circulatingSupply*priceUsd),fdvUsd=Number(cg?.fully_diluted_valuation)||(maxSupply*priceUsd),rawChart=chartResult.status==="fulfilled"?chartResult.value:okxChartResult.status==="fulfilled"?okxChartResult.value:[],chartSource=chartResult.status==="fulfilled"?"Binance":"OKX";
  const failedSources=[!cg&&!paprika&&"市场供应",rawChart.length<2&&"交易所K线",!perps&&"Hyperliquid永续",!spot&&"Hyperliquid现货",!validators.length&&"Hyperliquid验证者",!fund&&"Assistance Fund"].filter(Boolean);
  return NextResponse.json({
    price:priceUsd*rate,change24h:median(venues.map(x=>x.change24h)),marketCap:marketCapUsd*rate,fdv:fdvUsd*rate,volume24h:venues.reduce((sum,x)=>sum+x.volume24h,0)*rate,circulatingSupply,totalSupply,maxSupply,
    chart:rawChart.map(([time,value]:[number,number])=>[time,value*rate]),chartSource,marketSource:venues.map(x=>x.name).join(" · "),venues:venues.map(x=>({...x,price:x.price*rate,volume24h:x.volume24h*rate,high24h:x.high24h*rate,low24h:x.low24h*rate})),
    protocol:perps&&spot?{perpsVolume24h:perpsVolume*rate,spotVolume24h:spotVolume*rate,openInterest:openInterest*rate,perpMarkets:perpMeta.length,source:"Hyperliquid Info API"}:null,
    staking:validators.length?{totalStaked,stakingRatio:maxSupply?totalStaked/maxSupply:0,activeValidators:activeValidators.length,totalValidators:validators.length,weightedApr,top5Share:totalStaked?top5Stake/totalStaked:0,validators:activeValidators.slice(0,8),delegationLockDays:1,withdrawalDays:7,source:"Hyperliquid validatorSummaries"}:null,
    assistanceFund:fund?{hype:fundHype,address:ASSISTANCE_FUND,source:"Hyperliquid spotClearinghouseState"}:null,
    currencyRate:rate,fxSource:currency==="cny"?fxData.source:"USD",failedSources,stale:(currency==="cny"&&fxData.stale)||failedSources.length>0,updatedAt:new Date().toISOString()
  },{headers:{"Cache-Control":"public, max-age=15, s-maxage=30, stale-while-revalidate=90"}});
}
