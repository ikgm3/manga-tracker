#!/usr/bin/env node
/**
 * 特定の作品について、楽天APIが返す商品を1件ずつ表示して
 * どれが巻数として拾われているかを確認する調査用スクリプト。
 *
 *   node scripts/inspect-title.mjs "薫る花は凛と咲く" "夜は猫といっしょ"
 *
 * 引数を省略すると、誤検出の報告があった作品を調べる。
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const wl = JSON.parse(readFileSync(join(ROOT, "data", "watchlist.json"), "utf8"));

const ENDPOINT = "https://openapi.rakuten.co.jp/services/api/BooksBook/Search/20170404";
const APP_ID = process.env.RAKUTEN_APP_ID;
const ACCESS_KEY = process.env.RAKUTEN_ACCESS_KEY;
const REFERER = "https://ikgm3.github.io/manga-tracker/";
const ORIGIN = "https://ikgm3.github.io";

const norm = s => String(s).normalize("NFKC").replace(/[　\s]/g, "").replace(/[!！]/g, "!").toLowerCase();

function parseVolume(itemTitle, query) {
  const n = norm(itemTitle), q = norm(query);
  if (!n.includes(q)) return { vol: null, how: "シリーズ名不一致" };
  const rest = n.slice(n.indexOf(q) + q.length);
  let m = rest.match(/^[^0-9]{0,4}?(\d{1,3})(?![0-9])/);
  if (m) return { vol: +m[1], how: "①直後の数字" };
  m = n.match(/第(\d{1,3})巻/);
  if (m) return { vol: +m[1], how: "②第N巻" };
  m = rest.replace(/巻$/, "").match(/(\d{1,3})$/);
  if (m) return { vol: +m[1], how: "③末尾の数字" };
  return { vol: null, how: "数字なし" };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function search(query, page) {
  const url = new URL(ENDPOINT);
  url.searchParams.set("applicationId", APP_ID);
  url.searchParams.set("accessKey", ACCESS_KEY);
  url.searchParams.set("format", "json");
  url.searchParams.set("formatVersion", "2");
  url.searchParams.set("title", query);
  url.searchParams.set("sort", "-releaseDate");
  url.searchParams.set("hits", "30");
  url.searchParams.set("page", String(page));
  url.searchParams.set("outOfStockFlag", "1");
  const res = await fetch(url, {
    headers: { "User-Agent": "manga-tracker/1.0", Referer: REFERER, Origin: ORIGIN }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

const argv = process.argv.slice(2).filter(a => a.trim());
const targets = argv.length ? argv
  : ["薫る花は凛と咲く", "夜は猫といっしょ", "ふつつかな悪女ではございますが（漫画）",
     "とんでもスキルで異世界放浪メシ（漫画）"];

for (const key of targets) {
  const entry = wl.titles.find(x => x.t === key || x.query === key);
  if (!entry) { console.log(`\n### ${key} … watchlistに見つかりません\n`); continue; }

  const excludes = [...(wl.globalExclude || []), ...(entry.exclude || [])];
  console.log(`\n${"=".repeat(78)}`);
  console.log(`### ${entry.t}   検索語: "${entry.query}"   出版社条件: ${entry.publisher || "なし"}`);
  console.log("=".repeat(78));

  let items = [];
  for (const page of [1, 2]) {
    const j = await search(entry.query, page);
    const got = j.Items || [];
    items.push(...got);
    if (got.length < 30) break;
    await sleep(1200);
  }
  console.log(`取得件数: ${items.length}\n`);

  const rows = [];
  for (const it of items) {
    const title = it.title || "";
    const nt = norm(title);
    const hit = excludes.find(x => nt.includes(norm(x)));
    const { vol, how } = parseVolume(title, entry.query);
    rows.push({ title, pub: it.publisherName || "", date: it.salesDate || "", vol, how, ex: hit });
  }

  // 除外されずに巻数が取れたもの＝実際に判定に使われる候補
  const used = rows.filter(r => !r.ex && r.vol !== null);
  const maxVol = used.length ? Math.max(...used.map(r => r.vol)) : null;

  for (const r of rows) {
    const mark = r.ex ? `除外(${r.ex})` : r.vol === null ? `対象外(${r.how})`
               : r.vol === maxVol ? `★採用候補 ${r.vol}巻 ${r.how}` : `候補 ${r.vol}巻 ${r.how}`;
    console.log(`  ${mark}`);
    console.log(`    「${r.title}」`);
    console.log(`    ${r.pub} / ${r.date}`);
  }

  console.log(`\n  → この作品で最大巻数と判定されるのは: ${maxVol ?? "なし"}巻`);
  await sleep(1200);
}
