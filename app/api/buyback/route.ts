import { NextResponse } from "next/server";

const ETHFI="0xfe0c30065b384f05761f15d0cc899d4f9f9cc0eb";
const SETHFI="0x86b5780b606940eb59a062aa85a07959518c0161";
const FOUNDATION="0x2f5301a3d59388c509c65f8698f521377d41fd0f";
const EXPLORER="https://eth.blockscout.com";
const RPCS=["https://ethereum-rpc.publicnode.com","https://eth.llamarpc.com","https://rpc.flashbots.net"];

type Transfer={timestamp:string;transaction_hash:string;from:{hash:string};to:{hash:string}|null;token:{address_hash:string};total:{value:string;decimals:string}};
type TransferPage={items:Transfer[];next_page_params:{block_number:number;index:number}|null};

const amount=(value:string,decimals:string)=>Number(BigInt(value))/10**Number(decimals);
const addressArg=(address:string)=>address.toLowerCase().replace(/^0x/,"").padStart(64,"0");

async function fetchPage(url:string){
  let lastError:unknown;
  for(let attempt=0;attempt<2;attempt++){
    try{
      const response=await fetch(url,{headers:{accept:"application/json"},cache:"no-store",signal:AbortSignal.timeout(9000)});
      if(!response.ok)throw new Error(`Explorer ${response.status}`);
      return await response.json() as TransferPage;
    }catch(error){lastError=error}
  }
  throw lastError instanceof Error?lastError:new Error("Explorer unavailable");
}

async function readDistributions(){
  const base=`${EXPLORER}/api/v2/addresses/${FOUNDATION}/token-transfers?type=ERC-20&filter=from&token=${ETHFI}`;
  let url:string|null=base;
  const transfers:Transfer[]=[];
  for(let pageNumber=0;url&&pageNumber<5;pageNumber++){
    const page=await fetchPage(url);
    transfers.push(...page.items);
    url=page.next_page_params?`${base}&block_number=${page.next_page_params.block_number}&index=${page.next_page_params.index}`:null;
  }
  if(url)throw new Error("Explorer pagination incomplete");
  return transfers
    .filter(item=>item.token.address_hash.toLowerCase()===ETHFI&&item.from.hash.toLowerCase()===FOUNDATION&&item.to?.hash.toLowerCase()===SETHFI)
    .map(item=>({timestamp:item.timestamp,amount:amount(item.total.value,item.total.decimals),txHash:item.transaction_hash}))
    .sort((a,b)=>new Date(b.timestamp).getTime()-new Date(a.timestamp).getTime());
}

async function readWalletBalance(){
  const data=`0x70a08231${addressArg(FOUNDATION)}`;
  for(const rpcUrl of RPCS){
    try{
      const response=await fetch(rpcUrl,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"eth_call",params:[{to:ETHFI,data},"latest"]}),cache:"no-store",signal:AbortSignal.timeout(6500)});
      if(!response.ok)continue;
      const payload=await response.json();
      if(payload.result&&payload.result!=="0x")return Number(BigInt(payload.result))/1e18;
    }catch{}
  }
  return null;
}

export async function GET(){
  try{
    const [distributions,walletBalance]=await Promise.all([readDistributions(),readWalletBalance()]);
    const now=Date.now(),within=(days:number)=>distributions.filter(item=>new Date(item.timestamp).getTime()>=now-days*86_400_000).reduce((sum,item)=>sum+item.amount,0);
    const latest=distributions[0]??null;
    return NextResponse.json({
      distributedTotal:distributions.reduce((sum,item)=>sum+item.amount,0),
      distributed30d:within(30),
      distributed90d:within(90),
      distributionCount:distributions.length,
      latestDistribution:latest,
      recentDistributions:distributions.slice(0,8),
      walletBalance,
      foundationWallet:FOUNDATION,
      destination:SETHFI,
      weeklyPolicy:"100% eETH 提现费收入用于周度回购",
      monthlyPolicy:"部分 Stake、Liquid、Cash 协议收入用于月度回购",
      treasuryCapUsd:50_000_000,
      priceCeilingUsd:3,
      confirmedBurned:null,
      burnStatus:"官方回购文档将所得 ETHFI 归入 sETHFI 分配或流动性；尚未公布可独立核对的 ETHFI 累计销毁量",
      source:"ether.fi Foundation 官方钱包 · Blockscout 链上转账",
      updatedAt:new Date().toISOString(),
    },{headers:{"Cache-Control":"public, max-age=120, s-maxage=300, stale-while-revalidate=900"}});
  }catch{
    return NextResponse.json({error:"回购钱包链上记录暂时不可用",updatedAt:new Date().toISOString()},{status:503,headers:{"Cache-Control":"no-store"}});
  }
}
