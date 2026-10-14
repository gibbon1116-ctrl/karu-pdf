# SPEC-R2b: 関連の候補を使うときだけ動かす（通常の操作を遅くしない）

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 性能のための起動条件とストアのスナップショットの設計を伴うため既定の sol-high。

---

## 目的

R1・R2 の後、関連の候補の機能を使っていない利用者でも、数量パネルを開く・項目を選ぶ・検索欄に打つたびに処理が増えた（実測: 100項目の選択 中央値 128→144 ms、p95 173→223 ms）。原因:

1. `RelatedSuggestions` が描画のたびに `JSON.stringify(store.getRelatedReviews())`（深い複製＋文字列化）をする。選択・ホバー等の通知でも毎回走る。
2. 数量パネルを開くと、項目が1件でもあればルールと品目一覧を読み込み、文書の全項目で `suggestRelated` を実行する（未判断の件数のため）。
3. 項目を選ぶだけで、選択中の項目の提案を評価する（区画は閉じていても）。

**機能を使っていないときは、ルールの読込・照合・判断の複製を一切しない**ようにする。結果（提案の内容・判断・保存）は変えない。

## 対象

- `src/editor/AnnotationStore.ts`
- `src/app/RelatedSuggestions.tsx`
- 必要なら `src/app/FixturePanel.tsx`（最小）
- 試験の追加・修正

## 変更内容

1. ストアに、判断データの版と固定のスナップショットを足す（項目の `getFixturesRevision` / `getCountFixturesSnapshot` と同じ考え方）:
   - `getRelatedReviewsRevision(): number` — 判断データ（`relatedReviews`）を置き換える／変えるたびに進む（読込・変更・Undo/Redo の復元・reset）。
   - `getRelatedReviewsSnapshot(): Readonly<RelatedReviews>` — 版が同じあいだ同じオブジェクト。深く freeze（既存の `deepFreeze` を使う）。内部の値とは別物。
   - `getRelatedReviews()`（複製を返す）は変えない。
2. `RelatedSuggestions` は判断データを `getRelatedReviewsSnapshot()` で読み、`JSON.stringify`／`JSON.parse` で作り直さない。`works`・`decisions` などの派生値は `useMemo` でスナップショットに結び付ける。
3. 「機能を使っている」状態（`active`）を次のどれかのときだけにする:
   - 直前に項目を登録した（`originIds.length > 0`）
   - 利用者が「関連の候補」を開いた（選択中の項目について）
   - 利用者が「未判断一覧」を開いた
   - 案件区分が設定されている
   - 保存済みの判断が1件以上ある
   `active` でないときは、`loadRelated()` を呼ばない・照合しない・文書全体の評価をしない。見出しは件数を出さずに「関連の候補（開くと確認します）」とする。
4. 選択中の項目の評価（`suggestRelated` を `activeOriginIds` に対して行う）は、`originIds` があるとき、または「関連の候補」が開いているときだけ行う。
5. 文書全体の評価（未判断の件数・未判断一覧）は、`active` のときだけ行う。さらに、項目の数が多くても操作を止めないよう、評価は描画の後（`setTimeout(…, 0)` か `requestIdleCallback` があればそれ）に行い、結果が古くなったら捨てる（世代を比べる）。
6. 計数器: 文書全体の評価は `perfTime('related.suggest.document', …)` のまま。

## 試験

- 単体: `getRelatedReviewsSnapshot()` が版の変わらない操作（`selectFixture` 等）で同じオブジェクト、変更・Undo・読込で新しいオブジェクトになり、内容が `getRelatedReviews()` と等しい。freeze されている。
- e2e（`e2e/related-suggestions.annotate.spec.ts` に追加）: 項目がある PDF を開いて数量パネルを開き、項目を数回選ぶだけでは `window.__karuPerf.get()['related.suggest']` と `['related.suggest.document']` が増えない（`?perf=1`）。「関連の候補」を開くと評価される。項目を登録すると評価される。
- 既存の関連の試験（`tests/related.*.test.ts`、`tests/AnnotationStore.relatedReviews.test.ts`、`e2e/related-*.annotate.spec.ts`）がすべて合格（必要な最小限の修正は可。意図は変えない）。

## 禁止事項

- 提案の照合・集約・判断の保存の結果を変えない。`rules.ts`・`types.ts`・`suggest.ts`・`reviews.ts` を変えない。
- 外部通信を足さない。https:// を含む文字列を足さない。
