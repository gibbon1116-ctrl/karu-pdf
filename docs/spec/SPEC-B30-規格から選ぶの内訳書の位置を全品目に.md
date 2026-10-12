# SPEC-B30: 「規格から選ぶ」で、すべての品目に代表の内訳書の位置を入れる

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 代表位置の逆引き（キャッシュ・優先順）に新しい表を組み込み、全品目を確かめる単体と e2e を足す。既存の自動対応を壊さない判断が要る

---

## 背景（利用者の試用の結果、2026-10-13）

> 標準マスタから追加で規格から選ぶを選択しているとき、内訳書の位置がきちんと入るものと、入らないものがある。全て内訳書の位置が想定で設定されるようにしたい。使用者の意図と違う場合は、入力された内容を手動で訂正する。

今:
- `src/core/catalog.ts` の `representativeBreakdownPosition(item)` は、内訳書のマスタの細目（`breakdownEntries`）ごとに `catalogItemsForBreakdownRow(entry)` が返す品目から逆引きの表を作る（編の順、庁舎優先、マスタの行順で最初）。
- 標準マスタの品目 1,358 件のうち 96 件は、どの細目からも返らない（同じ名前の細目が無い、単位が違う、など）。例: 建築 › 外部（面積） › 舗装、電気設備のコンセント・スイッチ、機械設備の配管・ダクト・衛生器具、仮設・土工の全品目。
- このとき `FixturePresetDialog.tsx` の `initialItemPosition` は、欄にいま出ている位置（直前の品目や保存された位置）に品目の名前を足したものを使う。そのため、利用者の画面では 舗装 に `機械設備 › 庁舎 › 空気調和設備 › ダクト設備 › 舗装（囲む）` という位置が入った。

## 対象

- 変更: `src/core/catalog.ts`（`representativeBreakdownPosition` のみ）
- 参照のみ（Claude が作成済み、変えない）: `src/core/breakdown/representativePositions.ts`（`REPRESENTATIVE_POSITION_ROWS`: 96 件の品目 → 想定の細目）
- 試験: `tests/catalog.test.ts` に追記、`e2e/breakdown-master.annotate.spec.ts` に 1 件追記
- 変えない: `FixturePresetDialog.tsx`（`initialItemPosition` の代替はそのまま残す）、データ、`catalogItemsForBreakdownRow`、内訳書から選ぶ

## 1. 逆引きの表に想定の細目を足す（`catalog.ts`）

- 今の自動の逆引き（`breakdownEntries` × `catalogItemsForBreakdownRow`）を先に作る。これで位置が決まる品目は今のまま（優先）。
- その後で `REPRESENTATIVE_POSITION_ROWS` の各行について、鍵 `masterKey(field, category, type)`（`master` の 3 つ）がまだ表に無ければ、`breakdownEntries(row.book)` から `section`・`subject`・`middle`（無い行は `undefined` と一致）・`row.name === item` が一致する細目を探し、あればその細目の位置（`book`・`section`・`subject`・`middle`・`item: entry.row.name`）を入れる。無ければ入れない（試験で見つける）。
- 重ね合わせた鍵（`#` 付き）は今の `sourceCatalogKey` で元の鍵に戻るので、同じ位置になる。
- キャッシュ（`cachedRepresentativePositions`）は今のまま 1 回だけ作る。返す値は今のとおり複製する。

## 2. 試験

### 単体（`tests/catalog.test.ts`、describe `SPEC-B30`）
- `catalogItems()` のすべての品目で `representativeBreakdownPosition(item)` が `undefined` でない。足りない品目があれば、その `key` を一覧にして失敗する（`expect(missing).toEqual([])`）。
- `REPRESENTATIVE_POSITION_ROWS` の各行が、`breakdownEntries()` の細目と一致する（行の誤記の検出。一致しない行の一覧を `[]` と比べる）。また各行の `master` が `catalogItems()` のどれかの品目の鍵（`master:` ＋ JSON）と一致する。
- 例: 建築 › 外部（面積） › 舗装 → `{ book: '建築', section: '構内舗装', subject: '構内舗装', item: 'アスファルト舗装' }`（`middle` 無し）。電気設備の C2 → `{ book: '電気設備', section: '庁舎', subject: '電灯設備', middle: 'コンセント分岐', item: '配線器具' }`。
- 既存の自動対応は変わらない: DL → ＬＥＤ照明器具（SPEC-B28 の試験がそのまま通る）。

### e2e（`e2e/breakdown-master.annotate.spec.ts`、1 件）
- `localStorage` に別の位置（例: 機械設備 › 庁舎 › 空気調和設備 › ダクト設備）を保存した状態で「標準マスタから追加」を開き、「規格から選ぶ」で 分野 建築 › 分類 外部（面積） › 種類 舗装 の規格にチェック。
- 位置の欄が 建築 / 構内舗装 / 構内舗装 / （中科目なし）になり、`内訳書: 建築 › 構内舗装 › 構内舗装 › アスファルト舗装` のボタンが出る。追加すると項目の `breakdown` がその位置になる。
- 既存の e2e の書き方（`expectPosition`・`savedFixtures` など、同じファイルの補助）を使う。

## 禁止事項

- `representativePositions.ts` とデータを変えない。自動対応で決まっている品目の位置を変えない。依存パッケージを足さない。git と試験の実行をしない。

## 検証項目（Claude Code が実行する）

- [ ] 型検査、単体（全件）、`npm run build` の後 e2e（標準マスタ・数量拾い・集計表）
- [ ] 画面で 舗装・コンセント・角ダクト・外部足場 の位置を確認
