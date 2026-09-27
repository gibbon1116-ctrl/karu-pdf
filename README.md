# かるPDF

ブラウザだけで動く、軽い PDF 編集アプリです（開発中の試作版）。

**https://gibbon1116-ctrl.github.io/karu-pdf/**

- インストールは不要です。Edge か Chrome で上の URL を開くだけで使えます。
- PDF は、**お使いのパソコンの中だけで処理します。** ファイルをサーバーへ送ることは一切ありません。
- 書き込んだ文字は、PDF の標準の注釈として保存します。保存した後に開き直しても、**書き直すことができます**。

## 使い方（試作版）

| 操作 | 方法 |
|---|---|
| PDF を開く | 「開く」ボタン、またはウィンドウへファイルをドラッグ＆ドロップ |
| 拡大・縮小 | 「拡大」「縮小」「幅に合わせる」ボタン、または Ctrl＋マウスホイール |
| 文字を書き込む | 「文字」を押して、ページをクリックして入力する。枠の外をクリックするか、Esc か Ctrl+Enter で確定する |
| 四角を描く | 「四角」を押して、ページ上でドラッグする |
| 書き込みを選ぶ・動かす・消す | 「選択」を押して、クリックで選ぶ、ドラッグで動かす、Delete キーで消す。文字はダブルクリックで書き直す |
| 上書き保存 | 「上書き保存」ボタン、または Ctrl+S |
| 別名で保存 | 「別名で保存」ボタン、または Ctrl+Shift+S |

上書き保存の初回に、ブラウザから「ファイルの編集を許可しますか」と確認が出ます。「許可」を選んでください。

## 対応環境

- Microsoft Edge または Google Chrome の最新版（Windows）
- Firefox と Safari は、上書き保存ができないため対象外です。

## 開発

```bash
npm install
npm run dev        # 開発用サーバー（http://localhost:5173/karu-pdf/）
npm test           # 単体テスト・結合テスト
npm run build      # 公開用のビルド（dist/）
```

- 開発の方針と仕様書は `docs/` にあります。
- `npm run make-test-pdf` で試験用の PDF を作ったうえで、`npm run e2e` で画面のテスト、`npm run bench` で性能の計測を行います。

## ライセンス

- このアプリ: [GNU Affero General Public License v3.0 以降](LICENSE)（AGPL-3.0-or-later）
- PDF エンジン: [MuPDF.js](https://github.com/ArtifexSoftware/mupdf.js)（Artifex Software、AGPL-3.0）
- フォント: [BIZ UDゴシック](https://github.com/googlefonts/morisawa-biz-ud-gothic)・[BIZ UD明朝](https://github.com/googlefonts/morisawa-biz-ud-mincho)（Morisawa、SIL Open Font License 1.1。ライセンス文は `public/fonts/` にあります）
