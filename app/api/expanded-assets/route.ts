import { NextResponse } from "next/server";
import type { ExpandedAssetSnapshot,ExpandedTokenId } from "../../asset-model";

type MarketRow={id:string;current_price?:number;price_change_percentage_24h?:number;market_cap?:number;fully_diluted_valuation?:number;total_volume?:number;circulating_supply?:number;total_supply?:number;max_supply?:number|null};
type ExchangeQuote={id:ExpandedTokenId;price:number;change24h:number;volume24h:number;source:string};
type Definition={id:ExpandedTokenId;cgId:string;paprikaId:string;symbol:string;name:string;project:string;category:string;color:string;verified:{circulating:number;total:number;overall:number};stakingApplicable:boolean;stakingLabel:string;stakingExit:string;businessLabel:string;valueCapture:string;pressure:string;risk:string};

const definitions:Definition[]=[
  {id:"uni",cgId:"uniswap",paprikaId:"uni-uniswap",symbol:"UNIUSDT",name:"UNI",project:"Uniswap",category:"DEX 治理 / 协议费用",color:"#ff4d9d",verified:{circulating:620_930_423,total:888_178_419,overall:1_000_000_000},stakingApplicable:false,stakingLabel:"无原生代币质押",stakingExit:"不适用",businessLabel:"Uniswap 协议 TVL",valueCapture:"协议费用用于 UNI 销毁；治理委托不计作质押",pressure:"治理可按规则增发，需同时观察销毁与供应变化",risk:"协议使用量与 UNI 价值回流并非固定比例"},
  {id:"aave",cgId:"aave",paprikaId:"aave-new",symbol:"AAVEUSDT",name:"AAVE",project:"Aave",category:"借贷协议 / 治理与安全",color:"#7b61ff",verified:{circulating:15_428_081,total:16_000_000,overall:16_000_000},stakingApplicable:true,stakingLabel:"stkAAVE 锁定量",stakingExit:"Safety Module 冷却机制",businessLabel:"Aave 协议 TVL",valueCapture:"stkAAVE 与 DAO 资金机制分开观察",pressure:"Umbrella 的 aToken / GHO 保障不计入 AAVE 质押",risk:"借贷坏账保障与 AAVE 代币质押并非同一资产池"},
  {id:"ena",cgId:"ethena",paprikaId:"ena-ethena",symbol:"ENAUSDT",name:"ENA",project:"Ethena",category:"合成美元协议治理",color:"#24262b",verified:{circulating:10_095_312_500,total:15_000_000_000,overall:15_000_000_000},stakingApplicable:true,stakingLabel:"sENA 合约锁定 ENA",stakingExit:"解除后 7 天冷却",businessLabel:"Ethena 协议 TVL",valueCapture:"sENA 分配属酌情机制，不把 sUSDe 收益计入 ENA",pressure:"未流通供应与生态激励仍需持续观察",risk:"USDe 业务规模不能直接等同于 ENA 持有人收益"},
  {id:"xpl",cgId:"plasma",paprikaId:"xpl-plasma",symbol:"XPLUSDT",name:"XPL",project:"Plasma",category:"支付链 / 原生 Gas 与验证",color:"#17b890",verified:{circulating:2_777_777_778,total:10_000_000_000,overall:10_000_000_000},stakingApplicable:true,stakingLabel:"验证者质押",stakingExit:"官方聚合退出数据暂未接通",businessLabel:"Plasma 链 TVL",valueCapture:"XPL 用于 Gas 与验证者安全",pressure:"初始分配与验证者奖励影响后续供应",risk:"链上验证者聚合数据成熟度低于其他资产"},
];

const ETH_RPCS=["https://ethereum-rpc.publicnode.com","https://eth.drpc.org","https://eth.llamarpc.com"];
const STKAAVE="0x4da27a545c0c5b758a6ba100e3a049001de870f5";
const ENA="0x57e114b691db790c35207b2e685d4a43181e6061";
const SENA="0x8be3460a480c80728a8c4d7a5d5303c85ba7b3b9";

async function json(url:string,options:RequestInit={},timeout=8500){
  const response=await fetch(url,{cache:"no-store",headers:{accept:"application/json",...(options.headers||{})},signal:AbortSignal.timeout(timeout),...options});
  if(!response.ok)throw new Error(`${response.status} ${url}`);
  return response.json();
}

async function marketRows(){
  const headers:Record<string,string>={accept:"application/json"};
  if(process.env.COINGECKO_API_KEY)headers["x-cg-demo-api-key"]=process.env.COINGECKO_API_KEY;
  return json(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${definitions.map(x=>x.cgId).join(",")}&price_change_percentage=24h`,{headers}) as Promise<MarketRow[]>;
}

async function paprikaRows(){
  const results=await Promise.allSettled(definitions.map(async definition=>({definition,payload:await json(`https://api.coinpaprika.com/v1/tickers/${definition.paprikaId}`,{},7000)})));
  return results.flatMap(result=>{if(result.status!=="fulfilled")return[];const {definition,payload}=result.value,quote=payload?.quotes?.USD??{},price=Number(quote.price)||0;return [{id:definition.cgId,current_price:price,price_change_percentage_24h:Number(quote.percent_change_24h)||0,market_cap:definition.verified.circulating*price,fully_diluted_valuation:definition.verified.overall*price,total_volume:Number(quote.volume_24h)||0,circulating_supply:definition.verified.circulating,total_supply:Number(payload?.total_supply)||definition.verified.total,max_supply:Number(payload?.max_supply)||definition.verified.overall} as MarketRow]});
}

const median=(values:number[])=>{const rows=values.filter(Number.isFinite).sort((a,b)=>a-b),mid=Math.floor(rows.length/2);return rows.length%2?rows[mid]:(rows[mid-1]+rows[mid])/2};

async function exchangeQuote(definition:Definition):Promise<ExchangeQuote>{
  const instId=definition.symbol.replace(/USDT$/,"-USDT");
  const [okxResult,bybitResult]=await Promise.allSettled([
    json(`https://www.okx.com/api/v5/market/ticker?instId=${instId}`),
    json(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${definition.symbol}`),
  ]);
  const quotes:Array<{price:number;change:number;volume:number;source:string}>=[];
  if(okxResult.status==="fulfilled"){const ticker=okxResult.value?.data?.[0],price=Number(ticker?.last),open=Number(ticker?.open24h);if(price>0)quotes.push({price,change:open>0?(price/open-1)*100:0,volume:Number(ticker?.volCcy24h)||0,source:"OKX"})}
  if(bybitResult.status==="fulfilled"){const ticker=bybitResult.value?.result?.list?.[0],price=Number(ticker?.lastPrice);if(price>0)quotes.push({price,change:Number(ticker?.price24hPcnt)*100||0,volume:Number(ticker?.turnover24h)||0,source:"Bybit"})}
  if(!quotes.length)throw new Error(`${definition.name} exchange quote unavailable`);
  return {id:definition.id,price:median(quotes.map(item=>item.price)),change24h:median(quotes.map(item=>item.change)),volume24h:quotes.reduce((sum,item)=>sum+item.volume,0),source:quotes.map(item=>item.source).join(" · ")};
}

async function chart(definition:Definition){
  try{
    const rows=await json(`https://api.binance.com/api/v3/klines?symbol=${definition.symbol}&interval=1d&limit=90`);
    return {rows:(rows as unknown[][]).map(row=>[Number(row[0]),Number(row[4])] as [number,number]).filter(row=>row[0]>0&&row[1]>0),source:"Binance"};
  }catch{
    const instId=definition.symbol.replace(/USDT$/,"-USDT"),payload=await json(`https://www.okx.com/api/v5/market/history-candles?instId=${instId}&bar=1Dutc&limit=90`),rows=(payload?.data??[]).map((row:string[])=>[Number(row[0]),Number(row[4])] as [number,number]).filter((row:[number,number])=>row[0]>0&&row[1]>0).sort((a:[number,number],b:[number,number])=>a[0]-b[0]);
    if(rows.length<2)throw new Error(`${definition.name} chart unavailable`);
    return {rows,source:"OKX"};
  }
}

async function ethCall(to:string,data:string){
  let last:unknown;
  for(const rpc of ETH_RPCS){
    try{
      const result=await json(rpc,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"eth_call",params:[{to,data},"latest"]})},6500) as {result?:string;error?:{message?:string}};
      if(result.error||!result.result||result.result==="0x")throw new Error(result.error?.message||"empty eth_call");
      return Number(BigInt(result.result))/1e18;
    }catch(error){last=error}
  }
  throw last instanceof Error?last:new Error("Ethereum RPC unavailable");
}

const balanceOf=(token:string,account:string)=>ethCall(token,`0x70a08231${account.toLowerCase().replace(/^0x/,"").padStart(64,"0")}`);
const totalSupply=(token:string)=>ethCall(token,"0x18160ddd");

async function protocolMetrics(){
  const [uni,aave,ethena,chains]=await Promise.allSettled([
    json("https://api.llama.fi/tvl/uniswap"),json("https://api.llama.fi/tvl/aave"),json("https://api.llama.fi/tvl/ethena"),json("https://api.llama.fi/v2/chains")
  ]);
  const chainRows=chains.status==="fulfilled"&&Array.isArray(chains.value)?chains.value as Array<{name?:string;tvl?:number}>:[];
  const plasma=chainRows.find(row=>row.name?.toLowerCase()==="plasma")?.tvl;
  return {
    uni:uni.status==="fulfilled"?Number(uni.value):null,
    aave:aave.status==="fulfilled"?Number(aave.value):null,
    ena:ethena.status==="fulfilled"?Number(ethena.value):null,
    xpl:Number.isFinite(Number(plasma))?Number(plasma):null,
  } as Record<ExpandedTokenId,number|null>;
}

export async function GET(){
  const [marketsResult,paprikaResult,exchangeResult,chartsResult,aaveStakeResult,enaStakeResult,businessResult]=await Promise.all([
    marketRows().then(value=>({value,error:false as const})).catch(()=>({value:[] as MarketRow[],error:true as const})),
    paprikaRows().then(value=>({value,error:false as const})).catch(()=>({value:[] as MarketRow[],error:true as const})),
    Promise.allSettled(definitions.map(exchangeQuote)),
    Promise.allSettled(definitions.map(chart)),
    totalSupply(STKAAVE).then(value=>({value,error:false as const})).catch(()=>({value:null,error:true as const})),
    balanceOf(ENA,SENA).then(value=>({value,error:false as const})).catch(()=>({value:null,error:true as const})),
    protocolMetrics().then(value=>({value,error:false as const})).catch(()=>({value:{uni:null,aave:null,ena:null,xpl:null} as Record<ExpandedTokenId,number|null>,error:true as const})),
  ]);
  const marketMap=new Map(paprikaResult.value.map(row=>[row.id,row]));for(const row of marketsResult.value)marketMap.set(row.id,row);
  const exchangeMap=new Map(exchangeResult.flatMap(result=>result.status==="fulfilled"?[[result.value.id,result.value] as const]:[]));
  const updatedAt=new Date().toISOString();
  const assets:ExpandedAssetSnapshot[]=definitions.map((definition,index)=>{
    const market=marketMap.get(definition.cgId),exchange=exchangeMap.get(definition.id),total=Number(market?.total_supply)||definition.verified.total,overall=Number(market?.max_supply)||definition.verified.overall,circulating=Number(market?.circulating_supply)||definition.verified.circulating;
    const chartResult=chartsResult[index],chartRows=chartResult.status==="fulfilled"?chartResult.value.rows:[],chartSource=chartResult.status==="fulfilled"?chartResult.value.source:null,lastPrice=chartRows.at(-1)?.[1]??null,price=exchange?.price||Number(market?.current_price)||lastPrice;
    const stakingAmount=definition.id==="aave"?aaveStakeResult.value:definition.id==="ena"?enaStakeResult.value:null;
    const businessValue=businessResult.value[definition.id];
    const canDeriveBurn=definition.id==="uni"&&overall!=null&&total!=null&&overall>=total;
    const failedSources=[!exchange&&!market&&"实时行情",chartResult.status!=="fulfilled"&&"交易所日线",definition.id==="aave"&&aaveStakeResult.error&&"stkAAVE 链上供应",definition.id==="ena"&&enaStakeResult.error&&"sENA 锁定量",definition.id==="xpl"&&"Plasma 验证者聚合",businessValue==null&&"协议规模"].filter(Boolean) as string[];
    return {
      id:definition.id,name:definition.name,project:definition.project,category:definition.category,color:definition.color,
      price,change24h:exchange?.change24h??(Number.isFinite(Number(market?.price_change_percentage_24h))?Number(market?.price_change_percentage_24h):chartRows.length>1?(chartRows.at(-1)![1]/chartRows.at(-2)![1]-1)*100:null),
      marketCap:price?price*circulating:Number(market?.market_cap)||null,fdv:price?price*overall:Number(market?.fully_diluted_valuation)||null,volume24h:exchange?.volume24h||Number(market?.total_volume)||null,
      circulatingSupply:circulating,totalSupply:total,overallSupply:overall,burnedSupply:canDeriveBurn?Math.max(0,overall-total):null,burnedMethod:canDeriveBurn?"最大供应与当前总供应差额":"官方未单列",
      stakingAmount,stakingApplicable:definition.stakingApplicable,stakingLabel:definition.stakingLabel,stakingExit:definition.stakingExit,
      businessLabel:definition.businessLabel,businessValue,valueCapture:definition.valueCapture,pressure:definition.pressure,risk:definition.risk,
      chart:chartRows,marketSource:exchange?`${exchange.source} · ${chartSource??"日线暂不可读"}`:market?`${marketsResult.value.some(row=>row.id===definition.cgId)?"CoinGecko":"CoinPaprika 备用"} · ${chartSource??"日线暂不可读"}`:`${chartSource??"行情暂不可读"} 日线推导`,stakingSource:definition.id==="aave"?"Ethereum stkAAVE totalSupply":definition.id==="ena"?"Ethereum ENA balanceOf(sENA)":definition.id==="uni"?"不适用":"待接 Plasma 官方验证者源",businessSource:"DefiLlama 协议 / 链 TVL",
      failedSources,updatedAt,
    };
  });
  return NextResponse.json({assets,updatedAt},{headers:{"Cache-Control":"public, max-age=15, s-maxage=30, stale-while-revalidate=90"}});
}
