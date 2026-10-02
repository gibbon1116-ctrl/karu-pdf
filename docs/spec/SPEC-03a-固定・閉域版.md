# SPEC-03a: 固定・閉域版（外部と通信しない、版を固定した配布物）

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: ビルドの仕組み、PWA、セキュリティ（CSP・通信の監査）、配布物の作成、試験の仕組みにまたがり、今の GitHub Pages 版を壊さないことが求められるため

---

## 目的

利用者から「固定・閉域版」の改修指示書が出た（2026-10-02）。業務用・機密文書用として、次の3点を同時に満たす配布物を、**今の GitHub Pages 版とは別に**作れるようにする。

1. PDF のデータを外部へ送らない（今と同じ）
2. 実行中のアプリが、GitHub を含む外部のインターネットと一切通信しない
3. 管理者が承認した版から、勝手に更新されない

職員の PC から見た形は「PC →（HTTPS）→ 内部 Web サーバー → 固定された かるPDF」とする。GitHub は、開発・ソースの管理・固定版の作成までにだけ使い、PDF を扱う PC の実行環境からは切り離す。

**今の GitHub Pages 版（`npm run build`、https://gibbon1116-ctrl.github.io/karu-pdf/、自動公開のワークフロー）の動作と生成物を変えないこと。**

利用者と決めたこと:
- 固定版の最初の版は **`1.0.0-fixed`**。
- 公開リポジトリの文書では、職場を特定できる言葉を使わず、「**内部サーバー**」「内部 Web サーバー」と書く。
- 固定版でも PWA（アプリとしてインストール、オフライン動作）を残す。更新の確認先は、同じ内部サーバーだけにする。

最初に、`vite.config.ts`、`package.json`、`index.html`、`src/main.tsx`、`src/pwa.ts`、`src/App.tsx`（更新の案内と「このアプリについて」）、`src/app/MenuBar.tsx`、`src/worker/pdf.worker.ts`（フォントの `fetch`）、`src/client/PdfWorkerPool.ts`・`src/client/ImageWorkerClient.ts`（Worker の作り方）、`playwright.config.ts`、`.github/workflows/deploy.yml`、`README.md`、`.gitignore` を読むこと。

## 対象

- 変更してよいファイル: `vite.config.ts`、`package.json`（scripts だけ。依存を加えない）、`index.html`、`.gitignore`、`playwright.config.ts`、`src/`、`scripts/`、`e2e/`、`tests/`、`README.md`、新規 `.env.pages`・`.env.fixed`、新規 `docs/固定版/`、新規 `.github/workflows/fixed-release.yml`、新規 `THIRD_PARTY_LICENSES` の作り方（生成物）
- 変更しないファイル: `.github/workflows/deploy.yml`、`package-lock.json`、`public/`（中身の追加は不可。参照のしかたは変えてよい）、`LICENSE`、`docs/`（この SPEC と `docs/固定版/` を除く）
- **新しい npm パッケージを加えない。** ZIP の作成、SHA-256、SBOM、静的配信の試験用サーバーは、Node の標準機能（`node:zlib`、`node:crypto`、`node:http` など）で作る。

## 変更内容

### 1. ビルドの切り替え

- `package.json` に次を加える。今の `build` は変えない。
  - `"build:fixed": "tsc --noEmit && vite build --mode fixed"`
  - `"audit:network": "node scripts/audit-network.mjs"`（ソースの監査。`-- --dist` で固定版の生成物を監査）
  - `"package:fixed": "node scripts/package-fixed.mjs"`（配布物の ZIP を作る）
  - `"release:fixed"`: 次の順に実行し、どこかで失敗したら止まる。`audit:network` → `test` → `build:fixed` → `audit:network -- --dist` → `package:fixed`
  - `"e2e:fixed": "playwright test --project=fixed"`
- `.env.pages`: `VITE_DISTRIBUTION_MODE=pages`。`.env.fixed`: `VITE_DISTRIBUTION_MODE=fixed`、`VITE_BASE_PATH=/karu-pdf/`、`VITE_APP_VERSION=1.0.0-fixed`。
- `vite.config.ts` は `loadEnv(mode)` で読み、次を**1か所から**決める。
  - `base`、マニフェストの `id`・`start_url`・`scope`・`icons` の `src`・`file_handlers` の `action`
  - 固定版の出力先は **`dist-fixed/`**（通常版の `dist/` と混ざらないようにする）
  - 固定版では、`VITE_BASE_PATH` を変えれば、別のパスに置けるようにする（`/` で始まり `/` で終わることを検査する）
- 通常版（mode が production・pages）の生成物は、変更前と同じにする。確認として、変更前のコミットと変更後で `npm run build` の `dist/` を比べ、**中身が同じ**であることを報告する（ファイル名と SHA-256 の一覧で比べる。違いが出た場合は、理由を報告する）。
- 生成物に `github.io` などの実行元の URL を埋め込まない。

### 2. GitHub Pages 上での起動を止める（固定版だけ）

- 固定版が `*.github.io` で開かれたときは、アプリを起動せず、白い画面にもせず、次の文を表示する。
  > 固定・閉域版を GitHub Pages から実行することはできません。管理された内部サーバーから起動してください。
- 判定は `src/main.tsx`（React を描く前）で行い、関数に切り出して単体テストできるようにする。インラインのスクリプトは使わない（CSP で止まるため）。

### 3. 外部との通信を止める（アプリ側）

- 実行時の取得は、すべて**同じオリジン（配信元のサーバー）**の固定版の配布パスの中だけとする。
- `src/worker/pdf.worker.ts` のフォントの取得は、`new URL(..., self.location.origin)` で URL を作り、`origin` が `self.location.origin` と同じで、パスが `BASE_URL` の中にあることを確かめてから取得する。違えば例外にする。二重スラッシュなどの誤った結合をしない。この確かめは関数に切り出し、単体テストを書く。
- MuPDF.js の WASM、Worker、マニフェスト、アイコン、フォントは、相対 URL か同一オリジンの URL だけで読み込まれることを確かめる（下の 6. と 7. の試験で示す）。
- PDF の本体・ファイル名・書き込みの内容・検索語・比較の内容を、URL・クエリ・ヘッダー・本文のどれにも載せて送らない（今のまま。試験で示す）。

### 4. CSP とセキュリティのヘッダー

- **`connect-src 'self'` にする**（指示書の案 A）。理由: フォントと WASM を同じサーバーから `fetch` で読んでいる。`'none'` にするにはフォント（約 15MB）をプログラムに埋め込む必要があり、起動が重くなる。
- 主はサーバーのレスポンスヘッダーで設定する。固定版の `index.html` には、補助として `<meta http-equiv="Content-Security-Policy">` を入れる（`frame-ancestors` など、meta では効かない指示は入れない）。通常版の `index.html` には入れない。
- 内容（実機で動くことを確かめ、必要な最小限に調整してよい。調整したら理由を報告する）:
  ```
  default-src 'self'; connect-src 'self'; script-src 'self' 'wasm-unsafe-eval';
  worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; font-src 'self';
  img-src 'self' data: blob:; media-src 'self' blob:; manifest-src 'self';
  object-src 'none'; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'
  ```
  あわせて `X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`、`Permissions-Policy: camera=(), microphone=(), geolocation=()`。
- `*`、`https:`、`http:` などの広い許可は入れない。
- **内部 Web サーバーの設定例**を `docs/固定版/サーバー設定例.md` に書く: IIS（`web.config`）、Apache（`.htaccess`）、nginx。ヘッダーに加え、`.wasm` の MIME（`application/wasm`）、`.webmanifest`、Service Worker（`sw.js`）を必ず再確認させるキャッシュの設定（`Cache-Control: no-cache`）を含める。

### 5. PWA と更新（固定版）

- 今の `registerType: 'prompt'` を基本にする。`skipWaiting`・`clientsClaim` を常に有効にする設定や、`autoUpdate` は使わない。
- 更新の確認先は、同じ内部サーバーの `sw.js` だけ（Service Worker の仕組みのまま）。外部の更新確認・版の確認 API・CDN は使わない。
- 新しい版を見つけたときの案内の文を、固定版では「管理者が配布物を更新しました。再読み込みすると新しい版に切り替わります」にする。通常版の文は今のまま。
- アプリとしてインストールできる機能は残す。

### 6. 版の表示

- ビルドのときに、版（`VITE_APP_VERSION`）、ビルドの日付、Git のコミット（短い形と全体の SHA）を埋め込む（`define`）。Git が無い環境では `unknown` とする。
- ヘルプ▼「このアプリについて」に、版・ビルドの日付・コミットを表示する。固定版では、さらに次を表示する:
  - 配布形態: 固定・閉域版
  - 外部通信: 使用しない
  - 更新方式: 管理者による手動更新
- 固定版では、画面の下の帯の右端などに、小さく「固定・閉域版」と表示する。編集の画面を圧迫しないこと。

### 7. 通信の監査（`scripts/audit-network.mjs`）

- 2つの使い方がある。
  - ソースの監査: `src/`、`public/` のテキスト、`index.html`、`vite.config.ts`
  - 生成物の監査（`--dist`）: `dist-fixed/` のすべての JS・CSS・HTML・マニフェスト・Service Worker・Workbox のファイル
- 探すもの: `http://`、`https://`、`//` で始まる外部 URL、`fetch(`、`XMLHttpRequest`、`WebSocket`、`sendBeacon`、`EventSource`、`RTCPeerConnection`、`importScripts(` の外部 URL、`google-analytics`、`googletagmanager`、`sentry`、`mixpanel`、`segment`、`jsdelivr`、`unpkg`、`cdnjs`、`github.io`、`github.com`、`githubusercontent`、`googleapis`、`gstatic`
- **許可リスト**（`scripts/audit-allowlist.json`）: 見つかったものを、ファイル・文字列・理由の組で許可する。全面的な除外はしない。例:
  - SVG・XML の名前空間（`http://www.w3.org/2000/svg` など）
  - MuPDF.js・React・Workbox の本体に含まれる、実行されない文字列（エラーメッセージの URL、ライセンスの URL など）。どのライブラリのどの文字列かを理由に書く
  - アプリ自身の同一オリジンのフォント取得（`fetch` が1か所あること）
- 許可リストに無いものが見つかったら、ファイル・行（生成物では前後の文字）・文字列を出して、**終了コード 1 で失敗**する。
- ライセンス文、README、開発の文書、テストのコードは監査の対象外とし、その理由をスクリプトのコメントに書く。
- 単体テスト: 許可リストにない外部 URL や `sendBeacon` を含む一時ファイルで失敗すること、許可した文字列では通ること。

### 8. 配布物（`scripts/package-fixed.mjs`）

- `dist-fixed/` から、`release/karu-pdf-fixed-v1.0.0.zip` を作る（版の番号は `VITE_APP_VERSION` から）。ZIP の中:
  - 固定版の生成物の一式（`index.html`、`assets/`、`fonts/`、`icons/`、マニフェスト、`sw.js`、Workbox のファイル）
  - `LICENSE`、`THIRD_PARTY_LICENSES`、`VERSION.txt`、`SHA256SUMS.txt`、`SBOM.cdx.json`
- `VERSION.txt`: Application、Distribution（Fixed / Closed Network）、Version、Build Date、Git Commit（全体の SHA）、Node Version、npm Version、npm lockfile hash（`package-lock.json` の SHA-256）、Build mode、Base path、CSP（4. の内容）
- `SHA256SUMS.txt`: ZIP に入れる全ファイルの SHA-256（`sha256sum -c` で確かめられる形）
- ZIP の外に `release/karu-pdf-fixed-v1.0.0.zip.sha256`
- `SBOM.cdx.json`: CycloneDX 1.5 の JSON。`package-lock.json` と `node_modules` の各 `package.json` から、名前・固定された版・ライセンス・直接か間接か・実行時に含まれるか（`dependencies` の木は `required`、開発用は `excluded`）を出す。同梱のフォント（BIZ UD、OFL）も部品として入れる。
- `THIRD_PARTY_LICENSES`: 実行時に含まれる第三者のもの（MuPDF.js、React、React DOM、scheduler、Workbox の実行時の部品、BIZ UD フォントの OFL など。実際にバンドルに入ったものを調べて決める）の名前・版・ライセンス・ライセンス文。
- ZIP は Node の `zlib` で自前に作る（新しいパッケージを加えない）。作った ZIP を展開して、`SHA256SUMS.txt` と一致することを、スクリプトの最後で確かめる。
- lockfile の確かめ: `package-lock.json` が Git の HEAD と同じであること（`git diff --quiet -- package-lock.json`）を確かめ、違えば失敗する。手順書では `npm ci` を使うことを書く。
- `.gitignore` に `dist-fixed/` と `release/` を加える。

### 9. 試験（Playwright の `fixed` プロジェクト）

- `scripts/serve-fixed.mjs`: `dist-fixed/` を配信する、試験用の小さな静的サーバー（`node:http`）。内部 Web サーバーの代わりとして、4. のヘッダーをすべて付ける。ポートは 4174。`/karu-pdf/` の外は 404。
- `playwright.config.ts` に `fixed` プロジェクトを加える（`webServer` で上のサーバーを使う。`e2e` と `bench` は変えない）。
- 試験の中身（`e2e/fixed-*.spec.ts`）:
  1. **通信の記録**: キャッシュの無い状態から起動し、PDF を開く → 10 ページほど移動 → 検索 → 文字と四角を書き込む → ページ整理（並べ替えて適用）→ 比較（2つ目の PDF）→ 保存（テスト用の窓口かダウンロード）。その間のすべての要求（`page.on('request')` と Service Worker・Worker からの要求を含む。`context.on('request')` を使う）を記録する。
     - 外部オリジンへの要求が **0 件**であること
     - 同一オリジンの要求がすべて `/karu-pdf/` の中の静的な取得（GET）であること。POST・PUT・PATCH・DELETE が 0 件であること
     - URL・ヘッダーに、PDF のファイル名・検索語・書き込みの文字が含まれないこと
     - 同一オリジンの要求の一覧（URL・目的）を試験の出力に出す（報告に使う）
     - `securitypolicyviolation` が 0 件であること
  2. **CSP の負の試験**: ページの中から `fetch('https://example.com/')`、`new WebSocket('wss://example.com/')`、`navigator.sendBeacon('https://example.com/', 'x')`、外部の `<img>` を試み、すべてブラウザに止められる（`securitypolicyviolation` が出る、または例外になる）こと。Worker の中からの外部 `fetch` も止められること。この試験では、ネットワークへ実際の要求が出ていないことも記録で確かめる。
  3. **3つの状態の起動**: キャッシュを消した初回、通常の再起動、オフライン（`context.setOffline(true)` の後の再読み込み）。オフラインで、PDF を開く・表示・拡大・ページ移動・文字の入力・図形・検索・ページ整理・保存ができること。
  4. **github.io の判定**: 2. の関数の単体テスト（`tests/`）で、`*.github.io` のときに止まり、ほかでは止まらないこと。
  5. **版の表示**: 「このアプリについて」に `1.0.0-fixed`、コミット、「固定・閉域版」「外部通信: 使用しない」「管理者による手動更新」が出ること。
- 通常版の `e2e`（全件）も、今までどおり通ること。

### 10. GitHub Actions（任意の手動実行だけ）

- `.github/workflows/fixed-release.yml` を加える。**`workflow_dispatch`（手で起動したときだけ）**で、`npm ci` → `npm run release:fixed` → `release/` を Artifact として保存する。
- GitHub Pages へは公開しない。内部サーバーへの配布もしない（管理者が Artifact を確かめて、手で置く）。
- 今の `deploy.yml` は変えない。

### 11. 文書

- `README.md` に、2つの版の違いを書く。
  - 通常版: GitHub Pages、自動で更新される、一般の利用向け
  - 固定・閉域版: 内部サーバーで使う、外部と通信しない、版を固定、管理者が手で更新、機密性の高い業務での利用を想定
  - 固定版の作り方（`npm ci` → `npm run release:fixed`）、置き方、更新のしかた、運用の流れ（コミットを決める → 固定版を作る → ZIP とハッシュを確かめる → 管理者が確認 → 内部サーバーへ置く）
  - 「絶対安全」などの言い方はしない。技術的に保証している範囲と、していない範囲（ブラウザの拡張機能、PC の管理、サーバーの設定は対象外など）をはっきり書く。
- `docs/固定版/セキュリティ設計.md`: 二重の防御（アプリが外部と通信しない＋CSP）、`connect-src 'self'` にした理由、PWA と更新の扱い、Service Worker が同一オリジンへ行う通信、保存の方式（File System Access API とブラウザ内の Blob）、IndexedDB に入れるもの（ファイルハンドル・ファイル名・最近使ったファイルだけ。PDF の本体は入れない）、残るリスク。
- `docs/固定版/サーバー設定例.md`（4. のとおり）。
- 公開リポジトリなので、職場を特定できる言葉は使わない。

## 変えないもの

- PDF の編集の機能（表示、書き込みのすべての道具、文字の選択と印、コピー、検索、書き込みの一覧と CSV、ページ整理、結合・分割・抽出、画像として保存、保存、確定して保存、印刷、計測、雲、指摘、画像から PDF、並べて表示、比較）は変えない。
- 他のプロジェクトのコードや依存を取り込まない。

## 禁止事項

- 対象外のファイルを変更しないこと。git の変更操作をしないこと。
- 新しい npm パッケージを加えないこと。`package-lock.json` を変えないこと。
- 通常版の動作と生成物を変えないこと。
- 自分で起動したサーバー（4173・4174 など）は必ず止め、一時ファイルは削除すること。
- テストは「通った」だけでなく、**通信の記録の中身・ヘッダーの値・ハッシュの一致**を確かめること。

## 検証項目

- [ ] `npm run build`、`npm test`、`npm run e2e`（全件）がすべて成功する（通常版）。
- [ ] 通常版の `dist/` が、変更前と同じであること（違いがあれば理由）。
- [ ] `npm run release:fixed` が成功し、ZIP・`.sha256`・`VERSION.txt`・`SHA256SUMS.txt`・`SBOM.cdx.json`・`THIRD_PARTY_LICENSES` ができる。
- [ ] `npm run e2e:fixed` がすべて成功する。

## 報告してほしいこと

指示書の第 28 章に沿って報告すること。
- 変更したファイルの一覧と、通常版への影響（`dist/` の比較の結果）
- 固定版の作り方・起動のしかた・base path
- PWA と Service Worker の扱い
- CSP の内容と、`connect-src 'self'` にした理由。実機で調整したところ
- 内部 Web サーバーのヘッダーの設定（設定例の要点）
- 通信の監査の結果（ソースと生成物）。許可リストに入れたものと理由
- Playwright の通信の試験の結果（外部への要求の件数、同一オリジンの要求の一覧と目的、POST などの件数、CSP 違反の件数）、負の試験の結果
- オフラインの試験の結果
- ZIP の SHA-256、`package-lock.json` の SHA-256、SBOM の要約（実行時に含まれる部品の一覧）
- 残るセキュリティ上のリスク
