import { NextResponse } from "next/server";

const SETHFI="0x86B5780b606940Eb59A062aA85a07959518c0161";
const ACCOUNTANT="0x05A1552c5e18F5A0BB9571b5F2D6a4765ebdA32b";
const DELAYED="0x1509b1fdD01cAF9697aff514b9574B4A27173Dd2";
const MAX_SUPPLY=1_000_000_000;

const networks=[
  {name:"Ethereum",rpcs:["https://ethereum-rpc.publicnode.com","https://eth.llamarpc.com","https://rpc.flashbots.net"],ethfi:"0xfe0c30065b384f05761f15d0cc899d4f9f9cc0eb"},
  {name:"Optimism",rpcs:["https://optimism-rpc.publicnode.com","https://mainnet.optimism.io"],ethfi:"0xe0080d2F853ecDdbd81A643dC10DA075Df26fD3f"},
  {name:"Arbitrum",rpcs:["https://arbitrum-one-rpc.publicnode.com","https://arb1.arbitrum.io/rpc"],ethfi:"0x7189fb5b6504bbff6a852b13b7b82a3c118fdc27"},
  {name:"Base",rpcs:["https://base-rpc.publicnode.com","https://mainnet.base.org"],ethfi:"0x6c240dda6b5c336df09a4d011139beaaa1ea2aa2"},
] as const;

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

const addressArg=(address:string)=>address.toLowerCase().replace(/^0x/,"").padStart(64,"0");
const words=(value:string)=>value.slice(2).match(/.{64}/g)??[];

async function readWithdrawConfig(rpcUrl:string,asset:string){
  const result=await rpc(rpcUrl,"eth_call",[{to:DELAYED,data:`0xaa5a0ffd${addressArg(asset)}`},"latest"]),decoded=words(result);
  if(decoded.length<6)throw new Error("Invalid withdrawal config");
  return {
    withdrawEnabled:BigInt(`0x${decoded[0]}`)!==0n,
    withdrawDelay:Number(BigInt(`0x${decoded[1]}`)),
    completionWindow:Number(BigInt(`0x${decoded[2]}`)),
    pendingShares:Number(BigInt(`0x${decoded[3]}`))/1e18,
    withdrawFeeBps:Number(BigInt(`0x${decoded[4]}`)),
    maxLossBps:Number(BigInt(`0x${decoded[5]}`)),
  };
}

async function readNetwork(network:(typeof networks)[number]){
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

async function readExitQueue(network:(typeof networks)[number]){
  for(const rpcUrl of network.rpcs){
    try{
      const [withdraw,pending]=await Promise.all([
        readWithdrawConfig(rpcUrl,network.ethfi),
        call(rpcUrl,DELAYED,`0x3ac5427c${addressArg(network.ethfi)}`),
      ]);
      return {name:network.name,...withdraw,pending,available:true};
    }catch{}
  }
  return {name:network.name,withdrawEnabled:false,withdrawDelay:0,completionWindow:0,pendingShares:0,pending:0,withdrawFeeBps:0,maxLossBps:0,available:false};
}

export async function GET(){
  const exitNetworks=networks.filter(network=>network.name!=="Optimism");
  const [networkResults,exitQueues]=await Promise.all([Promise.allSettled(networks.map(readNetwork)),Promise.all(exitNetworks.map(readExitQueue))]);
  const failedChains=networkResults.flatMap((result,index)=>result.status==="rejected"?[networks[index].name]:[]);

  // A partial cross-chain sum is worse than no value: it made the live total look
  // like it had collapsed whenever one public RPC timed out. Never publish it.
  if(failedChains.length){
    return NextResponse.json({error:"跨链质押数据不完整，已拒绝发布部分汇总",failedChains,updatedAt:new Date().toISOString()},{status:503,headers:{"Cache-Control":"no-store"}});
  }

  const stakingChains=networkResults.map(result=>result.status==="fulfilled"?result.value:neverResult());
  const exitQueueComplete=exitQueues.every(queue=>queue.available);
  const chains=stakingChains.map(chain=>{const queue=exitQueues.find(item=>item.name===chain.name);return {...chain,pendingShares:queue?.available?queue.pendingShares:0,pending:queue?.available?queue.pending:0,pendingAvailable:queue?.available??false,withdrawEnabled:queue?.available?queue.withdrawEnabled:false,withdrawDelay:queue?.available?queue.withdrawDelay:0,completionWindow:queue?.available?queue.completionWindow:0}});
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
    pendingCoverage:exitQueues.filter(queue=>queue.available).map(queue=>queue.name),
    pendingComplete:exitQueueComplete,
    exitChain:"Ethereum · Arbitrum · Base",
    exitQueueAvailable:exitQueueComplete,
    withdrawEnabled:exitQueueComplete&&exitQueues.every(queue=>queue.withdrawEnabled),
    withdrawDelay:exitQueueComplete?Math.max(...exitQueues.map(queue=>queue.withdrawDelay)):0,
    completionWindow:exitQueueComplete?Math.max(...exitQueues.map(queue=>queue.completionWindow)):0,
    pendingLabel:"sETHFI 退出队列（已部署链）",
    exitQueues,
    chains,
    source:"Ethereum · Optimism · Arbitrum · Base 多 RPC 交叉容错",
    stale:false,
    updatedAt:new Date().toISOString(),
  },{headers:{"Cache-Control":"public, max-age=20, s-maxage=20, stale-while-revalidate=60"}});
}

function neverResult():never{throw new Error("Unreachable network result")}
