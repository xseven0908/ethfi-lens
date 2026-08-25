import { NextResponse } from "next/server";

const SETHFI="0x86B5780b606940Eb59A062aA85a07959518c0161";
const ACCOUNTANT="0x05A1552c5e18F5A0BB9571b5F2D6a4765ebdA32b";
const ZERO_TOPIC="0x0000000000000000000000000000000000000000000000000000000000000000";
const TRANSFER_TOPIC="0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const RATE_TOPIC="0xa95bc6aba40bbc4d95fc35f118c4cd8b53fc5d5b89ed264002af03503a7a9439";
const DAY=86_400;

const networks=[
  {name:"Ethereum",rpc:"https://ethereum-rpc.publicnode.com",explorer:"https://eth.blockscout.com"},
  {name:"Optimism",rpc:"https://optimism-rpc.publicnode.com",explorer:"https://optimism.blockscout.com"},
  {name:"Arbitrum",rpc:"https://arbitrum-one-rpc.publicnode.com",explorer:"https://arbitrum.blockscout.com"},
  {name:"Base",rpc:"https://base-rpc.publicnode.com",explorer:"https://base.blockscout.com"},
] as const;

type ExplorerLog={blockNumber:string;data:string;timeStamp:string};
type SupplyEvent={timestamp:number;change:number};
type RateEvent={timestamp:number;rate:number};

async function json(url:string,timeout=10_000){
  let lastError:unknown;
  for(let attempt=0;attempt<3;attempt++){
    try{
      const response=await fetch(url,{cache:"no-store",signal:AbortSignal.timeout(timeout)});
      if(!response.ok)throw new Error(`Explorer ${response.status}`);
      const payload=await response.json();
      if(String(payload.status)==="0"&&/no (records|logs) found/i.test(`${payload.message||""} ${payload.result||""}`))payload.result=[];
      if(String(payload.status)!=="1"&&!Array.isArray(payload.result))throw new Error(payload.message||"Explorer unavailable");
      return payload;
    }catch(error){
      lastError=error;
      if(attempt<2)await new Promise(resolve=>setTimeout(resolve,250*(attempt+1)));
    }
  }
  throw lastError;
}

async function rpc(rpcUrl:string,method:string,params:unknown[]){
  const response=await fetch(rpcUrl,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params}),cache:"no-store",signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw new Error("RPC unavailable");
  const payload=await response.json();
  if(payload.error||payload.result==null)throw new Error(payload.error?.message||"Empty RPC result");
  return payload.result as string;
}

async function currentNetwork(rpcUrl:string){
  const [sharesHex,blockHex]=await Promise.all([
    rpc(rpcUrl,"eth_call",[{to:SETHFI,data:"0x18160ddd"},"latest"]),
    rpc(rpcUrl,"eth_blockNumber",[]),
  ]);
  return {shares:Number(BigInt(sharesHex))/1e18,block:Number(BigInt(blockHex))};
}

async function startBlock(explorer:string,timestamp:number){
  const payload=await json(`${explorer}/api?module=block&action=getblocknobytime&timestamp=${timestamp}&closest=before`);
  return Number(payload.result.blockNumber);
}

async function logs(explorer:string,fromBlock:number,toBlock:number,topicIndex:1|2):Promise<ExplorerLog[]>{
  const operator=`topic0_${topicIndex}_opr`;
  const url=`${explorer}/api?module=logs&action=getLogs&fromBlock=${fromBlock}&toBlock=${toBlock}&address=${SETHFI}&topic0=${TRANSFER_TOPIC}&${operator}=and&topic${topicIndex}=${ZERO_TOPIC}`;
  const payload=await json(url,15_000),items=(payload.result||[]) as ExplorerLog[];
  if(items.length<1000||fromBlock>=toBlock)return items;
  const middle=Math.floor((fromBlock+toBlock)/2);
  const [left,right]=await Promise.all([logs(explorer,fromBlock,middle,topicIndex),logs(explorer,middle+1,toBlock,topicIndex)]);
  return [...left,...right];
}

async function supplyEvents(network:(typeof networks)[number],cutoff:number){
  const [current,fromBlock]=await Promise.all([currentNetwork(network.rpc),startBlock(network.explorer,cutoff)]);
  const [mints,burns]=await Promise.all([logs(network.explorer,fromBlock,current.block,1),logs(network.explorer,fromBlock,current.block,2)]);
  const convert=(item:ExplorerLog,sign:1|-1):SupplyEvent=>({timestamp:Number(BigInt(item.timeStamp)),change:sign*Number(BigInt(item.data))/1e18});
  return {name:network.name,currentShares:current.shares,events:[...mints.map(x=>convert(x,1)),...burns.map(x=>convert(x,-1))].filter(x=>x.timestamp>=cutoff)};
}

async function rateEvents():Promise<RateEvent[]>{
  const explorer=networks[0].explorer,url=`${explorer}/api?module=logs&action=getLogs&fromBlock=0&toBlock=latest&address=${ACCOUNTANT}&topic0=${RATE_TOPIC}`;
  const payload=await json(url,15_000);
  return ((payload.result||[]) as ExplorerLog[]).map(item=>{
    const words=item.data.slice(2).match(/.{64}/g)??[];
    return {timestamp:words[2]?Number(BigInt(`0x${words[2]}`)):Number(BigInt(item.timeStamp)),rate:words[1]?Number(BigInt(`0x${words[1]}`))/1e18:0};
  }).filter(x=>x.rate>0).sort((a,b)=>a.timestamp-b.timestamp);
}

export async function GET(){
  try{
    const now=Math.floor(Date.now()/1000),cutoff=now-91*DAY;
    const [networkHistory,rates]=await Promise.all([Promise.all(networks.map(x=>supplyEvents(x,cutoff))),rateEvents()]);
    if(!rates.length)throw new Error("No exchange-rate history");
    const points:Array<[number,number,number]>=[];
    for(let timestamp=Math.floor(cutoff/DAY)*DAY;timestamp<now;timestamp+=DAY){
      const shares=networkHistory.reduce((sum,network)=>sum+network.currentShares-network.events.filter(event=>event.timestamp>timestamp).reduce((net,event)=>net+event.change,0),0);
      const rate=rates.filter(event=>event.timestamp<=timestamp).at(-1)?.rate??rates[0].rate;
      points.push([timestamp*1000,Math.max(0,shares),Math.max(0,shares*rate)]);
    }
    const currentShares=networkHistory.reduce((sum,x)=>sum+x.currentShares,0),currentRate=rates.at(-1)!.rate;
    points.push([now*1000,currentShares,currentShares*currentRate]);
    return NextResponse.json({points,rangeDays:90,chains:networkHistory.map(x=>x.name),source:"Blockscout 链上 Transfer · Accountant ExchangeRateUpdated",method:"四链 sETHFI 铸造/销毁净额 × 当日兑换率",rateUpdatedAt:new Date(rates.at(-1)!.timestamp*1000).toISOString(),updatedAt:new Date().toISOString()},{headers:{"Cache-Control":"public, max-age=300, s-maxage=900, stale-while-revalidate=1800"}});
  }catch(error){
    console.error("staking history unavailable",error);
    return NextResponse.json({error:"历史质押数据暂时不可用"},{status:503,headers:{"Cache-Control":"no-store"}});
  }
}
