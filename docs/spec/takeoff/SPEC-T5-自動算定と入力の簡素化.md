# SPEC-T5: 拾い範囲 — 関連元の図形からの自動算定と、入力欄の削減

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol` / reasoning effort: `high`
- 選定理由: 図形からの算定と画面の作り直しで、既存の保存・計算との整合を判断するため。

## 利用者の指示（2026-10-18。これが最優先）

- 多数の自由記入欄は不要。**最低限の入力で、基本は自動入力**。初めて触る人が感覚的に使えること。
- 残してよい自由記入欄は **数量を指定（補正）するとき** と **特殊な仕様を採用するとき** だけ。それ以外の記入欄はすべて削除する。
- 数量を自分で入れさせない。関連元の図形から算定できるものは自動で算定する
  （例: 軽量鉄骨壁下地を「線＋高さ」で拾っていれば線の長さ、「面」で拾っていれば底辺の長さを基準に墨出しの面積を出す）。
- **入力は原則として選択式**。選択肢では表せず、正しく拾うために欠かせない最低限の情報だけを自由記入にする（今回の画面では「数量の補正値（数値）」と、補正理由で「その他」を選んだときの短文、特殊な仕様の1欄だけ）。迷ったら選択肢にする。数値欄（帯幅・補正値）は数値入力で、文章を書かせない。
- 原本 Excel の算定方法: 墨出し「壁のみの新設・改修」(M-WALL) は **新設壁前面から1mの床範囲**（第7編 PDF49頁）。壁高さは掛けない。両側は明示したときだけ。

## 作るもの・変えるもの

### 1. 関連元の図形の取得（`src/editor/AnnotationStore.ts` に追加）

```ts
export interface TakeoffOriginGeometry {
  markId: string; pageIndex: number
  method: 'click' | 'polyline' | 'polygon' | 'lengthHeight' | 'polygonDepth' | 'lengthWidthDepth'
  planLengthM?: number      // polyline・lengthHeight・lengthWidthDepth の線の長さ（m。立上り・余長を含めない平面長）
  heightM?: number          // lengthHeight の高さ
  areaM2?: number           // 面積（polygon・lengthHeight の算定値）
  baseEdgeM?: number        // polygon のとき: ほぼ水平な辺（傾き10°以内）のうち最も長い辺の長さ（壁の立面の底辺。無ければ undefined）
  openings: { widthM: number; heightM: number; count: number }[]  // その印の開口（幅・高さが分かるものだけ）
}
getTakeoffOriginGeometry(fixtureId: string): TakeoffOriginGeometry[]
```
- 既存の `quantity.ts`（`quantityValue`・開口の解決）と `measure.ts`（`polylineLength`）と、印ごとの縮尺（`mmPerPoint`）を使う。削除済みの印は除く。

### 2. 自動算定（`src/app/takeoffAuto.ts` 新規。純粋関数）

```ts
export interface AutoCalcInput {
  optionId?: string                 // 範囲分岐（M-WALL 等）
  definition?: MasterDefinition     // 949定義（ある場合）
  geometry: readonly TakeoffOriginGeometry[]
  originUnit: string                // 関連元の項目の単位
  sides: 1 | 2                      // 墨出しの片側／両側（M-WALL だけ）
  bandWidthM: string                // 墨出しの帯幅（既定 '1'。根拠 第7編 PDF49頁）
}
export interface AutoCalcResult { ok: boolean; value: string | null; unit: string; steps: string[]; reason?: string; basis: string }
export function autoCalculate(input: AutoCalcInput): AutoCalcResult
export function autoAvailable(input: Omit<AutoCalcInput, 'geometry'> & { methods: readonly string[] }): boolean
```

| 対象 | 算定（10進演算 `decimal.ts` を使う） | 図形が無いとき |
|---|---|---|
| M-WALL（壁のみ） | Σ 壁の基準長 × 帯幅 × 片側/両側。基準長 = planLengthM（線・線＋高さ）、無ければ baseEdgeM（面）。**高さは掛けない** | 「壁の線又は底辺が取れません。図面で拾い直すか数量を入力してください」 |
| M-DOOR（建具開口） | Σ 開口の 幅 × 高さ × 個数 | 同様 |
| M-EXT（外壁改修）・M-WATER（防水勾配） | Σ 関連元の面積（関連元がその改修面そのものであるため） | 同様 |
| M-NEW・M-INTERIOR・M-OTHER | 自動算定しない（床・部屋の範囲が必要）。ok=false、reason「床・部屋の範囲から拾ってください」 | — |
| 949定義 F_EDGE・F_UNIQUE | rows = 各印の planLengthM（id=印ID） → `calculateFormula` | — |
| F_WALL・F_UP | rows = 各印の L=planLengthM, h=heightM（lengthHeight の印だけ）、deductions = 開口の面積の合計（0 も明示）、additions = '0' | — |
| F_SURFACE | rows = 各印の areaM2、deductions/additions = '0' | — |
| F_COUNT | object_ids = 印ID、survey_complete = true | — |
| F_SUBSET | rows = 各印の値（単位が定義の単位と同じとき） | — |
| それ以外 | 自動算定しない（明細・方式は既存の入力） | — |

- `basis` に算定の説明（例「壁の線の長さ 12.5m × 帯幅 1m × 片側 = 12.5㎡（第7編 PDF49頁）」）。

### 3. 「拾い範囲に追加…」をワンクリックにする（`RuleScopeBlock.tsx`・`TakeoffDialog.tsx`・`takeoffFacts.ts`）

- カードのボタン名は「拾い範囲に追加」。押したら画面を開かずに（又は開いて結果を見せて）:
  1. 範囲分岐の既定を決める: 関連元の項目が壁（名称に「壁」）で分岐に M-WALL があれば M-WALL、建具なら M-DOOR、外壁なら M-EXT、防水なら M-WATER。決められないときだけ、分岐の **選択肢だけ** の小さな選択（自由記入なし）を出す。
  2. `create`（fact = 'true'、施工するから追加したとみなす）→ 自動算定できれば `setMeasurement`（mode: 'auto'。T3 の `MeasurementMode` に `'auto'` を足す。保存の検証も更新）＋ `recordResult` を **1つの Undo 単位**（`applyTakeoffBatch`）で記録。
  3. 一覧に「自動算定」の印と値・算定の説明を出す。
- 関連元の項目の図形が変わったら（`getTakeoffFixtureRevision` が変わったら）、画面を開いたとき・候補カードを表示したときに **自動で再計算して記録**（mode が 'auto' で補正値が無いものだけ）。採用済みなら要再確認に戻る（既存の規則のまま）。

### 4. 画面から消すもの・残すもの（`TakeoffDialog.tsx`）

**消す（入力欄ごと削除。保存データの項目は残してよいが画面に出さない）**
- 範囲タブの自由記入: 面側・層・階・部屋・工程・施工の機会・現物ID・範囲ID・仕様・工区・メモ、「範囲を保存」。
- 施工の有無の根拠、「施工の有無を保存」（施工の有無は「必要／不要」の切替1つ。変えたらすぐ保存）。
- 照査タブの不足キーの入力欄（232キーの事実入力・施工条件の回答欄）。照査タブ自体を消し、「詳細（確認用・読取専用）」に、原本の契約上の不足キーの一覧と施工条件の原文を **表示だけ** する（折りたたみ）。
- 採用タブの ID 記入欄（価格資料ID・年月地域・単価/見積行・価格の単位・担当契約・分担の根拠・版束・照査者・照査の根拠）。
- 計測の「行で入力」「明細」の手入力表は、自動算定できない定義のときだけ出す（自動算定できる定義では出さない）。

**残す**
- 範囲の分岐（選択肢）、墨出しの片側／両側（選択肢。M-WALL のときだけ）、帯幅（既定 1m を表示。変更は「変更する」を押したときだけ数値欄を出す。根拠の文を表示）。
- **数量の補正**（自由記入。値と理由。理由は選択肢「図面と現場の差」「特記による」「その他」＋その他のときだけ短文）。
- **特殊な仕様**（自由記入1欄。「特殊な仕様を採用する場合だけ記入」と表示）。`scope.specificationId` に保存。
- 計上の方法（選択肢: 別に計上する／単価に含む／他工事）と、他工事のときの担当（選択肢）。
- ボタン「内訳に計上する」（下の §5 の条件）／「計上を取り消す」。

**タブの構成**: 「算定」（範囲分岐・片側両側・自動算定の結果と説明・補正・特殊な仕様）と「計上」（計上の方法・担当・ボタン）と「詳細（確認用）」の3つ。上部の「次に入力すること」は、自動で決まらない選択だけを1文で出す（例「範囲の分岐を選んでください」）。キー名・英語を出さない。

**作成中の表示**: 作成欄を出している間は、右側に別の拾い範囲の詳細を出さない（器具用ボックス等の取り違えを防ぐ）。

### 5. 計上の条件（`takeoffFacts.ts`・`takeoffXlsx.ts`）

- 「内訳に計上する」を押せる条件: 役割が数量候補（補助量・親・記録・工数・方式未選択は不可）、算定結果が CALCULATED（又は補正値あり）、要再確認（STALE）でない、計上の方法が「別に計上する」。押したら `approve`（reviewer = '利用者'、evidence = 算定の説明）。
- 原本の949定義の詳細な契約（価格資料・分担の根拠ID 等）は **計上の条件にしない**（詳細に「原本の契約で未確認の項目」として表示だけ）。価格を接続した正式内訳は今回の範囲外のまま。
- 定義の無いルール（墨出し等）も、自動算定の結果があれば計上できる（数量候補として扱う）。
- Excel の「正式数量」列 → 列名を「計上数量」に変更。計上済みかつ上の条件のときだけ値。

### 6. 既存の連動の誤り（`RelatedSuggestions.tsx`）

- 範囲の分類が墨出し（ruleScopes の classId が `MARK`）のカードでは、既存の「連動にする」（係数1で壁の面積を写す）を出さず、「拾い範囲に追加」（自動算定）だけを出す。

## 試験

- vitest `tests/takeoff.auto.test.ts`: 壁 線10m＋高さ3.6m → M-WALL 片側 10㎡・両側 20㎡（高さを掛けない）、面で拾った壁（底辺12.5m）→ 12.5㎡、開口 0.9×2.0×2 → M-DOOR 3.6㎡、図形なし → ok=false、F_WALL の rows 自動生成と開口控除、F_COUNT。
- `tests/AnnotationStore.takeoff.test.ts` に getTakeoffOriginGeometry（線・線＋高さ・面・開口）。
- `tests/takeoff.model.test.ts`: mode 'auto' の保存と往復。
- `tests/takeoff.xlsx.test.ts`: 列名「計上数量」。
- e2e `e2e/takeoff-scope.annotate.spec.ts` を書き換え: 壁（線＋高さ）を図面に1本描いた PDF → 墨出しカードの「拾い範囲に追加」1回で、一覧に自動算定の値（線の長さ×1m）が出る。画面に自由記入欄が「数量の補正」「特殊な仕様」以外に無いこと（`input[type=text]`・`textarea` の数を数える）。補正を入れると値が変わり、元に戻す（Ctrl+Z）で戻る。上書き保存後に未保存の印が出ない。

## 守ること

- 関連元の面積を墨出しへ写さない（M-WALL は線の長さ×帯幅）。高さを掛けない。
- 既存の判断・追加する・経路・構成要素の動作は MARK の連動以外変えない。保存形式の互換（旧データの読込）を壊さない。
- 文言は日本語。英語のキー名を画面に出さない（詳細の確認用を除く）。
