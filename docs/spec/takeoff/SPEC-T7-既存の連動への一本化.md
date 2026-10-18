# SPEC-T7: 「拾い範囲と関連数量」の別画面を廃止し、既存の「追加する」と連動へ一本化する

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol` / reasoning effort: `high`
- 選定理由: 既存の関連候補の追加・連動（FixtureLink）の判定を変える設計判断を伴うため。

## 利用者の指示（2026-10-18）

- 「拾い範囲と関連数量」という新しい項目・画面は不要。**無駄な構成はなくす**。
- 入力は原則として選択式、基本は自動。自由記入は正しく拾うのに欠かせない最低限だけ。
- 例: 軽量鉄骨壁下地（線＋高さ）から墨出しを追加したら、**線の長さ × 帯幅1m** の面積が自動で出る（面で拾った壁なら底辺の長さ）。壁の面積を写さない。

## 現状（変更前の状態）

- 拾い範囲の画面・保存（KaruTakeoffScopes）・Excel シートは **撤去済み**（Claude が改修前の状態へ戻した）。
- `src/app/RuleScopeBlock.tsx` は撤去した `./takeoffSession` を参照していて型エラー。
- `src/app/takeoffModel.ts` に `loadTakeoffMaster`（949定義本体）と `loadRuleScopes`（拾う対象）。アプリからは `loadRuleScopes` だけ使う。
- 「追加する」の連動の判定 `relatedAdditionKind(origin, target, routeId)`（`AnnotationStore.ts`）は、面で拾った項目（polygon・lengthHeight）から面積の項目へ **係数1で面積を写す（'factor'）**。墨出し等ではこれが誤り（原本 Excel は「壁の下地面積・両面仕上面積の転記」を禁止）。

## 作るもの・変えるもの

### 1. 候補カードの「拾う対象」（`RuleScopeBlock.tsx` を作り直し、`RelatedSuggestions.tsx` に最小の追加）

- 表示は2行だけ: 「拾う対象：…」「関連元との違い：…」。「範囲の詳しい説明」（含めない・分け方）は details に折りたたむ。数量の定義の名称の列挙・ボタンは出さない。
- `loadRuleScopes()` で初回表示のときだけ読む。カードの kind が note のときは出さない。
- `takeoffModel.ts` は `loadRuleScopes` だけにし、`loadTakeoffMaster` を削除（試験 `tests/takeoff.lazyLoad.test.ts` も合わせる）。

### 2. 範囲の分類で連動を選ぶ（`src/app/relatedLinkRules.ts` 新規の純粋関数＋既存の追加の流れへ接続）

```ts
export type ScopeLinkPlan =
  | { kind: 'existing' }                                   // 今までどおり relatedAdditionKind に任せる
  | { kind: 'none'; reason: string }                       // 連動しない（項目だけ作り、図面で拾う）
  | { kind: 'link'; link: FixtureLink; note: string }      // この連動を付ける
export function scopeLinkPlan(input: {
  classId: string | undefined          // ruleScopes.rules[ruleId].classId
  optionId?: string                    // 墨出し等の範囲分岐（既定は下の表）
  origin: CountFixture
  target: CountFixture
}): ScopeLinkPlan
```

| 分類（classId） | 関連元の拾い方 | 連動 |
|---|---|---|
| MARK（墨出し）・範囲分岐 M-WALL（関連元の名称に「壁」を含むときの既定） | lengthHeight・polyline | `{ kind: 'shape', shape: { output: 'lengthTimesHeight', heightM: 1 }, sources: [origin] }`（線の長さ × 帯幅1m。note「壁の線の長さ × 帯幅1m（国交省 数量基準 第7編 PDF49頁）。両側に墨を出す場合は係数を2に」） |
| MARK・M-WALL | polygon | 同じ shape に `lengthBasis: 'baseEdge'` を足す（§3）。底辺 × 1m |
| MARK・建具（関連元の名称に「建具」「扉」「窓」を含む、M-DOOR） | 開口を持つ項目 | `{ kind: 'factor', sources: [{ itemId: origin.id, factorFrom: 'openingArea' }] }` |
| MARK のそれ以外（新築・内装全面・外壁・防水等） | 全部 | none（「床・改修範囲を図面で拾ってください」） |
| PROTECT・PROTECT_ACTUAL・SCAFFOLD・CRACK・DEFECT_POINT・PATCH・OPENING・PLAN・PROPERTY・MATERIAL・WALL_FRAME・CEILING_FRAME・RECORD・BRANCH・VOLUME・WASTE・CONTACT | 全部 | none（関連元から数量が決まらない。今の係数1の写しを付けない） |
| JOINT・BASEBOARD・CORNER | polygon | `{ kind: 'shape', shape: { output: 'perimeter' }, sources: [origin] }`（外周） |
| UPSTAND | polygon | `{ kind: 'shape', shape: { output: 'lengthTimesHeight' }, sources: [origin] }`（外周 × 高さ。高さ未設定は既存の警告で入力を促す） |
| SURFACE・AREA・EXIST_FACE・FLOOR・ROOF・CEILING_FINISH・INNER・WALL_FINISH・CAVITY | polygon・lengthHeight | existing（同じ面の別作業・撤去・仕上げは面積の写しが正しい） |
| POINT・EXIST_POINT・SET・SUPPORT・WORK_POINT・ENDPOINT | click | existing（構成要素・個数の連動） |
| ROUTE・UNIQUE_ROUTE・FILTER_ROUTE・LINE | polyline | existing（経路に入れる） |
| 上に無い・classId 不明 | — | existing |

- 判定は「既存の追加」の入口で使う: 候補カードの「追加する」で項目を作った直後に連動を付けている所（`applyRelatedAdditions`・`relatedAdditionKind` を呼ぶ所）で、ルールの classId を渡して `scopeLinkPlan` を先に見る。`none` なら連動を付けずに項目だけ作る（利用者は図面で拾う）。`link` ならその連動を付ける（1つの Undo 単位。既存の applyRelatedAdditions と同じ扱い）。`existing` なら今のまま。
- カードの「連動にする」ボタンも同じ判定。`none` のときは出さない。
- 付けた連動は既存の連動の画面でそのまま見え、係数（両側＝2）・補正値（override）を既存の操作で変えられる。**新しい入力欄は作らない。**

### 3. 図形連動の底辺（`src/core/fixtureLink.ts`）

- `FixtureLink.shape` に省略可能な `lengthBasis?: 'perimeter' | 'baseEdge'` を足す（検証・保存・複製の既存の箇所も）。
- `lengthTimesHeight` で関連元が polygon / polygonDepth のとき: `lengthBasis === 'baseEdge'` なら、ほぼ水平（傾き10°以内）の辺のうち最も長い辺の長さ、無ければ警告を出して外周。省略時は今のまま外周。
- 連動の説明（note）に「底辺 ○m × 1m」のように出す。

## 試験

- vitest `tests/relatedLinkRules.test.ts`: 表の各行（壁 lengthHeight → 墨出し M-WALL は shape lengthTimesHeight heightM=1、壁 polygon → baseEdge、建具 → openingArea、墨出し新築 → none、養生 → none、床仕上げ polygon → 幅木 perimeter、床仕上げ → 床撤去 existing、classId 不明 → existing）。
- vitest（既存の fixtureLink の試験の書き方）: lengthTimesHeight＋heightM=1 で線10m → 10㎡、polygon の baseEdge（長方形 12.5×3 → 12.5㎡）、lengthBasis の検証・往復。
- e2e `e2e/related-mark-link.annotate.spec.ts`（既存の関連候補の e2e の書き方と helpers）: 壁（線＋高さ 3.6m、線の長さが分かる図）を登録 → 墨出しのカードに「拾う対象」「関連元との違い」 → 「追加する」で墨出しの項目ができ、その数量が **線の長さ × 1m**（壁の面積ではない）になる。
- 既存の関連候補の e2e（related-*.annotate.spec.ts）が通ること。

## 守ること

- 既存の追加・判断・経路・構成要素の動作は、表で none / link にした分類以外は変えない。
- 関連元の面積を表で認めた分類以外へ写さない。固定倍率・既定値で補わない（帯幅1m は原本 Excel の根拠のある値）。
- 新しい保存キー・新しい画面・新しい自由記入欄を作らない。
