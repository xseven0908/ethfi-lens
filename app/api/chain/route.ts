import { NextResponse } from "next/server";

const SETHFI="0x86B5780b606940Eb59A062aA85a07959518c0161";
const ACCOUNTANT="0x05A1552c5e18F5A0BB9571b5F2D6a4765ebdA32b";
const MAX_SUPPLY=1_000_000_000;
const ATOMIC_UPDATED="0x9537495a2390e1a29f5f7e71b8540f5140bba27065f173615b770ad79d2f7960";
const ATOMIC_FULFILLED="0xa4e3f90ef19273220b37cbbbcfe402a6eadd9559c54813b9be52ea0c9612d6c9";
const MAINNET_ATOMIC_QUEUE="0xD45884B592E316eB816199615A95C182F75dea07";
const L2_ATOMIC_QUEUE="0xB149EF0f2539f1D9E1C9fd98d86E9C13A2aeC17A";

const networks=[
  {name:"Ethereum",rpcs:["https://ethereum-rpc.publicnode.com","https://eth.drpc.org","https://eth.blockscout.com/api/eth-rpc","https://eth.llamarpc.com","https://rpc.flashbots.net"],ethfi:"0xfe0c30065b384f05761f15d0cc899d4f9f9cc0eb"},
  {name:"Optimism",rpcs:["https://optimism-rpc.publicnode.com","https://optimism.drpc.org","https://mainnet.optimism.io"],ethfi:"0xe0080d2F853ecDdbd81A643dC10DA075Df26fD3f"},
  {name:"Arbitrum",rpcs:["https://arbitrum-one-rpc.publicnode.com","https://arbitrum.drpc.org","https://arbitrum.blockscout.com/api/eth-rpc","https://arb1.arbitrum.io/rpc"],ethfi:"0x7189fb5b6504bbff6a852b13b7b82a3c118fdc27"},
  {name:"Base",rpcs:["https://base-rpc.publicnode.com","https://base.drpc.org","https://mainnet.base.org"],ethfi:"0x6c240dda6b5c336df09a4d011139beaaa1ea2aa2"},
] as const;

const exitNetworks=[
  {name:"Ethereum",explorer:"https://eth.blockscout.com",queue:MAINNET_ATOMIC_QUEUE,lookbackBlocks:99_999,indexed:false,rpcFallback:"https://eth.blockscout.com/api/eth-rpc"},
  {name:"Arbitrum",explorer:"https://arbitrum.blockscout.com",queue:L2_ATOMIC_QUEUE,lookbackBlocks:6_000_000,indexed:false,rpcFallback:null},
  {name:"Base",explorer:"https://base.blockscout.com",queue:L2_ATOMIC_QUEUE,lookbackBlocks:800_000,indexed:true,rpcFallback:"https://base.gateway.tenderly.co"},
] as const;

type ChainReading={name:(typeof networks)[number]["name"];shares:number;rate:number;staked:number;tokenSupply:number;blockNumber:number;ok:true};
type ExplorerLog={blockNumber:string;data:string;logIndex:string;timeStamp:string;topics:Array<string|null>;transactionHash:string};

async function rpc(rpcUrl:string,method:string,params:unknown[]){
  const response=await fetch(rpcUrl,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params}),cache:"no-store",signal:AbortSignal.timeout(6500)});
  if(!response.ok)throw new Error("RPC unavailable");
  const payload=await response.json();
  if(payload.error||payload.result==null)throw new Error(payload.error?.message||"Empty RPC result");
  return payload.result as string;
}

async function call(rpcUrl:string,to:string,data:string){
  const result=await rpc(rpcUrl,"eth_call",[{to,data},"latest"]);
  if(result==="0x")throw new Error("Empty call");
  return Number(BigInt(result))/1e18;
}

async function readNetwork(network:(typeof networks)[number]):Promise<ChainReading>{
  let lastError:unknown;
  for(const rpcUrl of network.rpcs){
    try{
      const [shares,rate,tokenSupply,blockHex]=await Promise.all([
        call(rpcUrl,SETHFI,"0x18160ddd"),
        call(rpcUrl,ACCOUNTANT,"0x679aefce"),
        call(rpcUrl,network.ethfi,"0x18160ddd"),
        rpc(rpcUrl,"eth_blockNumber",[]),
      ]);
      return {name:network.name,shares,rate,staked:shares*rate,tokenSupply,blockNumber:Number(BigInt(blockHex)),ok:true};
    }catch(error){lastError=error}
  }
  throw lastError instanceof Error?lastError:new Error(`${network.name} RPC unavailable`);
}

const dataWord=(data:string,index:number)=>BigInt(`0x${data.slice(2+index*64,2+(index+1)*64)}`);
const topicToAddress=(topic:string)=>`0x${topic.slice(-40)}`.toLowerCase();
const dataToAddress=(data:string,index:number)=>`0x${data.slice(2+index*64+24,2+(index+1)*64)}`.toLowerCase();

async function fetchExplorerLogs(network:(typeof exitNetworks)[number],topic:string,fromBlock:number){
  const params=new URLSearchParams({
    module:"logs",action:"getLogs",fromBlock:String(Math.max(0,fromBlock)),toBlock:"latest",
    address:network.queue,topic0:topic,page:"1",offset:"1000",
  });
  if(network.indexed){params.set("topic2",`0x${SETHFI.toLowerCase().replace(/^0x/,"").padStart(64,"0")}`);params.set("topic0_2_opr","and")}
  const response=await fetch(`${network.explorer}/api?${params}`,{cache:"no-store",signal:AbortSignal.timeout(20_000)});
  if(!response.ok)throw new Error(`${network.name} explorer unavailable`);
  const payload=await response.json() as {message?:string;result?:ExplorerLog[]|string};
  if(payload.message==="No records found"||payload.message==="No logs found")return [];
  if(!Array.isArray(payload.result))throw new Error(`${network.name} explorer returned invalid logs`);
  if(payload.result.length>=1000)throw new Error(`${network.name} queue log window was truncated`);
  return payload.result;
}

async function fetchRpcLogs(network:(typeof exitNetworks)[number],topic:string,fromBlock:number){
  if(!network.rpcFallback)throw new Error(`${network.name} has no queue RPC fallback`);
  const response=await fetch(network.rpcFallback,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"eth_getLogs",params:[{fromBlock:`0x${Math.max(0,fromBlock).toString(16)}`,toBlock:"latest",address:network.queue,topics:[topic]}]}),cache:"no-store",signal:AbortSignal.timeout(20_000)});
  if(!response.ok)throw new Error(`${network.name} queue RPC unavailable`);
  const payload=await response.json() as {result?:ExplorerLog[];error?:{message?:string}};
  if(payload.error||!Array.isArray(payload.result))throw new Error(payload.error?.message||`${network.name} queue RPC returned invalid logs`);
  return payload.result;
}

async function fetchAtomicLogs(network:(typeof exitNetworks)[number],topic:string,fromBlock:number){
  try{return await fetchExplorerLogs(network,topic,fromBlock)}
  catch{return fetchRpcLogs(network,topic,fromBlock)}
}

async function readAtomicQueue(network:(typeof exitNetworks)[number],chain:ChainReading){
  try{
    const fromBlock=chain.blockNumber-network.lookbackBlocks;
    const [updates,fulfilled]=await Promise.all([
      fetchAtomicLogs(network,ATOMIC_UPDATED,fromBlock),
      fetchAtomicLogs(network,ATOMIC_FULFILLED,fromBlock),
    ]);
    const events=[
      ...updates.map(log=>({kind:"updated" as const,log})),
      ...fulfilled.map(log=>({kind:"fulfilled" as const,log})),
    ].sort((a,b)=>{
      const blockA=BigInt(a.log.blockNumber),blockB=BigInt(b.log.blockNumber);
      if(blockA!==blockB)return blockA<blockB?-1:1;
      const indexA=BigInt(a.log.logIndex),indexB=BigInt(b.log.logIndex);
      return indexA===indexB?0:indexA<indexB?-1:1;
    });
    const latest=new Map<string,{kind:"updated"|"fulfilled";amount:bigint;deadline:number;duration:number;txHash:string}>();
    for(const event of events){
      const indexed=event.log.topics.length>=4&&event.log.topics[1]!=null&&event.log.topics[2]!=null&&event.log.topics[3]!=null;
      const user=indexed?topicToAddress(event.log.topics[1]!):dataToAddress(event.log.data,0);
      const offer=indexed?topicToAddress(event.log.topics[2]!):dataToAddress(event.log.data,1);
      const want=indexed?topicToAddress(event.log.topics[3]!):dataToAddress(event.log.data,2);
      if(offer!==SETHFI.toLowerCase())continue;
      const key=`${user}|${offer}|${want}`,offset=indexed?0:3;
      if(event.kind==="updated"){
        const deadline=Number(dataWord(event.log.data,offset+1)),createdAt=Number(dataWord(event.log.data,offset+3));
        latest.set(key,{kind:event.kind,amount:dataWord(event.log.data,offset),deadline,duration:Math.max(0,deadline-createdAt),txHash:event.log.transactionHash});
      }else latest.set(key,{kind:event.kind,amount:0n,deadline:0,duration:0,txHash:event.log.transactionHash});
    }
    const now=Math.floor(Date.now()/1000);
    const open=[...latest.values()].filter(item=>item.kind==="updated"&&item.amount>0n&&item.deadline>now);
    const pendingRaw=open.reduce((sum,item)=>sum+item.amount,0n);
    const pendingShares=Number(pendingRaw)/1e18;
    return {
      name:network.name,queueContract:network.queue,queueType:"AtomicQueue",pendingShares,pending:pendingShares*chain.rate,
      requestCount:open.length,requestWindow:open.reduce((max,item)=>Math.max(max,item.duration),0),
      nextDeadline:open.length?new Date(Math.min(...open.map(item=>item.deadline))*1000).toISOString():null,
      scannedEvents:events.length,available:true,
    };
  }catch{
    return {name:network.name,queueContract:network.queue,queueType:"AtomicQueue",pendingShares:0,pending:0,requestCount:0,requestWindow:0,nextDeadline:null,scannedEvents:0,available:false};
  }
}

export async function GET(){
  const networkResults=await Promise.allSettled(networks.map(readNetwork));
  const failedChains=networkResults.flatMap((result,index)=>result.status==="rejected"?[networks[index].name]:[]);

  // Never publish a partial four-chain staking total.
  if(failedChains.length){
    return NextResponse.json({error:"跨链质押数据不完整，已拒绝发布部分汇总",failedChains,updatedAt:new Date().toISOString()},{status:503,headers:{"Cache-Control":"no-store"}});
  }

  const stakingChains=networkResults.map(result=>result.status==="fulfilled"?result.value:neverResult());
  const exitQueues=await Promise.all(exitNetworks.map(network=>{
    const chain=stakingChains.find(item=>item.name===network.name)!;
    return readAtomicQueue(network,chain);
  }));
  const exitQueueComplete=exitQueues.every(queue=>queue.available);
  const chains=stakingChains.map(chain=>{
    const queue=exitQueues.find(item=>item.name===chain.name);
    return {...chain,pendingShares:queue?.available?queue.pendingShares:0,pending:queue?.available?queue.pending:0,pendingRequests:queue?.available?queue.requestCount:0,pendingAvailable:queue?.available??false};
  });
  const ethereum=stakingChains.find(x=>x.name==="Ethereum")!;
  const mainnetSupply=ethereum.tokenSupply;

  return NextResponse.json({
    ethfiSupply:MAX_SUPPLY,
    mainnetSupply,
    supplyAdjustment:Math.max(0,MAX_SUPPLY-mainnetSupply),
    burned:0,
    burnStatus:"官方未启用代币销毁；回购所得分配给 sETHFI 持有人",
    totalShares:stakingChains.reduce((sum,x)=>sum+x.shares,0),
    exchangeRate:ethereum.rate,
    staked:stakingChains.reduce((sum,x)=>sum+x.staked,0),
    pendingShares:exitQueueComplete?exitQueues.reduce((sum,x)=>sum+x.pendingShares,0):0,
    pending:exitQueueComplete?exitQueues.reduce((sum,x)=>sum+x.pending,0):0,
    pendingRequests:exitQueueComplete?exitQueues.reduce((sum,x)=>sum+x.requestCount,0):0,
    pendingCoverage:exitQueues.filter(queue=>queue.available).map(queue=>queue.name),
    pendingComplete:exitQueueComplete,
    exitChain:"Ethereum · Arbitrum · Base",
    exitQueueAvailable:exitQueueComplete,
    requestWindow:exitQueueComplete?Math.max(...exitQueues.map(queue=>queue.requestWindow)):0,
    pendingLabel:"sETHFI AtomicQueue 退出队列",
    exitQueues,
    chains,
    source:"Ethereum · Optimism · Arbitrum · Base 多 RPC 交叉容错；退出队列为 AtomicQueue 链上事件",
    stale:false,
    updatedAt:new Date().toISOString(),
  },{headers:{"Cache-Control":"public, max-age=20, s-maxage=20, stale-while-revalidate=60"}});
}

function neverResult():never{throw new Error("Unreachable network result")}
