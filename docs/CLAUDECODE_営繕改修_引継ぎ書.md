# CLAUDECODE引き継ぎ書：かるPDF 営繕業務向け改修

更新日：2026-10-04（試用版 1.2.0 の作成後）。最初の版（1.1.0 の後）の内容のうち、今も有効なものは残し、削除した機能の説明と済んだ優先項目は改めた。

## 1. 再開時にまず把握すること

1. **下記の作業ツリーとブランチで続ける。** 改修コードはコミット済みで、改修ブランチは origin へ push 済み（利用者の指示「改修ブランチはプッシュします」による）。試用版 1.2.0 もローカルに作成済み。
2. 通常閲覧の軽快性を優先する。**数十msの差は記録して利用者の試用で判断する**。5%超過や小差だけを理由に作業を止めず、広い性能試験の反復を避ける。
3. 次は**利用者による 1.2.0 の試用**。その結果を受けて改修する。実装済みの機能や試験を調べ直して重複実装したり、全試験を最初から繰り返したりする必要はない。

| 項目 | 状態 |
|---|---|
| 作業場所 | `C:\Users\gibbo\.codex\worktrees\dda9\PDF編集アプリ` |
| ブランチ | `codex/eizen-review-upgrade`（origin へ push 済み） |
| 試用版 1.2.0 のソースコミット | `843d42b98c4604b0051c8a12460107d5470f3f1c` |
| その後のコミット | 文書（本書・報告）だけ。`git log --oneline 843d42b..HEAD` で確かめる |
| origin | `https://github.com/gibbon1116-ctrl/karu-pdf.git` |
| 未追跡 | `work/`（ログ・計測スクリプト・復元用 bundle など。消さない） |
| 公開状況 | PR 作成、公開サイトの差替え、Drive への書込みは行っていない |

まず [AGENTS.md](../AGENTS.md)、[実用性レビュー](営繕改修_実用性レビュー.md)（利用者の決定事項と進め方）、[試用版報告 1.2.0](調査/営繕改修_試用版報告_1.2.0.md)、[復元と性能判定](営繕改修_復元と性能判定.md) を読む。[試用版報告 1.1.0](調査/営繕改修_試用版報告.md) と `docs/spec/` の SPEC は経緯の参照用。

## 2. 利用者の指示と開発方針

- PDFを開くたびに全ページ文字解析、OCR、全ページ差分を実行しない。使っていない機能は通常閲覧へほとんど影響させない。
- 性能低下5%は目安。指示は「数十ms程度の誤差は実際に私が触ってみてからその可否を判断します。導入前に戻せる状態を確保しながら作業を先に進めてください。今後の扱いも同様とします」。絶対ms・相対%・測定条件を残す。
- 大きな遅延、フリーズ、破損、異常なメモリ増加は原因を調査して修正する。未測定を「問題なし」と扱わない。
- 機能ごとに小さく実装し、必要な試験、性能記録、Gitコミットを行う。失敗を直した後は関連試験を絞って再実行する。
- 性能測定中に重い試験・ビルドを並行実行しない。ビルドの終了コード0を確認してから、その配布形態のE2Eや包装へ進む。
- PDF原本を保ち、試用・保存はコピーや別名保存を使う。大規模な工程管理ソフトに広げない。
- 役割分担（利用者の共通ルール）: 企画・調査・SPEC作成・レビューは Claude Code、実装は Codex。SPEC を `docs/spec/` に置き、Codex CLI へ渡す（既定は `gpt-6.1-sol`・effort `high`、軽作業だけ `gpt-6-luna`・effort `max`）。返ってきたコードは仕様逸脱・既存機能の破壊を確かめてから採用し、直した点を報告する。

### 実用性レビューでの利用者の決定（2026-10-04）

- 個数カウントは、登録した器具（名称・略号・印の形・塗り・色）のリストから器具を選んで数える。特定の器具だけを図面に表示できる。表示中の図面と全図面の個数を出し、CSVでも両方を出す。器具リストは CSV から読み込まない。建築・電気設備・機械設備の見本を用意し、複製して名称・略号・形などを変えて追加できる。
- 図面の記号の見本は「両方」（印の書式の登録と、図面から切り取った見本）。記号の自動検索は作らない。器具の追加時は、まだ選んでいない形・塗り・色を自動で提案する。
- 指摘は残し、番号は文書全体の通し番号。
- 変更記録、本文文字の修正、図面内文字の抽出、共有・提出用に保存は**削除**（図面の修正は CAD などで行う）。
- CSVは、指摘に限らず複数の種類を選んで書き出す。
- 四角も Shift を押しながらで正方形にする。

## 3. 成果物と復元

### 試用版 1.2.0

| 成果物 | 用途 |
|---|---|
| [単一HTML版ZIP](../release/karu-pdf-v1.2.0-single.zip) | 別フォルダーに展開し `karu-pdf-v1.2.0.html` をEdgeで直接開いて試す（14,029,883 bytes） |
| [単一HTML本体](../dist-single/karu-pdf-v1.2.0.html) | この作業ツリー内で直接試す場合 |
| [固定版ZIP](../release/karu-pdf-fixed-v1.2.0.zip) | 同梱資材で使用する配布版。内部HTTPサーバーが必要（12,133,632 bytes） |
| [試用版報告 1.2.0](調査/営繕改修_試用版報告_1.2.0.md) | 変更点、互換、検証、性能、未測定事項の正式な記録。SHA-256 もここにある |

1.1.0 の配布物も `release/` に残してある。単一HTML版 1.1.0 の本体は `bench-results/eizen/review-final-1.1.0-single/`、通常版 1.1.0 のビルドは `bench-results/eizen/review-final-1.1.0-dist/`。

**ローカル資料の保全：** `dist*`、`release/`、`bench-results/`、試料PDF、試験生成物の多くはGit管理外。`work/` にはログ・計測スクリプト・復元用bundleなどがあり、未追跡でも不要ファイルとは限らない。`git clean` や作業ツリー全体の削除をしない。`dist-single/` は単一HTML版を作るたびに中身を消して作り直す（`scripts/assemble-single.mjs`）。

### 導入前への復元

- 導入前タグ：`karu-pdf-before-eizen-20261003`
- 導入前コミット：`130166f6049938814c1f1b7db124790593444f5a`
- ローカルバックアップ：[work/rollback/karu-pdf-before-eizen.bundle](../work/rollback/karu-pdf-before-eizen.bundle)（導入前の履歴。改修ブランチの搬送用ではない。改修ブランチは origin にある）

復元先が未使用であることを確認し、旧版を別フォルダーに作る。現作業ツリーを `reset --hard` する必要はない。

```powershell
Set-Location 'C:\Users\gibbo\.codex\worktrees\dda9\PDF編集アプリ'
git worktree add --detach ../karu-pdf-before-eizen karu-pdf-before-eizen-20261003
Set-Location ../karu-pdf-before-eizen
npm.cmd ci
npm.cmd run build
```

アプリの旧版復元だけでは、利用者が保存済みのPDFは戻らない。PDF原本の保全は別に行う。詳細は [復元手順](営繕改修_復元と性能判定.md)。

### 改修コミット

1.1.0 まで（`bd00f3b`〜`bfa48c9`）は [試用版報告 1.1.0](調査/営繕改修_試用版報告.md) を参照。1.2.0 までの主なもの:

| コミット | 内容 |
|---|---|
| `7eabe0a`・`3f3387b` | 本書の初版。初回の小型PDF表示の遅れは、ブラウザー起動直後の試行に限られ版によらないと記録 |
| `fc3e68a` | 性能計測でブラウザー起動直後に記録しない空回しを1回入れる |
| `02310a2`・`39c20c7` | 実用性レビューと利用者の決定 |
| `64de5b2` | 図面内文字の抽出、共有・提出用に保存を削除（SPEC-04b） |
| `8199c50` | 四角も Shift で正方形（SPEC-04e） |
| `a3f962c` | 変更記録の削除、指摘番号の整理、種類を選ぶCSV（SPEC-04c） |
| `557ee09` | 本文文字の修正を削除（SPEC-04g） |
| `1ea53b2`・`bc62fcb` | 器具リストで数える個数カウントと、その見やすさ（SPEC-04d・04h） |
| `dcbf049`・`aafa310`・`ef63aba` | 多数の印の保存を速くする（注釈の索引、外観を `setAppearance` で入れる、保存のジャーナルを区切る。SPEC-04i・04j・04k） |
| `f20cda0` | 図面の記号を器具の見本にする、未使用の形・塗り・色の提案（SPEC-04f） |
| `75a0e7a` | 二重丸の塗りつぶしを輪にする（SPEC-04l） |
| `71ae952`・`843d42b` | 版を 1.2.0 に上げる、固定版の通信監査の許可リストを分かれ方の変わったファイル名に合わせる |

## 4. 実装済み機能とコードの入口

| 機能 | 実装・制約 | 主なファイル |
|---|---|---|
| PDF読込中表示 | 操作直後に「PDFを開いています」。初表示、成功、失敗、中止で解除。根拠のない進捗率なし | `src/App.tsx`、`src/app/PdfOpeningFeedback.tsx` |
| 指摘 | 文書全体の通し番号。状態は未回答→回答済→修正済→確認済。詳細に分野（候補から選べる）、回答、修正確認、図面番号。貼り付け・引継ぎで番号を保つ（引継ぎ元番号を記録）。PDF内保存 | `src/core/issues.ts`、`src/core/annotations.ts`、`src/editor/AnnotationStore.ts`、`src/app/AnnotationListPanel.tsx`、`src/app/IssueDetails.tsx` |
| 旧版の変更記録 | 1.1.0 で作ったものだけ「変更記録（旧版）」として一覧に出し、削除できる。作成・編集はできない。番号は指摘の通し番号に数えない | `src/core/annotations.ts`（`legacyChange`）、`src/app/AnnotationListPanel.tsx` |
| 個数カウント（器具リスト） | 器具タブ、追加・複製・編集・削除・並べ替え、見本から追加、他のPDFから読み込む、表示の絞り込み、表示中の図面と全図面の個数、数量表CSV。旧形式（種類名）の印は器具タブを開くと器具へ移す | `src/app/FixturePanel.tsx`、`src/app/FixtureDialog.tsx`、`src/app/FixturePresetDialog.tsx`、`src/core/countFixtures.ts`、`src/core/counts.ts`、`src/editor/countMarkers.ts` |
| 器具の見本 | 図面の記号を四角で囲んで切り取り、PNG（base64 48KiB まで、各辺16〜160画素）を器具に保存。書き込みを含まない図面だけを Worker で描く | `src/app/FixtureDialog.tsx`、`src/App.tsx`（切り取りの接続）、`src/editor/AnnotationLayer.tsx`（範囲の指定）、`src/client/PdfWorkerPool.ts`（`renderFixtureSample`）、`src/worker/pdf.worker.ts`（`contentsOnly`） |
| CSV | 書き込み一覧の「CSV に書き出す…」で種類・ページ範囲・指摘の状態を選び1つの表に。個数は器具ごとの数量表を別に書き出す | `src/app/CsvExportDialog.tsx`、`src/app/annotationCsv.ts` |
| 新旧／分野別比較 | 既存の左右表示、差分、同期ズーム・移動を再利用。透過率、2組の基準点による移動・倍率・回転補正 | `src/app/CompareView.tsx`、`src/core/registration.ts`、`src/core/compare.ts`、`src/worker/compareRender.ts` |
| ページ対応 | 手動図面番号、ページ対応、位置補正をJSON出力・再読込。読み込み時の全ページ自動認識なし | 比較UI、`src/core/registration.ts` |
| 未解決指摘の引継ぎ | 現在の対応ページを対象に候補表示。利用者確認、位置補正、重複・範囲外除外、1操作Undo、元指摘保持、番号を保つ | `src/app/IssueTransferDialog.tsx`、`src/app/issueTransfer.ts` |

削除した機能: 図面内文字の抽出（CSV/TXT）、共有・提出用に保存、本文文字の修正、変更記録の作成。

### 次の改修で守る設計上の要点

- Workerの入口は `src/client/PdfWorkerPool.ts`、`src/worker/pdf.worker.ts`、`src/worker/protocol.ts`。Worker 0 が文書の操作（編集・保存）を担い、Worker 1〜3 が描画する。Worker 0は全ページサイズ等を取得するが、描画Workerでは同じ全ページ情報の重複取得を省く。署名・編集制限の確認は残す。
- PDF内の保存形式: 指摘は注釈の `KaruIssue`（JSON）。個数の印は `KaruCount`（新形式 `{version:2,id,fixtureId}`、旧形式 `{version:1,id,group}`）。器具リストはカタログの `KaruCountFixtures`（JSON、1,000件・4MiB まで）。IDを保ち、複製時は新IDにする。旧 `done`（対応済）は確認済と自動同一視しない。
- 器具リストは器具タブ・保存・CSVなどで必要になったときだけ読む（`ensureSessionFixtures`）。通常の読込では読まない。
- 印の図形は `countMarkerData`（`src/editor/countMarkers.ts`）が作り、画面の印、500個を超えたときのまとめ描き（`AnnotationLayer.tsx`）、PDFの外観（`annotations.ts` の `drawCountMarker`）の3か所で共通に使う。塗りは非ゼロ規則（二重丸の輪は内側を逆巻きにして抜く）。
- 個数カウントと指摘の外観は、一時文書で作ったテンプレートを元の文書へ写し、`annotation.setAppearance` で入れる（同じ書式の印は Resources を共有。大きさのキーは小数の誤差を丸める）。`annotation.update()` は呼ばない。ほかの種類（四角・線・丸・手書き・文字など）は今も `update()` で外観を作るため、1ページに数千個あると件数の2乗で遅くなる。
- 保存の取消し（原子性）は MuPDF のジャーナルで行う。`applyEditsAtomically`・`applyAndSaveAtomically` は `pdfChunkedOperation`（`src/core/editTransaction.ts`）で50件ごとに操作を区切り、失敗したらこの呼出しで終えた操作だけを `undo()` する。区切らないと件数の2乗で遅くなる。ページの整理・ヘッダーフッターは従来の `pdfOperation`。
- MuPDF.js の `page.getAnnotations()` はページの wrapper に注釈の handle を覚える。試験や補助関数でその handle を destroy すると、後の呼出しが壊れる。
- 指摘一覧は100行、引継ぎ候補は50行ずつ。500個超のカウント印は書式別のSVGパスに集約し、1,000個を超えると画面では略号を省く。選択時も大量の個別DOM生成を避ける。
- 位置合わせは相似変換。旧1→新1→旧2→新2の基準点を指定し、新図面を旧図面へ合わせる。ページ対応JSONは容量、件数、ページ範囲、有限数、文書名等を検証する。比較終了時は専用キャッシュを破棄する。
- CSVはBOM、CRLF、数式化の抑止を維持する。
- 配布版の JavaScript は、遅延読込の画面がどのモジュールを読むかで塊の分かれ方とファイル名が変わる。固定版の通信監査（`scripts/audit-allowlist.json`）はファイル名で許可しているので、塊が移って未承認が出たら、前の版と同じコードかを確かめてから許可リストを直す（1.2.0 で `annotations-*.js`・`AnnotationLayer-*.js` に合わせた）。

未実装：3画面、OCR、全ページ自動差分、自動図面番号認識、自動ページ対応、自動修正済判定、図面記号の自動検索。

## 5. 完了した検証と限界（1.2.0）

| 対象 | 結果 |
|---|---|
| ビルド | 通常版・固定版・単一HTML版が成功 |
| 単体 | 64ファイル・376件すべて成功 |
| 通常版E2E | 全件で171件成功・1件スキップ（実試料なし）。SPEC-04l の後は対象の9件を再実行して成功 |
| 固定版E2E | 16件すべて成功。外部通信0、GET以外0、CSP違反0 |
| 単一HTML E2E | 20件すべて成功。外部通信0 |
| 通信監査 | ソース・固定版・単一HTML版とも未承認0件 |
| 1.1.0 で作ったPDF | 開ける。指摘の番号が続く。旧版の変更記録は一覧に出る（`work/check-legacy-trial-pdf.mjs`） |
| 実図面での見本の切り取り | 天井伏図の凡例の記号で確認（`work/walkthrough-04f.mjs`、`work/screens-04f/`） |
| 大量の印 | 合成PDFの印5,000個（100種類）で、移行・書式変更・保存・開き直しまで確認。実図面の多数の印と同じ条件ではない |

記録の一覧は [試用版報告 1.2.0](調査/営繕改修_試用版報告_1.2.0.md) の「検証」。古い失敗ログがあることだけで最新成果を未完了に戻さない。

## 6. 性能の記録と未解決事項

1.2.0 の数値と条件は [試用版報告 1.2.0](調査/営繕改修_試用版報告_1.2.0.md) の「性能」と、[読込JSON](調査/eizen-review-1.2.0-opening.json)、[全操作JSON](調査/eizen-review-1.2.0-performance.json)。要点:

- 読込（各5回の中央値）は改修前と比べて、小型 -11.0〜-1.7%、300ページ -3.7〜-0.7%。初期取得本文量 +56,254 bytes（+0.10%）。
- 全操作（各2回）は差がすべて数十ms以内。小型の保存処理 +10.5ms（1.1.0 でも +9.0ms）、300ページの保存処理 +10.8ms、400%ズーム +7.5ms。2回では統計的な保証にならない。
- 多数の印の保存は、旧形式1,000個の移行と書式変更で 50,234→614ms、5,000個で25分超→2,199ms。

1.1.0 の性能記録（[全操作JSON](調査/eizen-review-final-performance.json)、[読込JSON](調査/eizen-review-final-opening.json)）は、ブラウザー起動直後の空回しなしの条件で測ったもの。1.2.0 の数値と直接比べない。

### 未解決・未測定

1. ほかの種類の書き込み（四角など）の外観は `update()` で作るため、1ページに数千個あると件数の2乗で遅くなる（Node で四角2,000個の作成と更新に約24秒）。照査では考えにくい数なので直していない。
2. 印5,000個の合成PDFを開いて操作できるまで約20秒（1.1.0 から同じ程度）。内訳は未測定。
3. 印5,000個の文書では1個追加しただけの保存でも約0.9秒。内訳は未測定。
4. 利用者の実図面、実IME、実上書きI/O、8GB端末、ピーク／GPUメモリは未測定。

済んだ項目: 初回の小型PDF表示の遅れ（ブラウザー起動直後の試行に限られ、版によらない。1.1.0 の報告の追記）。大容量PDFの文字解析中の性能（文字の抽出を削除したので不要になった）。

### 原記録の取り違えに注意

測定入口は `scripts/eizen-bench.mjs`、比較は `scripts/eizen-compare.mjs`（読込だけの記録には `--open-only` を付ける。ラベルに「.」は使えない）。生記録の `buildDir` と比較条件を確認し、`candidate` というフォルダー名だけで新旧を決めない。

| `bench-results/eizen/` 以下の記録 | root側 | candidate側 |
|---|---|---|
| `review-1-2-0-open-2026-10-04T10-13-15-742Z` | 1.2.0（`review-1.2.0-dist`） | 導入前（`baseline-dist`） |
| `review-1-2-0-unused-2026-10-04T10-14-40-682Z` | 1.2.0 | 導入前 |
| `review-final-unused-2026-10-03T22-32-47-461Z` | 1.1.0 | 導入前 |
| `review-final-open-2026-10-03T22-37-25-174Z` | 1.1.0 | 導入前 |

日時部分はUTC。

## 7. 継続作業の優先順位

### 優先1：利用者による 1.2.0 の試用

まず PDF を開く、A1の拡大・スクロール・パン、文字の入力と保存を確かめてもらい、その後に器具リスト（見本から追加、複製、図面からの見本の切り取り、数える、表示の絞り込み、数量表CSV）、指摘、CSV の書き出しを確かめてもらう。性能差の採否は利用者が実際の操作で判断する。実図面（電灯コンセント平面図など）と、普段使う指摘一覧・数量表の Excel の様式があれば `test-data/real/` に置いてもらう（[実用性レビュー](営繕改修_実用性レビュー.md) の 8）。

### 優先2：試用の結果による改修

試用で出た指摘を先に直す。その後、実用性レビューの順8（引継ぎのまとめ表示、ページ対応のPDF内保存）を、試用の結果を見て決める。3画面・OCR・全ページ自動解析を当然の次工程として着手しない。

### 優先3：必要になったときだけ

- 四角など、ほかの種類の大量保存の高速化（未解決1）。実際に困る数が出たときに、個数カウントと同じく `setAppearance` へ寄せる。
- 印の多い文書を開くときと、1個追加の保存の内訳の調査（未解決2・3）。

## 8. 再開コマンドと検証方法

### 起動・状態確認

```powershell
Set-Location 'C:\Users\gibbo\.codex\worktrees\dda9\PDF編集アプリ'
git branch --show-current
git status --short
git log --oneline -5
git rev-parse karu-pdf-before-eizen-20261003
git bundle verify work/rollback/karu-pdf-before-eizen.bundle
claude
```

`node_modules` は現作業ツリーに存在するため、依存関係の変更や欠落がなければ再インストールから始めない。エンジンはMuPDF.js 1.28.1。PDFiumの開発用ベンチ依存があるが、エンジンを置き換えたわけではない。

### 変更した機能だけを先に試験する

下記から変更対象に対応するものを選び、全部を毎回実行しない。

```powershell
npm.cmd test -- tests/countFixtures.test.ts tests/countFixtures.integration.test.ts tests/counts.test.ts
npm.cmd test -- tests/editTransaction.integration.test.ts tests/stampAppearance.integration.test.ts tests/annotations.batch.integration.test.ts
npm.cmd test -- tests/cloudIssues.test.ts tests/cloudIssues.integration.test.ts tests/annotationCsv.test.ts
npm.cmd test -- tests/registration.test.ts tests/compare.integration.test.ts
```

画面試験は通常版ビルドの成功後に対象だけ実行する。

```powershell
npm.cmd run build
# 上のコマンドが終了コード0で完了したことを確認してから、対象の画面試験を選ぶ。
node node_modules/@playwright/test/cli.js test e2e/count-fixtures.annotate.spec.ts e2e/review-load.annotate.spec.ts --project=e2e
node node_modules/@playwright/test/cli.js test e2e/cloud-issues.annotate.spec.ts e2e/shape-shift.annotate.spec.ts --project=e2e
node node_modules/@playwright/test/cli.js test e2e/compare.annotate.spec.ts --project=e2e
```

E2Eはビルド済み `dist` を使う。同じ配布形態のE2E中に再ビルドすると参照中の資材が変わるため、順序を守る。

確認用のスクリプト（`work/`）:

| スクリプト | 用途 |
|---|---|
| `node work/measure-5000-save.mjs dist 1000`（または 5000） | 旧形式の移行・書式変更・1個追加の保存時間 |
| `node work/check-legacy-trial-pdf.mjs dist --new-issue` | 1.1.0 で作ったPDFとの互換 |
| `node work/walkthrough-04f.mjs` | 実図面で見本の切り取り・提案の画面を撮る |
| `node work/check-double-circle.mjs` | 二重丸の塗りを画面と保存したPDFで比べる |
| `node work/profile-save-path.mjs dist 1000` | 保存を主処理と Worker に分けて測り、送った編集を書き出す |

### コード変更後に配布物を更新する場合

ソース変更をコミットし、必要な試験を確認してから、対象配布形態を順にビルド・監査・試験・包装する。版を上げるときは `.env.fixed` と `.env.single` の `VITE_APP_VERSION` を変えてコミットする。固定版の例：

```powershell
npm.cmd run audit:network
npm.cmd run build:fixed
npm.cmd run audit:network -- --dist
node node_modules/@playwright/test/cli.js test --project=fixed
npm.cmd run package:fixed
```

単一HTML版は `build:single` → `audit:network -- --single` → `--project=single` の試験 → `package:single`。各段階の失敗を直してから次へ進む。`release:*` は単体全件も実行するため、狭い修正のたびに無条件で使わない。

包装はソースの未コミット変更、HEADとの差、ロックファイルとソーススナップショットを検査する（対象は `src`、`scripts`、`public` など。`docs`・`tests`・`e2e`・`work` は含まない）。出荷のために安易に `--allow-dirty` で回避しない。

## 9. CLAUDECODEに渡す開始文

以下をそのまま貼り付けて開始できる。

```text
かるPDFの営繕業務向け改修を、この作業ツリーで引き続き進めてください。
作業場所：C:\Users\gibbo\.codex\worktrees\dda9\PDF編集アプリ
ブランチ：codex/eizen-review-upgrade（origin へ push 済み）
試用版 1.2.0 のソースコミット：843d42b98c4604b0051c8a12460107d5470f3f1c

まずAGENTS.md、docs/CLAUDECODE_営繕改修_引継ぎ書.md、
docs/営繕改修_実用性レビュー.md、docs/調査/営繕改修_試用版報告_1.2.0.md、
docs/営繕改修_復元と性能判定.mdを読み、
現在のGit状態と導入前タグ・bundleが残っていることを確認してください。
実装済み機能、ローカル試用版、試験記録を使い、調査・実装を最初からやり直さないでください。

次は利用者による1.2.0の試用です。試用の結果と実図面があれば、それを先に反映してください。
実装は SPEC を作って Codex に渡し、返ってきたコードをレビューしてから採用してください。

通常閲覧を最優先し、読込時の全文字解析・OCR・全ページ差分を追加しないでください。
数十msの差は絶対ms・相対%・条件を記録し、利用者が試して採否を判断します。
小差や5%超過だけで作業を止めたり、広い性能試験を反復したりしないでください。
大きな遅延、フリーズ、破損、異常なメモリ増加は調査・修正してください。
原本PDF、導入前タグ、work/の復元用bundle・ログを保持し、機能ごとにコミットしてください。
重い試験を性能測定と並行実行せず、ビルド成功後に配布物の試験・包装を行ってください。
未測定を問題なしと扱わず、実装・試験・性能差・未確認事項を短く報告してください。
```
