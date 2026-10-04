# SPEC-04o: 外部にデータを送ることに類する動作を止めて警告を出す

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 3つの配布形態の起動・ネットワークの呼出し・Worker・通信監査にまたがる安全機能の新規実装のため（判定表「新規機能の実装」「複数ファイルにまたがる改修」）

> Codex デスクトップアプリへ貼り付けて実行する場合は、モデルセレクタを上記に合わせてから貼り付けること。

---

## 目的

利用者の要望（2026-10-04、試用版 1.2.0 の試用中）:

> 外部にデータを送ることに類する動作をしようとしているときは、アラートを出すようにして下さい。

確認したところ、アプリ（かるPDF）に付ける機能として求められた（Claude の作業の話ではない）。利用者は公共建築の図面を扱うので、図面や書き込みが外部へ出ないことを、画面で確かめられるようにする。

## 現状（Claude Code が確認したこと）

- アプリには、外部へデータを送る機能も、外部のURLへのリンクもない。必要な通信は同じ配布元の資材（フォント・WASM・Worker・Service Worker）だけ。
- 印刷は `window.open('', '_blank')` で空のタブを開き、`blob:` のURLを表示する（`src/App.tsx` の `printDocument`）。外部への送信ではない。
- 閉域版は CSP で外部への通信を止めている（固定版 `connect-src 'self'`、単一HTML版 `connect-src 'none'`。`scripts/fixed-policy.mjs`、`vite.config.ts`）。止めたことは画面に出ない。通常版（GitHub Pages）には CSP がない。
- 起動は `src/main.tsx` の配布形態ごとの部分（`/* @pages */`・`/* @fixed */`・`/* @single */`）。固定版は App を読む前に `blocksFixedStartup` を確かめている。
- 配布物の通信監査（`scripts/audit-network.mjs` と `scripts/audit-allowlist.json`）は、`fetch(`・`XMLHttpRequest`・`WebSocket`・`sendBeacon`・`EventSource` などの文字列を探し、ファイルごとの許可リストで承認する。

## 対象

- 作業フォルダ: `C:\Users\gibbo\.codex\worktrees\dda9\PDF編集アプリ`
- 変更してよいファイル: 新規 `src/security/externalSend.ts`（見張りと判定）、新規 `src/app/ExternalSendAlert.tsx`（警告・確認の画面）、`src/main.tsx`（起動の最初に見張りを入れる）、`src/App.tsx`（警告の画面を置くだけ）、`src/worker/pdf.worker.ts`・`src/worker/image.worker.ts`（Worker 内の見張りと、止めたことの主画面への知らせ）、`src/client/PdfWorkerPool.ts`（Worker からの知らせを受け取るだけ）、`src/styles.css`、`src/app/HelpDialog.tsx`（説明の追加）、`scripts/audit-allowlist.json`（見張りのコードの承認）、`tests/`、`e2e/`
- 変更しないファイル: 上記以外

## 変更内容

### 1. 外部かどうかの判定（`src/security/externalSend.ts`）

- アプリのページと同じ配布元（`location.origin`）のURL、`blob:`、`data:`、`about:blank`、空のURLは「内部」。
- 別の配布元の `http:`・`https:`・`ws:`・`wss:`・`ftp:`、および `mailto:`・`tel:` などの外部のアプリへデータを渡すURLは「外部」。単一HTML版（`file://` で開く。`location.origin` は `"null"`）では、`http(s)`・`ws(s)` はすべて外部。
- 相対URLはページのURLを基準に解決してから判定する。解決できないURLは外部とみなして止める。

### 2. 見張り（起動の最初、App を読み込む前に入れる。3つの配布形態すべて）

- 次の呼出しで送り先が外部なら、**送らずに止めて**、警告を出す。内部なら今までどおり動かす。
  - `fetch`（`Request` オブジェクトも含む）、`XMLHttpRequest`（`open` で送り先を覚え、`send` で止める）、`navigator.sendBeacon`、`WebSocket`、`EventSource`
  - フォームの送信（`submit` イベント、`HTMLFormElement.prototype.submit`・`requestSubmit`）で送り先が外部のもの
  - 止めたときの戻り値: `fetch` は拒否された Promise（`TypeError`）、`sendBeacon` は `false`、`WebSocket`・`EventSource`・`XMLHttpRequest` は例外。アプリの動作が止まらないこと（呼出し側の例外処理に任せる）。
- 外部のリンクを開く動作（`<a href>` のクリック、`window.open`）は、すぐには開かず、確認の画面を出す。「開く」を選んだときだけ開く（`noopener`）。印刷の `window.open('', '_blank')` と `blob:` は内部なので今までどおり。
- ブラウザーが CSP で止めた通信（`securitypolicyviolation`）も、警告を出す。Worker（`pdf.worker`・`image.worker`）では、Worker 内の `fetch` の見張りと `securitypolicyviolation` を受け、主画面へ知らせる（`PdfWorkerPool` などで受け取って警告に渡す）。
- 見張りは軽い判定だけにし、通常の読込・表示・保存の速さに影響させない。

### 3. 警告と確認の画面（`src/app/ExternalSendAlert.tsx`）

- 止めたとき: 「外部への送信を止めました」。何を（通信の種類: fetch・XHR・Beacon・WebSocket・フォーム・CSP で遮断）、どこへ（送り先のホスト名。URL の残りは出さない）止めたかを出し、「データは送信していません」と明記する。続けて起きたものはまとめて件数を出す。「閉じる」で閉じる。`role="alertdialog"`。
- リンクを開く前: 「外部のサイトを開こうとしています」。送り先のホスト名を出し、「開くと、その場所へ接続します」と書く。「開かない」（既定のフォーカス）と「開く」を置く。
- 画面の言葉はやさしい日本語にする。ほかの画面（書式欄・ダイアログ）と見た目をそろえる。
- 試験用の `window.__karu` に、出た警告の記録を読む関数を足してよい（試験で確かめるため）。

### 4. 説明と監査

- `HelpDialog` に、外部への送信を止めて警告を出すことを1段落で書く。
- 見張りのコードは `XMLHttpRequest`・`WebSocket`・`sendBeacon`・`EventSource`・`fetch(` の文字列を含むので、通信監査で未承認にならないよう `scripts/audit-allowlist.json` に、ソースのファイルと配布物のファイル（固定版の分かれ方に合わせたファイル名のパターン、単一HTML版）の承認を、理由（「外部への送信を止めるための見張り。送信はしない」）と最小の出現数（`maxOccurrences`）で加える。既存の承認は広げない。

## 試験

- 単体試験（`tests/`）:
  - 判定: 同じ配布元・`blob:`・`data:`・`about:blank`・空・相対URLは内部、別の配布元の `http(s)`・`ws(s)`・`mailto:`・解決できないURLは外部。`file://` の配布元（`"null"`）では `http(s)` がすべて外部。
  - 見張り（`jsdom` などが使えなければ、見張りを入れる関数に偽の `window` を渡す形で）: 外部への `fetch`・`XMLHttpRequest`・`sendBeacon`・`WebSocket`・`EventSource`・外部のフォーム送信が止まり、元の関数が呼ばれず、警告の記録が残る。内部への呼出しは元の関数に渡る。
- 画面試験（`e2e/`）:
  - 通常版: 外部への `fetch` が拒否され、警告の画面にホスト名と「データは送信していません」が出て、実際の通信が起きない（`context.route` で外部を見張る）。同じ配布元への `fetch`（例: フォント）は成功する。`window.open('https://example.com/')` で確認の画面が出て、「開かない」で新しいページが開かない。印刷（既存の試験）は今までどおり動く。
  - 固定版・単一HTML版: 既存の「外部 fetch・WebSocket・Beacon・画像・Worker fetch は CSP が遮断する」試験を、見張りで止める分（fetch・WebSocket・Beacon）と CSP で止める分（画像・Worker）に合わせて直し、警告の画面が出ること、外部へ出た通信が0件のままであることを確かめる。
  - 既存の画面試験がすべて通ること（警告の画面が既存の操作を妨げないこと）。

## 禁止事項

- 元データ（`test-data/`、`bench-results/`、`dist*/`、`release/`、`work/`）を変更しないこと
- 「対象」に挙げていないファイルを変更しないこと
- 同じ配布元への必要な通信（フォント・WASM・Worker・Service Worker・Vite の modulepreload）を止めないこと
- CSP を緩めないこと
- 通常の読込に重い処理を足さないこと
- 指示していない仕様変更・リファクタを行わないこと
- 依存関係を追加しないこと
- **テスト・ビルド・型検査・ブラウザーを実行しないこと**（Claude Code 側で行う）
- **python は使えない（この環境に入っていない）。ファイルの編集は apply_patch で行い、スクリプトによる一括書き換えをしないこと**
- git 操作をしないこと

## 検証項目（Claude Code 側で実施）

- [ ] `npx tsc --noEmit` が通る
- [ ] `npm test`（単体試験の全件）が通る
- [ ] `npm run build` の後、追加・修正した画面試験と、通常版の画面試験の全件が通る
- [ ] 固定版・単一HTML版を作り、通信監査（未承認0件）と配布形態の画面試験が通る
- [ ] 画面で、外部への送信を止めたときの警告と、リンクを開く前の確認をスクリーンショットで確かめる
- [ ] 開く・表示の速さが変わらないことを記録する

## 報告してほしいこと

- 変更・作成したファイル一覧
- 見張りを入れた呼出しと、止めたときの戻り値
- Worker での扱い
- 通信監査に加えた承認とその理由
- SPEC から逸脱した箇所があれば、その内容と理由
- 残課題（見張れない通信があれば、その種類と理由）
