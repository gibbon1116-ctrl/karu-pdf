# SPEC-B16: 標準マスタの「種類」に 0 件の項目を残さない

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 品目一覧の鍵・拾い方・換算の組み立ての変更が 3 編にまたがり、既存の単体試験の期待値の見直しを伴う

---

## 背景（利用者の試用の結果、2026-10-12）

> 標準マスタの種類に0件になっている項目が多々ある。必ず1件以上は項目を入れたい。０件では項目の選択肢として利用できない。

調べた結果（Claude）: 「規格から選ぶ」の種類の件数は、その種類の品目の規格（`CatalogItem.options`）の数。0 件は建築の 20 種類（単位 t: 鋼板・切板鋼板・角形鋼管・平鋼・丸鋼・高力ボルト類・軽量形鋼構造・スパイラル筋、単位 式: 木工事の木材加工・木材運搬・仮設金物・木躯体足場・建方・施工費、単位 株: 植栽・屋上緑化の低木・地被類）。拾い方の決まらない単位のため、規格が作られていなかった。また、機械設備（53 行）・昇降機設備（26 行）・電気設備（2 行）の別紙明細でない「式」の細目は、品目一覧にそもそも出ていない。

データは Claude が作成済み（**変えないこと**）: `src/core/breakdown/buildingVariants.ts` の `BUILDING_ROW_VARIANTS`（行の名前 → `{ pick: 'length' | 'area' | 'count', variants: [{ code, spec, convert: { factor, unit: 't', basis } }] }`。拾った長さ m・面積 ㎡・本数に factor を掛けて t）。

## 対象

- 変更: `src/core/countFixtures.ts`（`COUNT_UNITS` に `'式'`・`'株'` を足す）、`src/core/catalog.ts`、`src/core/breakdown/types.ts`（`DetailVariant.convert.unit` に `'t'`、`DetailTemplate.pick` に `'area'` を足す型だけ）
- 試験: `tests/catalog.test.ts`・`tests/breakdownMaster.test.ts`（あれば）の期待値の見直しと追記
- 変えない: データ（`src/core/breakdown/*Groups.ts`・`*Details.ts`・`buildingVariants.ts`・`linkRules.ts`）、画面

## 1. 式・株を個数の単位にする（`countFixtures.ts`）

- `COUNT_UNITS` の最後に `'式'`・`'株'` を足す。`kindForUnit('式')`・`kindForUnit('株')` は個数（`click`）になる。式は「図面に 1 つ印を置いて 1 式」、株は植栽の本数の拾い。
- 既存の PDF の読込・保存の互換を保つ（単位の検査は `COUNT_UNITS` を使っているので足すだけでよいはず。ほかに単位の一覧を持つ所があれば合わせる）。

## 2. 建築の t の細目の規格（`catalog.ts`）

- 建築の別紙明細でない行で `BUILDING_ROW_VARIANTS[行の名前]` があれば、機械の `MECHANICAL_ROW_VARIANTS` と同じように規格（variant ごとの選択肢、`convert` つき）にする。`pick` は `length`（線 `polyline`）・`area`（囲む `polygon`）・`count`（個数 `click`）。`detailOptions` の `pick` の検査に `area` を足す。
- 連動の規則がある行（`linkRuleForDetail(名前)`）は今のまま（連動の項目）。規則と variants の両方がある行は無いが、あれば規則を優先する。

## 3. 同じ名前で単位の違う行（機械・昇降機・電気）

- 機械設備の「パネル形エアフィルター」（台／式）のように、同じ編・同じ名前で単位の違う行は、単位を品目の鍵に入れて別の品目にする（建築と同じ考え方）。**電気設備・機械設備の既存の品目の鍵は、単位の違う同名の行が無いものは変えない**（保存済みの選択などとの互換のため）。
- `catalogItemsForBreakdownRow` は、行の単位と品目の単位が一致する品目を返す。

## 4. 不変条件（試験で守る）

- 品目一覧のすべての品目が 1 件以上の規格を持つ（`catalogItems().every(item => item.options.length > 0)`）。したがって「規格から選ぶ」のどの種類も 1 件以上。
- 内訳書の別紙明細でない行は、すべて品目に対応する（`catalogItemsForBreakdownRow(entry)` が 1 件以上。単位が拾えない行は、連動の規則・variants・式・株のどれかで拾える）。例外があれば試験の中に理由つきで列挙する。
- 建築の「角形鋼管」の規格 `□-100×100×3.2` は 長さ 1m → 0.0157×3.2×(200−10.5184)/1000×1.05 t。「鋼板」`t=9` は 1㎡ → 0.009×7.85×1.03 t。「高力ボルト類」は個数の拾い。「低木」は単位 株 の個数。「木材加工」は単位 式 の個数。
- 機械設備の「パネル形エアフィルター」の 台 の行と 式 の行は別の品目（単位が違う）。

## 禁止事項

- データを変えないこと。画面を変えないこと（件数の表示は品目の規格の数のまま）。依存パッケージを足さないこと。指定外のファイルを変えないこと。
- 既存の電気の品目の鍵を変えないこと。

## 検証項目（Claude Code が実行する）

- [ ] 型検査、単体（全件）、`npm run build` の後 e2e（内訳書・項目・集計表・連動）
- [ ] 画面: 標準マスタの「規格から選ぶ」で 建築 → 鉄骨 → 角形鋼管 が 1 件以上、選んで追加すると長さの項目（t に換算）になる
