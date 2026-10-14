# SPEC-R1: 関連品目の提案（最小実装）

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 新しいモジュールの設計と、既存の登録経路・画面への接続を伴うため既定の sol-high。

---

## 目的

数量拾いの項目を登録したとき、ルール（`src/core/related/rules.ts`、642件、Claude が精査して作成済み）から関連品目・確認事項を控えめに提案する。勝手に数量や項目を足さない。この段階の判断・案件区分・品目作業はメモリ内だけ（保存は R2）。
背景: 非公開の調査資料 の §3 と §7。

## 既にあるもの（変更しない）

- `src/core/related/types.ts` — データの型（RelatedRule、RelatedOrigin、RelatedOriginMatch、RelatedTarget、ProjectMode、WorkType、PROJECT_MODES、WORK_TYPES）。**変更しない**（足りない型は新しいファイルに書く）
- `src/core/related/rules.ts` — `RELATED_RULES`（642件）、`RELATED_RULES_VERSION`、`RELATED_REF_DOCUMENTS`。**内容を変えない**。約350KB なので、必ず動的 `import()` で読み、起動時のバンドルに入れない

## 作るもの・変えるもの

1. 新規 `src/core/related/suggest.ts`（純粋関数。React・ストアに依存しない）
   - `buildRelatedIndex(rules)`: 分野（book）ごとに、分類・名称・内訳書の科目からルールを引く索引と、文脈ルール（`origin.context`）の一覧を作る。
   - `suggestRelated(input): RelatedSuggestion[]`。input:
     `{ index, fixtures: readonly CountFixture[], originIds: readonly string[], projectMode?: ProjectMode, works: Readonly<Record<string, WorkType>>, decisions: Readonly<Record<string, RelatedDecision>>, resolveTarget(target, book) }`
   - 起点の照合（`origin.any` のどれか1つの条件の組がすべて当たる）:
     - `categories` は `fixture.category`、`names` は `fixture.name`（完全一致）、`subjects` は `fixture.breakdown?.subject`、`works` は `works[fixture.id]`、`modes` は `projectMode`。
     - 項目の分野は `fixture.breakdown?.book`。無い場合は全分野のルールを照合してよい。
     - **名称の部分一致を使わない。**
   - 工事区分: ルールの `modes` に `projectMode` が含まれるときだけ出す。`projectMode` が `'混在'` なら区分を問わない。**未設定なら出すが、状態に「工事区分が未設定」を付ける**（推測で必須にしない）。
   - 品目作業: `works` 条件のあるルールは、その項目の品目作業が設定され一致したときだけ出す。品目作業が未設定で、案件区分が改修・撤去・解体・混在のときは、提案とは別に「品目作業を選ぶと関連の候補が増えます」という案内を1件返す（`kind: 'hint'`）。
   - 文脈ルール（`origin.context`）は `suggestRelated` では返さず、別の関数 `contextChecks({ index, projectMode, decisions })` で、案件区分が `context` に含まれるとき（混在は全部）返す。
   - 提案（`RelatedSuggestion`）: `{ key, kind: 'item' | 'check' | 'hint', ruleIds, originFixtureIds, book, priority, targets（解決済みの品目一覧の候補）, questions, notes, refs, flags: { modeUnknown?, registered?, unresolved? }, decision? }`。
   - 集約: 拾い候補は提案先（targets を `分類/名称` で並べた文字列）＋起点の品目作業で1件にまとめ、`ruleIds`・`originFixtureIds`・`questions` を集める。確認事項はルールIDで1件。
   - 登録済み: 提案先に名称があり、`fixtures` に同じ分類・同じ名称の項目がある → `registered`。分類だけの提案先は、その分類の項目があれば `registered`（件数を持つ）。
   - 並び: 判断済みを除く → 優先度（高→中）→ 拾い候補→確認事項 → ルールIDの順。
   - 判断（`RelatedDecision`）: `'必要' | '不要' | '単価包含' | '他工事' | '後で確認' | '構成要素で拾う'`。`decisions[key]` があるものは結果に含めるが `decision` を付け、未判断と分けられるようにする。
   - `resolveTarget` は呼び出し側が渡す（品目一覧 `catalogItems()` を使う解決。`suggest.ts` から `catalog.ts` を import しない）。解決できない提案先は `flags.unresolved`。
2. 新規 `src/app/relatedModel.ts`（遅延読込の入口）
   - `loadRelated()`: `import('../core/related/rules')` と `import('../core/catalog')` を読み、索引と `resolveTarget`（`catalogItems()` から 分野＝book（建築は「建築」と「仮設・土工」）・分類・名称で探す）を一度だけ作って返す（Promise を保持）。
3. 新規 `src/app/RelatedSuggestions.tsx`（数量パネルの中の区画。`React.lazy` で読む）
   - props: `{ store, fixtures（スナップショット）, originIds, onClearOrigins, onOpenMaster(query: string), onSelectFixture(id) }`。
   - 表示:
     - 見出し「関連の候補 n件」。`originIds` があればその項目（直前に登録した項目）について、無ければ選択中の項目について出す。
     - 初期は未判断の上位5件。「すべて見る」で全件、「閉じる」で `onClearOrigins`。モーダルにしない。
     - 各候補: 提案品目（targets の名称、無ければ元の関連提案品目の原文）、質問、拾い候補／確認事項の別、優先度、根拠（記号と `RELATED_REF_DOCUMENTS` の資料名）、「工事区分が未設定」等の注記、Claude の要点（`notes`）、起点の項目名。
     - 「登録済み」の候補は既定で畳む。
     - 文言の注意: 「提案は拾い漏れの確認用です。別途計上の根拠ではありません」を区画の下に小さく出す。
   - 判断ボタン: 拾い候補は「追加する」「不要」「単価包含」「他工事」「後で確認」。E-039 の候補だけ「構成要素で拾う」も出す。確認事項は「確認した」「不要」「後で確認」（「確認した」は `'必要'` として記録し、項目は作らない）。
   - 「追加する」: `onOpenMaster(提案先の名称、名称が無ければ分類)` を呼ぶだけ（既存の標準マスタの画面を検索語つきで開く。項目の追加は利用者がその画面で行う）。判断は `'必要'` として記録。
   - 判断は R1 ではコンポーネントの外のメモリ（数量パネルの state でよい。文書ごと）に持つ。
   - 案件区分の選択（新築／改修／撤去／解体／混在／未設定）と、選択中の項目の品目作業の選択をこの区画に置く（R1 はメモリ内、文書ごと）。
   - 案件区分を選んだら、`contextChecks` の確認事項を「案件の確認事項 n件」として折りたたみで出す（同じ判断ボタン）。
4. `src/app/FixturePanel.tsx`（最小の変更）
   - `addMany()` と `saveFixture()` の、新しい項目を足した直後に、足した項目のIDを `originIds` に入れる（編集の保存では入れない）。
   - 選択中の項目の表示の下に `RelatedSuggestions` を置く（`Suspense`）。`onOpenMaster(query)` は既存の「標準マスタから追加」と同じダイアログを `initialQuery` つきで開く。
   - 判断・案件区分・品目作業のメモリ内の state は `session`（文書）ごとに分ける（タブを切り替えて混ざらない）。
5. `src/app/FixturePresetDialog.tsx`
   - 省略可能な prop `initialQuery?: string` を足し、検索欄 `query` の初期値にする。それ以外は変えない。
6. 計数器: `perfTime('related.suggest', ...)`、`perfCount('related.panel.render')`（`src/perf/counters.ts`）。

## 試験

`tests/related.suggest.test.ts`（実データ `RELATED_RULES` と実際の `catalogItems()` を使う。項目は `catalogItems()` の品目から作る）:
1. 【電気／新築】分類「配線器具」の項目（例: コンセント）→ ボックス類（拾い候補）、プレートの単価包含（確認事項）、電線管・ケーブル（拾い候補）が出る。入力の項目一覧は変わらない（freeze した入力で例外にならない）。
2. 【電気／改修】名称「分電盤」＋品目作業「更新・交換」＋案件区分「改修」→ 盤撤去（拾い候補、E-094）、仮設分電盤・切替（確認事項、E-095）が出る。品目作業が未設定なら E-094 は出ず、hint が1件出る。案件区分が未設定なら出る提案に `modeUnknown`。
3. 【機械／新築】給水管（分類「配管（給水・給湯）」）→ 弁類・保温・試験（確認事項）。保温は M-010 と M-090 が1件に集約され、`ruleIds` に両方。管継手は出ない。
4. 【機械／改修】パッケージ形空気調和機＋更新・交換＋改修 → 機器撤去（M-155）・配管分岐閉塞（M-157）・冷媒回収（確認事項 M-158）・再調整（確認事項 M-160）。冷媒回収は `kind: 'check'`。
5. 【建築／改修】内訳書の科目「防水改修」の項目（例: 防水層撤去 or 改修の アスファルト防水）＋案件区分「改修」→ B-140〜B-145・B-X01 の候補と、B-148（確認事項）。
6. 【建築／解体】`contextChecks` に案件区分「解体」→ B-252（石綿事前調査）・B-254（分別解体）が確認事項として出る。`suggestRelated` には文脈ルールが出ない。
7. 【共通】同じ分類・名称の項目が既にある → `registered`。案件区分「新築」で改修だけのルールは出ない。「混在」では出る。名称だけ似た項目（例: 名称「仮設金物」）は起点にならない。判断した候補は `decision` 付きで未判断の数に入らない。
8. 全ルールの提案先が `resolveTarget` で解決できる（`unresolved` が0件）こと。

`e2e/related-suggestions.annotate.spec.ts`: 既存の e2e（`window.__karu.addFixturePresets` や標準マスタの画面）の作り方にならい、配線器具の項目を追加 → 「関連の候補」が出る → 「不要」で消える → 「追加する」で標準マスタの画面が検索語つきで開く → 集計表の数量合計が変わらない → 保存して開き直しても既存の項目・数量が同じ。

## 受入条件

- 上の試験、既存の単体試験全件、関係する e2e（count-fixtures、quantity-table、quantity-master、fixture-panel-layout、linked-fixtures）が合格。
- `rules.ts` が起動時のバンドルに入らない（`npm run build` の出力で、rules の内容が初期チャンクに無いこと。報告に書く）。
- 性能: `related.suggest` は項目の登録時と区画の再表示時だけで、印の追加・選択・スクロールでは呼ばれない（呼ばれても選択1回の評価がメモ化で再計算されないこと）。
- `npm run audit:network` で未承認 0。

## 停止条件・戻し方

- 既存の数量・集計・保存の結果が変わったら停止して報告。戻し方はこの段階のコミットの revert。

## 禁止事項

- `rules.ts`・`types.ts`、既存の品目一覧・内訳書マスター・`linkRules.ts`・数量の計算・保存形式を変えない。
- 名称の部分一致で照合しない。架空の項目・内訳行・単位を作らない。提案から直接 `setCountFixtures` で項目を足さない（必ず標準マスタの画面を経由）。
- 提案の評価を描画・スクロール・印の追加の経路に入れない。外部通信を足さない。https:// を含む文字列を足さない。
