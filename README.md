# マンガ新刊トラッカー

読んでいる漫画の既刊・次巻の発売予定をスマホで確認するための単一HTMLページ。
GitHub Pages で配信し、カタログは GitHub Actions が毎日自動更新する。

**公開URL**: https://ikgm3.github.io/manga-tracker/

## 構成

```
index.html                          アプリ本体（自己完結。CATALOGブロックを Actions が書き換える）
sw.js                               オフライン用 Service Worker（ネットワーク優先）
manifest.json / *.png               ホーム画面アイコン
data/watchlist.json                 追跡する作品の定義 ← 人が編集するのはここだけ
data/last-run.json                  直近の実行結果（自動生成）
scripts/update-catalog.mjs          楽天ブックスAPIを叩いてカタログを更新する
.github/workflows/update-catalog.yml  毎日 08:00 JST に実行
```

既読巻数は各端末の `localStorage`（キー `manga-tracker-read-v2`）に保存され、
どこにも送信されない。カタログだけが全端末に配信される。

## セットアップ（初回のみ）

### 1. 楽天のアプリIDとアクセスキーを発行する

1. https://webservice.rakuten.co.jp/app/create で楽天アカウントでログインし、アプリを新規登録する（無料）
2. https://webservice.rakuten.co.jp/app/list で **applicationId** と **accessKey** を確認する

> 2025年以降、`accessKey` が必須になっている。両方必要。

### 2. GitHub Secrets に登録する

リポジトリの **Settings → Secrets and variables → Actions → New repository secret** で2つ登録する。

| 名前 | 値 |
|---|---|
| `RAKUTEN_APP_ID` | applicationId |
| `RAKUTEN_ACCESS_KEY` | accessKey |

Secrets は Actions の実行環境からしか読めず、GitHub Pages で配信される
`index.html` には一切含まれない。ブラウザから鍵が見えることはない。

### 3. 動作確認

**Actions タブ → 新刊カタログ更新 → Run workflow** で手動実行する。
実行後のサマリに全作品の判定結果が表示される。

## 作品を追加する（スマホから）

**Issues → New issue → 「作品を追加」** を選び、作品名と既読巻数を入力して送信する。

ワークフローが自動で以下を行う。

1. 入力内容を検証して `data/watchlist.json` に追加
2. 楽天ブックスを検索して既刊・次巻・表紙を取得
3. `index.html` を更新してコミット
4. 結果をIssueに返信して自動でクローズ

判定が `ok` にならなかった場合はその旨が返信される。検索語や出版社を変えて新しいIssueを立て直す。

削除したいときは `data/watchlist.json` から該当行を消す。
ただし `index.html` の CATALOG からも消えるため、**その作品の既読巻数は失われる**。

## 作品定義を直接編集する

`data/watchlist.json` の `titles` を編集する。

```json
{ "t": "作品名", "init": 12, "query": "楽天での検索語", "publisher": "講談社",
  "exclude": ["カンナの日常"], "note": "補足", "complete": false }
```

| キー | 説明 |
|---|---|
| `t` | **既読データのキー。絶対に変更しない**（変えると既読巻数が消える） |
| `init` | 初期既読巻数。既に読んでいる巻数を入れる |
| `query` | 楽天ブックスAPIに渡す検索語。`t` と違ってよい（例: `フラジャイル`） |
| `publisher` | 出版社名。ソフトな絞り込み（一致が0件なら無視される） |
| `exclude` | 除外語。スピンオフや別レーベル対策 |
| `note` | アプリに表示する補足 |
| `complete` | `true` なら完結扱いでAPIを叩かない |

`img`（表紙URL）は `index.html` 側に自動で書き込まれるため、watchlist に書く必要はない。

追加したら手動実行するか、翌朝の自動実行を待つ。

## 判定ロジックと安全策

- 商品タイトルから巻数を抽出し、発売日が今日以前を「既刊」、今日より後を「次巻」とする
- `globalExclude`（特装版・分冊版・セット・小説など）は全作品に適用される
- **巻数は絶対に減らない。** APIの取りこぼしで前回より小さい巻数が返っても既存値を維持する（`regression-ignored`）
- 該当商品が見つからない場合は既存値をそのまま維持する（`no-match`）
- 発売日が「2026年9月上旬」のように曖昧な場合は中間日を入れ、`nc` を `予想` にする

### 実行結果のステータス

| 状態 | 意味 |
|---|---|
| `ok` | 正常に判定できた |
| `no-match` | 条件に合う商品が0件。既存値を維持（`query` や `exclude` の見直しを検討） |
| `regression-ignored` | APIが前回より古い巻数を返したので無視した |
| `only-upcoming` | 予約商品しか見つからなかった |
| `complete` | 完結指定のためスキップ |

`no-match` や `regression-ignored` が続く作品は `data/last-run.json` を見て
`query` / `publisher` / `exclude` を調整する。

## 表紙について

既刊最新巻としてマッチした商品の `largeImageUrl` を `index.html` に保存し、
ブラウザは楽天のCDNから直接読み込む。APIキーは介在しない。

表紙が取得できなかった作品は、作品名から生成した色のタイルに巻数を表示する。
画像の読み込みに失敗した場合も同じタイルに自動で戻るので、表示が崩れることはない。

楽天ウェブサービスの規約によりクレジット表示が必要なため、ページ下部に
「Supported by 楽天ウェブサービス」を記載している。**消さないこと。**

## メモ

- ワークフローは毎回 `data/last-run.json` を更新してコミットするため、リポジトリの活動が途切れない。
  公開リポジトリで60日間活動がないとスケジュール実行が自動停止するが、この構成では起きない。
- 楽天APIはレート制限があるため、作品ごとに1.2秒の間隔を空けている（30作品で約1分）。
- ローカルで試すとき: `RAKUTEN_APP_ID=xxx RAKUTEN_ACCESS_KEY=yyy node scripts/update-catalog.mjs --dry-run`
- APIを叩かずロジックだけ試すとき: `node scripts/update-catalog.mjs --mock mock.json --dry-run`
