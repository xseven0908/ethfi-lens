import { NextRequest, NextResponse } from "next/server";

const MINT = "BPxxfRCXkUVhig4HS1Lh7kZqV6SPJhzfEk4x6fVBjPCy";
const ECONOMIC_MAX_SUPPLY = 1_000_000_000;
const TGE_CIRCULATING_SUPPLY = 250_000_000;

async function json(url:string,options:RequestInit={}){
  const response=await fetch(url,{cache:"no-store",headers:{accept:"application/json",...(options.headers||{})},signal:AbortSignal.timeout(7_000),...options});
  if(!response.ok)throw new Error(`${response.status} ${url}`);
  return response.json();
}

async function readTicker(){return json("https://api.backpack.exchange/api/v1/ticker?symbol=BP_USDC")}
async function readStaking(){return json("https://api.backpack.exchange/wapi/v1/staking/stats")}
async function readChart(){
  const start=Math.floor(Date.now()/1000)-92*86_400;
  const payload=await json(`https://api.backpack.exchange/api/v1/klines?symbol=BP_USDC&interval=1d&startTime=${start}`);
  return (Array.isArray(payload)?payload:[]).map((row:{start:string;close:string})=>[new Date(row.start).getTime(),Number(row.close)] as [number,number]).filter((row:[number,number])=>Number.isFinite(row[0])&&Number.isFinite(row[1])&&row[1]>0).sort((a:[number,number],b:[number,number])=>a[0]-b[0]);
}
async function readDepth(){return json("https://api.backpack.exchange/api/v1/depth?symbol=BP_USDC&limit=100")}
async function readMarkets(){return json("https://api.backpack.exchange/api/v1/markets")}
async function readCoinGecko(){
  const headers:Record<string,string>={accept:"application/json"};
  if(process.env.COINGECKO_API_KEY)headers["x-cg-demo-api-key"]=process.env.COINGECKO_API_KEY;
  const payload=await json("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=backpack&price_change_percentage=24h",{headers});
  return payload?.[0]??null;
}
async function readCnyRate(){
  try{const payload=await json("https://api.coinbase.com/v2/exchange-rates?currency=USD"),rate=Number(payload.data?.rates?.CNY);if(Number.isFinite(rate)&&rate>0)return {rate,source:"Coinbase FX",stale:false}}catch{}
  return {rate:7.17,source:"汇率暂不可读",stale:true};
}
async function rpc(method:string,params:unknown[]){
  return json("https://api.mainnet-beta.solana.com",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params})});
}
async function readChain(){
  const [supply,account]=await Promise.all([rpc("getTokenSupply",[MINT,{commitment:"confirmed"}]),rpc("getAccountInfo",[MINT,{encoding:"jsonParsed",commitment:"confirmed"}])]);
  const info=account.result?.value?.data?.parsed?.info,value=supply.result?.value;
  if(!info||!value)throw new Error("Solana RPC returned no mint data");
  return {mint:MINT,supply:Number(value.uiAmountString),decimals:Number(value.decimals),mintAuthority:info.mintAuthority??null,freezeAuthority:info.freezeAuthority??null,slot:Number(supply.result?.context?.slot??0)};
}

export async function GET(request:NextRequest){
  const currency=request.nextUrl.searchParams.get("currency")==="cny"?"cny":"usd";
  const [tickerResult,stakingResult,chartResult,depthResult,cgResult,fxResult,chainResult,marketsResult]=await Promise.allSettled([readTicker(),readStaking(),readChart(),readDepth(),readCoinGecko(),readCnyRate(),readChain(),readMarkets()]);
  const ticker=tickerResult.status==="fulfilled"?tickerResult.value:null,cg=cgResult.status==="fulfilled"?cgResult.value:null;
  const priceUsd=Number(ticker?.lastPrice)||Number(cg?.current_price)||0;
  if(!priceUsd)return NextResponse.json({error:"BP 实时行情暂时不可用",updatedAt:new Date().toISOString()},{status:503,headers:{"Cache-Control":"no-store"}});
  const fx=fxResult.status==="fulfilled"?fxResult.value:{rate:7.17,source:"汇率暂不可读",stale:true},rate=currency==="cny"?fx.rate:1;
  const circulatingSupply=Number(cg?.circulating_supply)||TGE_CIRCULATING_SUPPLY,totalSupply=Number(cg?.total_supply)||ECONOMIC_MAX_SUPPLY,staked=stakingResult.status==="fulfilled"?Number(stakingResult.value.totalStakedBp):null;
  const rawChart=chartResult.status==="fulfilled"?chartResult.value:[],chart=rawChart.map(([time,value])=>[time,value*rate]);
  const bids:Array<[string,string]>=depthResult.status==="fulfilled"?depthResult.value.bids??[]:[],asks:Array<[string,string]>=depthResult.status==="fulfilled"?depthResult.value.asks??[]:[],bestBid=Math.max(0,...bids.map(x=>Number(x[0]))),bestAsk=Math.min(...asks.map(x=>Number(x[0])).filter(Number.isFinite)),mid=bestBid>0&&Number.isFinite(bestAsk)?(bestBid+bestAsk)/2:priceUsd,spreadBps=bestBid>0&&Number.isFinite(bestAsk)?(bestAsk-bestBid)/mid*10_000:null;
  const depth=(side:Array<[string,string]>,band:number,bid:boolean)=>side.filter(x=>bid?Number(x[0])>=mid*(1-band):Number(x[0])<=mid*(1+band)).reduce((sum,x)=>sum+Number(x[0])*Number(x[1]),0),chain=chainResult.status==="fulfilled"?chainResult.value:null,markets=marketsResult.status==="fulfilled"&&Array.isArray(marketsResult.value)?marketsResult.value:[];
  const change24h=ticker?Number(ticker.priceChangePercent)*100:Number(cg?.price_change_percentage_24h??0),venueVolume=Number(ticker?.quoteVolume??0),allMarketVolume=Number(cg?.total_volume)||venueVolume;
  return NextResponse.json({
    price:priceUsd*rate,change24h,high24h:Number(ticker?.high??cg?.high_24h??priceUsd)*rate,low24h:Number(ticker?.low??cg?.low_24h??priceUsd)*rate,
    marketCap:priceUsd*circulatingSupply*rate,fdv:priceUsd*ECONOMIC_MAX_SUPPLY*rate,venueVolume24h:venueVolume*rate,allMarketVolume24h:allMarketVolume*rate,trades24h:Number(ticker?.trades??0),
    circulatingSupply,totalSupply,economicMaxSupply:ECONOMIC_MAX_SUPPLY,staked,stakedPercent:staked==null?null:staked/ECONOMIC_MAX_SUPPLY*100,unstakedCirculating:staked==null?null:Math.max(0,circulatingSupply-staked),cooldownDays:7,pendingUnstake:null,pendingUnstakePublic:false,
    chart,chartSource:"Backpack BP_USDC 日线",marketSource:cg?"Backpack + CoinGecko":"Backpack",circulatingSource:cg?"CoinGecko 市场口径":"Backpack TGE 公开口径",
    liquidity:{bestBid:bestBid?bestBid*rate:null,bestAsk:Number.isFinite(bestAsk)?bestAsk*rate:null,spreadBps,bidDepth05Pct:depth(bids,.005,true)*rate,askDepth05Pct:depth(asks,.005,false)*rate,bidDepth1Pct:depth(bids,.01,true)*rate,askDepth1Pct:depth(asks,.01,false)*rate,bidDepth2Pct:depth(bids,.02,true)*rate,askDepth2Pct:depth(asks,.02,false)*rate,available:bids.length>0&&asks.length>0},marketCount:markets.length,
    chain:chain?{...chain,supplyDelta:ECONOMIC_MAX_SUPPLY-chain.supply,mintAuthorityEnabled:!!chain.mintAuthority,freezeAuthorityEnabled:!!chain.freezeAuthority}:null,
    tokenomics:{tge:{amount:250_000_000,percent:25,status:"已完成",rule:"Points 用户 2.4 亿 · Mad Lads 1000 万"},preIpo:{amount:375_000_000,percent:37.5,status:"里程碑触发",rule:"监管、产品与市场扩展触发；无固定日期"},postIpo:{amount:375_000_000,percent:37.5,status:"锁定",rule:"潜在 IPO 后至少一年"}},
    stale:(currency==="cny"&&fx.stale)||!cg||rawChart.length<2||!chain||staked==null,failedSources:[!cg&&"CoinGecko",rawChart.length<2&&"Backpack K线",!chain&&"Solana RPC",staked==null&&"Backpack质押统计",!markets.length&&"Backpack市场列表"].filter(Boolean),fxSource:currency==="cny"?fx.source:"USD",updatedAt:new Date().toISOString()
  },{headers:{"Cache-Control":"public, max-age=15, s-maxage=15, stale-while-revalidate=45"}});
}
