# SPEC-T4: 拾い範囲と関連数量 — 候補カードの拾う対象、拾い範囲の画面、Excel の参考／正式の出力

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 既存の候補カード・保存・出力へ接続しながら、業務の段階に沿った新しい画面を組む判断を伴うため既定の sol-high。

---

## 目的

統合実装指示書 §6〜§9・P3・P6 の画面と出力。日常の画面では「何を拾うか」「関連元と範囲がどう違うか」「次に何を入力するか」を先に出し、
ID・AST・JSON は「詳細」に置く。**「拾い対象へ追加」と「正式内訳へ採用」を別の操作にする。** 関連元の数量を関連先へ転記しない。

## 既にあるもの（変更しない・使う）

- `src/app/RelatedSuggestions.tsx`（候補カード。右の書式パネルの「関連の候補」区画）。既存の判断・追加する・経路に入れる 等の動作は変えない。
- T2a: `calculateFormula`・`calculateSchedule`・`calculateUnitMethod`・`UNIT_METHOD_SPECS`・`capabilities.ts`・`decimal.ts`（`roundForDisplay`）・`units.ts`。
- T2b: `loadTakeoffMaster()`・`loadRuleScopes()`（`src/app/takeoffModel.ts`）、`MasterView`、`evaluateReadiness`・`mergeFacts`・`SYSTEM_FACT_KEYS`、`runExternalValidators`、`buildCoverageLedger`。
- T3: `AnnotationStore` の `ensureTakeoff`・`takeoffReady`・`getTakeoffSnapshot`・`getTakeoffRevision`・`applyTakeoff`・`applyTakeoffBatch`・`getTakeoffFixtureRevision`・`getTakeoffFixtureMeasure`、`ensureSessionTakeoff`、`model.ts` の型・`findDuplicateScopes`・`findSharedCandidates`・`checkDependencies`・`candidateState`。
- `src/core/takeoff/ruleScopes.data.ts` の `definitionHeads`（定義の名称・単位・役割・範囲の分類。カードではこれだけ使い、949定義の本体は読まない）。

## 作るもの・変えるもの

### 1. 候補カードの「拾う対象」（`src/app/RuleScopeBlock.tsx` 新規、`RelatedSuggestions.tsx` に最小の追加）

- `RuleScopeBlock`（props: `ruleIds`, `originLabel?: string`, `onOpenTakeoff(context)`）を、kind が `note` でないカードの質問文の下に置く。
- 初めて表示されたときだけ `loadRuleScopes()` を呼ぶ（読込中は何も出さない。失敗したら「拾う対象の情報を読めませんでした」と小さく出して再試行ボタン）。
- 表示（ルールが複数なら最初のルール、残りは「ほか n件」の details）:
  - 「拾う対象：{target}」（1行目。日常で最初に見る）
  - 「関連元との違い：{difference}」
  - `<details><summary>範囲の詳しい説明</summary>` に「面・線・位置：{kind}」「分け方：{split}」「含めない：{exclude}」「単位・扱い：{unit}」「関連元の範囲：{originScope}」。
  - ルールの `definitions` があれば「数量の定義：保護管（m）、ケーブルラック（m）…」（`definitionHeads` の label・unit。役割が `親/確認記録` は「（子を選ぶ）」、`補助量/照査` は「（補助量）」、`未確定方式` は「（方式を選ぶ）」を付ける）。
  - 範囲分岐（`scopeOptions` の classId がルールの classId と同じもの）があれば「範囲の選び方：新築（国の数量基準）／防水改修／…」を details の中に。
- ボタン「拾い範囲に追加…」→ `onOpenTakeoff({ mode: 'create', ruleId, originFixtureId, definitionIds })`。**項目（CountFixture）を作らない・数量を作らない**。既存の「追加する」（項目を作る）とは別のボタンで、title 属性に「関連数量として範囲・方式・計測を管理します（数量は別に拾います）」。
- 編集できない文書（`canEditReviews` が false）ではボタンを無効。
- `RelatedSuggestions` の区画の見出しの横に「拾い範囲と関連数量」ボタン（一覧を開く）を足す。

### 2. 拾い範囲の画面（`src/app/TakeoffDialog.tsx` 新規、`React.lazy` で読む）

`RelatedSuggestions` から開く（文書ごとの状態。`relatedSessionMemory` と同じく session に紐づけた外部ストアに `{ open: boolean; context?: TakeoffOpenContext; selectedId?: string }` を持ち、パネルの再マウントで閉じない）。
モーダルの `<dialog>`（既存のダイアログと同じ作り。Esc で閉じる）。幅は画面の 90%・最大 1200px、狭い画面では一覧と詳細を縦に並べる。

開いたとき: `ensureSessionTakeoff(session, pool)` と `loadTakeoffMaster()`（読込中は「読み込み中…」）。
保存データが読めなかったとき（`state.unreadable.root`）: 「この PDF の拾い範囲の保存データを読めませんでした。元のデータは変更せずに保存し直します。」と出し、編集の操作を全部無効。`unreadable.instances` があれば件数を出す。

**左: 一覧**（`order` の順）
- 各行: 名称（instance.label）、関連元の項目名（origins の項目名。無ければ「関連元なし」）、単位、状態、参考数量（`roundForDisplay(result.value, 2)`。null は「—」）。
- 状態の表示（判定は §4 の `takeoffStatus`）: 「未入力」「参考値あり・要確認」「採用済み」「要再確認」「対象外（施工なし）」「施工の有無を確認」「方式を選ぶ」「子を選ぶ」「記録」「補助量」「孤立（関連元なし）」「入力が矛盾」「未対応の方式」。
- 重複の警告: `findDuplicateScopes` の群は行に「範囲が重複しています」（自動で統合・削除しない）。
- 絞り込み: すべて／要対応（未入力・要再確認・矛盾・孤立）／採用済み。

**作成（context.mode === 'create'）**: 一覧の上に「新しい拾い範囲」の枠を出す。
- ルールの拾う対象（§1 と同じ文）と、定義の候補（`view.definitionsForRule(ruleId)`。定義が無いルールは「このルールには数量の定義がありません。参考として別拾いの範囲だけを管理します」）。
- 定義を1つ選ぶ（ラジオ）。役割ごとの説明: 親「子の定義を選びます（親は数量を持ちません）」、記録「確認の記録だけです」、補助「補助量として保存し、正式な物量へ転記しません」、未確定「方式・単位を選ぶまで算定しません」。
- 範囲分岐（ルール・定義の classId に合う `scopeOptions`）があれば選ぶ（例: 墨出しの M-WALL「壁のみの新設・改修」→ 対象範囲・単位・含めない範囲を表示）。
- 既に同じ定義（又はルール）で範囲が同じ・未選択のインスタンスがある（`findSharedCandidates`）→「既存の拾い範囲『…』に関連元を足す（数量は加算しません）」と「別の範囲として追加」を選ばせる（SH17）。
- 「追加」→ `applyTakeoff({ id: newOperationId(), kind: 'create', payload: { ruleId, definitionId?, label: 定義の label（無ければルールの対象名）, unit: 定義の元単位（範囲分岐を選んだら分岐の単位、未確定は ''）, origin: { fixtureId, ruleId }, scope: { optionId? } } }, { projectId: newProjectId(), masterVersion: view.master.masterVersion })`。
  操作IDは画面のボタン押下ごとに1つ作り、同じ押下の再送では同じ ID を使う（二重押し対策。押下中はボタンを無効）。
- 作ったインスタンスを選択状態にする。**result は作らない**（CC26-01: 壁下地 20m2 から墨出しを選んでも 20m2 を保存しない）。

**右: 詳細**（タブ: 範囲 ／ 計測 ／ 照査 ／ 採用 ／ 詳細）。上部に1行で「次に入力すること：…」（§4 の `nextActions` の先頭3件）を常に出す。

- **範囲**:
  - 拾う対象・関連元との違い・含めない（定義の `scope`、定義が無ければルールの範囲）。
  - 施工の有無: 「必要（施工する）」「不要（施工しない）」「未確認」の3択＋根拠（`setFact`）。未確認のまま数量を作らない。不要は「対象外」として残す（削除しない）。
  - 範囲の欄（`TakeoffScope`）: 定義の `scope.kind` と classId に応じて**関係する欄だけ**出す（全部を一律必須にしない）:
    面・層が要る（WALL_FINISH, WALL_FRAME, CEILING_*, SURFACE, EXIST_FACE, FLOOR, PATCH, UPSTAND, BASEBOARD 等）→ 面側・層、
    経路（ROUTE, UNIQUE_ROUTE, FILTER_ROUTE, BRANCH, LINE, ENDPOINT, JOINT）→ 区間・平面/立上り、
    すべて → 階・部屋・工程・現物ID・範囲ID・仕様。分岐（optionId）。メモ。
    「保存」で `setScope`（採用済みなら要再確認へ戻る旨を確認ダイアログで出す）。
  - 関連元: 項目名の一覧（クリックで図面の項目を選ぶ `onSelectFixture`）、「関連元を外す」（`unlinkOrigin`。最後の1件でも拾い範囲は残る旨を表示）。
- **計測**（定義の役割と方式で出し分け。編集は画面内の下書きで、「計算して記録」で `applyTakeoffBatch([setMeasurement, recordResult])` を1回（1つの Undo 単位））:
  - 図面の項目から（mode `fixture`）: 同じ PDF の項目から選ぶ。候補は単位の次元が合うもの（`unitDimension(instance.unit)` と項目の kind: length↔m、area↔m2、volume↔m3、count↔同じ単位）。
    **関連元の項目は候補の末尾に「関連元（同一数量の確認が必要）」として出し、選んだら**: 定義の方式が `F_SAME` なら `same_object_scope_basis` の確認チェック（「同一現物・範囲・数量基準であることを確認した」）を要求、それ以外の方式・定義なしでは選べない（「関連元の数量を転記しません。図面で別に拾ってください」。CC26-01）。
    「図面で新しく拾う」→ 既存の `onCreateFixture(initial, context)`（名称＝instance.label、kind は単位の次元から）。作った項目は次に開いたとき候補の先頭。
    計算は `getTakeoffFixtureMeasure(fixtureId)` の値を F_MANUAL と同じに扱う（`{ value, input_unit: measure.unit, measurement_evidence_id: 'fixture:' + fixtureId }`）。単位が換算できなければ「入力が矛盾」。
  - 数値で入力（mode `manual`、F_MANUAL）: 値・単位・根拠（図面番号等。必須）。
  - 行で入力（mode `rows`）: 定義の方式（formula）の body 契約に合わせた表（列: F_WALL/F_UP は id・L・h、F_THICK/F_SAND は id・A・t、F_TRENCH は id・L・w・d、F_PIT は id・A・d、F_RECT は id・w・h・L、F_ROUND は id・D・L、F_SURFACE は id・A、F_SUBSET は id・value、F_UNIQUE/F_EDGE は id・value、F_COUNT は object_ids と調査完了、F_BACK は掘削量と控除の行、F_DIFF は A・B と同一基準の確認、F_MASS は値・単位質量・根拠、F_TON は kg、F_SAME は値と同一確認）。**控除・加算の欄は空のままにできない（0 を入れる）**。
  - 明細（mode `schedule`、定義に `detail` がある・ダクト・はつりの体積）: 明細の表（列は `detail.recordFields`、STEEL は mass_model を選ぶと必要な列だけ出す、FIRE は measured_area_m2 を足す）、上に basis_id・drawing_revision・schedule_id（ダクトは adopted_basis_id、はつり体積は quote_line_id）。数値の列は number として入れる。`view.scheduleSchema(def)` を `calculateSchedule` へ渡す。
  - 方式（mode `method`、未確定方式・はつり）: 方式の選択（`unresolved.methods` だけ。参照専用は「参照専用」として選べない）→ `setMethod`（単位も方式の単位へ）。方式の variables の入力欄と、方式固有の必須入力（`master.unitMethods[id].requiredInputs`）の入力欄（文字列。`*_ids` はカンマ区切りで配列）。はつりは HAT:NQ_COUNT（開口IDの一覧 → F_COUNT）、HAT:QUOTE_VOL（HATSURI_VOL の明細）、HAT:NO_WORK_RECORD（理由と根拠の記録だけ。数量なし）。
  - 親（ROUTER）: 子の定義（stages.children）の一覧と、子ごとの「この子を拾い範囲に追加」（create。親の関連元を引き継ぐ。**一段だけ**）。親に計測の欄は出さない。
  - 記録（RECORD_ONLY）: 確認の結果（applicable / not_applicable / needs_review）・理由・根拠・確認者を `setFacts` で（decision_result 等のキー）。計測の欄は出さない。
  - 手入力の補正（override）: 「補正値を入れる」→ 値・理由（必須）。計算値と別に保持し、自動で上書きしない（LC11）。
  - 計算の結果: 状態、未丸めの値（全桁）、表示（小数2桁）、内訳 steps、不足 missing（キー名ではなく `view.keyLabel(key)?.meaning` があればそれ）、矛盾 errors、注意 warnings、自動では確かめない照査条件 reviewConditions。
- **照査**:
  - 段階ごとの判定（`evaluateReadiness`）: 「数量の段階」「正式採用の段階」の状態と、不足・未確認・条件不一致の一覧。キーは `keyLabel(key).meaning`（type も小さく）で出し、**入力の段階**（下の表）ごとにまとめる。
    | 画面の段階 | キー（例） |
    |---|---|
    | 候補表示 | project_id, work_zone_id, project_mode, source_item_id, work_mode, source_revision |
    | 拾い開始 | definition_id, selected_method_id, target_unit, physical_object_id, scope_id, scope_kind, work_event_id, phase_id, specification(_id) |
    | 対象範囲 | surface_side, layer_id, segment_id, route_part, floor_id, room_id |
    | 計測 | document_id, document_revision, page_id, geometry_id, drawing_page_id, drawing_revision, scale_*, measurement_* |
    | 数量照査 | quantity_basis_id, basis_version, quantity_profile_review_id, scope_verified, quantity_basis_verified, rule_condition_verified 等 |
    | 明細入力 | detailed_quantity_*, records, mass_*, deduction_* |
    | 正式採用 | price_*, inclusion_state, allocation_*, billing_*, adoption_*, overlap_* |
    | 定義固有 | 上に無いキー |
  - 不足キーの入力欄（`setFacts`）: 型で出し分け（boolean は「はい／いいえ／未確認」の3択で未確認はキーを消す、string は1行、string[]/array は改行区切り、number は数値、object は JSON の textarea（JSON として読めなければ保存しない））。**SYSTEM_FACT_KEYS は入力欄を出さず「システムが照合」と表示**。
  - 定義固有の施工条件（`definition.checks`）: 文と「成立／不成立／未確認」＋根拠（`setCheckAnswer`）。
  - 重複・共用: 同じ範囲の重複の警告、関連元が複数（共用）であること、孤立の表示。
  - 依存の版: `checkDependencies` の結果。古いものがあれば「計測元が変わりました」と「再計算する」「要再確認にする（markStale）」ボタン。**自動で上書きしない。**
- **採用**（正式内訳）:
  - 費用の欄（`setBilling`）: 価格資料ID・年月地域・単価/見積行・価格の単位・包含（別計上／単価包含／他契約／重複／未確定）・担当契約・分担の根拠・版束・照査者・照査の根拠・担当（他工事のとき）。
  - 価格の単位と数量の単位が違う（`sameUnit` でない）→「価格接続を保留（換算の根拠が必要）」を表示し、数量の元値は保持（CC26-18）。
  - 包含・他契約 → 「別計上しません（物理数量は保持）」（CC26-19）。
  - 「正式内訳へ採用」: `evaluateReadiness({..., approvedForProject: true})` で他の条件を見て、`formalOutputBlockers` が空のときだけ押せる。押せないときは理由の一覧を出す（**欄が全部埋まっても、照査の結果・根拠・最新性がそろわなければ押せない**。CC26-17）。採用者名・採用の根拠（必須）を入れて `approve`。
  - 採用済み: 採用した値・単位・日時・採用者・根拠、「採用を取り消す」（revoke）。
  - 補助・親・記録・工数・方式未選択は、このタブに「正式内訳へは出しません（理由）」だけを出す。
- **詳細**（診断）: 定義ID・役割・原本の実行状態・算出方式・範囲の分類・品目ID案・既存ルール・原本の行（数量算定949対応!行 等）・パッチ・競合・必須キーの一覧・条件付き必須・段階条件（JSON）・入力した事実（JSON）・依存の版・履歴（新しい順。決定コードと前の値）・逆方向の照会（下）・次の関連候補（下）。

**次の関連候補（一段だけの再評価。指示書 §7）**
- 詳細タブと照査タブの下に「確認後の次の候補」: 施工の有無が「必要」で、範囲の scopeId か physicalObjectId が入っているときだけ出す。
- `definition.continuation.policy` が `CONFIRM_THEN_REEVALUATE` のとき、`nextRules` の既存ルール（`loadRelated()` の索引から）の提案先と拾う対象を出し、各行に「拾い範囲に追加」（利用者の操作でだけ create。親の範囲 phaseId/physicalObjectId を引き継ぐ）。
- 訪問キー（定義又はルール・physicalObjectId・scopeId・phaseId・マスターの版）で既にあるものは「追加済み」（循環防止。A→B→A で同じ対象・工程・版なら止まり、別対象なら追加できる。CC26-07）。
- STOP_* の方針は理由（`continuation.reason`）を出し、候補を出さない。
- 未確認（施工の有無が未確認）のインスタンスからは出さない（CC26-05）。
- 表示の上限は 30件（それ以上は「ほか n件」と「続きを表示」）。

**逆方向の照会（指示書 §7。数量式は反転しない）**
- 「この項目を関連先とするルール」: `loadRelated()` のルールで、提案先の名称（正規化）が instance.label と同じもの、又は definition.reverse.rootRules/candidateRules の分類名。各ルールの起点（originText）と、その起点に当たる項目が PDF にあるか（ある → 項目名、無い → 「この PDF に無い」）。**照会だけで、数量・インスタンスを作らない**（CC26-06）。

### 3. 事実の導出（`src/app/takeoffFacts.ts` 新規。画面と出力で共用する純粋関数）

```ts
export interface TakeoffFactContext {
  state: TakeoffDocState; instance: TakeoffInstance; definition?: MasterDefinition; view: MasterView
  fixtures: readonly CountFixture[]
  fixtureRevision(fixtureId: string): string | undefined
  fixtureMeasure(fixtureId: string): { value: number; unit: string; kind: string; markIds: string[]; pageIndexes: number[] } | undefined
  projectMode?: ProjectMode
  ruleModes?(ruleId: string): readonly string[] | undefined     // ルールの modes（新築/改修…）
  originMatches?(ruleId: string, fixtureId: string): boolean | undefined   // 分からなければ undefined
}
export function systemFacts(ctx: TakeoffFactContext): Record<string, unknown>
export function takeoffInputHash(instance: TakeoffInstance): string
export function computeTakeoff(ctx: TakeoffFactContext): { result: CalcResult; inputHash: string; dependencies: Record<string, string> }
export function takeoffStatus(ctx: TakeoffFactContext, readiness?: Readiness): TakeoffStatusLabel
export function nextActions(ctx: TakeoffFactContext, readiness?: Readiness): string[]
export function validatorContext(ctx: TakeoffFactContext, calc?: CalcResult): ValidatorContext
```

- `systemFacts` が入れるもの（**分からないものは入れない＝未確認**）: project_id（state.projectId）、source_item_id（最初の関連元）、source_revision（その版）、source_active（関連元の項目が全部ある）、origin_match（`originMatches` が boolean を返したときだけ）、work_mode（projectMode）、work_mode_match（projectMode とルールの modes。混在は true。未設定なら入れない）、quantity_definition_id（定義の schemaOverrides の const）、target_unit（instance.unit）、formula_id・formula_revision・formula_supported（能力表）、measurement_input_mode（fixture → `geometry`、それ以外の計測 → `manual_schedule`、none → 入れない）、measurement_revision（inputHash）、uses_geometry（fixture のとき true、それ以外 false）、uses_source_quantity（F_SAME で関連元を使ったとき true、それ以外 false）、geometry_id・drawing_page_id・drawing_revision・coordinate_frame_id（'pdf-user-space'）・selected_geometry_ids（fixture の印）、geometry_topology_verified（fixture の印の値がすべて有限で 0 より大きいとき true、それ以外は入れない）、source_quantity_ids・source_current・source_not_orphaned・dependency_acyclic（F_SAME の関連元を使ったときだけ。依存の版と存在から）、detailed_quantity_profile_id（定義の detail.format）・detailed_quantity_schedule_id（明細の schedule_id）、selected_method_id（instance.methodId）、price_compatible（billing.priceUnit があり instance.unit と sameUnit）、overlap_resolved（重複群に入っていない かつ billing.inclusion が `unresolved`・`duplicate` 以外のとき true）。
- `computeTakeoff`: 役割・方式で T2a の関数を呼ぶ。親・記録 → NO_QUANTITY、定義なし（ルールだけ）→ 計測が manual/fixture なら F_MANUAL、それ以外は INPUT_REQUIRED。`dependencies` に 'fixture:<id>'（計測元と関連元）・'master'（masterVersion）・'engine'（ENGINE_REVISION）。
- `takeoffStatus` の優先: 読めない → 「読めない」、孤立 → 「孤立」、fact false → 「対象外」、親 → 「子を選ぶ」、記録 → 「記録」、未確定で方式なし → 「方式を選ぶ」、fact unknown → 「施工の有無を確認」、stale → 「要再確認」、採用済み → 「採用済み」、result INVALID → 「入力が矛盾」、UNSUPPORTED → 「未対応の方式」、CALCULATED → 補助なら「補助量」それ以外は「参考値あり・要確認」、それ以外 → 「未入力」。

### 4. Excel の出力（`src/app/takeoffXlsx.ts` 新規、`quantityXlsx.ts`・`QuantityTable.tsx` に最小の追加）

- 新しいシート「拾い範囲と関連数量」を、**拾い範囲が1件以上あるときだけ** 足す（既存のシート・列・関連候補のシートは変えない。CC26-32: 既存の手動数量の出力を止めない）。
- 列: 番号、定義ID、項目、関連元の項目、拾う範囲（範囲の欄をまとめた文）、単位、参考数量（未丸め。文字列のまま）、計算の状態、不足・理由（先頭3件）、採用の状態、**正式数量**（formalOutputAllowed のときだけ承認時の値。それ以外は空欄）、包含・担当、価格資料、要再確認、役割（数量候補／補助量／親／記録／工数）。
- 参考数量と正式数量を別の列にし、**参考値が正式数量の列へ混ざらない**。補助量・親・記録は正式数量を常に空欄。
- `QuantityTable` の出力ボタン: `store.takeoffReady` で拾い範囲が1件以上ならマスターを読み（`loadTakeoffMaster()`）、行を作って `quantityWorkbookSheets` へ渡す。未使用の文書では読まない。

### 5. スタイル

- 既存の `related-*` の CSS の書き方に合わせ、`takeoff-*` のクラスを `src/app/QuantityChecks.css` の末尾（又は新しい CSS を TakeoffDialog から import）に足す。状態の表示は色だけに頼らず文字で出す。

## 試験

1. vitest `tests/takeoff.facts.test.ts`: systemFacts（分からないものは入れない、SYSTEM_FACT_KEYS は利用者入力を上書き）、computeTakeoff（墨出しの定義なしインスタンスで関連元の項目を計測元に選べない、F_MANUAL、明細、方式、親・記録は NO_QUANTITY）、takeoffStatus の優先順、nextActions。
2. vitest `tests/takeoff.xlsx.test.ts`: 拾い範囲なし → シートを足さない・既存シートが同じ（CC26-32）、参考値だけ → 正式数量の列は空欄、採用済みで条件がそろう → 正式数量に値、補助量は値があっても正式数量は空欄、包含は「単価包含」と表示し参考数量は残る。
3. Playwright `e2e/takeoff-scope.annotate.spec.ts`（既存の `e2e/related-*.annotate.spec.ts` の書き方と helpers を使う。独自の試験枠を作らない）:
   - 壁下地（建築・壁の品目。既存の e2e で使う項目でよい）を登録 → 関連の候補の「墨出し」のカードに「拾う対象」と「関連元との違い」が出る → 「拾い範囲に追加…」→ 範囲分岐「壁のみ」を選んで追加 → 一覧に「未入力」で出て参考数量は「—」（壁の面積を転記しない。CC26-01）。
   - 計測で関連元（壁下地）の項目を選べない旨が出る。数値で入力（10 ㎡、根拠 TEST）→ 参考値 10、状態「参考値あり・要確認」、「正式内訳へ採用」は押せず理由が出る。
   - 上書き保存 → 再読込 → 一覧に同じ値が残る。保存直後に未保存の印が出ない（CC26-28）。
   - Ctrl+Z で計測が戻り、Ctrl+Y でやり直せる（CC26-26）。
   - 機能を使わない既存の e2e（関連候補・数量）が通ること（既存の試験を変えない）。

## 守ること

- 既存の候補カードの判断・追加・経路・構成要素の動作を変えない。既存の e2e のセレクタ（`data-testid="related-suggestion"` 等）を壊さない。
- 拾い範囲の画面・マスターは、使われるまで読まない（PDF を開く・描画・候補の索引だけでは読まない。カードの拾う対象は ruleScopes だけ）。
- 関連元の数量を関連先の result に入れない。補助量・親・記録を正式数量へ出さない。0・式1・既定値で埋めない。
- 文言は日本語で、利用者が次に何をすればよいか分かる文にする。技術的な ID は「詳細」に置く。
