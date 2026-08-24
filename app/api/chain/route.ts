import { NextResponse } from "next/server";

const SETHFI="0x86B5780b606940Eb59A062aA85a07959518c0161",ACCOUNTANT="0x05A1552c5e18F5A0BB9571b5F2D6a4765ebdA32b",DELAYED="0x1509b1fdD01cAF9697aff514b9574B4A27173Dd2",MAX_SUPPLY=1_000_000_000;
const networks=[{name:"Ethereum",rpc:"https://ethereum-rpc.publicnode.com",ethfi:"0xfe0c30065b384f05761f15d0cc899d4f9f9cc0eb"},{name:"Arbitrum",rpc:"https://arbitrum-one-rpc.publicnode.com",ethfi:"0x7189fb5b6504bbff6a852b13b7b82a3c118fdc27"},{name:"Base",rpc:"https://base-rpc.publicnode.com",ethfi:"0x6c240dda6b5c336df09a4d011139beaaa1ea2aa2"}] as const;
async function rpc(rpcUrl:string,method:string,params:unknown[]){const response=await fetch(rpcUrl,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params}),cache:"no-store",signal:AbortSignal.timeout(6500)});if(!response.ok)throw new Error("RPC unavailable");const payload=await response.json();if(payload.error||payload.result==null)throw new Error(payload.error?.message||"Empty RPC result");return payload.result as string}
async function call(rpcUrl:string,to:string,data:string){const result=await rpc(rpcUrl,"eth_call",[{to,data},"latest"]);if(result==="0x")throw new Error("Empty call");return Number(BigInt(result))/1e18}
const addressArg=(address:string)=>address.toLowerCase().replace(/^0x/,"").padStart(64,"0");
const words=(value:string)=>value.slice(2).match(/.{64}/g)??[];
async function readWithdrawConfig(rpcUrl:string,asset:string){
  const result=await rpc(rpcUrl,"eth_call",[{to:DELAYED,data:`0xaa5a0ffd${addressArg(asset)}`},"latest"]),decoded=words(result);
  if(decoded.length<6)throw new Error("Invalid withdrawal config");
  return {withdrawEnabled:BigInt(`0x${decoded[0]}`)!==0n,withdrawDelay:Number(BigInt(`0x${decoded[1]}`)),completionWindow:Number(BigInt(`0x${decoded[2]}`)),pendingShares:Number(BigInt(`0x${decoded[3]}`))/1e18,withdrawFeeBps:Number(BigInt(`0x${decoded[4]}`)),maxLossBps:Number(BigInt(`0x${decoded[5]}`))};
}
async function readNetwork(network:(typeof networks)[number]){
  const [shares,rate,withdraw,withdrawDebt,tokenSupply,blockHex]=await Promise.all([call(network.rpc,SETHFI,"0x18160ddd"),call(network.rpc,ACCOUNTANT,"0x679aefce"),readWithdrawConfig(network.rpc,network.ethfi),call(network.rpc,DELAYED,`0x3ac5427c${addressArg(network.ethfi)}`),call(network.rpc,network.ethfi,"0x18160ddd"),rpc(network.rpc,"eth_blockNumber",[])]);
  return {name:network.name,shares,rate,staked:shares*rate,pendingShares:withdraw.pendingShares,pending:withdrawDebt,withdrawEnabled:withdraw.withdrawEnabled,withdrawDelay:withdraw.withdrawDelay,completionWindow:withdraw.completionWindow,tokenSupply,blockNumber:Number(BigInt(blockHex)),ok:true};
}

export async function GET(){
  const results=await Promise.allSettled(networks.map(readNetwork));
  const chains=results.map((result,index)=>result.status==="fulfilled"?result.value:{name:networks[index].name,shares:0,rate:0,staked:0,pendingShares:0,pending:0,withdrawEnabled:false,withdrawDelay:0,completionWindow:0,tokenSupply:0,blockNumber:0,ok:false});
  const ethereum=chains.find(x=>x.name==="Ethereum"),mainnetSupply=ethereum?.tokenSupply||0,stale=chains.some(x=>!x.ok);
  return NextResponse.json({ethfiSupply:MAX_SUPPLY,mainnetSupply,supplyAdjustment:mainnetSupply?Math.max(0,MAX_SUPPLY-mainnetSupply):0,burned:0,burnStatus:"官方未启用代币销毁；回购所得分配给 sETHFI 持有人",totalShares:chains.reduce((sum,x)=>sum+x.shares,0),exchangeRate:ethereum?.rate||0,staked:chains.reduce((sum,x)=>sum+x.staked,0),pendingShares:chains.reduce((sum,x)=>sum+x.pendingShares,0),pending:chains.reduce((sum,x)=>sum+x.pending,0),withdrawDelay:Math.max(...chains.map(x=>x.withdrawDelay)),completionWindow:Math.max(...chains.map(x=>x.completionWindow)),pendingLabel:"sETHFI 退出队列",chains,source:"Ethereum · Arbitrum · Base 公共 RPC",stale,updatedAt:new Date().toISOString()},{headers:{"Cache-Control":"public, max-age=20, s-maxage=20, stale-while-revalidate=60"}});
}
