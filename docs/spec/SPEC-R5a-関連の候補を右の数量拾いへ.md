# SPEC-R5a: 関連の候補を右の「数量拾い」へ移し、選択済み・追加するを揃える

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 複数画面（左右のパネル・App のダイアログ）にまたがる移設と、提案データの型変更・集計の件数の扱いの判断を伴うため既定の sol-high。

---

## 背景（試用版 related1 の利用者の意見、2026-10-14）

1. 関連の候補が左の数量拾いの中にあって見にくい。**右側の「数量拾い」（書式パネル、`FormatPanel` の数量拾いの表示）に出したい。**
2. **選択している項目について**関連するものを出したい。
3. **すでに項目があるもの（登録済み）は「選択済み」と表示**したい。
4. 「確認した」しか押せない候補が多く、意味がない。**「追加する」のある表示にしたい。標準マスタに無いものは項目を作成したい。**

Claude がルールのデータを変更済み（このコミットに含む）:

- `src/core/related/types.ts`: `RelatedRule.kind` に `'note'`（計上しない・単価に含む等の注意。判断は不要）を追加。`RelatedCreate { name; unit: '式' | 'か所' | 'm' | '㎡' }` と `RelatedRule.create?`（kind が check のとき、項目を作る初期値）を追加。
- `src/core/related/rules.ts`: 642件のうち note 58件、check 284件（すべて create あり）、item 300件。版 `2026-10-14`。

## 対象

- `src/core/related/suggest.ts`
- `src/app/RelatedSuggestions.tsx`
- `src/app/FormatPanel.tsx`
- `src/app/FixturePanel.tsx`（関連の候補の表示を外す）
- `src/app/documentModel.ts`（`FixtureUiContext` の型）
- `src/App.tsx`（標準マスタ・新しい項目のダイアログを右のパネルから開く）
- `src/app/relatedReviewList.ts`、`src/app/relatedReviewRows.ts`、`src/app/relatedXlsx.ts`
- `src/styles.css`
- 試験の追加・修正

`rules.ts`・`types.ts`・`reviews.ts`（保存形式）は変えない。

## 変更内容

### 1. 提案の計算（`suggest.ts`）

- `RelatedSuggestion.kind` を `'item' | 'check' | 'note' | 'hint'` にする。キーは item は今と同じ、check は `check:${rule.id}`、note は `note:${rule.id}`。案件区分の確認事項（`contextChecks`）もルールの kind を使う（note は note）。
- `RelatedSuggestion` に `create?: RelatedCreate` を足す（check のルールの `create` を写す。集約は無いので1件）。
- check の「選択済み」: 文書の項目に `name === create.name` のものがあれば `flags.registered = true`、`registeredCount` はその件数。item は今と同じ（分類・名称の一致）。note は登録の判定をしない。
- 並び（`withRelatedDecisions`）の種類の順位: item 0、check 1、note 2、hint 3。そのほかは今と同じ。

### 2. 未判断の数え方・一覧・Excel

- `relatedReviewList` は note を入れない（未判断・後で確認の件数に入らない）。
- **未判断の件数・未判断一覧から、選択済み（`flags.registered`）で判断の無いものを除く**（項目があるので判断を求めない）。右のパネル・集計表の上部の「関連候補：未判断 n件」とも同じ数え方。
- Excel（`buildRelatedReviewRows` / `relatedReviewSheet`）:
  - `RelatedReviewRow.status` に `'選択済み'` と `'注意'`、`kind` に `'注意'` を足す。
  - 判断の無い選択済みは status `選択済み`。
  - note は、文書の提案（起点の項目の評価と案件区分の確認事項）から重複を除いて、status `注意`・kind `注意` の行で最後に出す。
  - 並びは 未判断 → 後で確認 → 判断済み → 選択済み → 注意。
  - 関連の機能を使っていない文書で別シートを出さないこと（R3）は変えない。

### 3. 表示の場所

- **`FixturePanel` から `RelatedSuggestions` の表示を外す**。項目の登録で `relatedSessionMemory(session).update({ originIds, closed: false })` するのは残す（機能を使った合図）。
- **`FormatPanel` の数量拾いの表示（`target === 'count'` の分岐）で、「項目を編集…」のボタンの直後に `RelatedSuggestions`（今と同じく `lazy` と `Suspense`）を出す**。対象は、そのパネルに出ている項目 `fixture`（選択中の印の項目、または一覧で選んだ項目）。`fixture` が無いときは出さない。
- `FormatPanel` は `session` を持たないので、`relatedSessionMemory` のキーは `store`（`AnnotationStore`）に変えてよい（`FixturePanel` も同じキーを使う）。
- **評価するのは表示中の項目1件だけ**（`originIds` の集約はやめる）。登録した直後は、登録した項目のうち最初の1件が選ばれる（今と同じ）。

### 4. 右のパネルでの表示

幅の狭いパネル（約 250px。利用者が広げられる）に合わせる。

- 見出し `<details>`「関連の候補 n件」（n は判断の無い・選択済みでない item と check の件数）。
- 開閉は R2b の起動条件を守る。使っていないときは「関連の候補（開くと確認します）」で閉じ、ルールを読まない。
- 一度開いたら、ほかの項目を選んでも開いたまま。閉じたら閉じたまま（セッションのメモリ `closed`）。
- 登録した直後と、案件区分・判断がある文書は開いた状態。
- 開いた中の順:
  1. 案件区分（`関連提案の案件区分`）と、この項目の品目作業（`関連提案の品目作業`）。1行ずつ。
  2. 候補のカード: 判断の無いもの → 選択済み（**見出しに「選択済み」の印、薄い表示**、判断のボタンは出さない） → 判断済み（`<details>`「判断済み n件」）。「すべて見る」（5件より多いとき）は今と同じ。
  3. note: `<details>`「注意 n件」。カードは名称と質問の1行だけ。判断のボタンは出さない。
  4. `<details>`「案件の確認事項 n件」（案件区分があるとき。今と同じ）。
  5. `<details>`「未判断一覧」（文書全体。今と同じ。開いたときだけ評価）。
  6. 注記「提案は拾い漏れの確認用です。別途計上の根拠ではありません」。
- カードの判断（判断が無く、選択済みでないとき）:
  - 1行目のボタン: **「追加する」**「不要」「後で確認」。
  - 2行目: `<select aria-label="ほかの判断">`。先頭は「ほかの判断…」。
    - item の選択肢: 単価包含・他工事・構成要素で拾う（E-039 のときだけ。R5b で広げる）。
    - check の選択肢: 確認した（判断は `必要`）・単価包含・他工事。
    - 選ぶとその判断を記録する。他工事は今と同じく担当を選んでから記録する。
  - 「追加する」は判断 `必要` を記録して、次を開く:
    - item で提案先が標準マスタにある（`flags.unresolved` でない）: 標準マスタから追加（`initialQuery` は今と同じ `targetQuery`）。
    - item で解決できない、または check: **新しい項目のダイアログ（`FixtureDialog`、新規）**。初期値は次のとおり（利用者が直して保存する）:
      - 名称: check は `create.name`、item は `targets[0].name ?? targetTexts[0]`
      - 分類: 表示中の項目の分類
      - 単位 `式`・`か所` → 個数（`kind` 無し、`unit` にその単位）
      - `m` → `kind: 'length'`・`method: 'polyline'`
      - `㎡` → `kind: 'area'`・`method: 'polygon'`
      - 単位が無い（item の未解決）ときは個数・`unit` 無し
      - 色・形は「項目を追加」と同じ作り方（`nextCountStyle`・次の `order`）
- 判断済みのカードの表示・変更・取消・担当の変更は今と同じ。
- 「詳しく」の中の起点のボタンは、右のパネルでは表示中の項目なので出さなくてよい。未判断一覧の中では今と同じ。
- data 属性（`data-testid="related-suggestions"`・`related-suggestion`・`data-rule-ids`・`data-decision`・`data-related-kind`・`data-related-key`）は残す。
  - 選択済みのカードに `data-registered="true"` を足す。
  - note のカードは `data-related-kind="note"`。
- CSS: `.format-panel` の中で、カードが横にはみ出さない。ボタンは折り返す。文字は 12〜13px 程度。

### 5. ダイアログを開く経路（`FixtureUiContext`）

右のパネルから、左の数量パネルが出ていなくても開けるようにする。

- `FixtureUiContext` の値に次を足す。App が実装する。
  - `addFromMaster(query: string): void`
  - `createFixture(initial: CountFixture): void`
- App は今の「項目の編集」（`fixtureEdit`）と同じ並びで、作業中の文書（`active`）について描画する:
  - `FixturePresetDialog`（`initialQuery`）
  - `FixtureDialog`（新規。`editing` なし）
- 追加・保存の処理は `FixturePanel` の `addMany` / `saveFixture`（新規）と同じ結果にする:
  - `appendFixtures`
  - `setCountFixtures`
  - 最初に追加した項目を `selectFixture`
  - `relatedSessionMemory(store).update({ originIds, closed: false })`
  - 連動の項目なら `setRouteTemplate(null)`
- 重複を避けるため、共通の関数（例 `src/app/fixtureAdd.ts`）に切り出してもよい。`FixturePanel` の今の動作は変えない。
- 編集が許されない文書（`editRestriction` 等、`FixturePanel` の `canEdit` と同じ条件）では、「追加する」を押せない。

## 試験

- 単体 `tests/related.suggest.test.ts`:
  - note の kind とキー（`note:`）。
  - check の `create` の写し。
  - check の選択済み（`create.name` と同名の項目があるとき）。
  - 種類の並び。
  - 既存の試験はデータの変更（note・create）に合わせて最小限直す（意図は変えない）。
- 単体 `tests/related.reviewList.test.ts`: note が一覧に入らない。判断の無い選択済みが未判断に数えられない。
- 単体 `tests/related.xlsx.test.ts`: `選択済み`・`注意` の行と並び。関連を使わないときシートが変わらない（既存）。
- e2e `e2e/related-suggestions.annotate.spec.ts`（既存を右のパネルに合わせて直す）:
  - 左の数量パネルに `related-suggestions` が無い。
  - 給水管を登録すると、右の `format-panel` の中に関連の候補が出る。
  - check の候補（例: 分類「電線管」の項目を登録したときの E-016「貫通スリーブ・箱入れ」。create のある check ならどれでもよい）で「追加する」を押すと、新しい項目のダイアログが開き、名称が `create.name` で入っている。
    - 保存するとその項目ができ、元の項目に戻るとそのカードが「選択済み」（`data-registered`）。
  - note が「注意」の中に出て、判断のボタンが無い。
  - R2b の性能の試験（使っていないときに選ぶだけでは評価しない）を、右のパネルで同じように確認する。
- e2e の `related-reviews`・`related-export` は、操作の場所の変更に合わせて最小限直す。
- 既存の数量関係の e2e（`fixture-panel-layout`・`breakdown-master`・`quantity-table`・`quantity-checks`）と単体試験全件が合格すること。

## 受入条件・停止条件

- 関連の機能を使っていない文書で、左右のパネルの表示・保存・Excel が R3 と同じ。項目を選ぶだけでルールを読まない（`?perf=1` の `related.suggest` が増えない）。
- 戻し方: この段階のコミットの revert。

## 禁止事項

- 数量・集計・保存形式（`KaruRelatedReviews`、`CountFixture`）を変えない。
- 自動で項目・数量を足さない（「追加する」はダイアログを開くだけ。保存は利用者）。
- 外部通信を足さない。`https://` を含む文字列を足さない。
- git 操作をしない。
