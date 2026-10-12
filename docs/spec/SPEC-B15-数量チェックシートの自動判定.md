# SPEC-B15: 数量チェックシート（④工種別チェックシート）の自動判定

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 判定の計算、PDF への保存（新しい鍵・編集の種類・取り消し）、集計表の新しい表示、Excel の新しいシート、e2e にまたがる

---

## 背景（利用者の要望、2026-10-12）

> 積算チェックリスト（建築工事）に各種チェックシートがあるが、これらの内容も自動で確認できるようにしたい。

利用者の決定: ④工種別チェックシートの数値の判定から（②③の文の確認項目は次の段階）。基本の値（建築面積・延べ面積・建物周長・高さ・階数など）は入力欄＋拾いからの候補、PDF に保存。結果は集計表と Excel。

データは Claude が作成済み（**変えないこと**）: `src/core/breakdown/checkSheets.ts`
- `CHECK_BASICS`（基本の値の鍵・表示名・単位）
- `CHECK_QUANTITY_GROUPS`（内訳数量の集め方: 建築の項目のうち 種目・科目・中科目・名前の条件が合い、単位が同じものの全図面の合計 × `factor`）
- `CHECK_ROWS`（判定の行: シート・内訳数量・演算子 ≧ ≒ ∈ ＝ ＜・チェック項目の文・基準の値の関数・∈ の範囲・注記）
- `CHECK_APPROX_TOLERANCE`（≒ は ±10%）・`CHECK_EQUAL_TOLERANCE`（＝ は ±1%）
- `CHECK_BASIS_SUGGESTIONS`（拾いから延べ面積・建築面積の候補を出すときの内訳数量）

## 対象

- 新規: `src/core/quantityChecks.ts`、`src/app/QuantityChecks.tsx`（遅延読込）、`tests/quantityChecks.test.ts`、`e2e/quantity-checks.annotate.spec.ts`
- 変更: 保存（`src/core/annotations.ts` の編集の種類、`src/worker/*`、`src/editor/AnnotationStore.ts`、`src/app/documentModel.ts` など `setCountFixtures`・`KaruCountFixtures` と同じ経路）、`src/app/QuantityTable.tsx`（切り替え）、`src/app/quantityXlsx.ts`（シート）、`src/styles.css`
- 変えない: データ（`src/core/breakdown/*`）、数量の計算（`quantityIndex.ts`・`fixtureLink.ts`）

## 1. 計算（`quantityChecks.ts`）

```ts
export interface QuantityCheckBasics { values: Partial<Record<CheckBasisKey, number>> }
export interface QuantityCheckResult {
  row: CheckRow
  group: CheckQuantityGroup
  quantity: number | undefined          // 内訳数量（当たる項目が無ければ undefined）
  items: Array<{ id: string; code: string; name: string; total: number }>  // 足した項目（根拠）
  skippedUnits: string[]                // 単位が違うため足さなかった項目の名前
  basis: number | undefined             // 基準の値
  expected: { min?: number; max?: number } | undefined  // 判定の範囲
  verdict: 'ok' | 'out' | 'noQuantity' | 'noBasis'
}
export function computeQuantityChecks(fixtures: readonly CountFixture[], total: (id: string) => number, basics: QuantityCheckBasics): QuantityCheckResult[]
export function suggestCheckBasics(fixtures, total): Partial<Record<CheckBasisKey, number>>
export function parseQuantityCheckBasics(raw: unknown): QuantityCheckBasics   // 不正な値は捨てる（0 以上の有限の数だけ）
export function serializeQuantityCheckBasics(basics): string
```

- 項目の当たり: `fixture.breakdown?.book === '建築'`、`sections`（既定 `['庁舎']`）・`subjects`・`middles` に `breakdown.section`・`subject`・`middle` が入る、名前（`fixture.name`）が `names`／`nameIncludes`／`nameStartsWith` のどれか（指定のあるものすべて OR でなく、**指定のある条件はすべて満たす**。`names` と `nameIncludes` の両方があるときはどちらか一方に当たればよい）、`nameExcludes` を含まない。単位は `quantityUnit(fixture)` を `㎡`・`㎥`・`m`・`t`・`か所` にそろえて比べる（m² → ㎡ など表示の違いを吸収する）。数量は `total(id)`（全図面の合計。連動・換算・上書きの後の値）。
- 判定の範囲: `∈` は `basis × range[0]`〜`basis × range[1]`、`≒` は `basis × (1 ∓ 0.10)`、`＝` は `basis × (1 ∓ 0.01)`、`≧` は `basis` 以上、`＜` は `basis` 未満。数量が無ければ `noQuantity`、基準が無ければ `noBasis`（どちらも判定しない）。
- 基準の値の関数には `values.basis(key)`（入力された値）と `values.quantity(groupId)`（ほかの内訳数量。当たる項目が無ければ undefined）を渡す。
- `suggestCheckBasics`: `CHECK_BASIS_SUGGESTIONS` の内訳数量のうち最大の値（無ければ出さない）。

## 2. 保存（PDF）

- 文書の鍵 `KaruQuantityChecks`（Root、`KaruRoomSets` と同じ置き方、JSON `{ version: 1, basics: { 建築面積などの鍵: 数 } }`。空なら鍵を消す）。
- 読込: ワーカーに新しい要求 `getQuantityChecks`（`getCountFixtures` と同じ作り。`PdfWorkerPool.getQuantityChecks(docId)`、`protocol.ts` に要求と応答）。店（`AnnotationStore`）に `ensureQuantityChecks(loader)`（最初に要るとき 1 回だけ読む。チェックの表示を開いたとき・Excel を書き出すとき）、`getQuantityChecks()`、`setQuantityCheckBasic(key, value | undefined)`。**通常の閲覧・数量タブを開くだけでは読まない。**
- 保存: 編集の種類 `setQuantityChecks`（`{ kind: 'setQuantityChecks'; pageIndex: 0; basics }`。`setRoomSets` と同じく文書の Root に書き、ページの再描画をしない。`documentModel.ts` の再描画するページの除外にも足す）。読込前（未読込）なら編集を作らない。
- 取り消し: 履歴の状態（`HistoryState`）に `quantityChecks?` を足し、変更は Ctrl+Z 1 回で戻る（部屋の組 `roomSets` と同じ扱い）。

## 3. 集計表（`QuantityTable.tsx`・新規 `QuantityChecks.tsx`）

- 建築の項目（内訳書の位置が建築）が 1 つ以上あるとき、集計表の上の操作の並びに `チェックシート` の切り替え（`aria-pressed`）。押すと表の代わりにチェックの表示（`QuantityChecks`、遅延読込）。もう一度押すと集計表に戻る。状態は覚える（`karu-pdf:quantity-table-checks`）。
- 上に「基本の値」の入力欄（`CHECK_BASICS` の順、`aria-label` は表示名、単位を横に）。拾いからの候補があれば欄の横に `拾いから ${値}` のボタン（押すと入る）。入力は離れたとき（blur）か Enter で保存（`setQuantityChecks`）。空にすると消える。
- 下にシートごと（仮設・土工・地業・躯体・外部仕上・内部仕上・金属）の表: `名称`（内訳数量の表示名）・`内訳数量`（単位つき、2 桁）・`チェック項目`（演算子と文）・`チェック数量`（範囲 `a 〜 b` または値）・`判定`（`OK`／`範囲外`／`数量なし`／`基本の値なし`）・`確認事項`（注記）。範囲外の行は `quantity-check-out` のクラスで目立たせる（赤系）。内訳数量のセルの `title` に足した項目（略号 名称 数量）と、単位違いで足さなかった項目。
- 上部に要約: `判定 ${n} 行: OK ${a}・範囲外 ${b}・判定できない ${c}`。

## 4. Excel（`quantityXlsx.ts`）

- 建築の項目があるとき、最後に `チェックシート` のシート: 基本の値の表（名前・値・単位）と、判定の表（シート・名称・内訳数量・単位・演算子・チェック項目・下限・上限・判定・確認事項）。値は数（式でなくてよい）。

## 5. 試験

- `tests/quantityChecks.test.ts`: 延べ面積 1000・コンクリート（軸部）650 ㎥ ＋（基礎部）300 ㎥ → コンクリート総量 950 ∈ 800〜1000 で OK、基礎部 300 ∈ 200〜500 OK、軸部 650 ∈ 500〜800 OK。鉄筋加工組立 130 t → 延べ 1000 × 0.10〜0.14 で OK、コンクリート総量 950 × 0.13〜0.16 = 123.5〜152 で OK。延べ面積を入れない → `noBasis`。根切り = 埋戻し ＋ 建設発生土処分 の収支（±1%）。単位が違う項目（㎡ のコンクリート）は足さず `skippedUnits` に出る。建築でない項目・種目が違う項目は足さない。`suggestCheckBasics` が墨出し・養生の大きいほう。読込の不正な値（負・文字・NaN）を捨てる。
- e2e `e2e/quantity-checks.annotate.spec.ts`: 標準マスタから 建築 → コンクリート → 躯体 → 普通コンクリート（軸部）を追加し、体積を 1 つ拾う（既存の e2e に倣う）。集計表で `チェックシート` を押す → `延べ面積` に値を入れて Enter → 躯体のシートの「コンクリート総量」の行が判定される（拾った体積に合わせて `OK` または `範囲外` になる値を入れて両方を確かめる）。Ctrl+Z で延べ面積が消える。保存して開き直すと延べ面積が残る。Excel にシート `チェックシート` がある。

## 禁止事項

- データを変えないこと。数量の計算を変えないこと。建築の項目が無い文書の集計表・Excel を変えないこと。通常の閲覧で新しい読込をしないこと。依存パッケージを足さないこと。

## 検証項目（Claude Code が実行する）

- [ ] 型検査、単体（全件）、`npm run build` の後 e2e（新規・集計表・内訳書・連動）
- [ ] 画面で基本の値の入力・判定の表・範囲外の強調を確認
- [ ] 起動時の JS が増えないこと（`QuantityChecks` とデータは遅延読込）
