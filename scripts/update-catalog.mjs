#!/usr/bin/env node
/**
 * マンガ新刊トラッカー カタログ更新スクリプト
 *
 * data/watchlist.json の各作品について楽天ブックス書籍検索APIを叩き、
 * 既刊最新巻と次巻の発売予定日を判定して index.html の CATALOG ブロックを書き換える。
 *
 * 必要な環境変数:
 *   RAKUTEN_APP_ID     アプリID
 *   RAKUTEN_ACCESS_KEY アクセスキー（2025年以降必須）
 *
 * 使い方:
 *   node scripts/update-catalog.mjs              通常実行（index.html を書き換える）
 *   node scripts/update-catalog.mjs --dry-run    書き換えずに結果だけ表示
 *   node scripts/update-catalog.mjs --mock f.json APIを叩かずモックデータで実行（テスト用）
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HTML = join(ROOT, "index.html");
const WATCHLIST = join(ROOT, "data", "watchlist.json");
const LASTRUN = join(ROOT, "data", "last-run.json");

const ENDPOINT = "https://openapi.rakuten.co.jp/services/api/BooksBook/Search/20170404";
const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const MOCK = args.includes("--mock") ? args[args.indexOf("--mock") + 1] : null;

/* ---------------- 日付ユーティリティ（JST基準） ---------------- */

function todayJST() {
  const now = new Date(Date.now() + 9 * 3600 * 1000);
  return now.toISOString().slice(0, 10);
}
const TODAY = todayJST();

/** 楽天の salesDate は「2026年07月03日」「2026年07月上旬」「2026年07月頃」など揺れる */
function parseSalesDate(raw) {
  if (!raw) return null;
  const s = String(raw).replace(/\s/g, "");
  const m = s.match(/(\d{4})年(\d{1,2})月(?:(\d{1,2})日)?/);
  if (!m) return null;
  const [, y, mo, d] = m;
  let day = d ? +d : null;
  let approx = false;
  if (day === null) {
    approx = true;
    if (s.includes("上旬")) day = 5;
    else if (s.includes("中旬")) day = 15;
    else if (s.includes("下旬")) day = 25;
    else day = 15;
  }
  const p = n => String(n).padStart(2, "0");
  return { date: `${y}-${p(+mo)}-${p(day)}`, approx };
}

/* ---------------- タイトル正規化・巻数抽出 ---------------- */

function norm(s) {
  return String(s)
    .normalize("NFKC")        // 全角英数・全角記号を半角へ
    .replace(/[　\s]/g, "") // 空白を除去
    .replace(/[!！]/g, "!")
    .toLowerCase();
}

/**
 * 商品タイトルから巻数を取り出す。
 * 例: "アオのハコ 26" / "薫る花は凛と咲く（23）" / "星旅少年6" / "死役所 28"
 */
/** カレンダー・手帳など、西暦を含む商品は巻数と紛らわしいので弾く */
const hasYear = n => /(19|20)\d{2}/.test(n);

function parseVolume(itemTitle, query, volumeRegex) {
  const n = norm(itemTitle);
  const q = norm(query);
  if (!n.includes(q)) return null;

  // 作品ごとに巻数の書式が指定されていれば、それだけを信じる
  // （例: 同じ出版社から原作小説も出ていて「N巻」表記の有無でしか区別できない場合）
  if (volumeRegex) {
    const m = n.match(new RegExp(volumeRegex));
    return m ? +m[1] : null;
  }

  // 1) シリーズ名の直後にある数字（最も信頼できる）
  const rest = n.slice(n.indexOf(q) + q.length);
  const m = rest.match(/^[^0-9]{0,4}?(\d{1,3})(?![0-9])/);
  if (m) return +m[1];

  // 2) 「第12巻」形式
  const m2 = n.match(/第(\d{1,3})巻/);
  if (m2) return +m2[1];

  // 3) 末尾の数字。サブタイトルを挟む作品向けだが誤爆しやすいので、
  //    西暦を含む商品（手帳・カレンダー等）では使わない
  if (!hasYear(n)) {
    const m3 = rest.replace(/巻$/, "").match(/(?<![0-9-])(\d{1,3})$/);
    if (m3) return +m3[1];
  }

  return null;
}

function isExcluded(itemTitle, excludes) {
  const n = norm(itemTitle);
  return excludes.some(x => n.includes(norm(x)));
}

/**
 * 楽天の画像URLはサイズ指定が付くので、サムネイル用に付け直す。
 * APIの返り値をそのまま index.html に埋め込むため、
 * 楽天の画像ドメイン以外は受け付けない（URL偽装・別サイト誘導の防止）。
 */
const IMAGE_HOSTS = /(^|\.)rakuten\.co\.jp$/;

function normImage(u) {
  if (!u) return null;
  let url;
  try { url = new URL(String(u)); } catch { return null; }
  if (url.protocol !== "https:") return null;
  if (!IMAGE_HOSTS.test(url.hostname)) return null;
  return url.origin + url.pathname + "?_ex=240x240";
}

/* ---------------- 楽天API ---------------- */

const APP_ID = process.env.RAKUTEN_APP_ID;
const ACCESS_KEY = process.env.RAKUTEN_ACCESS_KEY;

// 楽天アプリ設定の「許可されたウェブサイト」に登録したドメインと一致させること
const REFERER = process.env.RAKUTEN_REFERER || "https://ikgm3.github.io/manga-tracker/";
const ORIGIN  = process.env.RAKUTEN_ORIGIN  || "https://ikgm3.github.io";

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function rakutenSearch(query, page = 1) {
  const url = new URL(ENDPOINT);
  url.searchParams.set("applicationId", APP_ID);
  url.searchParams.set("accessKey", ACCESS_KEY);
  url.searchParams.set("format", "json");
  url.searchParams.set("formatVersion", "2");
  url.searchParams.set("title", query);
  url.searchParams.set("sort", "-releaseDate"); // 新しい順
  url.searchParams.set("hits", "30");
  url.searchParams.set("page", String(page));
  url.searchParams.set("outOfStockFlag", "1");  // 品切れ・予約中も含める

  for (let attempt = 1; attempt <= 4; attempt++) {
    let res;
    try {
      // 2026年の楽天API刷新以降、呼び出し元ドメインの検証が必須になった。
      // サーバーサイド実行では Referer / Origin が自動で付かないため、
      // 楽天アプリ設定の「許可されたウェブサイト」に登録した値を明示的に送る。
      res = await fetch(url, {
        headers: {
          "User-Agent": "manga-tracker/1.0",
          "Referer": REFERER,
          "Origin": ORIGIN
        }
      });
    } catch (e) {
      if (attempt === 4) throw e;
      await sleep(1500 * attempt);
      continue;
    }
    if (res.ok) return res.json();
    if (res.status === 404) return { Items: [] };      // 該当なし
    if (res.status === 429 || res.status >= 500) {     // レート制限・一時障害
      if (attempt === 4) throw new Error(`HTTP ${res.status} for "${query}"`);
      await sleep(2500 * attempt);
      continue;
    }
    const body = (await res.text()).replace(/\s+/g, " ").slice(0, 300);
    throw new Error(`HTTP ${res.status} for "${query}": ${body}`);
  }
}

/* ---------------- 既存 CATALOG の読み取り ---------------- */

const BLOCK_RE = /(\/\/ ==== 最新刊カタログ ====\n)([\s\S]*?)(\n\/\/ ==== ここまで ====)/;

function readCurrentCatalog(html) {
  const m = html.match(BLOCK_RE);
  if (!m) throw new Error("index.html の CATALOG ブロックが見つかりません");
  const body = m[2];
  const prev = new Map();
  const re = /\{t:"((?:[^"\\]|\\.)*)"([^}]*)\}/g;
  let x;
  while ((x = re.exec(body))) {
    const t = x[1];
    const f = x[2];
    const num = k => { const r = f.match(new RegExp(`${k}:(\\d+)`)); return r ? +r[1] : null; };
    const str = k => {
      const r = f.match(new RegExp(`${k}:(?:"((?:[^"\\\\]|\\\\.)*)"|null)`));
      return r ? (r[1] ?? null) : null;
    };
    prev.set(t, { init: num("init"), latest: num("latest"), ld: str("ld"),
                  next: num("next"), nd: str("nd"), nc: str("nc"),
                  note: str("note"), img: str("img") });
  }
  return prev;
}

/* ---------------- 1作品の解決 ---------------- */

async function resolveTitle(entry, globalExclude, prev, mockItems) {
  const key = entry.t;
  const before = prev.get(key) || {};
  const base = {
    t: key,
    init: entry.init,
    latest: before.latest ?? entry.init,
    ld: before.ld ?? null,
    next: before.next ?? entry.init + 1,
    nd: before.nd ?? null,
    nc: before.nc ?? "未定",
    note: entry.note ?? before.note ?? null,
    img: before.img ?? null
  };

  if (entry.complete) return { row: base, status: "complete", matched: 0 };

  let items = [];
  if (mockItems) {
    items = mockItems[entry.query] || mockItems[key] || [];
  } else {
    for (const page of [1, 2]) {
      const json = await rakutenSearch(entry.query, page);
      const got = json.Items || [];
      items.push(...got);
      if (got.length < 30) break;
      await sleep(1200);
    }
  }

  const excludes = [...globalExclude, ...(entry.exclude || [])];
  const byVol = new Map();
  for (const it of items) {
    const title = it.title || "";
    if (isExcluded(title, excludes)) continue;
    const vol = parseVolume(title, entry.query, entry.volumeRegex);
    if (vol === null) continue;
    const sd = parseSalesDate(it.salesDate);
    if (!sd) continue;
    // 出版社が指定されていれば優先度を上げる（一致が無ければ後で緩和する）
    const pubOk = entry.publisher
      ? norm(it.publisherName || "").includes(norm(entry.publisher))
      : true;
    const cand = { vol, ...sd, title, pubOk, publisher: it.publisherName || "",
                   image: normImage(it.largeImageUrl || it.mediumImageUrl || it.smallImageUrl) };
    const cur = byVol.get(vol);
    // 同じ巻が複数あるときは 出版社一致 > タイトルが短い（通常版）を優先
    if (!cur || (cand.pubOk && !cur.pubOk) ||
        (cand.pubOk === cur.pubOk && norm(cand.title).length < norm(cur.title).length)) {
      byVol.set(vol, cand);
    }
  }

  let cands = [...byVol.values()];
  if (entry.publisher && cands.some(c => c.pubOk)) cands = cands.filter(c => c.pubOk);

  if (!cands.length) return { row: base, status: "no-match", matched: 0 };

  const released = cands.filter(c => c.date <= TODAY).sort((a, b) => b.vol - a.vol);
  const upcoming = cands.filter(c => c.date > TODAY).sort((a, b) => a.vol - b.vol);

  const row = { ...base };
  let status = "ok";

  // 巻数が一気に跳ね上がったら誤検出を疑う（単話版・別シリーズの混入など）
  const maxJump = entry.maxJump ?? 3;

  if (released.length) {
    const top = released[0];
    if (top.vol < base.latest) {
      status = "regression-ignored";   // API側の欠落。既存値を守る
    } else if (base.latest > 0 && top.vol > base.latest + maxJump) {
      status = "suspicious-jump";      // 既存値を守り、人間の確認に回す
    } else {
      row.latest = top.vol;
      row.ld = top.date;
      if (top.image) row.img = top.image;
    }
  } else if (upcoming.length) {
    status = "only-upcoming";
  }

  row.next = row.latest + 1;
  const nextItem = upcoming.find(c => c.vol === row.next);
  if (nextItem) {
    row.nd = nextItem.date;
    row.nc = "確定";
    if (nextItem.approx) row.nc = "予想";
  } else {
    row.nd = null;
    row.nc = "未定";
  }

  if (row.latest < row.init) { row.latest = row.init; row.next = row.init + 1; status = "below-init"; }

  return { row, status, matched: cands.length };
}

/* ---------------- CATALOG 出力 ---------------- */

/**
 * CATALOG は index.html の <script> ブロック内に直接書き出される。
 * そのため JSON.stringify だけでは不十分で、文字列中の "</script>" が
 * そのまま出力されるとスクリプトが途中で終了し、続きがHTMLとして
 * 解釈されてしまう（XSS）。
 *
 * < > & を \uXXXX 形式に逃がしておけば、JSとしての値は変わらないまま
 * HTMLパーサからはタグに見えなくなる。
 * U+2028 / U+2029 はJSの文字列リテラルを壊すので併せて逃がす。
 */
const jstr = v => (v === null || v === undefined) ? "null"
  : JSON.stringify(v)
      .replace(/</g, "\\u003c")
      .replace(/>/g, "\\u003e")
      .replace(/&/g, "\\u0026")
      // U+2028 / U+2029 はJSでは改行扱いのため、正規表現リテラルに
      // 生の文字を書くと構文エラーになる。必ずエスケープ記法で書くこと。
      .replace(/\u2028/g, "\\u2028")
      .replace(/\u2029/g, "\\u2029");

function renderRow(r) {
  let s = `  {t:${jstr(r.t)}, init:${r.init}, latest:${r.latest}, ld:${jstr(r.ld)},`
        + ` next:${r.next}, nd:${jstr(r.nd)}, nc:${jstr(r.nc)}`;
  if (r.note) s += `, note:${jstr(r.note)}`;
  s += `, img:${jstr(r.img ?? null)}`;
  return s + "}";
}

function renderBlock(rows) {
  return `const UPDATED = ${jstr(TODAY)};\nconst CATALOG = [\n`
       + rows.map(renderRow).join(",\n") + "\n];";
}

/* ---------------- メイン ---------------- */

async function main() {
  if (!MOCK && (!APP_ID || !ACCESS_KEY)) {
    console.error("RAKUTEN_APP_ID と RAKUTEN_ACCESS_KEY を環境変数に設定してください。");
    process.exit(1);
  }

  const wl = JSON.parse(readFileSync(WATCHLIST, "utf8"));
  const html = readFileSync(HTML, "utf8");
  const prev = readCurrentCatalog(html);
  const mock = MOCK ? JSON.parse(readFileSync(MOCK, "utf8")) : null;

  const rows = [];
  const report = [];
  const newVolumes = [];

  for (const entry of wl.titles) {
    let out;
    try {
      out = await resolveTitle(entry, wl.globalExclude || [], prev, mock);
    } catch (e) {
      console.error(`  ! ${entry.t}: ${e.message}`);
      out = { row: { t: entry.t, init: entry.init, ...(prev.get(entry.t) || {}),
                     note: entry.note ?? (prev.get(entry.t) || {}).note ?? null },
              status: "error", matched: 0 };
      out.row.t = entry.t; out.row.init = entry.init;
      out.row.latest ??= entry.init; out.row.ld ??= null;
      out.row.next ??= entry.init + 1; out.row.nd ??= null; out.row.nc ??= "未定";
    }
    rows.push(out.row);

    const b = prev.get(entry.t);
    if (b && out.row.latest > b.latest) {
      newVolumes.push(`${entry.t} ${out.row.latest}巻（${out.row.ld || "日付不明"}）`);
    }
    report.push({ t: entry.t, status: out.status, matched: out.matched,
                  latest: out.row.latest, ld: out.row.ld, next: out.row.next,
                  nd: out.row.nd, nc: out.row.nc,
                  before: b ? { latest: b.latest, nd: b.nd } : null });

    const flag = out.status === "ok" ? " " : "!";
    console.log(`${flag} ${entry.t}  既刊${out.row.latest}巻 / 次${out.row.next}巻 ${out.row.nd || "未定"}(${out.row.nc})  [${out.status}]`);
    if (!mock) await sleep(1200); // 楽天APIのレート制限に配慮
  }

  const updated = html.replace(BLOCK_RE, (_, a, __, c) => a + renderBlock(rows) + c);

  const changed = updated !== html;
  console.log("\n--- サマリ ---");
  console.log(`作品数: ${rows.length}`);
  console.log(`新刊: ${newVolumes.length ? newVolumes.join(" / ") : "なし"}`);
  const warn = report.filter(r => r.status !== "ok" && r.status !== "complete");
  console.log(`要確認: ${warn.length ? warn.map(r => `${r.t}(${r.status})`).join(", ") : "なし"}`);
  console.log(`index.html: ${changed ? "更新あり" : "変更なし"}`);

  if (DRY) { console.log("\n(--dry-run のため書き込みません)"); return; }

  mkdirSync(dirname(LASTRUN), { recursive: true });
  writeFileSync(LASTRUN, JSON.stringify(
    { ranAt: new Date().toISOString(), today: TODAY, newVolumes, titles: report }, null, 2) + "\n");

  if (changed) writeFileSync(HTML, updated);

  if (process.env.GITHUB_OUTPUT) {
    writeFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\n`, { flag: "a" });
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    const lines = [
      `## マンガ新刊チェック ${TODAY}`, "",
      `- 作品数: ${rows.length}`,
      `- 新刊: ${newVolumes.length ? newVolumes.join(" / ") : "なし"}`,
      `- 要確認: ${warn.length ? warn.map(r => `${r.t} (${r.status})`).join(", ") : "なし"}`, "",
      "| 作品 | 既刊 | 次巻 | 発売予定 | 状態 |", "|---|---|---|---|---|",
      ...report.map(r => `| ${r.t} | ${r.latest} | ${r.next} | ${r.nd || "未定"} | ${r.status} |`)
    ];
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n", { flag: "a" });
  }
}

main().catch(e => { console.error(e); process.exit(1); });
