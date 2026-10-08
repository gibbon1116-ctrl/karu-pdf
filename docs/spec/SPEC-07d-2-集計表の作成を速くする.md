# SPEC-07d-2: 施工条件別の集計表の作成を、改修前と同じ程度の速さに戻す

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 集計の正確さを保った性能の改善で、判断を伴うため

---

## 現状（Claude Code が測ったこと）

- 既存の試験 `tests/quantityTable.test.ts` の「1000 fixtures / 100 pages / 10000 index entries」の `buildQuantityTableData` の中央値は次のとおり（同じ PC、同じ負荷）。
  - SPEC-07d の前: 10.1〜11.2ms
  - SPEC-07d の後: 32.9〜35.7ms（約3倍）
- 集計表を開いている間は、拾いを編集するたびに、これが走る。
- 原因とみられる点（`src/app/QuantityTable.tsx` の `buildQuantityTableData`）:
  1. すべての entry について、項目の集計と施工条件の集計の2つに、3つの方式（page・floor・room）の値と `reviewEntries` の配列を作っている。
     - 1 entry あたり 12 回の Map 操作と配列への追加。
  2. 施工条件が1種類だけの項目（ほとんどの項目）でも、条件の集計を項目とは別に作っている。
  3. `roomKey`（`JSON.stringify`）を entry ごとに呼んでいる。

## 変更内容

**目標**: 同じ試験の中央値を 15ms 以下にする。測定は、この試験を単独で3回流した中央値。

次の方針で直す。結果（表の値・行・CSV・順に確認の対象）は1つも変えない。

1. **施工条件が1種類だけの項目**
   - 条件の集計を、項目の集計と同じオブジェクト（参照）にする。
   - 値を二重に作らない。
2. **`reviewEntries` を前もって作らない**
   - 順に確認でボタンを押したときに、その項目（または条件）の entry から、その列の分だけを絞る。
   - 改修前の `go` と同じやり方。1回のクリックで1項目の entry を走査するだけなので軽い。
3. **`roomKey`**
   - 階・部屋の組ごとにキャッシュする（例: `Map<floor, Map<room, key>>`）。
4. **未設定の判定（`hasUnset`）・部分（plan・rise・slack）の合計**
   - 今と同じ値になること。

## 対象

- 対象フォルダ: `C:\Users\gibbo\Desktop\PDF編集アプリ\.claude\worktrees\sekisan-07d`
- 変更してよいファイル: `src/app/QuantityTable.tsx`、`tests/`（試験の追加だけ。既存の期待値は変えない）
- 変更しないファイル: 上以外。

## テスト

- 既存の単体試験（`tests/quantityTable.test.ts`、`tests/quantityConditionReporting.test.ts`、`tests/quantityTable.conditions.perf.test.ts` ほか）がそのまま通ること。
- 施工条件が1種類・2種類・未設定混在の項目で、項目と条件の値・順に確認の対象の entry が、変更前と同じになる試験を足す。

## 禁止事項

- 表の値・行・CSV を変えないこと。
- 対象外のファイルを変更しないこと。git の操作をしないこと。python・pytest は使わない。
- `npx tsc --noEmit` と単体試験は実行してよい。

## 報告してほしいこと

- 変更点と、測った中央値（変更前・後）
