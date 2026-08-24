import { NextRequest, NextResponse } from "next/server";

const fallback = {
  usd: { price:0.4046, marketCap:393_800_000, fdv:404_600_000, volume24h:69_400_000, high24h:0.423, low24h:0.397, ath:8.53 },
  cny: { price:2.90, marketCap:2_822_000_000, fdv:2_900_000_000, volume24h:497_000_000, high24h:3.03, low24h:2.84, ath:61.1 },
};
const fallbackChart = (price:number)=>Array.from({length:90},(_,i)=>[Date.now()-(89-i)*86_400_000,price*(1.14-i*0.00155+Math.sin(i/5)*0.045)]);

export async function GET(request:NextRequest){
  const currency=request.nextUrl.searchParams.get("currency")==="cny"?"cny":"usd",snapshot=fallback[currency];
  try{
    const headers:Record<string,string>={accept:"application/json"},apiKey=process.env.COINGECKO_API_KEY;if(apiKey)headers["x-cg-demo-api-key"]=apiKey;
    const [marketResponse,chartResponse]=await Promise.all([
      fetch(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=${currency}&ids=ether-fi&price_change_percentage=24h`,{headers,cache:"no-store",signal:AbortSignal.timeout(7000)}),
      fetch(`https://api.coingecko.com/api/v3/coins/ether-fi/market_chart?vs_currency=${currency}&days=90`,{headers,cache:"no-store",signal:AbortSignal.timeout(7000)}),
    ]);
    if(!marketResponse.ok||!chartResponse.ok)throw new Error("CoinGecko unavailable");
    const market=(await marketResponse.json())[0],chart=await chartResponse.json();if(!market||!Array.isArray(chart.prices))throw new Error("Invalid response");
    return NextResponse.json({price:market.current_price,change24h:market.price_change_percentage_24h??0,marketCap:market.market_cap,fdv:market.fully_diluted_valuation??market.current_price*1_000_000_000,volume24h:market.total_volume,circulatingSupply:market.circulating_supply??973_468_000,totalSupply:market.total_supply??1_000_000_000,high24h:market.high_24h,low24h:market.low_24h,ath:market.ath,athDate:market.ath_date,chart:chart.prices,source:"CoinGecko 实时行情",stale:false,updatedAt:market.last_updated??new Date().toISOString()},{headers:{"Cache-Control":"public, max-age=30, s-maxage=30, stale-while-revalidate=300"}});
  }catch{
    try{
      const [tickerResponse,klinesResponse]=await Promise.all([
        fetch("https://api.binance.com/api/v3/ticker/24hr?symbol=ETHFIUSDT",{cache:"no-store",signal:AbortSignal.timeout(7000)}),
        fetch("https://api.binance.com/api/v3/klines?symbol=ETHFIUSDT&interval=1d&limit=90",{cache:"no-store",signal:AbortSignal.timeout(7000)}),
      ]);
      if(!tickerResponse.ok||!klinesResponse.ok)throw new Error("Binance unavailable");
      const ticker=await tickerResponse.json(),klines=await klinesResponse.json(),rate=currency==="cny"?7.17:1,price=Number(ticker.lastPrice)*rate,circulatingSupply=973_468_000;
      return NextResponse.json({price,change24h:Number(ticker.priceChangePercent),marketCap:price*circulatingSupply,fdv:price*1_000_000_000,volume24h:Number(ticker.quoteVolume)*rate,circulatingSupply,totalSupply:1_000_000_000,high24h:Number(ticker.highPrice)*rate,low24h:Number(ticker.lowPrice)*rate,ath:snapshot.ath,athDate:"2024-03-27T00:00:00.000Z",chart:klines.map((item:unknown[])=>[Number(item[0]),Number(item[4])*rate]),source:"Binance ETHFI/USDT 备选行情",stale:false,updatedAt:new Date().toISOString()},{headers:{"Cache-Control":"public, max-age=30, s-maxage=30, stale-while-revalidate=300"}});
    }catch{
      return NextResponse.json({...snapshot,change24h:-1.1,circulatingSupply:973_468_000,totalSupply:1_000_000_000,athDate:"2024-03-27T00:00:00.000Z",chart:fallbackChart(snapshot.price),source:"最近一次可用快照",stale:true,updatedAt:new Date().toISOString()},{headers:{"Cache-Control":"no-store"}});
    }
  }
}
