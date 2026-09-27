# PDF エンジン比較（2026-09-27 調査）

ブラウザだけで動く PDF 編集アプリのために、中心部品の候補を比べた。事実は一次情報（公式ドキュメント、GitHub、npm、LICENSE）で確かめ、確かめられなかったものは「未確認」と書いた。

**結論: MuPDF.js を採用する。** 理由は第3章を参照。

## 1. 機能の対応

凡例: ○ 標準の API で対応している／△ 低レベル API を使って自前で実装する必要がある／× 実質的にできない

| 機能 | pdf.js 6.3.289 | pdf-lib 1.17.1 | MuPDF.js 1.28.1 | EmbedPDF 2.15.1（PDFium） |
|---|---|---|---|---|
| 描画 | ○ JavaScript 製 | × | ○ C 製のエンジンを WASM 化。API は同期なので Worker 化は自前 [17] | ○ WASM を Worker で実行 |
| 拡大時のタイル描画 | △ | × | △ 範囲を指定した Pixmap で実現できる。タイルの管理は自前 [17] | ○ plugin-tiling [24] |
| 結合・抽出・削除・並べ替え | ○ | ○ | ○ graftPage／deletePage／rearrangePages [18] | ○ ただし並べ替えは△ |
| 回転・白紙挿入 | × | ○ | ○ | △ |
| 日本語の FreeText | △ 外観（AP）を Helvetica でしか作らない [4][8] | △ 自前 | ○ AP を生成する。ただし標準の生成は埋め込まない明朝体になる。埋め込むには addFont と自前の AP が必要 [20] | △ 標準 14 フォントだけ [27] |
| 線・矢印・四角・丸・Ink・Highlight | △ | △ | ○ | ○ |
| 付箋（Text 注釈） | △ | △ | ○ | ○ |
| 本当の墨消し | × | × | ○ applyRedactions。テキスト・画像・線画ごとに方式を選べる [18] | ○ ただし重大な不具合が 2026-09 に直ったばかり [28] |
| しおりの編集 | × | △ [13] | ○ OutlineIterator [17] | ○ |
| 軽量化 | × | △ | △ garbage／compress／subsetFonts は使える。画像のダウンサンプリングは JS から呼べない [19] | △ |
| 日本語フォントのサブセット埋め込み | × | ○ ただし CJK で文字が欠ける不具合の報告がある [12] | ○ addFont（Identity-H）と subsetFonts() [18] | × フォント全体を埋め込む（v2）[29] |
| 保存方式 | 増分 | 全体を書き直す | 増分と全体を選べる [19] | 全体を書き直す（v2）[26] |
| 配布サイズ | 約 3MB | 約 1.2MB（fontkit を含む） | WASM 10.4MB（brotli で 3.6MB、gzip で約 4.8MB）[36] | WASM 4.65MB（gzip で約 2.1MB） |

## 2. ライセンスと保守の状況

| 候補 | ライセンス | 最新版 | 保守の状況 |
|---|---|---|---|
| pdf.js | Apache-2.0 | 6.3.289（2026-08-29） | ほぼ毎月リリースしている [1][10] |
| pdf-lib | MIT | 1.17.1（2021-11-06） | 実質的に停止している [11]。フォークの @cantoo/pdf-lib は活発 [14] |
| MuPDF.js | **AGPL-3.0-or-later**、または Artifex の商用ライセンス | 1.28.1（2026-09-06） | Artifex の公式。主要な開発者が複数いる [16] |
| EmbedPDF v2 | MIT（PDFium の部分は BSD-3 と Apache-2.0） | 2.15.1（2026-09-16） | 活発だが、コミットが1人に集中している。v3 は本番での利用が非推奨 [22] |

## 3. MuPDF.js を選んだ理由

- 一番の要件である「日本語の書き込みを保存し、後から再編集する」に対して、フォントのサブセット埋め込みと AP の生成に必要な API が揃っている。
- 墨消し、しおり、軽量化、フォームまで、1つのエンジンの標準 API でほぼ賄える。
- 開発元が安定しており、チームで長く使う道具に向く。
- AGPL の義務（アプリ全体のソースの公開）は、公開リポジトリで配信するので満たせる。

## 4. MuPDF.js で自前実装が必要なもの

- Web Worker 化（API が同期のため）
- タイル描画とサムネイルのキャッシュ層
- BIZ UD フォントを埋め込んだ FreeText の AP の生成
- 画像のダウンサンプリング（第2版の軽量化で使う）

## 5. 注意点

1. 重い図面 PDF の速さを、中立の立場で比べたベンチマークは見つからなかった（未確認）。試作で実際に測る。
2. WASM のメモリ上限は Emscripten の既定値である 2GB [21][33]。A1 図面の拡大表示ではタイル描画が必須になる。
3. 墨消しをした PDF は、全体を書き直す形で保存する（garbage を指定する）。増分保存では、元のデータが末尾より前に残るため。
4. MuPDF が標準で生成する日本語の AP は、フォントを埋め込まない明朝体になる [20]。埋め込んだ AP は自前で作る。

## 出典

- [1] https://github.com/mozilla/pdf.js/releases
- [4] https://github.com/mozilla/pdf.js/blob/v6.3.289/src/core/annotation.js
- [8] https://github.com/mozilla/pdf.js/issues/20117 ／ https://github.com/mozilla/pdf.js/issues/15769
- [10] https://www.npmjs.com/package/pdfjs-dist
- [11] https://github.com/Hopding/pdf-lib
- [12] https://github.com/Hopding/pdf-lib/issues/1232
- [13] https://github.com/Hopding/pdf-lib/issues/470 ／ https://github.com/Hopding/pdf-lib/issues/1266
- [14] https://github.com/cantoo-scribe/pdf-lib
- [16] https://www.npmjs.com/package/mupdf ／ https://github.com/ArtifexSoftware/mupdf.js
- [17] https://cdn.jsdelivr.net/npm/mupdf@1.28.1/dist/mupdf.d.ts
- [18] https://mupdf.readthedocs.io/en/latest/reference/javascript/types/PDFDocument.html ／ https://mupdf.readthedocs.io/en/latest/reference/javascript/types/PDFPage.html
- [19] https://github.com/ArtifexSoftware/mupdf/blob/master/source/pdf/pdf-write.c
- [20] https://github.com/ArtifexSoftware/mupdf/blob/master/source/pdf/pdf-appearance.c
- [21] https://github.com/ArtifexSoftware/mupdf/blob/master/platform/wasm/tools/build.sh
- [22] https://github.com/embedpdf/embed-pdf-viewer
- [24] https://www.embedpdf.com/docs/react/headless/plugins/plugin-tiling
- [26] https://github.com/embedpdf/embed-pdf-viewer/blob/v2/packages/pdfium/build/code/cpp/main.cpp
- [27] https://cdn.jsdelivr.net/npm/@embedpdf/models@2.15.1/dist/pdf.d.ts
- [28] https://github.com/embedpdf/embed-pdf-viewer/issues/801 ／ https://github.com/embedpdf/embed-pdf-viewer/pull/822
- [29] https://github.com/embedpdf/runtime/blob/embedpdf/main/fpdfsdk/fpdf_edittext.cpp
- [31] https://www.gnu.org/licenses/agpl-3.0.html
- [33] https://github.com/emscripten-core/emscripten/blob/main/src/settings.js
- [36] https://data.jsdelivr.com/v1/packages/npm/mupdf@1.28.1
