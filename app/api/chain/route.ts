import { NextResponse } from "next/server";

const ETHFI="0xfe0c30065b384f05761f15d0cc899d4f9f9cc0eb",SETHFI="0x86B5780b606940Eb59A062aA85a07959518c0161",ACCOUNTANT="0x05A1552c5e18F5A0BB9571b5F2D6a4765ebdA32b",DELAYED="0x1509b1fdD01cAF9697aff514b9574B4A27173Dd2",MAX_SUPPLY=1_000_000_000;
const networks=[{name:"Ethereum",rpc:"https://ethereum-rpc.publicnode.com"},{name:"Arbitrum",rpc:"https://arbitrum-one-rpc.publicnode.com"},{name:"Base",rpc:"https://base-rpc.publicnode.com"}];
async function call(rpc:string,to:string,data:string){const response=await fetch(rpc,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"eth_call",params:[{to,data},"latest"]}),cache:"no-store",signal:AbortSignal.timeout(5500)});if(!response.ok)throw new Error("RPC unavailable");const payload=await response.json();if(!payload.result||payload.result==="0x")throw new Error("Empty RPC result");return Number(BigInt(payload.result))/1e18}
const balanceOfData=(address:string)=>`0x70a08231${address.toLowerCase().replace(/^0x/,"").padStart(64,"0")}`;
async function readNetwork(network:(typeof networks)[number]){const [shares,rate,pendingShares]=await Promise.all([call(network.rpc,SETHFI,"0x18160ddd"),call(network.rpc,ACCOUNTANT,"0x679aefce"),call(network.rpc,SETHFI,balanceOfData(DELAYED))]);return{name:network.name,shares,rate,staked:shares*rate,pending:pendingShares*rate,ok:true}}

export async function GET(){
  const fallbackByName:Record<string,{shares:number;rate:number;staked:number;pending:number}>={Ethereum:{shares:84_900_000,rate:1.06,staked:90_000_000,pending:2_100_000},Arbitrum:{shares:1_430_000,rate:1.05,staked:1_500_000,pending:190_000},Base:{shares:190_000,rate:1.04,staked:200_000,pending:50_000}};
  const [supplyResult,...networkResults]=await Promise.allSettled([call(networks[0].rpc,ETHFI,"0x18160ddd"),...networks.map(readNetwork)]),ethfiSupply=supplyResult.status==="fulfilled"?supplyResult.value:MAX_SUPPLY;
  const chains=networkResults.map((result,index)=>result.status==="fulfilled"?result.value:{name:networks[index].name,...fallbackByName[networks[index].name],ok:false}),stale=supplyResult.status==="rejected"||chains.some(x=>!x.ok);
  return NextResponse.json({ethfiSupply,burned:Math.max(0,MAX_SUPPLY-ethfiSupply),staked:chains.reduce((s,x)=>s+x.staked,0),pending:chains.reduce((s,x)=>s+x.pending,0),chains,source:stale?"链上 RPC + 快照回退":"Ethereum · Arbitrum · Base 链上数据",stale,updatedAt:new Date().toISOString()},{headers:{"Cache-Control":"public, max-age=60, s-maxage=60, stale-while-revalidate=600"}});
}
