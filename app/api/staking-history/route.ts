import { NextResponse } from "next/server";

const SETHFI="0x86B5780b606940Eb59A062aA85a07959518c0161";
const ACCOUNTANT="0x05A1552c5e18F5A0BB9571b5F2D6a4765ebdA32b";
const ZERO_TOPIC="0x0000000000000000000000000000000000000000000000000000000000000000";
const TRANSFER_TOPIC="0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const RATE_TOPIC="0xa95bc6aba40bbc4d95fc35f118c4cd8b53fc5d5b89ed264002af03503a7a9439";
const ATOMIC_UPDATED="0x9537495a2390e1a29f5f7e71b8540f5140bba27065f173615b770ad79d2f7960";
const ATOMIC_FULFILLED="0xa4e3f90ef19273220b37cbbbcfe402a6eadd9559c54813b9be52ea0c9612d6c9";
const BORING_REQUESTED="0x2eb08ebdb4d68b4a37e3b424927f3363e1d799ca7e56e7b2c59cc6c1778d33f5";
const BORING_SOLVED="0xd94fc49a6578873ff851671d19cacb1809887f7a9128867ee4306dc3ffc93c26";
const BORING_CANCELLED="0x114ef421aef557f2e4086396789e7fb532b1133ff2982c9d948daa73d0691e36";
const MAINNET_ATOMIC_QUEUE="0xD45884B592E316eB816199615A95C182F75dea07";
const L2_ATOMIC_QUEUE="0xB149EF0f2539f1D9E1C9fd98d86E9C13A2aeC17A";
const OP_BORING_QUEUE="0xF03352da1536F31172A7F7cB092D4717DeDDd3CB";
const OP_ETHFI="0xe0080d2F853ecDdbd81A643dC10DA075Df26fD3f";
const DAY=86_400;

const networks=[
  {name:"Ethereum",rpcs:["https://ethereum-rpc.publicnode.com","https://eth.drpc.org","https://eth.blockscout.com/api/eth-rpc"],explorer:"https://eth.blockscout.com",supplyLookbackBlocks:690_000,exitLookbackBlocks:805_000},
  {name:"Optimism",rpcs:["https://optimism-rpc.publicnode.com","https://optimism.drpc.org","https://mainnet.optimism.io"],explorer:"https://optimism.blockscout.com",supplyLookbackBlocks:4_150_000,exitLookbackBlocks:4_820_000},
  {name:"Arbitrum",rpcs:["https://arbitrum-one-rpc.publicnode.com","https://arbitrum.drpc.org","https://arbitrum.blockscout.com/api/eth-rpc"],explorer:"https://arbitrum.blockscout.com",supplyLookbackBlocks:33_000_000,exitLookbackBlocks:38_500_000},
  {name:"Base",rpcs:["https://base-rpc.publicnode.com","https://base.drpc.org","https://mainnet.base.org"],explorer:"https://base.blockscout.com",supplyLookbackBlocks:4_150_000,exitLookbackBlocks:4_820_000},
] as const;

const exitNetworks=[
  {name:"Ethereum",explorer:"https://eth.blockscout.com",queue:MAINNET_ATOMIC_QUEUE,kind:"atomic" as const},
  {name:"Optimism",explorer:"https://optimism.blockscout.com",queue:OP_BORING_QUEUE,kind:"boring" as const},
  {name:"Arbitrum",explorer:"https://arbitrum.blockscout.com",queue:L2_ATOMIC_QUEUE,kind:"atomic" as const},
  {name:"Base",explorer:"https://base.blockscout.com",queue:L2_ATOMIC_QUEUE,kind:"atomic" as const},
] as const;

type ExplorerLog={blockNumber:string;data:string;logIndex:string;timeStamp:string;topics:Array<string|null>;transactionHash:string};
type SupplyEvent={timestamp:number;change:number};
type RateEvent={timestamp:number;rate:number};
type NetworkPoint={shares:number;block:number};
type ExitSnapshot={shares:number;assets:number};
type ExitSampler={name:string;sample:(timestamp:number,rate:number)=>ExitSnapshot};
const HISTORY_REFRESH_MS=300_000;
let cachedHistory:Record<string,unknown>|null=null;
let cachedAt=0;
const blockedExplorers=new Map<string,number>();

async function json(url:string,timeout=10_000){
  let lastError:unknown;const hostname=new URL(url).hostname;
  if((blockedExplorers.get(hostname)??0)>Date.now())throw new Error(`Explorer 429 ${hostname}`);
  for(let attempt=0;attempt<3;attempt++){
    try{
      const response=await fetch(url,{cache:"no-store",signal:AbortSignal.timeout(timeout)});
      if(response.status===429){blockedExplorers.set(hostname,Date.now()+60_000);throw new Error(`Explorer 429 ${hostname}`)}
      if(!response.ok)throw new Error(`Explorer ${response.status} ${hostname}`);
      const payload=await response.json();
      if(/rate limit/i.test(`${payload.message||""} ${payload.result||""}`)){blockedExplorers.set(hostname,Date.now()+60_000);throw new Error(`Explorer 429 ${hostname}`)}
      if(String(payload.status)==="0"&&/no (records|logs) found/i.test(`${payload.message||""} ${payload.result||""}`))payload.result=[];
      if(String(payload.status)!=="1"&&!Array.isArray(payload.result))throw new Error(payload.message||"Explorer unavailable");
      return payload;
    }catch(error){lastError=error;if(error instanceof Error&&error.message.includes("Explorer 429"))throw error;if(attempt<2)await new Promise(resolve=>setTimeout(resolve,1000*2**attempt+Math.floor(Math.random()*750)))}
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

async function currentNetwork(rpcs:readonly string[]){
  let lastError:unknown;
  for(const rpcUrl of rpcs){
    try{
      const [sharesHex,blockHex]=await Promise.all([rpc(rpcUrl,"eth_call",[{to:SETHFI,data:"0x18160ddd"},"latest"]),rpc(rpcUrl,"eth_blockNumber",[])]);
      return {shares:Number(BigInt(sharesHex))/1e18,block:Number(BigInt(blockHex))};
    }catch(error){lastError=error}
  }
  throw lastError instanceof Error?lastError:new Error("Network RPC unavailable");
}

async function readCurrentRate(){
  let lastError:unknown;
  for(const rpcUrl of networks[0].rpcs){try{return Number(BigInt(await rpc(rpcUrl,"eth_call",[{to:ACCOUNTANT,data:"0x679aefce"},"latest"])))/1e18}catch(error){lastError=error}}
  throw lastError instanceof Error?lastError:new Error("Accountant RPC unavailable");
}

async function topicLogs(explorer:string,address:string,topic:string,fromBlock:number,toBlock:number,extra=""):Promise<ExplorerLog[]>{
  const url=`${explorer}/api?module=logs&action=getLogs&fromBlock=${fromBlock}&toBlock=${toBlock}&address=${address}&topic0=${topic}${extra}`;
  const payload=await json(url,20_000),items=(payload.result||[]) as ExplorerLog[];
  if(items.length<1000||fromBlock>=toBlock)return items;
  const middle=Math.floor((fromBlock+toBlock)/2);
  const left=await topicLogs(explorer,address,topic,fromBlock,middle,extra);await pause(250);const right=await topicLogs(explorer,address,topic,middle+1,toBlock,extra);
  return [...left,...right];
}

async function transferLogs(explorer:string,fromBlock:number,toBlock:number,topicIndex:1|2):Promise<ExplorerLog[]>{
  return topicLogs(explorer,SETHFI,TRANSFER_TOPIC,fromBlock,toBlock,`&topic0_${topicIndex}_opr=and&topic${topicIndex}=${ZERO_TOPIC}`);
}

async function supplyEvents(network:(typeof networks)[number],cutoff:number,current:NetworkPoint,fromBlock:number){
  const mints=await transferLogs(network.explorer,fromBlock,current.block,1);await pause(300);const burns=await transferLogs(network.explorer,fromBlock,current.block,2);
  const convert=(item:ExplorerLog,sign:1|-1):SupplyEvent=>({timestamp:Number(BigInt(item.timeStamp)),change:sign*Number(BigInt(item.data))/1e18});
  return {name:network.name,currentShares:current.shares,events:[...mints.map(x=>convert(x,1)),...burns.map(x=>convert(x,-1))].filter(x=>x.timestamp>=cutoff)};
}

async function rateEvents():Promise<RateEvent[]>{
  const explorer=networks[0].explorer,url=`${explorer}/api?module=logs&action=getLogs&fromBlock=0&toBlock=latest&address=${ACCOUNTANT}&topic0=${RATE_TOPIC}`;
  const payload=await json(url,20_000);
  return ((payload.result||[]) as ExplorerLog[]).map(item=>{const words=item.data.slice(2).match(/.{64}/g)??[];return {timestamp:words[2]?Number(BigInt(`0x${words[2]}`)):Number(BigInt(item.timeStamp)),rate:words[1]?Number(BigInt(`0x${words[1]}`))/1e18:0}}).filter(x=>x.rate>0).sort((a,b)=>a.timestamp-b.timestamp);
}

const dataWord=(data:string,index:number)=>BigInt(`0x${data.slice(2+index*64,2+(index+1)*64)}`);
const topicToAddress=(topic:string)=>`0x${topic.slice(-40)}`.toLowerCase();
const dataToAddress=(data:string,index:number)=>`0x${data.slice(2+index*64+24,2+(index+1)*64)}`.toLowerCase();
const logTimestamp=(log:ExplorerLog)=>Number(BigInt(log.timeStamp));
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

async function atomicExitSampler(network:(typeof exitNetworks)[number],fromBlock:number,toBlock:number):Promise<ExitSampler>{
  const updates=await topicLogs(network.explorer,network.queue,ATOMIC_UPDATED,fromBlock,toBlock);await pause(300);const fulfilled=await topicLogs(network.explorer,network.queue,ATOMIC_FULFILLED,fromBlock,toBlock);
  const events=[...updates.map(log=>({kind:"updated" as const,log})),...fulfilled.map(log=>({kind:"fulfilled" as const,log}))].sort((a,b)=>logTimestamp(a.log)-logTimestamp(b.log)||Number(BigInt(a.log.logIndex))-Number(BigInt(b.log.logIndex)));
  const parsed=events.flatMap(event=>{
    const indexed=event.log.topics.length>=4&&event.log.topics[1]!=null&&event.log.topics[2]!=null&&event.log.topics[3]!=null;
    const user=indexed?topicToAddress(event.log.topics[1]!):dataToAddress(event.log.data,0),offer=indexed?topicToAddress(event.log.topics[2]!):dataToAddress(event.log.data,1),want=indexed?topicToAddress(event.log.topics[3]!):dataToAddress(event.log.data,2);
    if(offer!==SETHFI.toLowerCase())return [];
    const offset=indexed?0:3,timestamp=logTimestamp(event.log),key=`${user}|${offer}|${want}`;
    return event.kind==="updated"?[{kind:event.kind,key,timestamp,shares:Number(dataWord(event.log.data,offset))/1e18,deadline:Number(dataWord(event.log.data,offset+1))}]:[{kind:event.kind,key,timestamp,shares:0,deadline:0}];
  });
  return {name:network.name,sample(timestamp,rate){
    const latest=new Map<string,(typeof parsed)[number]>();for(const event of parsed){if(event.timestamp>timestamp)break;latest.set(event.key,event)}
    const shares=[...latest.values()].reduce((sum,event)=>sum+(event.kind==="updated"&&event.deadline>timestamp?event.shares:0),0);
    return {shares,assets:shares*rate};
  }};
}

async function boringExitSampler(network:(typeof exitNetworks)[number],fromBlock:number,toBlock:number):Promise<ExitSampler>{
  const requested=await topicLogs(network.explorer,network.queue,BORING_REQUESTED,fromBlock,toBlock);await pause(300);const solved=await topicLogs(network.explorer,network.queue,BORING_SOLVED,fromBlock,toBlock);await pause(300);const cancelled=await topicLogs(network.explorer,network.queue,BORING_CANCELLED,fromBlock,toBlock);
  const closures=new Map<string,number>();
  for(const log of [...solved,...cancelled]){const id=log.topics[1]?.toLowerCase();if(!id)continue;const timestamp=logTimestamp(log),previous=closures.get(id);if(previous==null||timestamp<previous)closures.set(id,timestamp)}
  const requests=requested.flatMap(log=>{const id=log.topics[1]?.toLowerCase(),asset=log.topics[3];if(!id||!asset||topicToAddress(asset)!==OP_ETHFI.toLowerCase())return [];const createdAt=Number(dataWord(log.data,3)),deadline=createdAt+Number(dataWord(log.data,5));return [{id,createdAt,deadline,closedAt:closures.get(id)??null,shares:Number(dataWord(log.data,1))/1e18,assets:Number(dataWord(log.data,2))/1e18}]});
  return {name:network.name,sample(timestamp){return requests.reduce((sum,request)=>request.createdAt<=timestamp&&request.deadline>timestamp&&(request.closedAt==null||request.closedAt>timestamp)?{shares:sum.shares+request.shares,assets:sum.assets+request.assets}:sum,{shares:0,assets:0})}};
}

async function exitSampler(network:(typeof exitNetworks)[number],fromBlock:number,current:NetworkPoint):Promise<ExitSampler>{
  return network.kind==="atomic"?atomicExitSampler(network,fromBlock,current.block):boringExitSampler(network,fromBlock,current.block);
}

export async function GET(){
  const headers={"Cache-Control":"public, max-age=60, s-maxage=300, stale-while-revalidate=600"};
  if(cachedHistory&&Date.now()-cachedAt<HISTORY_REFRESH_MS)return NextResponse.json(cachedHistory,{headers});
  try{
    const now=Math.floor(Date.now()/1000),cutoff=now-91*DAY;
    const [contexts,historicalRates,liveRate]=await Promise.all([Promise.all(networks.map(async network=>{const current=await currentNetwork(network.rpcs),supplyFromBlock=Math.max(0,current.block-network.supplyLookbackBlocks),exitFromBlock=Math.max(0,current.block-network.exitLookbackBlocks);return {network,current,supplyFromBlock,exitFromBlock}})),rateEvents().catch(()=>[] as RateEvent[]),readCurrentRate()]);
    const rateHistoryAvailable=historicalRates.length>0,rates=rateHistoryAvailable?[...historicalRates,{timestamp:now,rate:liveRate}]:[{timestamp:cutoff,rate:liveRate},{timestamp:now,rate:liveRate}];
    const failedSources:string[]=rateHistoryAvailable?[]:["兑换率历史"];
    const histories=await Promise.all(contexts.map(async context=>{
      const exitNetwork=exitNetworks.find(network=>network.name===context.network.name)!;
      let supply:Awaited<ReturnType<typeof supplyEvents>>;
      try{supply=await supplyEvents(context.network,cutoff,context.current,context.supplyFromBlock)}catch{failedSources.push(`${context.network.name} 质押历史`);supply={name:context.network.name,currentShares:context.current.shares,events:[]}}
      let exit:ExitSampler;
      try{exit=await exitSampler(exitNetwork,context.exitFromBlock,context.current)}catch{failedSources.push(`${context.network.name} 退出历史`);exit={name:context.network.name,sample:()=>({shares:0,assets:0})}}
      return {supply,exit};
    }));
    const networkHistory=histories.map(history=>history.supply),exitHistory=histories.map(history=>history.exit);
    if(!rates.length)throw new Error("No exchange-rate history");
    const points:Array<[number,number,number,number,number,number]>=[];
    for(let timestamp=Math.floor(cutoff/DAY)*DAY;timestamp<now;timestamp+=DAY){
      const shares=networkHistory.reduce((sum,network)=>sum+network.currentShares-network.events.filter(event=>event.timestamp>timestamp).reduce((net,event)=>net+event.change,0),0);
      const rate=rates.filter(event=>event.timestamp<=timestamp).at(-1)?.rate??rates[0].rate;
      const exit=exitHistory.reduce((sum,network)=>{const snapshot=network.sample(timestamp,rate);return {shares:sum.shares+snapshot.shares,assets:sum.assets+snapshot.assets}},{shares:0,assets:0});
      const assets=Math.max(0,shares*rate);points.push([timestamp*1000,Math.max(0,shares),assets,Math.max(0,exit.shares),Math.max(0,exit.assets),Math.max(0,assets-exit.assets)]);
    }
    const currentShares=networkHistory.reduce((sum,x)=>sum+x.currentShares,0),currentRate=rates.at(-1)!.rate,currentAssets=currentShares*currentRate;
    const currentExit=exitHistory.reduce((sum,network)=>{const snapshot=network.sample(now,currentRate);return {shares:sum.shares+snapshot.shares,assets:sum.assets+snapshot.assets}},{shares:0,assets:0});
    points.push([now*1000,currentShares,currentAssets,currentExit.shares,currentExit.assets,Math.max(0,currentAssets-currentExit.assets)]);
    cachedHistory={points,rangeDays:90,chains:networkHistory.map(x=>x.name),exitChains:exitHistory.map(x=>x.name),complete:failedSources.length===0,failedSources,source:"Blockscout 链上 Transfer、AtomicQueue、BoringOnChainQueue · Accountant ExchangeRateUpdated",method:"四链 sETHFI 存量、退出中资产与扣除退出后的净质押敞口，每日事件回放",refreshSeconds:300,rateUpdatedAt:new Date(rates.at(-1)!.timestamp*1000).toISOString(),updatedAt:new Date().toISOString()};cachedAt=Date.now();
    return NextResponse.json(cachedHistory,{headers});
  }catch(error){
    console.error("staking history unavailable",error);
    if(cachedHistory)return NextResponse.json({...cachedHistory,stale:true},{headers:{"Cache-Control":"public, max-age=30, s-maxage=60, stale-while-revalidate=300"}});
    return NextResponse.json({error:"历史质押与退出数据暂时不可用"},{status:503,headers:{"Cache-Control":"no-store"}});
  }
}
