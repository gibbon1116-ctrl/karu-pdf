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
npm ci
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

## 2つの配布版

| | 通常版 | 固定・閉域版 |
|---|---|---|
| 配信元 | GitHub Pages | 管理された HTTPS の内部サーバー |
| 更新 | 開発版を自動公開（アプリ内で更新を案内） | 承認した版を固定し、管理者が手で更新 |
| 想定 | 一般の利用 | 機密性の高い業務での利用 |
| 実行時の取得 | 公開先のアプリ・PWA の静的ファイル | 同じ内部サーバーの配布パス内だけ。外部インターネットを使用しない |
| PDF の扱い | PC のブラウザ内で処理 | PC のブラウザ内で処理 |
| 出力 | dist/ | dist-fixed/ と release/ |

固定版の最初の版は **1.0.0-fixed**。通常版のビルド、GitHub Pages 公開ワークフロー、編集機能は維持する。固定版を GitHub Pages で開くと、アプリを起動せずに内部サーバーからの起動を案内する。

### 固定版の作成と検証

管理者が承認するコミットを決め、変更のない作業コピーと Node.js 24 以降で実行する。作成時には開発環境から npm などへの接続が必要だが、配布後の PDF を扱う PC に npm や GitHub への接続は必要ない。

```bash
npm ci
npm run release:fixed
npm run e2e:fixed
```

release:fixed は、ソース通信監査 → 単体テスト → 固定版ビルド → 生成物通信監査 → ZIP 作成を順に行い、失敗時は停止する。新しい依存を追加せず、lockfile が HEAD と一致することも確認する。独立した作成・監査は build:fixed、audit:network、audit:network -- --dist、package:fixed を使う。

生成する ZIP は release/karu-pdf-fixed-v1.0.0.zip。ZIP の外に .zip.sha256、ZIP の中に VERSION.txt、SHA256SUMS.txt、SBOM.cdx.json、LICENSE、THIRD_PARTY_LICENSES と固定版の全ファイルを含む。SHA256SUMS は自分自身を除く全ファイルを検査し、ZIP 全体のハッシュがその checksum ファイルも保護する。

```bash
# ZIP があるディレクトリで確認し、展開後は展開先で確認する
sha256sum -c karu-pdf-fixed-v1.0.0.zip.sha256
sha256sum -c SHA256SUMS.txt
```

Windows では ZIP は Get-FileHash -Algorithm SHA256 でも確認できる。ハッシュの受け渡し元と承認記録も管理する。ハッシュ一致だけで承認者の真正性を保証するものではない。

### 配置・起動・更新

ZIP とハッシュ、版・コミット・SBOM・ライセンスを管理者が確認し、ZIP の中身を内部サーバーの **/karu-pdf/** へ配置する。HTTPS と [サーバー設定例](docs/固定版/サーバー設定例.md) の CSP、MIME、キャッシュ設定を適用し、実際のレスポンスヘッダーとブラウザの通信を確認する。

開発環境での起動確認は node scripts/serve-fixed.mjs、URL は http://127.0.0.1:4174/karu-pdf/。終了時は Ctrl+C で止める。このサーバーは本番用の認証や TLS を持たない。

配布パスを変更する場合は、ビルド前に VITE_BASE_PATH を先頭・末尾が / の値に設定する（例: /tools/karu-pdf/）。.env.fixed の初期値は /karu-pdf/。版は VITE_APP_VERSION で設定する。ビルド日付と Git コミットをビルド時に記録し、Git が取得できない場合の表示は unknown とする。配布物の作成には lockfile を HEAD と照合できる Git 環境が必要になる。

運用の流れは **コミットを決める → 固定版を作る → ZIP とハッシュを確認 → 管理者が確認 → 内部サーバーへ配置**。更新時も同じ手順を行い、生成物を一式として置き換える。ファイルを部分的に混ぜず、メンテナンス時間や配信先の切り替えで一式の整合を保つ。承認した古い ZIP も保管し、必要な場合は一式を戻す。

PWA のインストール・オフライン動作は残す。更新先は内部サーバーの sw.js のみで、外部への更新確認は行わない。新しい版を検出すると「管理者が配布物を更新しました。再読み込みすると新しい版に切り替わります」と案内し、利用者が更新を選ぶ。管理者は実際の版表示を確認させる。初回のオンラインキャッシュが未完了の PC はオフライン起動できない。

### 保証する範囲

この実装は、アプリの処理による PDF データの送信を行わず、固定版の取得先を同じ配布元に限定し、CSP で外部通信を禁止する。通信監査とブラウザ試験でその範囲を検証する。「絶対安全」を意味しない。ブラウザ拡張、PC・OS の管理、ブラウザ自体の通信、内部サーバーの設定や侵害、同一 origin の別アプリは対象外であり、管理者が別途対策する。詳しくは [セキュリティ設計](docs/固定版/セキュリティ設計.md) を参照する。
