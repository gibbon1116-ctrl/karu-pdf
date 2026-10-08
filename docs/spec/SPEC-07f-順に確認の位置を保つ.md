# SPEC-07f: 集計表・内訳から順に確認しているとき、削除しても確認の位置を保つ

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 確認の順序の状態管理と、Undo・Redo・複数削除・絞り込みの組合せを扱うため

---

## 目的

利用者の指示（2026-10-08）:

- 集計表から器具などを順に確かめているとき、誤って拾ったものを削除すると、確認の位置が初めに戻る。これを直す。
- 削除した後も、確認の順序を保つ。
- 確認中の器具を削除したら、次のクリックでは、削除した器具の次にあった器具を表示する。
- 他の器具を削除した場合も、できるだけ確認の位置を保つ。
- 削除したものが最後だったら、先頭に戻る。
- 数量と確認の件数を正しく更新する。
- 対象は集計表と数量の内訳の両方。Undo・Redo や複数の削除にも対応する。
- 集計表のスクロールの位置や絞り込みを、むやみに初期化しない。

## 現状（Claude Code が確認したこと）

**`src/app/QuantityTable.tsx`**
- `cursors: Record<key, { id, position, count }>`。key は `[mode, itemId, columnKey]`。
- `go(item, column)` は次の手順で動く。
  1. その列の entry の拾いを並べる（ページ → 上 → 左 → id）。
  2. `marks.findIndex(a => a.id === cursor.id)` の次を出す。
- 確認中の拾いが消えていると、`findIndex` が -1 になり、先頭に戻る。
- `useEffect(() => { scrollTop = 0; setCursors({}) }, [mode, filters, index])`。
  - **数量の索引（`index`）が変わるたびに**、スクロール位置と確認の位置が初期化される。
  - 削除・Undo・数量の編集でも初期化される。

**`src/app/QuantityBreakdown.tsx`**
- `cursor: { page, id, position, count }`。`go(pageIndex, list)` は同じ並べ方と同じ `findIndex`。
- 確認中の拾いが消えると、先頭に戻る。

**並べ方**
- 両方とも `store.get(id)` の `rect` で並べる。
- 削除した拾いは `store.get` で取れない（または `deleted`）。

## 変更内容

### 1. 確認の位置の持ち方（2画面で共通の関数を作る。例: `src/app/reviewCursor.ts`）

```ts
export interface ReviewCursor { id: string; order: string[]; position: number; count: number }
/** 今の拾いの並び current（並べ方は今と同じ）と前の cursor から、次に出す拾いを決める */
export function nextReview(current: readonly string[], cursor: ReviewCursor | null): { id: string; position: number; count: number; order: string[] } | null
/** 索引が変わったとき、表示の「n / m」を今の並びに合わせる（次に出すものは変えない） */
export function refreshReview(current: readonly string[], cursor: ReviewCursor): ReviewCursor
```

`nextReview` の規則:

1. `cursor` が無い、または並びが空 → 並びの先頭（空なら `null`）。
2. `cursor.id` が今の並びにある → その次。最後なら先頭へ戻る。
3. `cursor.id` が今の並びに無い（削除された）とき:
   1. 前の並び `cursor.order` で `cursor.id` より後にあった拾いのうち、今もある最初のものを出す。
   2. 無ければ先頭へ戻る。

**位置と件数**
- `position` は、出した拾いの今の並びでの順番（1 から）。`count` は今の並びの件数。
- `order` には今の並び全体を保存する。

**`refreshReview`**
- 索引が変わったときに件数を今に合わせる。
- `cursor.id` が今もあれば、`position` をその順番にする。
- 消えていれば、`position` は「次に出すものの順番 − 1」（0 なら 0）にする。表示は `—` でもよい。

**Undo で戻った拾い**
- 今の並びに入るので、次のクリックの対象になる。
- 戻った拾いが確認中の拾いより前なら、出さずに進む（並びの規則どおり）。

### 2. 集計表（`QuantityTable.tsx`）

- **数量の索引が変わったとき**
  - スクロールの位置と確認の位置を初期化しない。
  - 初期化するのは、集計の方式（図面別・階別・部屋別）と絞り込みを変えたときだけ。
  - 索引の変更では、各 `cursor` を `refreshReview` で更新する。
    - 対象は、今ある cursor の列だけ。すべての項目を回さない。
- `go` は `nextReview` を使う。
- 確認中の行・列が索引の変更で消えた場合（項目の数量が 0 になった等）は、その cursor を捨てる。
- 行の並びが変わらない限り、スクロールの位置を保つ。
  - 表の行が減ってスクロールの位置が範囲外になる場合は、範囲内に収める（ブラウザーの既定の動き）。

### 3. 数量の内訳（`QuantityBreakdown.tsx`）

- `go` は `nextReview` を使う。
- 索引が変わっても cursor を保ち、`refreshReview` で件数を更新する。
- 絞り込み（階・部屋）や表示の切り替え（ページ別・階・部屋別）を変えたときは、今どおり初期化する。

### 4. 複数の削除・Undo・Redo

- 複数を一度に削除しても、規則 3 で「前の並びで後にあった、今もある最初のもの」を出す。
- Undo・Redo の後も、上の規則のまま動く（特別な処理は要らない）。

## 対象

- 対象フォルダ: `C:\Users\gibbo\Desktop\PDF編集アプリ\.claude\worktrees\sekisan-07f`
- 変更してよいファイル: `src/app/QuantityTable.tsx`、`src/app/QuantityBreakdown.tsx`、新規 `src/app/reviewCursor.ts`、`tests/`、`e2e/`
- 変更しないファイル: 上以外。

## テスト

### 単体（`nextReview`・`refreshReview`）

- 先頭から順に進み、最後の次は先頭へ戻る。
- 確認中のものを削除したら、その次のものを出す。
- 確認中のものが最後で、それを削除したら先頭へ戻る。
- 確認中より前・後の別のものを削除しても、位置を保つ。
- 複数を削除（確認中と次の2件）したら、その次を出す。
- Undo で戻ったもの（確認中より前・後）の扱い。
- `refreshReview` の件数と位置。

### 画面（e2e、書くだけ）

- 集計表で、同じ図面の器具を5個拾い、列のボタンで順に確認する。
  - 2個目を表示中に Delete で消すと、次のクリックで3個目（元の並びの3個目）が出る。
  - 表示が「2 / 4」になる。
  - 数量が4になる。
- 集計表をスクロールしてから削除しても、スクロールの位置と絞り込みが保たれる。
- 最後の器具を表示中に消すと、次のクリックで先頭が出る。
- Ctrl+Z で戻すと件数が5に戻り、確認を続けられる。
- 内訳（ページ別）でも同じ。

## 禁止事項

- 確認のたびに全注釈を走査しないこと（並びはその列・ページの entry だけから作る、今のまま）。
- 対象外のファイルを変更しないこと。git の操作をしないこと。python・pytest は使わない。
- `npx tsc --noEmit` と単体試験は実行してよい。e2e は実行しなくてよい。

## 報告してほしいこと

- 変更したファイルと要点
- SPEC から逸脱した箇所と理由
