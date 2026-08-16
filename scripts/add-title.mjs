#!/usr/bin/env node
/**
 * Issueフォームの本文を解析して data/watchlist.json に作品を追加する。
 *
 * 環境変数:
 *   ISSUE_BODY   Issue本文（GitHub Issue Forms が生成したMarkdown）
 *
 * 標準出力に、Issueへ返信するためのメッセージを書き出す（GITHUB_OUTPUT の result）。
 * 追加に失敗した場合は終了コード1で終わる。
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WATCHLIST = join(ROOT, "data", "watchlist.json");

/** Issue Forms は「### ラベル\n\n値」の形で本文を作る */
function parseIssueForm(body) {
  const out = {};
  const parts = String(body).split(/^###\s+/m).slice(1);
  for (const p of parts) {
    const nl = p.indexOf("\n");
    if (nl < 0) continue;
    const label = p.slice(0, nl).trim();
    let value = p.slice(nl).trim();
    if (value === "_No response_" || value === "_なし_") value = "";
    out[label] = value;
  }
  return out;
}

function fail(msg) {
  console.error(msg);
  emit(`### 追加できませんでした\n\n${msg}\n\n内容を直して新しいIssueを作ってください。`, false);
  process.exit(1);
}

function emit(text, ok) {
  if (process.env.GITHUB_OUTPUT) {
    const d = "EOF_" + Math.random().toString(36).slice(2);
    writeFileSync(process.env.GITHUB_OUTPUT,
      `ok=${ok}\nresult<<${d}\n${text}\n${d}\n`, { flag: "a" });
  }
  console.log(text);
}

const f = parseIssueForm(process.env.ISSUE_BODY || "");
const t = (f["作品名"] || "").trim();
const readRaw = (f["既読巻数"] || "").trim();
const query = (f["検索語（任意）"] || "").trim();
const publisher = (f["出版社（任意）"] || "").trim();
const excludeRaw = (f["除外語（任意）"] || "").trim();
const note = (f["備考（任意）"] || "").trim();

/**
 * Issueの入力はそのまま watchlist.json → index.html まで流れるので、
 * HTMLやJSを壊しうる記号は全項目で受け付けない。
 * 制御文字も混入させない。
 */
const BAD_CHARS = /[<>{}"\\`]/;
const CONTROL   = /[\u0000-\u001f\u007f\u2028\u2029]/;

function checkField(label, value, max) {
  if (!value) return;
  if (value.length > max) fail(`${label}が長すぎます（${max}文字以内）。`);
  if (BAD_CHARS.test(value)) fail(`${label}に使えない記号が含まれています（ < > { } " \\ \` ）。`);
  if (CONTROL.test(value)) fail(`${label}に使えない制御文字が含まれています。`);
}

if (!t) fail("作品名が読み取れませんでした。");
checkField("作品名", t, 60);
checkField("検索語", query, 80);
checkField("出版社", publisher, 40);
checkField("除外語", excludeRaw, 200);
checkField("備考", note, 100);

if (/^[-−ー]/.test(readRaw)) {
  fail(`既読巻数「${readRaw}」が負の数に見えます。0以上の数字で入力してください。`);
}
if (!/\d/.test(readRaw)) {
  fail(`既読巻数「${readRaw}」に数字が含まれていません。0〜999の数字で入力してください。`);
}
const init = Number(readRaw.replace(/[^0-9]/g, ""));
if (!Number.isFinite(init) || init < 0 || init > 999) {
  fail(`既読巻数「${readRaw}」を数値として読み取れませんでした。0〜999の数字で入力してください。`);
}

const wl = JSON.parse(readFileSync(WATCHLIST, "utf8"));
if (wl.titles.some(x => x.t === t)) {
  fail(`「${t}」はすでに登録されています。`);
}

const entry = { t, init, query: query || t };
if (publisher) entry.publisher = publisher;
if (excludeRaw) {
  const ex = excludeRaw.split(/[,、]/).map(s => s.trim()).filter(Boolean);
  if (ex.length) entry.exclude = ex;
}
if (note) entry.note = note;

wl.titles.push(entry);
writeFileSync(WATCHLIST, JSON.stringify(wl, null, 2) + "\n");

emit(
  `### 「${t}」を追加しました\n\n` +
  `- 既読巻数: ${init}巻\n` +
  `- 検索語: \`${entry.query}\`\n` +
  (publisher ? `- 出版社: ${publisher}\n` : "") +
  (entry.exclude ? `- 除外語: ${entry.exclude.join(", ")}\n` : "") +
  `\nこのあとカタログ更新を実行します。結果を続けて投稿します。`,
  true
);
