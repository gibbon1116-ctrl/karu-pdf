# SPEC-B03h: 数量タブの項目の一覧を内訳書の構成で表示する

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 項目の一覧（表示切替・折りたたみ・並べ替え・検索）の多段の見出し化と、集計表と共通の並べ方の切り出しにまたがる

---

## 利用者の要望（2026-10-12）

> こちらの表示構成も同様の内訳書の構成にしたい。（数量タブの項目の一覧。今は分類「ケーブル（低圧）（7）」「照明器具（9）」の見出しでまとめている）

SPEC-B03g で、集計表は内訳書の構成の見出し（編・種目・科目・中科目・別紙明細の細目）で並ぶようになった。数量タブの項目の一覧（`FixturePanel.tsx` の `.fixture-groups`）も同じ構成にする。

## 対象

- 新規: `src/app/breakdownOutline.ts`（集計表と一覧で共通の並べ方・見出し）、`tests/breakdownOutline.test.ts`
- 変更: `src/app/QuantityTable.tsx`（共通の関数を使うように置き換える。結果は変えない）、`src/app/FixturePanel.tsx`、`src/styles.css`
- 試験: e2e は `e2e/breakdown-master.annotate.spec.ts` に足す
- 変えない: `src/core/*`、`fixtureOrder.ts` の関数の動き、集計表の結果（`tests/quantityTable.test.ts` がそのまま通ること）

## 変更内容

### 1. 共通の並べ方（`breakdownOutline.ts`）

`QuantityTable.tsx` にある `quantityBreakdownGroupKey`・`quantityBreakdownRowKey`・`QuantityBreakdownOrder`・`createQuantityBreakdownOrder`・`orderQuantityBreakdownItems` と、`projectQuantityTable` の見出しの行を出す処理（段 0〜4、`（別紙明細）`、`（内訳書の位置なし）`）を、項目（`CountFixture`）を受け取る汎用の関数としてこのファイルへ移す。

- `export function orderByBreakdown<T>(items: readonly T[], fixtureOf: (item: T) => CountFixture, order: QuantityBreakdownOrder): T[]`（今の `orderQuantityBreakdownItems` と同じ結果。細目そのものの項目を別紙明細の群より先に並べる規則を含む）。
- `export function breakdownHeadingPath(fixture, order): string[] | null`（位置が無ければ null。`[book, section, subject, middle ?? '', separate ? item : '']`）と、見出しの行を作る小さな関数（`projectQuantityTable` と一覧の両方で使う）。
- `QuantityTable.tsx` は再 export して、既存の import（`createQuantityBreakdownOrder` など）を壊さない。集計表の出力は変えない。

### 2. 数量タブの一覧

- 一覧の上（「名称・略号で検索」の近く）に `<label><input type="checkbox" aria-label="内訳書の構成で表示">内訳書の構成で表示</label>` を足す。状態は `localStorage` の `karu-pdf:fixture-panel-group-by-breakdown` に覚え、**値が無いときはオン**（読めなければオン）。
- 見出しを内訳書の構成にするのは、チェックがオンで、**項目のどれかに内訳書の位置があり**、マスタの順を読み込めたとき。それ以外は今と同じ分類の見出し（チェックも、どの項目にも位置が無ければ出さない）。
- マスタの順は、上の条件（位置のある項目がある・オン）のときだけ `import('../core/breakdownMaster')` で遅延読込する（通常の閲覧・位置を使わない人では読まない）。読み込むまでは分類の見出しで出す。
- 見出し:
  - 位置のある項目: 集計表と同じ段（0: 編、1: 種目、2: 科目、3: 中科目、4: `${細目}（別紙明細）`）。段ごとに字下げ（`data-level`。0・1: なし、2: 1em、3: 2em、4: 3em）。
  - 位置の無い項目: 最後に段 0 の見出し `（内訳書の位置なし）`、その下に**今の分類の見出し**（段 1）でまとめる（分類の順は今の `groupFixtures` の順）。
  - 各見出しは今の分類の見出しと同じ部品: 文字のボタン（`${見出し}（${その見出しの下の項目の数}）`、押すと折りたたみ。`aria-expanded`）と、表示切替のボタン（`aria-label` は `${見出し}の表示切替`。その見出しの下の項目すべてを表示／非表示）。折りたたむと、その見出しより下の見出しと項目を隠す。折りたたみの鍵は見出しの段と上の段を含む全体（同じ名前の中科目が別の科目にあっても混ざらない）。
  - 検索（名称・略号）で項目が残らない見出しは出さない。
- 並べ替え（内訳書の構成で表示しているとき）:
  - 見出しのドラッグはできない（`draggable` を付けない）。
  - 項目のドラッグと「上へ」「下へ」は、**同じ位置（編・種目・科目・中科目・細目がすべて同じ）の項目どうし**のときだけ並べ替える（`order` を入れ替える）。違う位置へ落としたときは何も変えず、状態の文 `内訳書の構成で表示中は、同じ細目の項目の中でだけ並べ替えできます` を出す。位置の無い項目どうしは、今と同じ分類の中の並べ替え（分類をまたぐドラッグで分類を変える動きも今のまま）。
  - 「上へ」「下へ」の押せる・押せないも、上の範囲で判断する。
- 分類の見出しで出すとき（オフ・位置が無い）は今と同じ（ドラッグ・分類の移動・表示切替・折りたたみ）。
- 「項目を追加」の既定の分類（今の `selectedCategory` 等）は、今と同じく選んでいる項目の分類を使う。

### 3. 試験

`tests/breakdownOutline.test.ts`:
- `orderByBreakdown` が今の集計表と同じ順（`tests/quantityTable.test.ts` の階層の試験と同じデータで同じ並び）。
- 見出しの行の作り方（段、別紙明細の細目、位置なしは最後）。

e2e（`e2e/breakdown-master.annotate.spec.ts` に1件）:
- 内訳書から分電盤（電灯分岐）とケーブルの別紙明細の項目を足し、ほかに位置の無い項目（例: `addFixturePresets('電気設備')` の照明器具）がある状態で、数量タブの一覧に見出し `電気設備（N）`・`庁舎（N）`・`電灯設備（N）`・`電灯分岐（N）` が順に出て、その下に分電盤、`ケーブル（別紙明細）（N）` の下にケーブルの項目、最後に `（内訳書の位置なし）（N）` とその下に `照明器具（N）`。
- `電灯分岐の表示切替` で、その下の項目がすべて非表示になる。`電灯分岐` を押すと折りたたまれる。
- 「内訳書の構成で表示」を外すと分類の見出しに戻り、再読み込みしても外れたまま。

## 禁止事項

- 集計表の結果・Excel を変えないこと（共通化は置き換えだけ）。
- `breakdownMaster` を通常の画面の塊に入れないこと（遅延読込）。
- 項目の分類（`category`）・内訳書の位置を、並べ替えで書き換えないこと（位置の無い項目の分類の移動は今のまま）。
- 依存パッケージを足さないこと。指定外のファイルを変えないこと。

## 検証項目（Claude Code が実行する）

- [ ] 型検査、単体（全件）、`npm run build` の後 e2e（内訳書・項目の一覧の並べ替え・表示切替・集計表・`format-panel-width`）
- [ ] 画面で、数量タブの一覧が内訳書の構成の見出しで出ることを確認
