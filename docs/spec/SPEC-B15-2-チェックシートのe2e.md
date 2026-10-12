# SPEC-B15-2: 数量チェックシートの e2e

## 実行モデル指定（必須）

- モデル: `gpt-6-luna`
- reasoning effort: `max`
- 選定理由: 既存の e2e の作り方をなぞる試験の追加のみ（単一ファイル、判断を伴う実装の変更なし）

---

SPEC-B15 の実装（`src/app/QuantityChecks.tsx`・`src/core/quantityChecks.ts` など）は済んでいる。下に載せた既存の e2e の作り方に倣って、新規 `e2e/quantity-checks.annotate.spec.ts` だけを書く。**実装のファイルは変えないこと。**

試験（1 件または 2 件）:
1. 空の PDF を開き（`e2e/rc-guidance.annotate.spec.ts` の開き方）、標準マスタの「内訳書から選ぶ」→ 建築 → 庁舎 → コンクリート → 躯体 → 普通コンクリート（軸部）を追加し、4m×3m を深さ 0.15m で拾う（同じファイルの作り方。体積 1.80 ㎥）。
2. 集計表を開き（`e2e/quantity-table.annotate.spec.ts` の開き方）、`チェックシート` を押す（`aria-pressed="true"`）。基本の値 `延べ面積` に `2` を入れて Enter → 躯体の「コンクリート総量」の行の判定が `OK`（1.80 ∈ 1.6〜2.0）。`延べ面積` を `10` にすると `範囲外`（8〜10）。行は `quantity-check-out` のクラスを持つ。
3. Ctrl+Z で延べ面積が `2` に戻る。
4. `window.__karu.saveToBytes()` で保存し、開き直して（`e2e/linked-fixtures.annotate.spec.ts` の作り方）チェックシートを開くと延べ面積 `2` が残っている。
5. 集計表の `チェックシート` をもう一度押すと集計表（表 `数量の集計`）に戻る。

画面の名前・ラベルは `src/app/QuantityChecks.tsx` の実装に合わせること（下に全文）。回答は `### FILE: e2e/quantity-checks.annotate.spec.ts` の全文だけ。
