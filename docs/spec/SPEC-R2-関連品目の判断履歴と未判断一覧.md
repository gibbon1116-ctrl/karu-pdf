# SPEC-R2: 関連品目の判断・案件区分・品目作業の保存と未判断一覧

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: PDF の保存形式・未保存判定・Undo/Redo に新しいデータを足す、互換性に関わる判断を伴うため既定の sol-high。

---

## 目的

R1 でメモリ内（`src/app/relatedState.ts`）に持っている判断・案件区分・品目作業を PDF に保存・復元し、未保存判定・Undo/Redo に乗せる。未判断を一覧にする。
**チェックシートの基本の値（`KaruQuantityChecks`）と全く同じ経路**を、新しいキー `KaruRelatedReviews` で作る。

## 保存するデータ

```ts
// 新規 src/core/related/reviews.ts
export interface RelatedReviewDecision {
  decision: '必要' | '不要' | '単価包含' | '他工事' | '後で確認' | '構成要素で拾う'
  ruleIds: string[]          // 1〜20、各 32字まで
  originFixtureIds: string[] // 0〜50
  reason?: string            // 200字まで
  rulesVersion: string       // RELATED_RULES_VERSION
  decidedAt: string          // ISO 8601
}
export interface RelatedReviews {
  version: 1
  projectMode?: ProjectMode
  works: Record<string, WorkType>                 // 項目ID → 品目作業（1,000件まで）
  decisions: Record<string, RelatedReviewDecision> // 提案の key → 判断（5,000件まで）
}
```

- `parseRelatedReviews(raw: unknown): RelatedReviews` — 不正な値・未知のキーは捨てる（`parseQuantityCheckBasics` と同じ方針）。上限を超えた分は捨てる。
- `serializeRelatedReviews(value): string` — 正規化して JSON。不正なら例外。
- `readRelatedReviews(doc)` / `writeRelatedReviews(doc, value)` — Root の `KaruRelatedReviews`（文字列）。`readQuantityChecks` / `writeQuantityChecks`（`src/core/quantityCheckBasics.ts`）と同じ書き方。値が空（projectMode なし・works と decisions が空）のときはキーを消す。

## 経路（`KaruQuantityChecks` と同じ場所に、同じ形で足す）

1. `src/core/annotations.ts`: 編集の種類 `{ kind: 'setRelatedReviews'; pageIndex: 0; reviews: RelatedReviews }` と、適用で `writeRelatedReviews`。
2. `src/worker/protocol.ts`・`src/worker/pdf.worker.ts`: `getRelatedReviews` の要求と応答（`getQuantityChecks` と同じ。編集が `setRelatedReviews` だけのときの扱いも `setQuantityChecks` と同じ）。
3. `src/client/PdfWorkerPool.ts`: `getRelatedReviews(docId)`。
4. `src/app/documentModel.ts`: `ensureSessionRelatedReviews(session, pool)`、未保存の説明に「関連候補の判断」、保存後の再描画ページの判定で `setRelatedReviews` を除外（`setQuantityChecks` と並べる）。
5. `src/editor/AnnotationStore.ts`: `quantityChecks` と同じ形で
   - 値・基準値・読込中・`relatedReviewsReady`、`ensureRelatedReviews(loader)`、`getRelatedReviews()`（複製）、
   - 変更のメソッド: `setRelatedProjectMode(mode | undefined)`、`setRelatedWork(fixtureId, work | undefined)`、`setRelatedDecision(key, decision | undefined)`（undefined は取消）。どれも値が変わらなければ何もしない。履歴に1手を積み、`notify(false)`（保存内容が変わる通知。`notifyUi` にしない）。
   - `HistoryState.relatedReviews`、`restoreMany`・`mapHistoryStep` での復元、`dirtySummary` の `relatedReviews`、`toEdits` での `setRelatedReviews` の追加と `markApplied` での基準値の更新、`reset` での初期化。
6. `src/app/RelatedSuggestions.tsx`・`src/app/FixturePanel.tsx`・`src/app/relatedState.ts`:
   - 判断・案件区分・品目作業はストアから読む（`getRelatedReviews()`）。変更はストアのメソッドで行う。`originIds`・`closed` だけは今のメモリ（`relatedState.ts`）に残す。
   - 数量パネルを開いたとき `ensureSessionRelatedReviews` を呼ぶ（`ensureSessionQuantityChecks` と同じ呼び方）。読み込み前は選択欄・判断ボタンを無効にする。
   - 項目の削除で起点の項目が無くなった判断は消さず、表示で「起点なし」とする。項目を戻せば元どおり。
7. 未判断一覧: 数量パネルの区画に「未判断 n件・後で確認 m件」を出し、開くと文書全体の一覧（起点ごと）。判断の変更・取消ができる。

## 試験

- `tests/related.reviews.test.ts`: parse の不正値・上限、serialize の正規化、Root への読み書き（mupdf の PDFDocument）、空ならキーを消す。
- `tests/AnnotationStore.relatedReviews.test.ts`: 変更→`dirtySummary.relatedReviews`、Undo/Redo で元に戻る、`toEdits` に `setRelatedReviews`、`markApplied` で未保存が消える、選択（`selectFixture`）だけでは未保存にならない、`reset` で初期化。
- `e2e/related-reviews.annotate.spec.ts`: 判断・案件区分・品目作業を付けて保存（`window.__karu.saveToBytes`）→ 開き直して同じ。キーの無い既存 PDF を開ける。判断の Undo（Ctrl+Z）で戻る。保存前はタブに未保存の印、保存後は消える。

## 受入条件・停止条件

- 既存の保存・再読込・Undo/Redo・未保存の e2e（save-state、save-as、resume、count-fixtures、quantity-table）と単体試験全件が合格。
- `KaruRelatedReviews` の無い PDF の保存結果（他のキー・注釈・項目）が変わらない。
- 停止: 既存データの読込・保存が変わったら停止。戻し方はこの段階のコミットの revert（保存済み PDF のキーは旧版では無視される）。

## 禁止事項

- `CountFixture` にフィールドを足さない。既存のキーの形式を変えない。`rules.ts`・`types.ts`・`suggest.ts` の照合を変えない。外部通信を足さない。https:// を含む文字列を足さない。
