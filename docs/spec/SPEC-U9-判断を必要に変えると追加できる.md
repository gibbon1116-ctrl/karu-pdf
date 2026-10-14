# SPEC-U9: 判断を「必要」に変えると、その候補を追加できる

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 判断の記録と項目の追加（マスタ検索・項目の作成・連動の自動反映）の流れをまたぐ UI の変更で、既存の判断操作を壊さない判断が要るため既定の sol-high。

---

## 背景

利用者の依頼（2026-10-15）:

> 一度不要と判断した項目でも、あとで必要になった場合、必要に変更すれば、追加項目として追加できるようにしたい。

現状（`src/app/RelatedSuggestions.tsx` の `renderSuggestion`）:

- 未判断のカードの「追加する」は、`decide(suggestion, '必要')` を記録してから、品目なら `onOpenMaster(query, context)`、それ以外は `createRelatedFixture` → `onCreateFixture(initial, context)` を開く。
- 判断済みのカードの「判断を変更」（`aria-label="関連候補の判断を変更"`）で「必要」を選ぶと、`requestDecision` → `decide` で判断を書き換えるだけ。項目は追加されず、追加する手段も無い。

## 変更内容（`src/app/RelatedSuggestions.tsx` のみ）

### 1. 追加の流れを1つの関数にする

`renderSuggestion` の中で、今の未判断のカードの「追加する」の `onClick` の中身を関数（例 `addSuggestion`）に切り出す。動作は今と同じ（`canAddFixtures`・`canCreate`・`createOrigin` の確認、`context` の作り方、品目は `onOpenMaster`、それ以外は `createRelatedFixture` → `onCreateFixture`、例外は `setReviewError`）。未判断のカードの「追加する」はこの関数を呼ぶ。

### 2. 「判断を変更」で「必要」にしたとき

`onChange` で選んだ値が `'必要'` で、次をすべて満たすときは、1 の関数を呼ぶ（判断の記録は関数の中の `decide(suggestion, '必要')` で行う）:

- 今の判断が `'必要'` でない
- `!suggestion.flags.registered`（文書にまだ無い）
- `canAddFixtures && canCreate`

満たさないときは、今と同じ `requestDecision(...)`（判断の書き換えだけ）。

### 3. 判断が「必要」で、まだ文書に無いカードに「追加する」

判断済みの表示（`suggestion.decision` があるとき）で、`suggestion.decision === '必要' && !suggestion.flags.registered && canCreate` なら、「判断を取消」の隣に「追加する」ボタンを出す（`disabled={!canAddFixtures}`、押すと 1 の関数）。

- 「判断を変更」で必要にした後、マスタや項目の画面を閉じた（追加しなかった）場合も、ここから追加できる。
- 追加して文書に入れば `flags.registered` が真になり、ボタンは出なくなる。

### 変えないこと

- 未判断のカードのボタン・「ほかの判断」・構成要素で拾う・他工事の担当・判断を取消の動作。
- 判断の保存形式（`KaruRelatedReviews`）。`decide` の中身。
- 「必要」以外への変更、文書に既にある候補（`flags.registered`）の「必要」への変更は今のまま記録だけ。

## 試験（e2e `e2e/related-redecide.annotate.spec.ts` を新規）

`e2e/related-auto-apply.annotate.spec.ts` と同じ作り（同じ起点の項目 `軽量鉄骨天井下地`・案件区分 新築・`RELATED_RULES` の `create.name === '天井耐震補強'` の規則、`window.__karu` の `openBytes`・`getCountFixtures`）で書く。新しい試験の仕組みを作らない。

1. **不要 → 必要で追加できる:**
   - 候補カードで「不要」を押す。
   - 「判断済み N件」（`/判断済み \d+件/` の summary）を開き、その規則のカードの「関連候補の判断を変更」で「必要」を選ぶ。
   - 項目のダイアログが開き、名称が「天井耐震補強」。「追加する」で閉じる。
   - `getCountFixtures()` に「天井耐震補強」があり、`link` が `{ kind: 'factor', sources: [{ itemId: origin.id, factor: 1 }] }`（「追加する」と同じ自動の連動）。
2. **必要にしてダイアログを閉じても、後から追加できる:**
   - 「不要」→「判断済み」を開き「必要」を選ぶ → ダイアログの「閉じる」で閉じる。
   - そのカードの `data-decision` が「必要」で、「追加する」ボタンがある。項目は増えていない。
   - その「追加する」でダイアログが開き、追加すると「天井耐震補強」ができる。

カードは `[data-testid="related-suggestion"][data-rule-ids~="${rule.id}"]` で探す（判断済みの一覧の中にあるものを使う）。

既存の e2e `e2e/related-reviews.annotate.spec.ts` の「判断を変更 → 不要」は変えない。

## 受入条件・停止条件

- 関連提案を使わない普段の操作の性能は今と同じ（描画で増えるのはボタン1つの条件だけ）。
- 保存形式・データファイルを変えない。
- 戻し方: この段階のコミットの revert。

## 禁止事項

- `src/app/RelatedSuggestions.tsx` と新しい e2e 以外を変えない。外部通信・`https://` を含む文字列を足さない。git 操作をしない。試験を実行しない（Claude Code が実行する）。
