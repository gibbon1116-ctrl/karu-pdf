# SPEC-B12-B13-2: 項目の編集画面の「鉄骨の部材」の欄と、連動の欄の交差・鉄骨

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 項目の編集画面の新しい欄（断面の選択・自由な断面・見本）、連動の欄の 2 つの新しい種類、標準マスタから追加するときの規則の当て方、数量タブの見本の計算、e2e にまたがる

---

## 背景

SPEC-B12-B13-1 で計算ができた（`src/core/crossings.ts` の `countSegmentCrossings`、`src/core/steelMember.ts` の `SteelMember`・`steelSection`・`steelMemberError`、`CountFixture.steel`、連動の `kind: 'crossing' | 'steel'`（`link.crossing`・`link.steel`）、`ShapeMetrics.pathPoints`・`riseCount`）。標準の規則は Claude が `src/core/breakdown/linkRules.ts` に足した（**変えないこと**）: 防火区画貫通処理・スリーブ・デッキプレート開口切断（`crossing`）、形鋼（所要）・工場加工組立／鉄骨運搬／現場建方／溶融亜鉛めっき（設計）・工場錆止め塗装／現場錆止め塗装・耐火被覆（`steel`）。この SPEC は画面だけ。

## 対象

- 変更: `src/app/FixtureDialog.tsx`、`src/app/FixturePanel.tsx`、`src/app/FixturePresetDialog.tsx`、`src/styles.css`
- 新規: `e2e/steel-crossings.annotate.spec.ts`
- 変えない: `src/core/*`

## 1. 「鉄骨の部材（質量・塗装・耐火被覆を計算する）」の欄（`FixtureDialog.tsx`）

`<details className="fixture-steel">`。項目に `steel` があれば開いて始める。連動の項目（`link`）・RC 部材（`rc`）の項目では出さない（RC 部材と鉄骨の部材は同時に持てない。片方をオンにしたらもう片方の欄は出さない）。線（polyline）・個数（click）の拾い方の項目だけ。

- `<input type="checkbox" aria-label="鉄骨の部材にする">`。オンで `steel = { section: H_SECTIONS[0].name }`。
- 断面 `<select aria-label="断面">`: `H_SECTIONS` の名前（`series` ごとに `<optgroup label="広幅">` など）と、最後に `自由な断面（単位質量を入れる）`（値 `''`）。自由な断面のとき 断面の名前 `<input aria-label="断面の名前">`（例: `□-200×200×9`、`section` に入る）・単位質量（kg/m）`customMassKgPerM`・表面積（㎡/m、空なら塗装・耐火被覆は 0）`customSurfaceM2PerM`。
- 個数で拾う項目（柱）のときだけ 長さ（mm）`lengthMm`（`aria-label="部材の長さ（mm）"`）。
- 見本: 新しい省略可能な props `previewSteel?(draft: CountFixture): { lengthM: number; massT: number; requiredT: number; contourM2: number; boxM2: number } | undefined`（数量タブから渡す。今の拾いの合計）。`長さ 12.00 m`・`質量 0.785 t（所要 0.824 t）`・`表面積 19.01 ㎡（箱 12.00 ㎡）`。拾いが無ければ `拾うと計算します`。
- 保存の検査: `steelMemberError` の文。

## 2. 連動の欄の交差・鉄骨（`FixtureDialog.tsx`）

- 種類のラジオに `交差から（防火区画貫通・スリーブ など）`（`crossing`）と `鉄骨の部材から（質量・塗装・耐火被覆）`（`steel`）を足す。
- 交差: 区画の項目のチェック（線・囲むの項目の一覧。自分と元の項目は除く。`aria-label="${code}を区画にする"`、`barrierItemIds`）、区画の名称の語 `<input aria-label="区画の名称に含む語">`（読点・空白区切り。`barrierNameIncludes`）、`平面で区画の線との交差を数える`（`planCrossings`、既定オン）・`立上り・立下りを床の貫通として数える`（`includeRises`）のチェック。状態の文: `区画の拾い ${n} 本`（同じ図面に限らない合計。0 のとき `区画の項目がありません`）。
- 鉄骨: 出力 `<select aria-label="鉄骨の出力">`（質量・塗装の面積・耐火被覆の面積）、質量のとき 設計数量／所要数量（×1.05）のラジオ、面積のとき 表面の種類 `<select aria-label="表面の種類">`（外周（塗装・吹付け）・箱（柱の巻付け）・箱（梁の巻付け、上面なし））。自動の元: `鉄骨の部材を自動で元にする`（オンで `auto: {}`。鉄骨の部材の項目すべて）。
- 元ごとの行の引き算・係数（B07-2b）はそのまま使えること。

## 3. 数量タブ（`FixturePanel.tsx`）

- `previewLink`: 連動に `crossing`・`steel` があるときも形の計量を集めて渡す（`rc`・`shape` と同じ。交差のときは区画の項目も集める対象に入れる）。
- `previewSteel`: 下書きで置き換えた一覧で `collectShapeMetrics(注釈, 項目, new Set([下書きの id]))` から長さを出し（線は長さ、個数は 個数 × `lengthMm`）、`steelSection` で質量・表面積を出して足す。
- 行の単位の表示: `crossing`（か所）・`steel`（t・㎡）の連動も単位を出す（`rc`・`shape` と同じ）。

## 4. 標準マスタから追加するときの規則（`FixturePresetDialog.tsx`）

`rc`・`shape` と同じ考え方で、次のどちらかのときだけ連動の項目にする（どちらでもなければふつうの項目）:
- `crossing`: (a) 単位が拾えない、または (b) 区画の項目（`crossing.barrierNameIncludes` のどれかを名前に含む線・囲むの項目）が今ある項目（追加する項目を含む）に 1 つ以上ある。`barrierNameIncludes` が空の規則（デッキプレート開口切断）は (a) のときだけ。
- `steel`: (a) 単位が拾えない（t）、または (b) 今ある項目に鉄骨の部材（`steel` を持つ項目）が 1 つ以上ある。
- 連動の中身: `kind`、`auto`（規則のまま）、`crossing`（規則の `crossing` を写す）、`steel`（規則の `steel` を写す）。`sources: []`。

## 5. 試験（e2e、新規 `e2e/steel-crossings.annotate.spec.ts`。`e2e/rc-members.annotate.spec.ts` の作り方に倣う）

1. 線の項目 `G1`（梁）を鉄骨の部材にする: 断面 H-400×200×8×13。12m の線を拾う。編集を開くと見本が `0.785 t`・`所要 0.824 t`・`19.01 ㎡`。
2. 個数の項目 `C1`（柱）を鉄骨の部材 H-300×300×10×15、長さ 3500 にして 2 個置く → 見本 `0.651 t`。
3. 連動の項目 `形鋼` を作り、種類 `鉄骨の部材から`・出力 質量・所要数量・自動 → 全図面がおよそ `1.51`（0.824 ＋ 0.684）。
4. 線の項目 `区画`（名前に「防火区画」）と、線の項目 `配管`（区画の線と 2 回交わる折れ線）を拾い、連動の項目 `貫通` を種類 `交差から`、元 配管、区画の名称に含む語 `防火区画` → `2`。`立上り・立下りを床の貫通として数える` をオンにし、配管に立上りがあれば 1 を足す（立上りの設定は既存の e2e の作り方に倣う。難しければ 4 は平面の交差だけでよい）。
5. 自由な断面: 断面の名前 `□-200×200×9`、単位質量を空で保存 → `steelMemberError` の文が出て保存できない。

## 禁止事項

- `src/core/*` を変えないこと（足りない関数は報告する）。連動・鉄骨の無い項目の画面を変えないこと。依存パッケージを足さないこと。指定外のファイルを変えないこと。

## 検証項目（Claude Code が実行する）

- [ ] 型検査、単体（全件）、`npm run build` の後 e2e（新規・RC 部材・連動・内訳書）
- [ ] 画面で鉄骨の部材の欄・見本を確認
