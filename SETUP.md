# 今日やること（所要 15〜20分）

上から順に。**順番を飛ばさないでください。**

---

## STEP 1 楽天のIDを2つ取得する（5分）

1. https://webservice.rakuten.co.jp/app/create を開く
2. 楽天アカウントでログイン
3. アプリ登録フォームを次のとおり埋める

| 項目 | 入れる内容 |
|---|---|
| アプリケーション名 | `mangatracker`（記号NG。ハイフンも不可） |
| アプリケーションURL | `https://ikgm3.github.io/manga-tracker/` |
| 応募タイプ | 個人利用にあたるものを選ぶ（迷ったら「ウェブサイト」系） |
| 許可されたウェブサイト | 下記の2行 |
| アプリケーションの説明 | `個人で読んでいる漫画の新刊発売日を管理するツール` |
| データ使用目的 | `購読中の漫画の既刊巻数・次巻の発売予定日・書影を取得し、個人用の読書管理ページに表示するため。非営利の個人利用。` |
| 必要とされるQPS | `1` |
| APIアクセススコープ | **楽天ブックスAPI だけ**にチェック |

**許可されたウェブサイト**（1行に1つ、この2行を入力）

```
ikgm3.github.io
github.com
```

4. 登録後 https://webservice.rakuten.co.jp/app/list を開く
5. **applicationId** と **accessKey** をメモする（2つとも必要）

> 無料です。課金情報の入力もありません。

---

## STEP 2 ファイルをGitHubに上げる（2分）

PCでコマンドプロンプト（または PowerShell）を開いて、次を1行ずつ実行する。

```
cd C:\Users\ikega\manga-tracker
git add -A
git commit -m "feat: Actions自動更新・表紙・作品追加フォーム"
git push
```

最後に `main -> main` と表示されれば成功。

> 「nothing to commit」と出た場合はすでに上がっています。次へ進んでください。

---

## STEP 3 GitHubに鍵を登録する（3分）

1. https://github.com/ikgm3/manga-tracker/settings/secrets/actions を開く
2. **New repository secret** を押して、2つ登録する

| Name | Secret |
|---|---|
| `RAKUTEN_APP_ID` | STEP 1 の applicationId |
| `RAKUTEN_ACCESS_KEY` | STEP 1 の accessKey |

名前は**大文字とアンダースコアまで完全に一致**させてください。

---

## STEP 4 Actionsに書き込み権限を与える（1分）

1. https://github.com/ikgm3/manga-tracker/settings/actions を開く
2. 下の方の **Workflow permissions** で **Read and write permissions** を選ぶ
3. **Save** を押す

> ここが読み取り専用のままだと、STEP 5 が最後のコミットで失敗します。

---

## STEP 5 動かしてみる（3分）

1. https://github.com/ikgm3/manga-tracker/actions を開く
2. 左の一覧から **新刊カタログ更新** を選ぶ
3. 右上の **Run workflow** → 緑の **Run workflow** ボタンを押す
4. 1〜2分待つ。実行が緑のチェックになれば成功

実行結果を開くと、全30作品の判定結果が表になって表示されます。

### 失敗したときの見分け方

| 症状 | 原因 |
|---|---|
| `RAKUTEN_APP_ID と RAKUTEN_ACCESS_KEY を...` | STEP 3 の名前が違う |
| 最後の push で `403` | STEP 4 をやっていない |
| `HTTP 400` が大量に出る | 鍵の値が間違っている（コピー時の空白に注意） |
| `HTTP 403` が大量に出る | 「許可されたウェブサイト」の設定。下記を試す |

**403 が出た場合**（ドメイン制限に引っかかっている可能性）

楽天のアプリ設定画面に戻り、「許可されたウェブサイト」に次を追加して保存し、もう一度実行する。

```
*.github.io
*.githubusercontent.com
```

それでも直らなければ、その旨を私に伝えてください。別の取得方法に切り替えます。

---

## STEP 6 スマホで確認する（2分）

1. https://ikgm3.github.io/manga-tracker/ を開く
2. **表紙が出ているか確認する** ← ここが今日の山場
3. ホーム画面に追加し直す（アイコンが新しくなります）

> 古いアイコンは自動では変わりません。一度削除してから追加し直してください。

---

## STEP 7 PC側の自動pushを止める（2分）

**STEP 5と6が成功してから**やってください。

### PowerShellでやる場合（おすすめ）

まずタスク名を調べる。

```powershell
Get-ScheduledTask | Where-Object {$_.TaskName -like "*manga*" -or $_.TaskName -like "*マンガ*"} |
  Format-Table TaskName, State, TaskPath
```

出てきた名前で無効化する。**タスク名は `manga-tracker push`（スペースあり）**。

```powershell
Disable-ScheduledTask -TaskName "manga-tracker push"
```

`State` が `Disabled` になれば完了。名前を一字でも省くと
「指定されたファイルが見つかりません」になるので、引用符ごと正確に入れること。

見つからないときは、名前が違う可能性があるので全件から探す。

```powershell
Get-ScheduledTask | Where-Object {$_.State -ne "Disabled"} | Format-Table TaskName, TaskPath
```

### GUIでやる場合

1. `Win + R` → `taskschd.msc` → Enter
2. 左の「タスク スケジューラ ライブラリ」を開く
3. 該当タスクを右クリック → **無効**

削除ではなく**無効化**にしておくこと。戻したくなったら右クリック → 有効 で復活できる。

これでPCの電源に関係なく、毎朝8時に自動更新される。

> `push-manga-tracker.bat` は消さないこと。チャットで修正した内容をGitHubへ
> 反映するときに、手動で `git push` する経路として残しておく。

---

# 完成後の使い方

### 作品を追加する

スマホから https://github.com/ikgm3/manga-tracker/issues/new?template=add-title.yml
を開き、作品名と既読巻数を入れて送信するだけ。
1〜2分でIssueに結果が返信され、アプリにも反映されます。

### 読んだ巻を記録する

アプリの ＋ / − を押す。記録はその端末に保存されます。
機種変更の前は「データを書き出す」でJSONを控えておいてください。

### PCから手動でpushするとき

Actionsが毎日リモートにコミットするため、**必ず先に取り込む**こと。

```powershell
cd C:\Users\ikega\manga-tracker
git pull --rebase
git add -A
git commit -m "変更内容"
git push
```

`git pull` を忘れると `! [rejected] main -> main (fetch first)` で弾かれる。

### うまく取れない作品があったら

`data/last-run.json` の中身を私に見せてください。
検索語や除外語を調整します。
