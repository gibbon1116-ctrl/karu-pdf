# SPEC-T10: 関連ルール916件と標準の連動規則37件の、数量の拾い方の全件点検

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol` / reasoning effort: `high`
- 選定理由: 原本 Excel の算定方法と、アプリが実際に付ける連動を全件照合する判定の設計を伴うため。

## 目的

利用者の指示（2026-10-18）: 「指定した項目のみではなく、誤って数量拾いを行っているルールを全て確認・修正する」。
この SPEC は **点検の仕組み** を作る（修正は点検結果を見て次の SPEC で行う）。点検は画面を使わない純粋な処理と vitest で行い、結果を CSV に出す。

## 作るもの

### 1. `src/app/relatedLinkAudit.ts`（純粋関数）

```ts
export type AuditVerdict = 'OK' | 'ERROR' | 'REVIEW'
export interface AuditRow {
  ruleId: string; book: string; originText: string; targetText: string
  classId: string            // ruleScopes の範囲の分類
  definitions: string        // 対応する949定義の「ID:算出方式:単位」（; 区切り）
  excelTarget: string        // 原本の「関連先で拾う対象・場所」
  excelDifference: string    // 原本の「関連元と異なる点」
  excelUnit: string          // 原本の「単位・扱い」
  originItem: string         // 点検に使った起点の品目（名称・拾い方）
  originMethod: string       // click / polyline / polygon / lengthHeight / polygonDepth / lengthWidthDepth
  targetItem: string         // 点検に使った提案先の品目（名称・種別）
  targetKind: string         // count / length / area / volume
  link: string               // 付く連動の要約（なし / factor / factor(openingArea) / shape:perimeter / shape:baseLength×2 / route / point / component 等）
  sources: string            // auto（条件）/ 押した項目だけ / なし
  verdict: AuditVerdict
  reasons: string[]          // 日本語の理由（複数可）
}
export function auditRelatedLinks(input: {
  rules: readonly RelatedRule[]
  scopes: TakeoffRuleScopes
  master: TakeoffMaster      // 949定義（算出方式・単位）
  catalogItems: readonly CatalogItem[]   // 品目一覧（src/core/catalog の catalogItems()）
  toFixture(item: CatalogItem, optionKey?: string): CountFixture        // 品目から項目を作る（既存の catalogPresets・fixtureFromPreset を使う）
  plan(ruleIds: readonly string[], origin: CountFixture, target: CountFixture, projectMode?: string): { kind: string; link?: FixtureLink; reason?: string }  // 実際の追加で使う計画関数（T9 の relatedLinkRules と同じもの）
  existingKind(origin: CountFixture, target: CountFixture): string | undefined     // relatedAdditionKind
}): AuditRow[]
export function auditToCsv(rows: readonly AuditRow[]): string   // UTF-8 BOM・CRLF
export function auditSummary(rows: readonly AuditRow[]): Record<AuditVerdict, number> & { byReason: Record<string, number> }
```

- 点検の対象: kind が `item` のルールと、`check` で `create` があるルール（note は対象外）。
- 起点の品目: ルールの `origin.any` の `names` に一致する品目、`categories` の品目（各分類で拾い方ごとに1品目まで）。品目の選択肢（options）の拾い方ごとに1行。品目一覧に無い起点は、名称だけの項目を拾い方 click・polyline・polygon・lengthHeight の4通りで作って点検し、`originItem` に「（品目一覧に無い）」と書く。
- 提案先の品目: `targets` を品目一覧で解決したもの（拾い方ごと）。`create` のルールは create の単位から作った項目（式・か所→個数、m→長さ、㎡→面積）。
- 案件区分は「改修」と「新築」の2通りで点検する（墨出し等で計画が変わるため）。行に区分を含める（`originItem` の末尾に「／改修」等）。

### 2. 判定（`verdict` と `reasons`）。原本 Excel の記載を根拠にする

起点の拾い方と提案先の種別から、付いた連動が **何を写すか** を求め、次に当たれば ERROR:

| # | 誤り | 判定の条件 |
|---|---|---|
| E1 | 別に拾う・確認だけの項目に数量を写す | 分類が RECORD・PLAN・BRANCH・PROTECT・PROTECT_ACTUAL・SCAFFOLD・CRACK・DEFECT_POINT・PATCH・OPENING・PROPERTY・MATERIAL・WALL_FRAME・CEILING_FRAME・VOLUME・WASTE・CONTACT、又は対応する定義が全部 F_MANUAL・F_CHECK・F_DESIGN なのに、関連元の数量を写す連動（factor・shape・perimeter）が付く。ただし RC・鉄骨の標準規則（kind rc/steel）は除く |
| E2 | 次元の不一致 | 写す量の次元（面積・長さ・個数・体積）と提案先の種別が合わない（例: 面積の写しを長さの項目へ、外周を面積の項目へ） |
| E3 | 辺・線を求めるのに面積を写す | 分類 BASEBOARD・JOINT・CORNER・UPSTAND、又は定義が F_EDGE・F_UP なのに、factor（面積の写し） |
| E4 | 立面の外周を床際・墨出しに使う | 起点の部位が壁（名称・分類に「壁」「間仕切」）で拾い方が polygon・lengthHeight なのに、shape: perimeter（壁の立面の外周） |
| E5 | 個数を求めるのに長さ・面積を写す | 定義が F_COUNT、又は分類が POINT・EXIST_POINT・SET・SUPPORT・WORK_POINT・ENDPOINT で、提案先が個数なのに factor・shape |
| E6 | 表面積を求めるのに長さを写す | 提案先の名称に「塗装」「保温」で種別が面積、起点が線（経路）なのに factorFrom: outerCircumference でない |
| E7 | 墨出しの算定範囲の誤り | 墨出しで、改修なら壁の線（M-WALL）以外、新築で連動が付く |
| E8 | 面積の写しの対象外 | factor の面積の写し（起点 polygon・lengthHeight → 提案先 面積）が付くのに、分類が「同じ面の別作業」（SURFACE・AREA・EXIST_FACE・FLOOR・ROOF・CEILING_FINISH・INNER・WALL_FINISH・CAVITY）でない |
| W1 | 元が押した1項目だけ | 連動が付くのに `auto` が無く `sources` が起点1件（REVIEW） |
| W2 | 判定できない | 起点・提案先が品目一覧に無く、分類も無い（REVIEW） |

- 上に当たらなければ OK。理由は日本語で、原本の分類・算出方式・単位を含める（例「E3: 幅木（BASEBOARD・REL-085 F_EDGE m）に面積を写している」）。
- **判定の表は `relatedLinkAudit.ts` の中に定数で持ち、計画関数（relatedLinkRules）の表とは独立に書く**（同じ表を使うと誤りを見つけられない）。

### 3. `tests/relatedLinkAudit.test.ts`

- 実データ（`RELATED_RULES`・`ruleScopes.data`・`master.data`・`catalogItems()`）で全件点検し、件数を出す（`console.log` で `auditSummary`）。
- 環境変数 `RELATED_AUDIT_OUT` があれば CSV を書き出す。
- 期待: 点検が全ルールを網羅すること（対象ルール数・行数が 0 でない、各ルールに1行以上）。**ERROR が 0 であることはこの SPEC では求めない**（件数を記録する。修正は次の SPEC）。
- 判定の単体試験: E1〜E8・W1 の各条件に当たる小さな例と、当たらない例。

## 守ること

- 既存のコードを変えない（新しいファイルだけ）。
- 判定の表と計画関数の表を共有しない。
