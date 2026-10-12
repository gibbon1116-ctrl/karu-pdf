# SPEC-B03c-2: 標準マスタの統一 — 画面

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 標準マスタの画面の作り直し（2つのタブで同じ選び方の部品を使う、位置の選択、既存のタブの削除）と、経路の線要素の追加、既存の e2e 11 ファイルの準備手順の置き換えにまたがる

---

## 背景

SPEC-B03c-1 で `src/core/catalog.ts`（品目の一覧 `catalogItems`、検索 `searchCatalog`、内訳書の行 → 品目 `catalogItemsForBreakdownRow`、項目を作る `catalogPresets`）を作った。この段階で画面をそれに置き換える。利用者の決定は B03c-1 の冒頭のとおり:

- 「分野の一式」のタブは削除する。
- 「規格から選ぶ」には「内訳書から選ぶ」で選べる品目をすべて出す（`catalogItems()`）。
- 選び方は **チェックして、チェックしたものをすべて追加** に統一する（データリストのドロップダウンはやめる）。
- 「規格から選ぶ」でも画面の上で内訳書の位置を選ぶ。どちらのタブで足しても同じ品目・同じ位置なら「追加済み」。
- 経路の「線要素を追加」から、配管塗装（E25塗装など）も選べる（ケーブルの経路の立上りだけ塗装する、など）。

## 対象

- 新規: `src/app/CatalogChooser.tsx`、`src/app/fixtureAppend.ts`
- 変更: `src/app/FixturePresetDialog.tsx`、`src/app/BreakdownPicker.tsx`、`src/app/FixturePanel.tsx`（`addMany` を `fixtureAppend` に移す）、`src/app/LinePicker.tsx`、`src/App.tsx`（試験用の関数を1つ足す）、`src/app/HelpDialog.tsx`、`src/styles.css`
- e2e: `e2e/breakdown-master.annotate.spec.ts`、`e2e/quantity-master.annotate.spec.ts`、「分野の一式」を使って準備している e2e（`businessCases.ts`、`cloud-issues`、`count-fixtures`、`quantity-area-volume`、`quantity-length`、`quantity-line-style`、`quantity-order`、`scale-regions`、`snap`）
- 変えない: `src/core/*`（`catalog.ts` を含む。足りなければ報告）

## 変更内容

### 1. 項目を足す処理を共通にする（`fixtureAppend.ts`）

`FixturePanel.tsx` の `addMany` の中の「既存と同じものを除き、見た目（形・色・線）を割り当てて項目にする」処理を、`export function appendFixtures(existing: readonly CountFixture[], items: ReadonlyArray<FixturePreset | CountFixture>): CountFixture[]`（戻り値は既存＋新しい項目の配列）として移す。動きは今と同じ（`fixtureIdentity` での重複除外、`'style' in item` の扱い、`convert`・`unit`・`breakdown`・`summary`・`remark`・`attributes` の引き継ぎ）。`addMany` はこれを使う。

### 2. 試験用の関数（`App.tsx`）

`window.__karu` に `addFixturePresets(field: string): Promise<number>` を足す（`?test=1` のときだけある既存の仕組みに足す。型の宣言も）。開いている PDF の項目の読み込みを待ち、`FIXTURE_PRESETS[field]` をすべて `appendFixtures` で足して `setCountFixtures` する（今の「分野の一式」で全部選んで追加したのと同じ結果）。戻り値は足した件数。

### 3. 選び方の部品（`CatalogChooser.tsx`）

```ts
export default function CatalogChooser(props: {
  item: CatalogItem
  selection: CatalogSelection
  onChange(selection: CatalogSelection): void
  /** 既存の項目の fixtureIdentity の集合（追加済みの表示用） */
  existing: ReadonlySet<string>
  position?: CatalogPosition
  /** catalogPresets を使うため（遅延読込した catalog モジュール） */
  catalog: typeof import('../core/catalog')
}): JSX.Element
```

- **規格（option）**:
  - option が1件で `label` が空: チェックボックス1つ（`aria-label` = `${item.name}（${item.unit}）`）。
  - それ以外: option ごとのチェックボックス。`aria-label` は、既存の標準マスタの option（`key` が `master:` の品目）では **今と同じ** `${label} ${name}${kindLabel}`（例: `CV 60sq-3C 600V架橋ポリエチレン絶縁ビニルシースケーブル（長さ・m）`。`kindLabel` は今の `FixturePresetDialog.tsx` のもの）、ほかは `${label} ${item.name}（${item.unit}）`。`note` があれば横に小さく。option が2件以上なら「すべて選ぶ」「選択を解除」。
  - 既存の項目と同じになる option（いまの摘要の選び方で作る項目がすべて `existing` にある）には「追加済み」を出し、チェックボックスを `disabled` にしない（既存のタブと同じく、追加のときに除く）。ただし既存の標準マスタの品目では、今と同じく「追加済み」の option はチェックされた状態で `disabled`（今の e2e に合わせる）。
- **摘要の区分**（`item.slots`）は、規格を1つ以上選んだときだけ出す:
  - `condition` の区分: `施工条件の候補: 隠ぺい・露出（拾うときに選びます）` のように文だけ。
  - 選択肢のある区分: 区分名の見出しと、値ごとのチェックボックス（`aria-label` = `${item.name}の${区分名} ${値}`）、「すべて選ぶ」「選択を解除」、`ほかの値` の入力（`aria-label` = `${item.name}の${区分名}のほかの値`、「、」で区切って複数）。チェックとほかの値を合わせたものが `selection.values[区分名]`。
  - 選択肢の無い区分: 入力欄（`aria-label` = `${item.name}の${区分名}`）。記号・盤名称・名称・建具番号には `placeholder="、で区切ると複数作ります"`。
- 下に `この品目で N 件追加`（`catalogPresets` の件数。既存と同じものは除いた数）。`catalogPresets` が誤りを投げたら、その文を `role="alert"` で出す。
- データリスト（`<datalist>`）は使わない。

### 4. 「標準マスタから追加」（`FixturePresetDialog.tsx`）

- タブは **「規格から選ぶ」「内訳書から選ぶ」の2つ**。「分野の一式」と、その中身（`FIXTURE_PRESETS` の一覧・「見本の分野」）を削除する。「他のPDFから読み込む」（`sources` があるとき）の画面は今のまま。
- 読み込みは `import('../core/catalog')`（失敗・再試行の文は今と同じ）。
- **規格から選ぶ**:
  - 上に「内訳書の位置」`<fieldset aria-label="内訳書の位置">`: 編 `<select aria-label="位置の編">`（先頭「付けない」、続けてデータのある編）、種目・科目・中科目の `<select>`（`aria-label` は `位置の種目`・`位置の科目`・`位置の中科目`。値は `breakdownEntries()` から。中科目の無い科目は「（中科目なし）」の1つ）。編を「付けない」にすると下の3つは無効。選んだ位置は `localStorage` の `karu-pdf:master-breakdown-position` に覚える（読めない・不正なら「付けない」。`localStorage` が使えなくても動く）。
  - 検索欄は今と同じ（`aria-label="標準マスタを検索"`、`placeholder="例: 60、PF22、400x250、分電盤"`）。検索が空なら、今と同じ見た目の3列（`role="group"`、`aria-label` は今と同じ「標準マスタの分野」「標準マスタの分類」「標準マスタの種類」）。中身は `catalogItems()` の分野 → 分類 → 種類（種類のボタンの文字は今と同じ `${type}（${option数}件）`）。右の列に選んだ品目の `CatalogChooser`。見出しは今と同じ `${type}の規格` と品目の名前・単位。
  - 検索中は `searchCatalog` の結果の品目ごとに `CatalogChooser`（option は一致したものだけ）。件数の文は今と同じ形。
  - 追加する項目 = 選んだ品目ごとの `catalogPresets(item, selection, 位置)`（位置が「付けない」なら `undefined`）。
- **内訳書から選ぶ**: `BreakdownPicker` を作り直す（下の 5）。
- 追加のボタンは今と同じ `選んだ項目を追加（N件）`（N = 既存と同じものと、作る予定どうしの重複を除いた数）。押したら `fixtureFromPreset` で項目にして `onAdd`。
- 選んだ状態は、タブ・分類・検索を切り替えても消えない（タブごとに持つ）。

### 5. 内訳書から選ぶ（`BreakdownPicker.tsx`）

- 階層の列（編・種目・科目・中科目）・検索欄・行の種類の表示（1式 別紙明細、1式（数量なし）、拾えない単位、※）は今のまま。
- 行の中身を `CatalogChooser` に置き換える:
  - 数量で計上する細目: `catalogItemsForBreakdownRow(entry)` の品目の `CatalogChooser`（位置 = 選んだ群、`item` = `row.name`）。
  - 別紙明細の細目: 「明細を選ぶ（N）」で開くと、`catalogItemsForBreakdownRow(entry)` の品目ごとに `CatalogChooser`。既存の標準マスタの品目が多い細目（電線管・ケーブルなど）は、今と同じく種類のボタン（`aria-label` = `${明細名}の種類 ${type}`）で開閉し、開いた種類の `CatalogChooser` を出す。
- 選んだ状態は `${entry.key}` と品目の `key` の組で持つ（同じ品目でも位置が違えば別の選択）。
- `onChange` に渡す項目は、選んだものごとの `catalogPresets(item, selection, { book, section, subject, middle, item: row.name })`。

### 6. 経路の「線要素を追加」（`LinePicker.tsx`）

- 標準マスタの検索を `searchCatalog` にし、結果の option のうち長さの拾い方（`method === 'polyline'`）のものを並べる（配管塗装の `E25塗装` も出る）。既存の項目と同じもの（位置なしで作った項目と `fixtureIdentity` が同じ）は出さない。最大 30 件。ボタンの `aria-label` は今と同じく略号（`option.label`。例 `PF28`、`E25塗装`）。
- 選んだら `catalogPresets(item, { options: [option.key] })` の1件を、今と同じ方法（`nextQuantityLineStyle` の見た目）で項目にして経路に足す（`convert` も持たせる）。

### 7. ヘルプ（`HelpDialog.tsx`）

「標準マスタから追加」の段落を、2つのタブの説明に書き換える（「分野の一式」の文を削る）:

> 「標準マスタから追加」には「規格から選ぶ」と「内訳書から選ぶ」があります。どちらも同じ品目の一覧で、選んだ規格・摘要の値をチェックすると、その組合せの項目をまとめて追加します。「規格から選ぶ」では分野・分類・種類をたどるか「60」「PF22」「分電盤」などで検索し、上の「内訳書の位置」で科目・中科目を選べます。「内訳書から選ぶ」では公共建築工事内訳書標準書式の科目・中科目・細目をたどります（いまは電気設備）。施工（隠ぺい・露出）は項目を分けず、拾うときに施工条件として選びます。配管塗装は拾った長さを外径から㎡に換算します。

（B04 で足した Excel の説明の文は残す。）

### 8. e2e

- 「分野の一式」を開いて全部追加していた準備は、`await page.evaluate(field => window.__karu!.addFixturePresets(field), '電気設備')` に置き換える（「見本の分野」で選んでいた分野を渡す）。置き換えた後の試験の中身・期待値は変えない。
- 「分野の一式」の画面そのものを確かめていた箇所（`quantity-master` の「keeps the existing all-selected field bundles…」、`quantity-area-volume`・`quantity-length`・`quantity-line-style` の一覧の文の確認など）は、その確認だけを削る（試験の残りは hook で準備して続ける）。`quantity-master` のタブの切り替えで選択が残る試験は、「分野の一式」の代わりに「内訳書から選ぶ」へ切り替えて戻る。
- `breakdown-master.annotate.spec.ts` はチェック方式に合わせて書き直す（タブは2つ、摘要はチェックボックス、施工は施工条件の候補）。期待する保存の結果（位置・摘要・単位）は今と同じ。足す試験:
  1. 規格から選ぶで位置を「電気設備／庁舎／電灯設備／電灯幹線」にして E25 を追加 → 内訳書から選ぶの電灯幹線の電線管の E25 が「追加済み」。数量タブで E25 は1行だけ（分類「電線管」）。
  2. 分電盤（盤類）を規格から「分電盤」で検索して L-1 を追加すると、分類「盤類」の下に入る。
  3. アウトレットボックスで寸法の「中浅形」「中深形」をチェック → 2件。保存した項目の `conditions` が `['隠ぺい', '露出']`。
  4. 経路の「線要素を追加」で「E25塗装」を検索して足せる。
  5. 幅 390px で両タブに横スクロールが無い。

## 禁止事項

- `src/core/*` を変えないこと。
- 「他のPDFから読み込む」の動きを変えないこと。
- 既存の e2e の期待値（数量・保存の結果）を変えないこと（準備の手順と、削除した画面の確認だけを変える）。
- 依存パッケージを足さないこと。

## 検証項目（Claude Code が実行する）

- [ ] 型検査、単体（全件）、`npm run build` の後の e2e（全件。時間の上限に注意）
- [ ] 画面で、2つのタブの見た目と、同じ品目が同じ分類・同じ項目になること
