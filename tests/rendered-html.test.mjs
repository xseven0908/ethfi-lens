import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Token Lens production shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<html lang="zh-CN">/i);
  assert.match(html, /<title>Token Lens — 八资产统一指标对比看板<\/title>/i);
  assert.match(html, /TOKEN/);
  assert.match(html, /ETHFI/);
  assert.match(html, /Backpack/);
  assert.match(html, /PENDLE/);
  assert.match(html, /HYPE/);
  assert.match(html, /八币对比/);
  assert.match(html, /先看谁领先/);
  assert.match(html, /USD 统一口径/);
  assert.doesNotMatch(html, /CNY/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|Building your site/i);
});

test("keeps comparison home and all eight asset dashboards wired", async () => {
  const [page, compare, pendle, pendleApi, marketsApi, hype, hypeApi, expanded, expandedApi, model, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/compare-dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/pendle-dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/pendle/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/pendle-markets/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/hype-dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/hype/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/expanded-asset-dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/expanded-assets/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/asset-model.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.match(page, /type AssetView = "compare" \| TokenId/);
  assert.match(page, /<CompareDashboard/);
  assert.match(compare, /核心指标矩阵/);
  assert.match(compare, /整体供应基准/);
  assert.match(compare, /当前总供应/);
  assert.match(compare, /已销毁 \/ 永久移除/);
  assert.match(compare, /质押 \/ 整体供应/);
  assert.match(compare, /30D 相对价格走势/);
  assert.match(compare, /CompareTrendChart/);
  assert.match(compare, /优势地图/);
  assert.match(compare, /未来事件与持续压力/);
  assert.match(compare, /risk-table/);
  assert.doesNotMatch(page, /setCurrency|>CNY</);
  assert.match(page, /<PendleDashboard/);
  assert.match(pendle, /sPENDLE 与协议收入/);
  assert.match(pendle, /头部活跃收益市场/);
  assert.match(pendleApi, /\/v1\/spendle\/data/);
  assert.match(pendleApi, /tickers\/pendle-pendle/);
  assert.match(pendleApi, /VERIFIED_CIRCULATING_SUPPLY/);
  assert.match(pendleApi, /supplySource/);
  assert.match(marketsApi, /\/v2\/markets\/all/);
  assert.match(page, /<HypeDashboard/);
  assert.match(hype, /交易业务快照/);
  assert.match(hype, /质押与验证者/);
  assert.match(hypeApi, /metaAndAssetCtxs/);
  assert.match(hypeApi, /validatorSummaries/);
  assert.match(hypeApi, /tokenDetails/);
  assert.match(hypeApi, /burnedSupply/);
  assert.match(hypeApi, /tickers\/hype-hyperliquid/);
  assert.match(hypeApi, /VERIFIED_CIRCULATING_SUPPLY/);
  assert.match(hypeApi, /protocol:perps\?/);
  assert.match(page, /<ExpandedAssetDashboard/);
  assert.match(page, /"uni","aave","ena","xpl"/);
  assert.match(compare, /八个资产统一使用 USD/);
  assert.match(compare, /供应压力与抛压缓冲/);
  assert.match(compare, /回购不自动等于销毁/);
  assert.doesNotMatch(compare, /新增资产快捷入口|项待完善/);
  assert.match(compare, /数据源失败不影响资产继续显示/);
  assert.match(compare, /不适用/);
  assert.match(expanded, /流通 \/ 整体供应/);
  assert.match(expanded, /质押 \/ 整体供应/);
  assert.match(expandedApi, /uniswap,aave,ethena,plasma|definitions\.map/);
  assert.match(expandedApi, /STKAAVE/);
  assert.match(expandedApi, /SENA/);
  assert.match(expandedApi, /api\.llama\.fi/);
  assert.match(expandedApi, /www\.okx\.com\/api\/v5\/market\/ticker/);
  assert.match(expandedApi, /api\.bybit\.com\/v5\/market\/tickers/);
  assert.match(expandedApi, /history-candles/);
  assert.match(model, /ExpandedTokenId="uni"\|"aave"\|"ena"\|"xpl"/);
  assert.match(layout, /og-brand-v6\.png/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await assert.rejects(access(new URL("app/_sites-preview", root)));
});
