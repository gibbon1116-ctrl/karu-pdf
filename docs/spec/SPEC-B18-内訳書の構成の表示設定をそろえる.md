# SPEC-B18: 数量タブの一覧と集計表の「内訳書の構成でまとめる」設定を 1 つにする

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 2 つの画面にまたがる設定の共有（その場で両方に反映）と、保存済みの設定の引き継ぎ、e2e の見直しを伴う

---

## 背景（利用者の試用の結果、2026-10-12）

> 拡声設備で１３項目登録しているが、集計表にはすべて表示されるが、画面左側の一覧には１０項目しか表示されない。

Claude の調査: 集計表の「内訳書の位置でまとめる」（`karu-pdf:quantity-table-group-by-breakdown-v2`）が外れていて、13 件が分類「拡声設備」にまとまって見える。数量タブの一覧の「内訳書の構成で表示」（`karu-pdf:fixture-panel-group-by-breakdown`）はオンのままで、内訳書の位置を持つ項目は上の「電気設備 › 庁舎 › 拡声設備 …」の見出しの下に、位置の無い項目は下の「（内訳書の位置なし）」の中の「拡声設備（10）」に分かれて並ぶ。2 つの画面で設定が別々なため、同じ名前の見出しの数が合わないように見える。

## 対象

- 新規: `src/app/breakdownGroupingPreference.ts`
- 変更: `src/app/FixturePanel.tsx`、`src/app/QuantityTable.tsx`
- 試験: 新規 `tests/breakdownGroupingPreference.test.ts`、関係する e2e（`e2e/quantity-table.annotate.spec.ts`・`e2e/breakdown-master.annotate.spec.ts` など、2 つの鍵を前提にしている所）の見直し、新しい e2e を 1 件（既存の e2e ファイルに追記でよい）

## 1. 設定の共有（`breakdownGroupingPreference.ts`）

- 鍵 `karu-pdf:group-by-breakdown`（`'true'`／`'false'`）。既定はオン。
- 初めて読むとき（新しい鍵が無いとき）は古い 2 つの鍵から引き継ぐ: どちらかが `'false'` なら `false`、そうでなければ `true`。引き継いだ値を新しい鍵に書く（古い鍵は消さなくてよい）。
- `getGroupByBreakdown(): boolean`、`setGroupByBreakdown(value: boolean)`、`subscribeGroupByBreakdown(listener): () => void`（同じ画面の中の購読。`useSyncExternalStore` で使う。ほかのタブとの同期は `storage` イベントでしてもよい）。`localStorage` が使えないときはメモリの値で動く（例外を出さない）。

## 2. 画面

- 数量タブの「内訳書の構成で表示」と集計表の「内訳書の位置でまとめる」は、どちらもこの 1 つの設定を読み書きする。片方を切り替えると、開いているもう片方もその場で切り替わる。表示の文言は今のまま。
- それぞれの画面の、内訳書の位置を持つ項目が無いときの振る舞い（切り替えを出さない、分類でまとめる）は今のまま。

## 3. 試験

- 単体: 既定 true、古い鍵の引き継ぎ（集計表 false → false、一覧 false → false、両方なし → true）、set で購読者に通知、`localStorage` が例外を出すときも動く。
- e2e: 内訳書の位置を持つ項目と持たない項目が同じ分類にある文書で、集計表の「内訳書の位置でまとめる」を外すと、数量タブの一覧も分類でまとまり、見出し「拡声設備（n）」の n が集計表の見出しの数と一致する。もう一度付けると両方が内訳書の構成に戻る。

## 禁止事項

- まとめ方の並び・見出しの作り（`breakdownOutline.ts`）を変えないこと。依存パッケージを足さないこと。指定外のファイルを変えないこと。

## 検証項目（Claude Code が実行する）

- [ ] 型検査、単体（全件）、`npm run build` の後 e2e（集計表・内訳書・項目・並べ替え）
