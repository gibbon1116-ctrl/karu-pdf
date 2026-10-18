# SPEC-T3: 拾い範囲と関連数量 — 保存モデル・変更追従・共用・Undo（ストアと保存への接続）

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 保存形式の新設・移行・Undo・二重操作防止という壊れると数量が失われる部分のため既定の sol-high。

---

## 目的

統合実装指示書 §5・§10 と P5 として、拾い範囲（候補インスタンス・範囲・計測・算定結果・採用・費用処理）を
**PDF の中に永続保存** し、変更・削除・共用・二重操作・Undo/Redo・旧ファイルの読込を壊さずに扱う。
重要な数量・判断をセッションメモリだけに置かない。

## 既にあるもの（変更しない・まねる）

- `src/core/related/reviews.ts` — 関連候補の判断の保存（Root キー `KaruRelatedReviews`、`parse/serialize/read/write`）。**同じ作りで新しい Root キー `KaruTakeoffScopes` を作る。**
- `src/editor/AnnotationStore.ts` — `relatedReviews` の扱い（`ensureRelatedReviews`・`replaceRelatedReviews`・`getRelatedReviewsSnapshot`・`changeRelatedReviews`・履歴 `HistoryState.relatedReviews`・`restoreMany`・`mapHistoryStep`・保存時の `pendingRelatedReviews`・`markApplied`・`dirtySummary`・`isDirty`・reset）。**同じ箇所に `takeoff` を並べて足す。** 既存の関連候補の判断の動作は変えない。
- `src/core/annotations.ts` — 編集の種類 `setRelatedReviews` と、保存時に `writeRelatedReviews` を呼ぶ箇所。
- `src/worker/protocol.ts`・`src/worker/pdf.worker.ts`・`src/client/PdfWorkerPool.ts` — `getRelatedReviews` の要求・応答と、`setQuantityChecks`/`setRelatedReviews` をページの再描画対象から外している箇所。
- `src/app/documentModel.ts` — `ensureSessionRelatedReviews`、保存の要約（「関連候補の判断」）、ページ再描画の判定から `setRelatedReviews` を外している箇所。
- T2a/T2b のモジュール（`calcTypes.ts` の `CalcStatus`、`readiness.ts` の `SYSTEM_FACT_KEYS` 等）。

## 作るもの

### 1. `src/core/takeoff/model.ts`（保存モデルと操作。純粋関数）

```ts
export const TAKEOFF_ROOT_KEY = 'KaruTakeoffScopes'
export type ConstructionFact = 'true' | 'false' | 'unknown'
export type CandidateState = 'PROPOSED' | 'CONDITION_UNKNOWN' | 'NOT_APPLICABLE'   // fact から導く（保存しない）
export type ReviewState = 'REVIEW_PENDING' | 'APPROVED_FOR_PROJECT'
export type MeasurementMode = 'none' | 'fixture' | 'manual' | 'rows' | 'schedule' | 'method'
export type InclusionState = 'separate' | 'included' | 'other_contract' | 'duplicate' | 'unresolved'

export interface TakeoffOrigin { fixtureId: string; ruleId?: string; linkedAt: string }
export interface TakeoffScope {
  optionId?: string        // 墨出し等の範囲分岐（M-NEW 等）
  kind?: string            // 床面・壁面・天井面・中心線区間・接触面 等（scope_kind）
  surfaceSide?: string; layerId?: string; segmentId?: string; routePart?: string
  floorId?: string; roomId?: string; phaseId?: string; workEventId?: string
  specificationId?: string; physicalObjectId?: string; scopeId?: string; workZoneId?: string
  note?: string
}
export interface TakeoffMeasurement {
  mode: MeasurementMode
  fixtureId?: string                       // 計測元の項目（同じ PDF の CountFixture）
  markIds?: string[]                       // 項目の一部の印だけを使うとき
  body?: unknown                           // 24方式の body
  schedule?: unknown                       // 明細
  methodInputs?: Record<string, unknown>   // 35方式の inputs
  methodValues?: Record<string, unknown>   // 35方式の values
  evidence?: string                        // 計測の根拠（図面番号・資料名）
}
export interface TakeoffResult {
  status: CalcStatus; value: string | null; unit: string
  computedAt: string; engineRevision: string; formulaRevision: string; inputHash: string
  missing: string[]; errors: string[]; warnings: string[]
}
export interface TakeoffApproval {
  at: string; reviewer: string; evidence: string
  value: string; unit: string; inputHash: string; dependencies: Record<string, string>
}
export interface TakeoffOverride { value: string; unit: string; reason: string; by?: string; at: string } // 0 も有効値（LC11）
export interface TakeoffBilling {
  priceSourceId?: string; pricePeriodRegionId?: string; priceLineId?: string; priceUnit?: string
  inclusion?: InclusionState; contractId?: string; allocationEvidenceId?: string
  revisionBundleId?: string; reviewerId?: string; reviewEvidenceId?: string; assignee?: string
}
export interface TakeoffHistoryEntry {
  at: string
  code: string                     // LC/SH の決定コード（SCOPE_REVIEW 等）又は APPROVED / REVOKED / CREATED
  before?: { value: string | null; unit: string; status: string; review: ReviewState }
  reason?: string
}
export interface TakeoffInstance {
  id: string                       // instance_id（'tk-' + 英数字）。表示名・行番号をキーにしない
  createdAt: string; updatedAt: string
  ruleId?: string                  // 提案した既存ルール（rules.ts の id）
  definitionId?: string            // 949定義の ID（無い = ルールの範囲だけの参考の別拾い）
  label: string                    // 作成時の表示名（キーにしない）
  unit: string                     // 採用する単位（定義の元単位、又は選んだ方式の単位、ルールの範囲分岐の単位）
  origins: TakeoffOrigin[]         // 関連元（共用なら複数）
  fact: ConstructionFact; factEvidence?: string
  scope: TakeoffScope
  methodId?: string                // 35方式・はつりの方式・親の子定義 ID
  measurement: TakeoffMeasurement
  facts: Record<string, unknown>   // 利用者が入れた定義の入力（SYSTEM_FACT_KEYS は入れない）
  checkAnswers: Record<string, { answer: ConstructionFact; evidence?: string }>
  result?: TakeoffResult
  override?: TakeoffOverride
  review: ReviewState
  approval?: TakeoffApproval
  billing: TakeoffBilling
  dependencies: Record<string, string>   // 'fixture:<id>' / 'master' / 'engine' → 版（計算時に記録）
  stale?: { since: string; reasons: string[] }
  orphan?: { since: string; code: 'DETACH_KEEP_MANUAL' | 'ARCHIVE_REVIEW' }
  history: TakeoffHistoryEntry[]   // 新しい順に最大 50
}
export interface TakeoffDocState {
  version: 1
  projectId: string                // 文書ごとに一度だけ作る（SH01: 案件をまたいで共有しない）
  masterVersion: string            // 最初に使ったマスターの版（SET07: 新しいマスターを無断で適用しない）
  instances: Record<string, TakeoffInstance>
  order: string[]
  operations: Record<string, { hash: string; at: string; outcome: string; instanceId?: string }> // 最新 500
  /** 読めなかった元データ（そのまま保存し直す。捏造・削除しない） */
  unreadable?: { instances: string[]; root?: string; reasons: string[] }
}
export function emptyTakeoffState(projectId: string, masterVersion: string): TakeoffDocState
export function candidateState(fact: ConstructionFact): CandidateState
export function parseTakeoffState(raw: unknown): { state: TakeoffDocState | null; diagnostics: string[] }
export function serializeTakeoffState(state: TakeoffDocState): string   // 正規化した stableJson
export function readTakeoffState(doc: PDFDocument): { state: TakeoffDocState | null; diagnostics: string[] }
export function writeTakeoffState(doc: PDFDocument, state: TakeoffDocState | null): void
```

**保存形式と移行（指示書 §10）**

- Root の `KaruTakeoffScopes` に JSON 文字列で入れる（`KaruRelatedReviews` と同じ書き方）。キーが無い = 機能を使っていない（`state: null`）。
- `parseTakeoffState`:
  - JSON として読めない・`version` が 1 でない → `state` は `emptyTakeoffState` に `unreadable.root = 元の文字列` を入れたもの、diagnostics に理由。**元の文字列を捨てない**（保存時はそのまま書き戻す。T4 の画面は「読めない保存データがあります」と出し、編集させない）。
  - インスタンスごとに検証し、不正なものは捨てずに `unreadable.instances` へ元の JSON 文字列で残す（最大 1000 件・各 64KB）。
  - 文字列の長さ（ID 64、表示名・根拠 300、メモ 1000）、配列の件数（origins 200、history 50、markIds 2000）、facts の大きさ（JSON で 64KB）、全体 4MB を超えたら不正。
  - 数値の文字列（value 等）は `parseDecimal` で読める10進だけ。**null（未算定）と '0' を区別して保持**（LC24）。
  - プロトタイプ汚染を避ける（`Object.defineProperty` で詰める、`__proto__` キーは不正）。
  - 旧ファイル（キーなし）を開いて保存しても、このキーを作らない（`writeTakeoffState(doc, null)` は何もしない。空の状態も書かない）。**新しい採用根拠を捏造しない**（CC26-25）。
- `serializeTakeoffState` は検証してから stableJson。`writeTakeoffState` は Root を変える前に検証する。`unreadable.root` があるときは元の文字列をそのまま書く。

**操作（指示書 §10。LC/SH の規則）**

```ts
export type TakeoffOperation =
  | { id: string; kind: 'create'; payload: { ruleId?: string; definitionId?: string; label: string; unit: string; origin: { fixtureId: string; ruleId?: string }; scope?: TakeoffScope; methodId?: string; fact?: ConstructionFact } }
  | { id: string; kind: 'linkOrigin'; payload: { instanceId: string; origin: { fixtureId: string; ruleId?: string } } }
  | { id: string; kind: 'unlinkOrigin'; payload: { instanceId: string; fixtureId: string } }
  | { id: string; kind: 'setFact'; payload: { instanceId: string; fact: ConstructionFact; evidence?: string } }
  | { id: string; kind: 'setScope'; payload: { instanceId: string; scope: TakeoffScope } }
  | { id: string; kind: 'setMethod'; payload: { instanceId: string; methodId: string | null; unit: string } }
  | { id: string; kind: 'setMeasurement'; payload: { instanceId: string; measurement: TakeoffMeasurement } }
  | { id: string; kind: 'recordResult'; payload: { instanceId: string; result: TakeoffResult; dependencies: Record<string, string> } }
  | { id: string; kind: 'setFacts'; payload: { instanceId: string; patch: Record<string, unknown> } }   // 値 null はキーを消す
  | { id: string; kind: 'setCheckAnswer'; payload: { instanceId: string; checkId: string; answer: ConstructionFact; evidence?: string } }
  | { id: string; kind: 'setBilling'; payload: { instanceId: string; billing: TakeoffBilling } }
  | { id: string; kind: 'setOverride'; payload: { instanceId: string; override: Omit<TakeoffOverride, 'at'> | null } }
  | { id: string; kind: 'approve'; payload: { instanceId: string; reviewer: string; evidence: string; gateSatisfied: boolean; blockers: string[] } }
  | { id: string; kind: 'revoke'; payload: { instanceId: string; reason: string } }
  | { id: string; kind: 'markStale'; payload: { instanceId: string; reasons: string[] } }
  | { id: string; kind: 'remove'; payload: { instanceId: string; confirmed: true } }
  | { id: string; kind: 'reorder'; payload: { order: string[] } }
export type OperationOutcome =
  | { code: 'APPLIED'; instanceId?: string }
  | { code: 'REPLAY_PREVIOUS'; instanceId?: string; previous: string }   // LC02/SH02
  | { code: 'OPERATION_CONFLICT'; message: string }                       // LC01
  | { code: 'ALREADY_LINKED'; instanceId: string }                        // SH16
  | { code: 'REJECTED'; message: string; blockers?: string[] }
export interface OperationContext { now: string; newId(): string }
export function applyTakeoffOperation(state: TakeoffDocState, op: TakeoffOperation, context: OperationContext): { state: TakeoffDocState; outcome: OperationOutcome }
export function operationHash(op: TakeoffOperation): string   // stableJson({kind,payload}) の FNV-1a 64bit（16進16桁）
```

- 入力の state を変更しない（新しいオブジェクトを返す）。`unreadable.root` がある状態への操作はすべて REJECTED（「読めない保存データがあるため変更できません」）。
- **二重操作**（LC01/LC02）: `operations[op.id]` があり hash が同じ → state を変えず `REPLAY_PREVIOUS`（前回の outcome を返す）。hash が違う → `OPERATION_CONFLICT`（state を変えない）。適用したら `operations` に記録（最新 500 件を残す）。
- **create**: `definitionId` と `ruleId` の少なくとも一方が必要。同じ定義（又はルール）・同じ正規化範囲（下の `scopeKey`）・同じ関連元の項目のインスタンスが既にあれば `ALREADY_LINKED`（新しく作らない）。新しいインスタンスは `fact` 既定 `'unknown'`、`review: 'REVIEW_PENDING'`、`measurement.mode: 'none'`、`result` なし（**関連元の数量で埋めない**。CC26-01）。history に `CREATED`。
- **linkOrigin**: 既に同じ fixtureId があれば `ALREADY_LINKED`。数量は加算しない（SH17）。
- **unlinkOrigin**（LC07〜09。**現物を連鎖削除しない**）: 残りの関連元があれば辺だけ外す（`DETACH_KEEP_SHARED`）。最後の関連元なら外したうえでインスタンスを残し、手入力・計測・採用・上書きのどれかがあれば `orphan.code = 'DETACH_KEEP_MANUAL'`、無ければ `'ARCHIVE_REVIEW'`。
- **setFact**（LC20）、**setScope**（LC18）、**setMethod**（LC19）、**setMeasurement**（LC15/16）、**setOverride**（LC11）、**setBilling**（LC21）: 値が変わったら history に前の値（result の value/unit/status と review）と決定コードを残す。採用済み（APPROVED_FOR_PROJECT）なら **REVIEW_PENDING に戻す**（承認の記録は history に残す。数量を上書きして確認済みを維持しない）。
  setScope / setMethod / setMeasurement は `result` を消す（旧値は history）。setBilling は `result` を残す（物理量を保持）。
- **setFacts**: `SYSTEM_FACT_KEYS` のキーは入れない（outcome は APPLIED のまま、捨てたキーを message で返せるよう `REJECTED` にはしない。代わりに `outcome` に `ignoredKeys` を足してよい）。値は JSON で表せるものだけ（関数・undefined・NaN・Infinity は不可 → REJECTED）。
- **recordResult**: `result` と `dependencies` を記録し、`stale` を消す。採用済みで `inputHash` か `value` が承認時と違えば REVIEW_PENDING に戻す（history に `MEASURE_REVIEW`）。
- **approve**: `gateSatisfied` が false → REJECTED（blockers をそのまま返す）。`result.status` が CALCULATED（又は override あり）でないと REJECTED。承認時の値（override があれば override の値）・単位・inputHash・dependencies を `approval` に写す。**入力欄が埋まっているだけでは承認しない**（gate は T2b の判定を呼び出し側が渡す）。
- **revoke**: REVIEW_PENDING に戻し history に `REVOKED`。
- **markStale**: `stale` を付け、採用済みなら REVIEW_PENDING に戻す（history に `MEASURE_REVIEW`、承認時の値は history に残る）。
- **remove**（LC10）: `confirmed: true` のときだけ消す（Undo で戻る）。
- **reorder**（LC06）: 数量・根拠を変えない。

```ts
export function scopeKey(instance: Pick<TakeoffInstance, 'definitionId' | 'ruleId' | 'scope' | 'methodId'>): string
export interface DuplicateGroup { key: string; instanceIds: string[] }
export function findDuplicateScopes(state: TakeoffDocState): DuplicateGroup[]
export function findSharedCandidates(state: TakeoffDocState, input: { definitionId?: string; ruleId?: string; scope?: TakeoffScope }): string[]
```

- `scopeKey` = 定義（又は `rule:` + ルール）＋ 方式 ＋ 範囲の各欄（optionId, kind, surfaceSide, layerId, segmentId, routePart, floorId, roomId, phaseId, workEventId, specificationId, physicalObjectId, scopeId, workZoneId）を固定順に並べたもの（空は空）。**位置だけで同一にしない**（面側・層・工程が違えば別のキー。CC26-03）。
- `findDuplicateScopes`: 同じ `scopeKey` で、範囲の欄が1つ以上入っているインスタンスが2件以上ある群（範囲が全部空のものは「範囲未選択」で重複扱いしない）。画面で警告に使う（自動で統合・削除しない。SH15）。
- `findSharedCandidates`: 同じ定義（又はルール）で範囲が同じ（又は範囲未選択）のインスタンス ID（作成時に「既存の拾い範囲に関連付けるか」を聞くため。SH17）。

```ts
export interface DependencyCheck { instanceId: string; staleReasons: string[]; orphanFixtureIds: string[] }
export function checkDependencies(state: TakeoffDocState, current: (key: string) => string | undefined): DependencyCheck[]
```

- 各インスタンスの `dependencies` を `current(key)` と比べ、違う・無いものを理由（「計測元の項目（…）の数量・縮尺が変わりました」「マスターの版が変わりました」）にする。関連元の項目が無い（削除された）ものは `orphanFixtureIds`。**ここでは state を変えない**（画面が markStale を発行する）。

### 2. `src/editor/AnnotationStore.ts`（`relatedReviews` と同じ箇所へ足す）

- フィールド: `takeoff: TakeoffDocState | null`、`takeoffRevision`、`takeoffSnapshotCache`、`takeoffBaseline: string`（serialize した文字列。null は ''）、`takeoffLoading`、`pendingTakeoff`、`takeoffReady = false`、`takeoffDiagnostics: string[]`。
- `ensureTakeoff(loader: () => Promise<{ state: TakeoffDocState | null; diagnostics: string[] }>)`: `ensureRelatedReviews` と同じ（generation の確認、baseline の記録、`notify(false)`）。
- `getTakeoffRevision()`、`getTakeoffSnapshot(): Readonly<TakeoffDocState> | null`（同じ版では同じ freeze したオブジェクト）。
- `applyTakeoff(op: TakeoffOperation, init?: { projectId: string; masterVersion: string }): OperationOutcome`:
  - 準備前は `{ code: 'REJECTED', message: '保存データの読込前です' }`。
  - `takeoff` が null で init があれば `emptyTakeoffState(init.projectId, init.masterVersion)` から始める（init が無ければ REJECTED）。
  - `applyTakeoffOperation` の結果の state が変わったときだけ、履歴へ `{ before: { takeoff: 前 }, after: { takeoff: 後 } }` を積み（`HistoryState.takeoff`）、`notify(false)`。REPLAY_PREVIOUS・OPERATION_CONFLICT・REJECTED・ALREADY_LINKED（state 不変のとき）は履歴を積まない。
  - **1つの操作 = 1つの Undo 単位**（LC23）。複数の操作を1単位にしたいときのために `applyTakeoffBatch(ops: TakeoffOperation[], init?)` も作る（途中で REJECTED/CONFLICT があれば全部取り消し、履歴を積まない。LC05）。
- `restoreMany`・`mapHistoryStep`・`HistoryState` に `takeoff?: TakeoffDocState | null` を足す（`undefined` は「この履歴は takeoff を含まない」、`null` は「機能未使用の状態」）。
- 保存: `pendingTakeoff` と `setTakeoffScopes` の編集（`{ kind: 'setTakeoffScopes'; pageIndex: 0; state: TakeoffDocState | null }`）。`takeoffReady` かつ serialize が baseline と違うときだけ出す。`markApplied` で成功したら baseline を更新。
- `dirtySummary` に `takeoff?: boolean`、`isDirty` に含める。reset（文書の切替）で初期化。
- `getTakeoffFixtureRevision(fixtureId: string): string | undefined`: 項目が無ければ undefined。あれば `quantityIndex()` の `total`・`rawTotal`・`entries(fixtureId)` の（annotationId, pageIndex, value）と、項目の kind・unit・convert・link を stableJson して FNV-1a 64bit。**縮尺・図形・換算が変われば変わる**。
- `getTakeoffFixtureMeasure(fixtureId: string): { value: number; unit: string; kind: QuantityKind; markIds: string[]; pageIndexes: number[] } | undefined`: `quantityIndex().total(id)` と項目の単位（count は fixture.unit ?? '個'、length は m、area は m2、volume は m3、convert があれば convert.unit を正規化）。

### 3. 保存の経路

- `src/core/annotations.ts`: `AnnotationEdit` に `{ kind: 'setTakeoffScopes'; pageIndex: 0; state: TakeoffDocState | null }` を足し、`setRelatedReviews` の隣で `writeTakeoffState(doc, edit.state)` を呼ぶ。
- `src/worker/protocol.ts` / `pdf.worker.ts` / `src/client/PdfWorkerPool.ts`: `getTakeoffScopes` の要求・応答（`readTakeoffState(document)` をそのまま返す）。ページ再描画の判定（`setQuantityChecks`・`setRelatedReviews` を除いている箇所）に `setTakeoffScopes` も足す。
- `src/app/documentModel.ts`: `ensureSessionTakeoff(session, pool)`（`ensureSessionRelatedReviews` と同じ）、保存の要約に「拾い範囲」、ページ再描画の判定に `setTakeoffScopes`。

### 4. 性能（AGENTS.md）

- **機能を使っていない文書では何もしない**: `ensureTakeoff` は T4 の画面を開いたとき・候補カードで「拾い範囲に追加」を押したときだけ呼ぶ。PDF を開いたとき・描画・保存（未読込なら編集を出さない）で読まない。
- `dirtySummary` は `takeoffReady` のときだけ serialize を比べる（未使用の文書で余計な stableJson をしない）。

## 試験（vitest）

1. `tests/takeoff.model.test.ts`:
   - 新規作成で result なし・fact unknown・REVIEW_PENDING（CC26-01 の保存側）、同じ op を2回 → REPLAY_PREVIOUS で1件だけ（CC26-21）、同じ id で別 payload → OPERATION_CONFLICT で元の結果を上書きしない（CC26-22）。
   - 同じ壁で面側（A面/B面）・層（下地/仕上げ）が違う3件は `findDuplicateScopes` で重複にならない（CC26-03）。同じ範囲の2件は重複として出るが自動で消えない。
   - 共用: 関連元2件のうち1件を unlink → インスタンスと計測は残る（DETACH_KEEP_SHARED）、最後の1件を unlink → 残る（orphan: ARCHIVE_REVIEW 又は DETACH_KEEP_MANUAL）（CC26-23）。
   - 採用済みに recordResult（値が違う）/ markStale / setScope → REVIEW_PENDING、history に承認時の値が残る（CC26-24）。
   - approve は gateSatisfied=false で REJECTED（CC26-17 のモデル側）、override の 0 は有効値（LC11）。
   - setBilling で inclusion を included にしても result（物理量）は残る（CC26-19）。
   - setFacts に `origin_match: true` を入れても保存されない（SYSTEM_FACT_KEYS）。
   - parse: 旧形式（キーなし）→ null、壊れた JSON → unreadable.root に元の文字列、不正なインスタンス1件 → 残りは読めて unreadable.instances に元の JSON、null と '0' の区別、`__proto__` を拒否、往復（serialize → parse → serialize）で同じ文字列（LC24）。
2. `tests/AnnotationStore.takeoff.test.ts`（`tests/AnnotationStore.relatedReviews.test.ts` の書き方に合わせる）:
   - 未読込では applyTakeoff が REJECTED、`isDirty` は false、保存の編集を出さない。
   - 読込（キーなし）→ 何もしなければ保存の編集なし・dirty なし（CC26-25・CC26-28）。
   - create → dirty、編集 `setTakeoffScopes` が出る、`markApplied` 成功で dirty が消える（保存直後に不正な未保存警告を出さない。CC26-28）、失敗なら dirty のまま。
   - Undo/Redo: create → setMeasurement → recordResult → approve を Undo/Redo で往復し、計測・判断・関連元が一致して戻る（CC26-26）。Undo で新しい ID を作らない。
   - `applyTakeoffBatch` の途中失敗で全部戻り履歴を積まない（LC05）。
   - `getTakeoffFixtureRevision` が項目の印の追加で変わり、表示名の変更だけでは変わらない（LC06）。
3. `tests/takeoff.persistence.test.ts`（mupdf を使う既存の保存試験の書き方に合わせる。例: 関連候補の判断の保存試験）: `writeTakeoffState` → 保存 → 再読込で同じ state、null は Root キーを作らない、`unreadable.root` は元の文字列のまま書き戻る、既存の `KaruRelatedReviews` を壊さない。

## 守ること

- 既存の `relatedReviews` の動作・保存形式を変えない。既存の試験を壊さない。
- 計算（T2a）・判定（T2b）をこのモデルに持ち込まない（`recordResult` は呼び出し側が計算した結果を受け取るだけ）。
- 数量を 0 や関連元の値で埋めない。現物（インスタンス）を自動で削除しない。
