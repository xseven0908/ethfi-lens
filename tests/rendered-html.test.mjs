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
  assert.match(html, /<title>Token Lens — ETHFI、BP、PENDLE 与 HYPE 对比看板<\/title>/i);
  assert.match(html, /TOKEN/);
  assert.match(html, /ETHFI/);
  assert.match(html, /Backpack/);
  assert.match(html, /PENDLE/);
  assert.match(html, /HYPE/);
  assert.match(html, /四币对比/);
  assert.match(html, /先看谁领先/);
  assert.match(html, /USD 统一口径/);
  assert.doesNotMatch(html, /CNY/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|Building your site/i);
});

test("keeps comparison home and all four asset dashboards wired", async () => {
  const [page, compare, pendle, pendleApi, marketsApi, hype, hypeApi, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/compare-dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/pendle-dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/pendle/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/pendle-markets/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/hype-dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/hype/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.match(page, /type AssetView = "compare" \| "ethfi" \| "bp" \| "pendle" \| "hype"/);
  assert.match(page, /<CompareDashboard/);
  assert.match(compare, /核心指标矩阵/);
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
  assert.match(hypeApi, /tickers\/hype-hyperliquid/);
  assert.match(hypeApi, /VERIFIED_CIRCULATING_SUPPLY/);
  assert.match(hypeApi, /protocol:perps\?/);
  assert.match(layout, /og-brand-v5\.png/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await assert.rejects(access(new URL("app/_sites-preview", root)));
});
