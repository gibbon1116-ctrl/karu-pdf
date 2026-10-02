# SPEC-03b 実装・検証記録

2026-10-02、Windows / Edge 154、Node v24.18.0 / npm 11.16.0 で検証した。
Git の変更操作、依存の追加、npm install、Python は使用していない。
配布物は未コミットの作業ツリーから作成しており、表示コミットは既存 HEAD
`38859d1c502b6afe505637a6a4f6f4ccd90ac485` である。

## 変更ファイル

| 分野 | ファイル |
|---|---|
| ビルド・配布 | `vite.config.ts`、`package.json`（scripts のみ）、`.env.single`、`.gitignore`、`.github/workflows/fixed-release.yml` |
| 組み立て・監査 | `scripts/single-worker.mjs`、`scripts/assemble-single.mjs`、`scripts/verify-single.mjs`、`scripts/audit-network.mjs`、`scripts/audit-allowlist.json`、`scripts/package-fixed.mjs` |
| 起動・表示 | `src/main.tsx`、`src/pwa.ts`、`src/App.tsx`、`src/app/MenuBar.tsx`、`src/single/About.tsx`、`src/single/runtime.ts` |
| Worker | `src/client/PdfWorkerPool.ts`、`src/client/ImageWorkerClient.ts`、`src/worker/pdf.worker.ts`、`src/single/workerFonts.ts` |
| 試験 | `playwright.config.ts`、`e2e/single-network.spec.ts`、`tests/single-build.test.ts` |
| 文書 | `README.md`、`docs/固定版/セキュリティ設計.md`、`docs/固定版/HTML版の使い方.txt`、この記録 |

対象外のファイルを変更していない。`package-lock.json`、`public/`、`LICENSE`、
`.github/workflows/deploy.yml` は変更していない。

## 既存の2版とコマンドの結果

変更前に `npm run build` と `npm run build:fixed` を実行し、ファイル名と
SHA-256 の一覧を一時ファイルに記録した。最終ソースで両方を再ビルドし、
通常版 19 ファイル、固定版 27 ファイルの全 46 ファイルで、名前・SHA-256 が一致した。
固定版の比較ではビルド日時を変更前の `2026-10-02T02:18:12.789Z` に揃えた。
コミットは変更していないため同一である。日時を固定する一時スクリプトと
環境変数は比較後に元へ戻し、一時スクリプトと一覧は検証完了後に削除した。

| 検証 | 結果 |
|---|---|
| `npm run build` | 成功 |
| `npm run build:fixed` | 成功、上記の全ファイル一致 |
| `npm test` | 50 ファイル・278 試験成功（release:single 内で全件実行） |
| `npm run e2e` 全件 | 最終の全件再実行で134試験成功、終了コード0 |
| `npm run e2e:fixed` | 4 試験成功 |
| `npm run release:single` | 全段階成功 |
| `npm run e2e:single` | 最終配布 HTML で 5 試験成功 |
| 通信の静的監査 | ソース 6 出現、HTML 30 出現、未許可 0 |

通常版の初回全件実行では 133 件成功、既存の検索性能試験が空白フレーム率で
1 件失敗した（基準 0.492857、実測 1）。同じ生成物の対象試験は再実行で成功した
（検索結果 824 件、初結果 213.3 ms、完了 8,877.2 ms、空白率 0.5 → 0.5）。
判定基準や既存アプリの処理は変更していない。
最終の全件再実行は他の試験・ビルドと並行せずに行い、134件すべて成功した。
検索性能は824件、初結果194.4 ms、完了10,418.5 ms、空白率1 → 0.333333だった。

固定版の通信記録は外部要求 0、GET 以外 0、CSP 違反 0。
初回 53 件、初回・通常再起動・オフライン起動の試験で 106 件を記録し、
各要求の URL・ヘッダー・本文に PDF、ファイル名、検索語、書き込みがないことを確認した。
HTML・WASM・manifest・sw.js のレスポンスヘッダーは実際の値を照合した。

- `Content-Security-Policy`: `scripts/fixed-policy.mjs` の CSP と一致。
- `X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`。
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`。
- `Cache-Control: no-cache`。
- WASM: `application/wasm`、manifest: `application/manifest+json`、SW: `text/javascript; charset=utf-8`。

## HTML の大きさと読み込み

`dist-single/` の最終成果物は `karu-pdf-v1.0.0.html` だけ。
29,165,072 bytes（約 27.8 MiB）。内訳は次のとおり。

| 内容 | HTML 内の bytes | バイナリ元の bytes |
|---|---:|---:|
| MuPDF WASM（base64） | 13,879,768 | 10,409,826 |
| BIZ UD ゴシック（base64） | 6,223,176 | 4,667,380 |
| BIZ UD 明朝（base64） | 8,205,244 | 6,153,932 |
| 画面プログラム・起動処理 | 640,536 | — |
| PDF Worker・起動処理 | 164,678 | — |
| 画像 Worker・起動処理 | 6,425 | — |
| CSS | 32,883 | — |
| アイコン・HTML・メタデータなど | 12,362 | — |

全体を作る前に、指定方式の MuPDF の file:// 試作を実行した。
従来形式の Blob Worker の async 関数内で WASM を初期化し、
400×500 のページを RGB 600,000 bytes に描画した。記録は HTML 1 件・Blob 1 件、
CSP 違反 0、`isSecureContext === true`。試作の一時 HTML は削除した。

画面側が WASM を1回復号し、1回だけ `WebAssembly.compile` する。
同じ Module を Worker の最初のメッセージで渡し、
`$libmupdf_wasm_Module.instantiateWasm` を設定してから、ESM をまとめたコード全体を
async 関数内で実行する。準備中のメッセージは順序を保って処理する。
Worker は import/export と import.meta がない Blob の従来形式である。
画面側も既存の MuPDF の参照を持つため、Module を非同期でインスタンス化する。
8MB を超える主スレッドの同期インスタンス化制限に対応した変更であり、CSP の緩和ではない。

フォントは必要時に画面で各1回だけ復号し、Worker にメッセージで複製する。
同じバイト列を FontFace で表示用に登録する。起動時にフォントを復号せず、CSS に二重に入れない。
ゴシック・明朝の両方で復号1回、FontFace の loaded 状態、日本語注釈の保存を確認した。
`Uint8Array.fromBase64` の代替経路も初回オフライン試験で実行した。
Service Worker / PWA を登録せず、更新の案内も出さない。

## CSP と通信

最終 HTML の meta CSP は次のとおり。

```text
default-src 'none'; script-src 'sha256-Qb4Gwu4eBcuszSms89/+kZKqxhtQw2VMWlaywqOmNyw=' 'wasm-unsafe-eval'; worker-src blob:; connect-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; object-src 'none'; base-uri 'none'; form-action 'none'
```

実行されるインラインスクリプトは1つ。最終スクリプトの UTF-8 バイト列を SHA-256 で
計算し、base64 で script-src に入れる。実際の HTML から再計算した値も一致した。
SPEC の CSP を緩めていない。`frame-ancestors` は meta で効かないため入れていない。
file:// の HTML には HTTP レスポンスヘッダーがない。

通常・最初からオフラインの両試験で、各 HTML 1 件、PDF Worker の Blob 4 件、
画像 Worker の Blob 1 件、合計 6 件を記録した。
**file/blob/data 以外の要求 0、CSP 違反 0、GET 以外 0、本文なし**。
記録された全要求の URL・ヘッダー・本文を検査し、秘密のファイル名・検索語・
書き込み・PDF の先頭文字列が含まれないことを確認した。
WASM の復号・compile は1回、起動・重い PDF 表示時のフォント復号は0回だった。

負の試験では、ページの外部 fetch・WebSocket・sendBeacon・画像、同じフォルダの
ファイルへの fetch を遮断した。ページで connect-src 違反4件、img-src 違反1件。
Worker の外部 fetch・WebSocket・同じフォルダへの fetch も遮断し、connect-src 違反3件。
DedicatedWorker には sendBeacon と Image / DOM がなく、利用不能であることを検査した。
sendBeacon は true を返したが、CSP 違反と実通信0で遮断を確かめた。
画像は requestfailed の記録が1件あり、実際の外部ネットワーク送信・レスポンスはともに0。

静的監査は指定された base64 要素と data アイコンの範囲だけを除外する。
JS・Worker・CSS を監査し、許可リストは未使用の MuPDF/Emscripten の取得分岐、
React の例外説明 URL、SVG/XML/MathML の名前空間に回数制限と理由を付けている。

## 編集・保存・印刷・性能

12 ページを開き、10 ページ移動、拡大、検索、文字・四角・蛍光ペン、並べ替え・適用、
計測、2つ目の PDF との比較、画像として保存、画像 Worker による PDF 作成、保存を実行した。
保存したバイト列を Node の MuPDF とブラウザで開き直した。

- 保存した PDF は 139,065 bytes、12 ページ、注釈4件。
- 元の1ページ目は最後へ移動し、全ページのテキストで順序 `2…12, 1` を検査。
- 最後のページには日本語 FreeText、Square、Ink の3件。
- 新しい1ページ目の距離注釈は 72pt・縮尺1/100から **2,540 mm**。開き直しても一致。
- 画像化 PDF は 14,141 bytes、1ページ、抽出テキストなし。
- 画像 Worker の出力は 1,484 bytes、1ページ。
- API を模した別名保存・上書き保存は、実際に渡された 569,974 / 142,228 bytes を解析し、
  12 ページとゴシック・明朝の2件の日本語注釈を確認。
- file:// から Ctrl+P で Blob PDF タブを開き、`embed[type="application/pdf"]` の表示と
  12 ページの印刷用 PDF（142,228 bytes）を確認。印刷方式の変更は不要だった。

最終配布 HTML の単回計測は、画面操作可能まで **632.5 ms**、
`heavy-300p.pdf`（101,494,206 bytes）の最初の鮮明なページ表示まで **975 ms**。
それぞれ目標2秒・3秒以内だった。計測の生値と通信・内容の JSON は
`test-results/single/` の各試験の出力先に残している。

## 配布物とハッシュ

`release/karu-pdf-v1.0.0-single.zip` は 13,959,037 bytes。
独立した展開でも7ファイルと全6件の SHA256SUMS を検査した。
ZIP 内の HTML と dist-single の HTML はバイト単位で一致。
ZIP 外の .zip.sha256、.html.sha256 も実ファイルの値と一致した。
埋め込み WASM・2フォントも元ファイルのバイト列とハッシュが一致した。

```text
HTML  08bd4ca39ca3c138448f626dc3be34d612e725b7384a648c00daf8e223892dae
ZIP   d02adf57880e7b62cd0952f4e226419d99814f83481b07111de3d74c4876a1ac
lock  3e74f6daafa047f52f64799ea0595a1aad2b4f3a9afe080aa37e40b6085f90cc
WASM  5a30ef7b027f541ea8fc54e7c73f16414b0b59940741a12efe5e55f1fd0a99d7
Gothic 7d2b48d84ef4e65c9f85bcf65fb1fb41c92b134be641fab6a7141d597c9a92b0
Mincho 468ee6d9b149ca144809e03841bf18740ecf014e055a00da6ecaf1aaf4165af2
```

ZIP は HTML、LICENSE、THIRD_PARTY_LICENSES、VERSION.txt、SHA256SUMS.txt、
SBOM.cdx.json、使い方.txt を含む。CycloneDX 1.5 の SBOM は441部品を記録し、
同梱実行時部品は mupdf、react、react-dom、scheduler、BIZ UD Gothic、BIZ UD Mincho。
HTML 内のビルド日時は `2026-10-02T03:42:07.270Z`。

## 残る範囲と後片付け

組織のポリシーで file://、Blob Worker、WASM が禁止された場合は使用できない。
拡張機能、ブラウザ自体の通信、PC・OS の管理は CSP の保証対象外。
file:// の IndexedDB は他のローカル HTML と保存場所を共有しうる。
PDF 本体は保存しないが、ハンドル・名前とブラウザプロファイルの管理が必要。
ハッシュは信頼できる配布経路で受け取り、利用者側でも照合する。

ブラウザ試験は Edge 154 で実施し、Chrome の別実機、OS のネイティブ保存ダイアログ、
物理プリンターでの出力は自動検証していない。上書き保存は SPEC で許可された API の模擬で検査した。
性能はこの PC での単回値であり、他の環境での時間を保証しない。

試作・展開検証の一時ディレクトリは finally で削除した。比較用一覧・時計スクリプト・
一時ログは削除した。テストで起動した4173・4174のサーバーも停止し、
両ポートの LISTENING が0件であることを最終確認した。通信などの試験の出力は検証記録として残した。
