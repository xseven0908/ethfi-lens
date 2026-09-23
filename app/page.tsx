"use client";

import { useCallback, useEffect, useState } from "react";
import TriOverview from "./tri-overview";
import HypeDashboard from "./hype-dashboard";
import UniDashboard from "./uni-dashboard";
import BpDashboard from "./bp-dashboard";

type View="compare"|"hype"|"uni"|"bp";
const views:Array<{id:View;name:string;project:string}>=[{id:"hype",name:"HYPE",project:"Hyperliquid"},{id:"uni",name:"UNI",project:"Uniswap"},{id:"bp",name:"BP",project:"Backpack"}];

export default function Home(){
  const [view,setView]=useState<View>("compare"),[refreshNonce,setRefreshNonce]=useState(0);
  useEffect(()=>{const sync=()=>{const token=new URLSearchParams(window.location.search).get("token");setView(token==="hype"||token==="uni"||token==="bp"?token:"compare")};sync();window.addEventListener("popstate",sync);return()=>window.removeEventListener("popstate",sync)},[]);
  const switchView=useCallback((next:View)=>{setView(next);const url=new URL(window.location.href);if(next==="compare")url.searchParams.delete("token");else url.searchParams.set("token",next);url.hash=next==="compare"?"compare-overview":`${next}-overview`;window.history.replaceState({},"",`${url.pathname}${url.search}${url.hash}`);window.scrollTo({top:0,behavior:"smooth"})},[]);
  return <div className={`app-shell theme-${view}`}><main><header className="topbar"><div className="top-identity"><a className="brand" href="#compare-overview" onClick={event=>{event.preventDefault();switchView("compare")}} aria-label="Token Lens 三币总览"><span className="brand-mark small">t</span><span>TOKEN<span>lens</span></span></a><div className="asset-switch tri-switch" aria-label="选择页面"><button type="button" className={view==="compare"?"active":""} onClick={()=>switchView("compare")}><i className="compare-dot"/><span><b>总览</b><small>Compare</small></span></button>{views.map(item=><button type="button" className={view===item.id?"active":""} onClick={()=>switchView(item.id)} key={item.id}><i className={`${item.id}-dot`}/><span><b>{item.name}</b><small>{item.project}</small></span></button>)}</div><div className="breadcrumb"><b>/</b><strong>{view==="compare"?"三币基本面 · 供应 · 价值回流":view==="hype"?"交易 · 销毁 · 质押":view==="uni"?"协议使用 · 费用 · 销毁":"交易 · 流动性 · 质押"}</strong></div></div><div className="top-actions"><span className="live-dot"/><span className="updated">{view==="compare"?"三币总览":views.find(x=>x.id===view)?.name} · 自动刷新</span><span className="unit-badge">USD 统一口径</span><button className="refresh-button" type="button" onClick={()=>setRefreshNonce(x=>x+1)}><span>↻</span>刷新数据</button></div></header><div className="content">{view==="compare"?<TriOverview refreshNonce={refreshNonce} onSelect={switchView}/>:view==="hype"?<HypeDashboard currency="usd" refreshNonce={refreshNonce}/>:view==="uni"?<UniDashboard refreshNonce={refreshNonce}/>:<BpDashboard currency="usd" refreshNonce={refreshNonce}/>}</div></main></div>
}
