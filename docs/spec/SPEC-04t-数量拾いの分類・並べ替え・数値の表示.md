# SPEC-04t: 数量拾いの分類の選択、並べ替え（ドラッグ）、数値の表示の切替

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 項目の画面・数量タブの並べ替えの考え方の作り直し・ドラッグ操作・図面の重ね描きにまたがる変更のため（判定表「新規機能の実装」）

> Codex デスクトップアプリへ貼り付けて実行する場合は、モデルセレクタを上記に合わせてから貼り付けること。

---

## 目的

利用者が数量拾い（SPEC-04r・04s、1.3.0）を試して出た要望（2026-10-06）:

> 数量拾いで項目を追加するとき、分類が選択できなくなっている。分類の新規作成や既に作成している分類の選択ができるようにしたい。項目の並び替えをするとき、新規に追加した項目を見本から追加した項目より上に置くことができない。修正したい。また、項目の並び替えをするとき、ドラッグアンドドロップで並び替えられるようにしたい。長さや面積を入力したとき、測定した数値を表示する、しないを選択できるようにしたい。

利用者の回答（同日）:

| 問い | 回答 |
|---|---|
| ドラッグで、項目を別の分類の行に落としたとき | **その分類へ移す**（`Ctrl+Z` で戻せる）。分類の見出しのドラッグで、分類ごと並べ替えられる |
| 数値を図面に出す・出さないの単位 | **全体で一括**。数量タブにチェックを1つ置き、すべての長さ・面積・体積の数値をまとめて出す・隠す（画面の表示だけ） |

## 現状と原因（Claude Code が確認したこと）

- **分類が選べない**: `src/app/FixtureDialog.tsx:95` の分類の欄は `<input list="fixture-categories">`（`datalist`）。新しい項目では初期値が入っている（選んでいる項目の分類か「その他」）ため、ブラウザーは候補を入力中の文字で絞り、他の分類が出てこない。消せば出るが、利用者には分からない。
- **新しい項目を上へ動かせない**: `src/app/FixturePanel.tsx` の「上へ」「下へ」（84〜88 行付近）は、`fixtures`（`order` 順の全項目の配列）の中で隣と入れ替えている。一方、一覧の表示は分類ごとにまとめている（26〜27 行。分類の並びは、その分類の項目が配列に最初に出てくる順）。そのため、隣が別の分類の項目だと、押しても見た目が変わらない。新しい項目は配列の最後に付くので、見本から足した項目の上に出すには、見えない入れ替えを何十回も押す必要がある。また、分類の並びそのものを変える手段がない。
- **数値の表示**: 拾いの重ね描きは `src/editor/AnnotationLayer.tsx:765` 付近の `MeasurementShape`（`src/editor/MeasurementOverlay.tsx:20`）で、`text` を常に描いている。

## 対象

- 対象フォルダ: `C:\Users\gibbo\Desktop\PDF編集アプリ\.claude\worktrees\quantity-pickup-expansion-ea43cf`
- 新しく作るファイル: `src/app/fixtureOrder.ts`（並べ替えの純粋な関数）、`tests/fixtureOrder.test.ts`、`e2e/quantity-order.annotate.spec.ts`
- 変更してよいファイル: `src/app/FixtureDialog.tsx`、`src/app/FixturePanel.tsx`、`src/app/HelpDialog.tsx`、`src/editor/AnnotationStore.ts`、`src/editor/AnnotationLayer.tsx`、`src/editor/MeasurementOverlay.tsx`、`src/styles.css`、`tests/`、`e2e/`（既存の試験で、今回の変更で文字や操作が変わる箇所だけ）
- 変更しないファイル: `docs/`、`public/`、設定ファイル、`.env.*`、`src/core/`（保存の形は変えない）、`src/worker/`、`src/viewer/`、`scripts/`

## 変更内容

### 1. 分類の選択と新規作成（`FixtureDialog.tsx`）

`datalist` をやめ、次の形にする。

```
分類 [照明器具        ▼]      ← select。今の一覧にある分類を、一覧の並び順で出す
     （最後の選択肢）＋ 新しい分類…
                              ← 「＋ 新しい分類…」を選んだときだけ、下に入力欄を出す
     新しい分類の名前 [        ]  （40文字まで。空なら決定できない）
```

- 選択肢: 数量タブの一覧にある分類（`fixtures` の分類を、2. の表示順で重複なく）。編集中の項目自身の分類も必ず含める。
- 初期値:
  - 追加: 一覧で選んでいる項目の分類。選んでいなければ一覧の最初の分類。一覧が空なら「＋ 新しい分類…」を選んだ状態で、入力欄に「その他」を入れておく。
  - 編集・複製: その項目の分類。
- 新しい分類の名前が既にある分類と同じ（前後の空白を除いて一致）なら、その分類を選んだのと同じに扱う。
- `aria-label`: select は「分類」、入力欄は「新しい分類の名前」。e2e の既存の `getByLabel('分類')` があれば合わせて直す。
- 保存の形（`category` の文字列）は変えない。

### 2. 並べ替えの考え方（`src/app/fixtureOrder.ts`）

一覧の見た目の並びを正とし、すべての並べ替えをその並びの上で行う。

```ts
// 一覧の表示順: 分類は、その分類の項目のうち最小の order の順。分類の中は order の順。
export function groupFixtures(fixtures: readonly CountFixture[]): Array<{ category: string; items: CountFixture[] }>
// 表示順に並べ、order を 0 から振り直した配列を返す（入力は変えない）
export function renumber(groups: ReadonlyArray<{ category: string; items: readonly CountFixture[] }>): CountFixture[]
// 項目を動かす。target の前（before）か後（after）、または分類の末尾（category の指定）へ。
// 別の分類へ入れたときは、その項目の category をその分類に変える。
export function moveFixture(fixtures: readonly CountFixture[], id: string, to: { beforeId: string } | { afterId: string } | { endOfCategory: string }): CountFixture[]
// 分類を丸ごと動かす（その分類の項目の並びは保つ）
export function moveCategory(fixtures: readonly CountFixture[], category: string, to: { beforeCategory: string } | { end: true }): CountFixture[]
// 「上へ」「下へ」: 同じ分類の中で、表示順の1つ前・後と入れ替える。分類の端なら null
export function stepFixture(fixtures: readonly CountFixture[], id: string, direction: -1 | 1): CountFixture[] | null
```

- どの関数も、結果を `renumber` で 0, 1, 2, … の `order` に振り直して返す。変化が無いときは `null`（`stepFixture`）か、元と同じ並びを返し、呼び出し側は何もしない。
- 一覧の表示（`FixturePanel.tsx` の `categories`）も `groupFixtures` を使う（検索で絞るときは、`groupFixtures` の結果から絞る）。
- 反映は今と同じく `store.setCountFixtures(next)`。1回の並べ替えが1回の `Ctrl+Z` で戻ること。分類を変えても、印・拾いの見た目は変わらない（`setCountFixtures` の `appearance` に分類は入っていない）ので、注釈は書き換えない。

### 3. 「上へ」「下へ」ボタン

- `stepFixture` を使い、**同じ分類の中で、見えている1つ前・後**と入れ替える。
- 分類の先頭で「上へ」、末尾で「下へ」は使えない（`disabled`）。`title` に「分類の先頭です。分類ごと動かすときは、分類の見出しをドラッグします」（末尾も同様）を出す。

### 4. ドラッグで並べ替え（`FixturePanel.tsx`）

HTML の drag and drop（`draggable`、`dragstart`・`dragover`・`drop`・`dragend`）で作る。外部のライブラリは足さない。

- **項目の行**（`li[data-fixture-id]`）をつかんで動かせる。行の左端に、つかむ印（`⠿`、`aria-hidden`）を出し、行全体を `draggable` にする。
  - 他の項目の行の上に落とす: マウスが行の上半分なら、その行の前。下半分なら後ろ。その行が別の分類なら、**その分類へ移す**。
  - 分類の見出しの上に落とす: その分類の**末尾**へ移す（畳んでいる分類でもよい）。
  - 落とす位置に、細い横線（2px、選択色）を出す。見出しに落とすときは、見出しを強調する。
  - 分類を変えたときは、状態の文に「〈名称〉を分類「〈分類〉」へ移しました（Ctrl+Z で戻せます）」と出す。
- **分類の見出し**（`.fixture-category` の分類名のボタン）をつかんで、分類ごと動かせる。
  - 他の分類の見出しの上半分なら、その分類の前。下半分なら後ろ（= その次の分類の前。最後なら末尾）。
  - 項目の行の上に落としたときは、その行の分類の前後（同じ上半分・下半分の規則）として扱う。
- 次のときはドラッグを使えなくする（`draggable={false}`）: 編集できないとき（`!canEdit`）、検索欄に文字があるとき（並びが一部しか見えないため。`title` で「検索中は並べ替えできません」）。
- 動かしたものは選んだ状態にする（項目なら `store.selectFixture`）。
- 行のクリック（項目の選択）、目のボタン、見本の拡大表示（`onMouseEnter`）など、今の操作は壊さない。ドラッグを始めたら見本の拡大表示を閉じる。
- 内部の受け渡しは `dataTransfer.setData('application/x-karu-fixture', id)` と `'application/x-karu-category'`。それ以外の種類（ファイルなど）の `drop` は無視する（今の、PDF を窓に落として開く動きに影響させない。`preventDefault` は自分の種類のときだけ）。

### 5. 図面の数値の表示の切替

- `AnnotationStore` に、画面の表示だけの状態を足す。

```ts
showQuantityValues = true
setShowQuantityValues(value: boolean): void   // notify する
```

  - PDF には保存しない。`reset(true)`（ページの整理の後など）では保ち、`reset()` では `true` に戻す（`hiddenFixtures` と同じ扱い）。
- 数量タブの「選択中の項目だけ表示」の下にチェックを置く: `☑ 図面に長さ・面積・体積の数値を表示`（既定オン）。
- オフのとき、拾いの重ね描き（`quantity` のある注釈の `MeasurementShape`）は、線・塗りだけを描き、値の文字（と文字の白い背景）を描かない。略号も出さない。
  - 個数の印、ふつうの計測（距離・連続した長さ・面積）、指摘などは変えない。
  - なぞっている途中のカーソルのそばの値（下書き）は、オフでも出す（測っている最中の確認に使うため）。
  - 選んだ拾いの書式欄の値（平面の長さ・この拾い）、一覧の数量、CSV、`/Contents`、保存した PDF の外観は変えない。
- ヘルプ（`HelpDialog.tsx`）の数量拾いの説明に、分類の選び方・新しい分類、ドラッグでの並べ替え（別の分類へ落とすと分類が変わる、分類の見出しで分類ごと動かす、検索中は使えない）、数値の表示の切替（画面だけ）を足す。

## 動作の軽さ

- 通常の読込に何も足さない。並べ替えの計算は、数量タブで操作したときだけ（1,000件まで。配列の並べ替えだけなので軽い）。
- ドラッグ中（`dragover`）は、落とす位置の線の位置だけを更新する。毎回 `setCountFixtures` を呼ばない（`drop` のときに1回だけ）。

## テスト

- **単体（`tests/fixtureOrder.test.ts`）**:
  - `groupFixtures`: 分類の並びが最小の `order` の順になること。分類の中が `order` の順になること。
  - 見本から足した分類「照明器具」（order 0〜9）の後ろに、新しい項目（分類「照明器具」、order 50）がある場合: `moveFixture(..., { beforeId: 照明器具の先頭 })` で先頭に来て、`order` が 0〜10 に振り直されること。
  - 別の分類の行の前に落とすと `category` が変わること。`endOfCategory` で末尾に入ること。
  - `moveCategory`: 「コンセント」を「照明器具」の前へ動かすと、表示順の分類が入れ替わり、分類の中の並びは保たれること。`{ end: true }` で最後になること。
  - `stepFixture`: 同じ分類の中だけで動き、分類の端で `null` になること。間に別の分類の項目がある並び（今の不具合の再現）でも、見た目の1つ前と入れ替わること。
- **画面（`e2e/quantity-order.annotate.spec.ts`）**:
  1. 見本から電気設備を足す。「項目を追加」で、分類の select に「照明器具」「コンセント」などが出て、「照明器具」を選べる。名称「新LED」で追加すると、照明器具の末尾に出る。
  2. 「＋ 新しい分類…」で「幹線」を作って項目を追加すると、分類「幹線」ができる。
  3. 「新LED」の行を、照明器具の先頭の行の上半分へドラッグ（`locator.dragTo` に `targetPosition`）→ 照明器具の先頭になる。`Ctrl+Z` で元に戻る。
  4. 「新LED」を「上へ」で押していくと、1回ごとに見た目が1つ上がり、先頭で「上へ」が使えなくなる。
  5. 項目をコンセントの行へドラッグすると分類がコンセントに変わり、状態の文が出る。保存して開き直しても、並びと分類が残る。
  6. 分類「幹線」の見出しを「照明器具」の見出しの上半分へドラッグ → 幹線が最初の分類になる。
  7. 検索欄に文字を入れると、行と見出しの `draggable` が `false` になる。
  8. 長さの拾いを1つ作り、「図面に長さ・面積・体積の数値を表示」をオフにすると、拾いの線は残り、値の文字が図面から消える。一覧の数量は変わらない。オンで戻る。保存した PDF の拾いの `/Contents` は値のまま。
- 既存の `e2e/count-fixtures.annotate.spec.ts`、`e2e/quantity-length.annotate.spec.ts`、`e2e/quantity-area-volume.annotate.spec.ts` が通ること（分類の欄の操作が変わる箇所は直してよい。試験の意図は変えない）。

## 禁止事項

- 対象外のファイルを変更しないこと。git の変更操作をしないこと。
- 保存の形（`KaruCountFixtures` の JSON、`KaruCount`、`KaruQuantity`、注釈の外観）を変えないこと。
- 外部のライブラリを足さないこと（`package.json` を変えない）。
- 個数カウント・長さ・面積・体積の拾いの既存の動き（作る・選ぶ・付け替え・表示の切替・CSV・保存）を壊さないこと。
- python・pytest は使わない。自分で起動したサーバーは必ず止め、一時ファイルは削除すること。

## 検証項目

- [ ] `npm run build`、`npm test` が成功する。
- [ ] 上の e2e（新規と既存の3ファイル）が成功する。ブラウザーが起動できないときは「未実行」と報告する。

## 報告してほしいこと

- 作成・変更したファイルと要点
- 検証の結果（実行したコマンドと件数。未実行のものはそう書く）
- SPEC から逸脱した箇所と理由、残課題
