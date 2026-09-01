import { NextResponse } from "next/server";

type Market={name:string;protocol:string;address:string;expiry:string;chainId:number;isPrime:boolean;details?:{liquidity?:number;totalTvl?:number;tradingVolume?:number;underlyingApy?:number;impliedApy?:number;aggregatedApy?:number;ytFloatingApy?:number;pendleApy?:number}};
type MarketsPayload={total:number;results:Market[]};

const CHAIN_NAMES:Record<number,string>={1:"Ethereum",10:"Optimism",56:"BNB Chain",137:"Polygon",146:"Sonic",42161:"Arbitrum",5000:"Mantle",8453:"Base",999:"HyperEVM"};
const CACHE_MS=300_000;
let cached:Record<string,unknown>|null=null,cachedAt=0;

async function page(skip:number){const response=await fetch(`https://api-v2.pendle.finance/core/v2/markets/all?limit=100&skip=${skip}`,{cache:"no-store",headers:{accept:"application/json"},signal:AbortSignal.timeout(12_000)});if(!response.ok)throw new Error(`Pendle markets ${response.status}`);return response.json() as Promise<MarketsPayload>}

export async function GET(){
  const headers={"Cache-Control":"public, max-age=60, s-maxage=300, stale-while-revalidate=900"};
  if(cached&&Date.now()-cachedAt<CACHE_MS)return NextResponse.json(cached,{headers});
  try{
    const first=await page(0),skips=Array.from({length:Math.max(0,Math.ceil(first.total/100)-1)},(_,index)=>(index+1)*100),rest=await Promise.all(skips.map(page)),all=[...first.results,...rest.flatMap(item=>item.results)],now=Date.now();
    const active=all.filter(item=>new Date(item.expiry).getTime()>now&&Number(item.details?.totalTvl??0)>0);
    const totalTvl=active.reduce((sum,item)=>sum+Number(item.details?.totalTvl??0),0),tradingVolume=active.reduce((sum,item)=>sum+Number(item.details?.tradingVolume??0),0);
    const chains=[...active.reduce((map,item)=>{const current=map.get(item.chainId)??{chainId:item.chainId,name:CHAIN_NAMES[item.chainId]??`Chain ${item.chainId}`,tvl:0,markets:0};current.tvl+=Number(item.details?.totalTvl??0);current.markets+=1;map.set(item.chainId,current);return map},new Map<number,{chainId:number;name:string;tvl:number;markets:number}>()).values()].sort((a,b)=>b.tvl-a.tvl);
    const expiry=(days:number)=>{const until=now+days*86_400_000,rows=active.filter(item=>new Date(item.expiry).getTime()<=until);return {days,markets:rows.length,tvl:rows.reduce((sum,item)=>sum+Number(item.details?.totalTvl??0),0)}};
    const topMarkets=[...active].sort((a,b)=>Number(b.details?.totalTvl??0)-Number(a.details?.totalTvl??0)).slice(0,12).map(item=>({name:item.name,protocol:item.protocol,chain:CHAIN_NAMES[item.chainId]??`Chain ${item.chainId}`,chainId:item.chainId,address:item.address,expiry:item.expiry,tvl:Number(item.details?.totalTvl??0),volume:Number(item.details?.tradingVolume??0),fixedApy:Number(item.details?.impliedApy??0),underlyingApy:Number(item.details?.underlyingApy??0),lpApy:Number(item.details?.aggregatedApy??0),ytApy:Number(item.details?.ytFloatingApy??0),pendleApy:Number(item.details?.pendleApy??0),isPrime:item.isPrime}));
    cached={totalTvl,tradingVolume,activeMarkets:active.length,chains,expiryWindows:[expiry(7),expiry(30),expiry(90)],topMarkets,source:"Pendle Core API /v2/markets/all · 未到期且 TVL 大于 0",updatedAt:new Date().toISOString()};cachedAt=Date.now();
    return NextResponse.json(cached,{headers});
  }catch(error){
    console.error("Pendle markets unavailable",error);
    if(cached)return NextResponse.json({...cached,stale:true},{headers:{"Cache-Control":"public, max-age=30, s-maxage=60, stale-while-revalidate=300"}});
    return NextResponse.json({error:"Pendle 活跃市场暂时不可用",updatedAt:new Date().toISOString()},{status:503,headers:{"Cache-Control":"no-store"}});
  }
}
