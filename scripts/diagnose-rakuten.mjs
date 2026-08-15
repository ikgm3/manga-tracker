#!/usr/bin/env node
/**
 * 楽天APIへの接続方法を数パターン試し、どれが通るかを調べる診断用スクリプト。
 * Actions の「楽天API診断」ワークフローから手動実行する。
 *
 * 鍵は伏せ字にして出力するので、ログをそのまま共有しても安全。
 */

const APP_ID = process.env.RAKUTEN_APP_ID || "";
const ACCESS_KEY = process.env.RAKUTEN_ACCESS_KEY || "";

const mask = s => !s ? "(未設定)" : `${s.slice(0, 4)}…${s.slice(-2)} (${s.length}文字)`;

console.log("=== 鍵の状態 ===");
console.log("RAKUTEN_APP_ID    :", mask(APP_ID));
console.log("RAKUTEN_ACCESS_KEY:", mask(ACCESS_KEY));
console.log("APP_ID が数字のみ  :", /^\d+$/.test(APP_ID));
console.log("前後の空白混入     :", APP_ID !== APP_ID.trim() || ACCESS_KEY !== ACCESS_KEY.trim());
console.log();

const QUERY = "アオのハコ";

const REF = "https://ikgm3.github.io/manga-tracker/";
const ORG = "https://ikgm3.github.io";
const EP  = "https://openapi.rakuten.co.jp/services/api/BooksBook/Search/20170404";

const patterns = [
  {
    name: "G: Referer + Origin の両方  ← 本命",
    base: EP,
    params: { applicationId: APP_ID, accessKey: ACCESS_KEY },
    headers: { Referer: REF, Origin: ORG }
  },
  {
    name: "H: Origin のみ",
    base: EP,
    params: { applicationId: APP_ID, accessKey: ACCESS_KEY },
    headers: { Origin: ORG }
  },
  {
    name: "I: Referer + Origin（Refererをドメインだけに）",
    base: EP,
    params: { applicationId: APP_ID, accessKey: ACCESS_KEY },
    headers: { Referer: ORG + "/", Origin: ORG }
  },
  {
    name: "J: Referer + Origin を github.com に",
    base: EP,
    params: { applicationId: APP_ID, accessKey: ACCESS_KEY },
    headers: { Referer: "https://github.com/ikgm3/manga-tracker", Origin: "https://github.com" }
  },
  {
    name: "K: 参考・Referer のみ（前回失敗した形）",
    base: EP,
    params: { applicationId: APP_ID, accessKey: ACCESS_KEY },
    headers: { Referer: REF }
  }
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

for (const p of patterns) {
  const url = new URL(p.base);
  for (const [k, v] of Object.entries(p.params)) url.searchParams.set(k, v);
  url.searchParams.set("title", QUERY);
  url.searchParams.set("hits", "3");
  if (!p.noFormatVersion) url.searchParams.set("formatVersion", "2");

  let line = `${p.name}\n  → `;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "manga-tracker/1.0", ...p.headers } });
    const text = await res.text();
    line += `HTTP ${res.status}`;
    if (res.ok) {
      let n = "?", sample = "";
      try {
        const j = JSON.parse(text);
        const items = j.Items || [];
        n = items.length;
        const first = items[0] && (items[0].Item || items[0]);
        if (first) sample = ` 例: ${first.title} / ${first.salesDate} / 画像${first.largeImageUrl ? "あり" : "なし"}`;
      } catch (e) { sample = " (JSON解析失敗)"; }
      line += `  ★成功  件数=${n}${sample}`;
    } else {
      line += `  本文: ${text.replace(/\s+/g, " ").slice(0, 300)}`;
    }
  } catch (e) {
    line += `通信エラー: ${e.message}`;
  }
  console.log(line + "\n");
  await sleep(1500);
}

console.log("=== 判定 ===");
console.log("★成功 が付いたパターンを教えてください。それに合わせてスクリプトを直します。");
