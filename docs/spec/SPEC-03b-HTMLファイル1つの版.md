# SPEC-03b: HTML ファイル1つの版（ダブルクリックで開く、管理者権限が要らない、外部と通信しない）

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: ビルドの形（Worker・WASM・フォントの埋め込み）を大きく変える必要があり、file:// でのブラウザの制約と、CSP・性能・全機能の動作を同時に満たす必要があるため

---

## 目的

SPEC-03a の固定・閉域版は、内部 Web サーバーに置く必要がある。利用者の職場では、**管理者権限を伴う変更（サーバーの設置・設定、ソフトのインストール）ができない**。

そこで、**HTML ファイル1つ**（例: `karu-pdf-v1.0.0.html`）を自分の PC か共有フォルダに置き、**ダブルクリックで Edge・Chrome に開く**だけで使える版を作る（利用者が選んだ。2026-10-02）。

この版は、次を満たす。
1. サーバーも exe も要らない。管理者権限が要らない。
2. 外部との通信を、CSP の `connect-src 'none'` で**完全に禁止**する（サーバー版の `'self'` より厳しい）。
3. ファイルを差し替えない限り、版は変わらない（Service Worker を使わない）。
4. PDF のデータは、今までどおりブラウザの中だけで扱う。
5. 今のすべての編集機能が使える。

**今の GitHub Pages 版（`npm run build`）と、SPEC-03a の固定・閉域版（`npm run build:fixed`）の生成物と動作を変えないこと。** 3つの版を同じソースから作れるようにする。

## 試作で確かめたこと（2026-10-02、Edge、file://）

- `file://` のページは `isSecureContext === true`。`showOpenFilePicker`・`showSaveFilePicker`（上書き保存に使う）と IndexedDB は使える。
- 同じフォルダの通常のスクリプト（`<script src>`）は読み込める。**`<script type="module" src>` と、モジュール形式の Worker（`{ type: 'module' }`）は使えない**（オリジンが null のため）。
- **Blob URL から作った従来形式の Worker は動き、その中で WASM も動く**（CSP `worker-src blob:` と `'wasm-unsafe-eval'` のもとで）。
- MuPDF.js は、トップレベルの `await` を使い、読み込まれた直後に WASM の関数を呼ぶ。そのため、MuPDF.js を書き換えずに、**Worker のコード全体（ESM でまとめたもの。トップレベルの import・export が無いもの）を `async` の関数で包み、最初のメッセージで WASM を受け取ってから実行する**方式で動いた。
  - WASM は、ページ側で base64 を1回だけバイト列に戻し、`WebAssembly.compile` で1回だけ `WebAssembly.Module` にして、各 Worker へ `postMessage` で渡す。
  - Worker 側では `globalThis.$libmupdf_wasm_Module = { instantiateWasm(imports, done) { … } }` を設定してから、包んだコードを実行する。
  - `mupdf-wasm.js` の `import.meta.url` は、実行されないが構文として残るので、ビルドのときに `self.location.href` に置き換える。
  - 4 つの Worker の準備は 0.09 秒、5 ページの PDF を開いて1ページ目を描くのは 0.07 秒だった。base64 を戻すのに 1.7 秒かかったが、これは `Uint8Array.from(atob(...), fn)` が遅いためで、`Uint8Array.fromBase64`（無ければ、事前に確保した配列へ `charCodeAt` で書き込む）を使う。
- `connect-src 'none'` で、外部への `fetch` は止まり、外部への要求は 0 件だった。

## 対象

- 変更してよいファイル: `vite.config.ts`、`package.json`（scripts だけ。依存を加えない）、`index.html`（通常版・固定版の出力は変えないこと）、`.gitignore`、`playwright.config.ts`、`src/`、`scripts/`、`e2e/`、`tests/`、`README.md`、新規 `.env.single`、`docs/固定版/`、`.github/workflows/fixed-release.yml`
- 変更しないファイル: `.github/workflows/deploy.yml`、`package-lock.json`、`public/`、`LICENSE`、`docs/`（この SPEC と `docs/固定版/` を除く）
- **新しい npm パッケージを加えない。** 手元にある `vite`・`rolldown` と Node の標準機能だけを使う。

## 変更内容

### 1. ビルド

- `npm run build:single`（`vite build --mode single` と、その後の組み立てのスクリプト）で、`dist-single/karu-pdf-v<版>.html` を1つ作る。
- `.env.single`: `VITE_DISTRIBUTION_MODE=single`、`VITE_APP_VERSION=1.0.0-single`
- HTML の中に、次をすべて入れる。外部のファイル（同じフォルダのファイルも含む）は読みに行かない。
  - CSS（`<style>`）
  - 画面のプログラム（インラインのスクリプト1つ。動的 `import()` で分かれた部分を作らない）
  - Worker のコード（`pdf.worker`、`image.worker`。上の「包む」方式。実行されない `<script type="text/plain" id="…">` などに入れ、Blob URL で従来形式の Worker として起動する）
  - MuPDF の WASM（base64。実行されない要素に入れる）
  - BIZ UD ゴシック・明朝（base64。実行されない要素に入れる）
- 通常版・固定版と同じく、SPEC-03a の `/* @fixed:start */` のような領域の仕組みを使い、`single` のときだけのコードは、ほかの版の出力に入らないようにする。必要なら `@single:start` などを加える。
- アイコンは、HTML に `data:` URL で入れてよい（小さいもの）。

### 2. フォント

- 今の Worker の `fetch` によるフォントの取得は、この版では行わない。Worker がフォントを必要としたときに、画面側へ頼み、画面側が埋め込みの base64 をバイト列に戻して渡す（最初の1回だけ戻し、以後は使い回す）。
- 画面の文字の入力欄などで使う BIZ UD の表示（今の `@font-face`）は、この版では、使うときに `new FontFace(name, arrayBuffer)` で登録する。HTML の中にフォントを二重に入れない。
- 起動のときに、フォントを戻さない（使うときまで遅らせる）。

### 3. Service Worker と更新

- この版では Service Worker・PWA の登録を行わない（`file://` では使えない）。更新の案内も出さない。
- 版はファイルそのもので固定される。新しい版にするときは、ファイルを差し替える。

### 4. CSP（`<meta http-equiv="Content-Security-Policy">`）

```
default-src 'none'; script-src 'sha256-…'（インラインのスクリプトのハッシュ） 'wasm-unsafe-eval';
worker-src blob:; connect-src 'none'; style-src 'unsafe-inline';
img-src data: blob:; font-src data:; object-src 'none'; base-uri 'none'; form-action 'none'
```

- インラインのスクリプトは `'unsafe-inline'` ではなく、**ハッシュ**で許可する（組み立てのスクリプトで計算する）。
- 実機で必要な最小限に調整してよい。調整したら理由を報告する。`*`・`https:`・`http:`・`'unsafe-eval'` は入れない。
- `frame-ancestors` は meta では効かないので入れない（報告にその旨を書く）。

### 5. 印刷・保存・開く

- 開く: `showOpenFilePicker`（無ければ `<input type="file">`）、ドラッグ＆ドロップ。今と同じ。
- 保存: 上書き保存（File System Access API）、別名で保存。今と同じ。
- 印刷: 今は Blob の PDF を新しいタブで開いている。`file://` のページからこれが動くことを確かめる。動かない場合は、印刷用の PDF を保存させて、ブラウザで開いて印刷するよう案内する形にする（報告する）。
- 最近使ったファイル（IndexedDB）: 使える。`file://` のページは、PC の中のほかの HTML ファイルと保存場所を共有しうるので、PDF の中身は今までどおり保存しない（ファイルハンドルと名前だけ）。

### 6. 版の表示

- 「このアプリについて」に、版（`1.0.0-single`）、ビルドの日付、コミット、配布形態「HTML ファイル1つの版（固定・閉域）」、外部通信「使用しない（CSP で禁止）」、更新方式「ファイルの差し替え」を表示する。
- 画面の下の帯に、小さく「固定・閉域版（HTML）」と表示する。

### 7. 起動の速さ（重要）

- HTML の読み込みから、画面が操作できるまでの時間と、`heavy-300p.pdf` を開いて1ページ目が出るまでの時間を計測する。
- 目標: 画面が操作できるまで 2 秒以内、PDF を開いて1ページ目が出るまで（試作の基準 SPEC-00a の目標と同じ）3 秒以内。
- base64 を戻すのは、WASM は起動のとき1回、フォントは使うときに1回だけにする。`Uint8Array.fromBase64` が使えればそれを使う。

### 8. 監査と配布物

- `scripts/audit-network.mjs` に `--single` を加え、`dist-single/` の HTML を監査する（SPEC-03a と同じ許可リストの方式）。埋め込みの base64 の部分は、監査の対象から外してよいが、その範囲を正確に特定して外す（HTML 全体を外さない）。
- `npm run release:single`: `audit:network` → `test` → `build:single` → `audit:network -- --single` → 配布物の作成。
  - `release/karu-pdf-v1.0.0-single.zip`: HTML、`LICENSE`、`THIRD_PARTY_LICENSES`、`VERSION.txt`、`SHA256SUMS.txt`、`SBOM.cdx.json`、`使い方.txt`（下の 10. の要点）
  - `release/karu-pdf-v1.0.0-single.zip.sha256`、`release/karu-pdf-v1.0.0.html.sha256`（HTML 単体のハッシュ。利用者が HTML だけを受け取る場合に使う）
- `.github/workflows/fixed-release.yml` で、固定版に加えて HTML の版も作り、Artifact に入れる。
- `.gitignore` に `dist-single/` を加える。

### 9. 試験

- Playwright に `single` プロジェクトを加え、`dist-single` の HTML を `file://` で開いて試験する（`?test=1` を付けてテスト用の窓口を使ってよい）。
  1. **通信**: 開く → 10 ページほど移動 → 拡大 → 検索 → 文字・四角・蛍光ペンを書き込む → ページ整理（並べ替えて適用）→ 計測 → 比較（2つ目の PDF）→ 画像として保存 → 保存。その間の要求を記録し、`file:`・`blob:`・`data:` 以外の要求が **0 件**であること。`securitypolicyviolation` が 0 件であること。
  2. **CSP の負の試験**: 画面と Worker から、外部への `fetch`・`WebSocket`・`sendBeacon`・`<img>`、同じフォルダのファイルへの `fetch` を試み、すべて止められること。
  3. **全機能**: 上の操作の結果（書き込みの数、ページの順、計測の値、保存したバイト列を開き直した内容）を確かめる。上書き保存は、テスト用の窓口で File System Access の書き込みを模してよい。
  4. **オフライン**: `context.setOffline(true)` の状態で、HTML を開くところから上の操作ができること。
  5. **版の表示**: 「このアプリについて」の内容。
  6. **起動の速さ**: 7. の計測（1回）。
- 通常版の `e2e`（全件）と、固定版の `e2e:fixed` も、今までどおり通ること。通常版の `dist/` と固定版の `dist-fixed/` が、この変更の前と同じであること（SPEC-03a と同じ方法で比べる）。

### 10. 文書

- `README.md` に「HTML ファイル1つの版」を加える。使い方:
  1. `karu-pdf-v1.0.0.html` を、自分の PC か共有フォルダに置く。
  2. ダブルクリックで開く。既定のブラウザが Edge・Chrome でない場合は、右クリック →「プログラムから開く」→ Edge。
  3. よく使うなら、Edge のお気に入りに入れるか、デスクトップにショートカットを置く。
  4. 新しい版にするときは、HTML ファイルを差し替える。`.sha256` で本物か確かめる方法（PowerShell の `Get-FileHash`）。
- 保証の範囲（ブラウザの拡張機能、PC の管理、組織のブラウザのポリシーで `file://` が禁止されている場合は使えないこと、など）を書く。
- `docs/固定版/セキュリティ設計.md` に、HTML の版の設計（`connect-src 'none'`、ハッシュによるスクリプトの許可、Service Worker なし、IndexedDB の共有の注意）を加える。
- 公開リポジトリなので、職場を特定できる言葉は使わない。

## 禁止事項

- 対象外のファイルを変更しないこと。git の変更操作をしないこと。
- 新しい npm パッケージを加えないこと。`package-lock.json` を変えないこと。
- 通常版と固定版の動作と生成物を変えないこと。
- MuPDF.js のファイル（`node_modules`）を直接書き換えないこと（ビルドのときの変換は可）。
- 自分で起動したサーバーは必ず止め、一時ファイルは削除すること。
- テストは「通った」だけでなく、**通信の記録の中身、保存したバイト列の中身、ハッシュの一致、計測の値**を確かめること。

## 検証項目

- [ ] `npm run build`、`npm test`、`npm run e2e`（全件）、`npm run e2e:fixed` がすべて成功する。
- [ ] 通常版の `dist/` と固定版の `dist-fixed/` が、変更前と同じであること（違いがあれば理由）。
- [ ] `npm run release:single` が成功し、配布物ができる。
- [ ] `single` プロジェクトの試験がすべて成功する。

## 報告してほしいこと

- 変更したファイルの一覧と、通常版・固定版への影響（比較の結果）
- HTML のファイルの大きさと、その内訳（WASM・フォント・プログラム）
- CSP の内容（ハッシュの付け方を含む）と、調整したところ
- Worker・WASM・フォントの読み込みの方式
- 印刷が file:// で動くか
- 通信の試験の結果（file・blob・data 以外の要求の件数、CSP 違反の件数）と、負の試験の結果
- 起動の速さの計測の結果
- 配布物のハッシュ
- 残るリスク（組織のポリシーで file:// が禁止される場合など）
