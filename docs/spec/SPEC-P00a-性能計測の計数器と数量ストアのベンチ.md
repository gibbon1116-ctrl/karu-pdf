# SPEC-P00a: 性能計測の計数器と数量ストアのベンチ

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 中核ストアへ計測を差し込む複数ファイル変更と、新規ベンチ試験の設計判断を伴うため既定の sol-high。

---

## 目的

かるPDF v1.8.1（d9e3a5b）の高速化の前に、改修前の性能を再現可能に測る。
このSPECでは (1) 通常起動では実質無負荷の計数器、(2) 数量ストア・集計表・数量パネルの主要関数への計数器の差し込み、
(3) Node 上で動く決定的なベンチ試験 を作る。**製品の動作・計算結果・画面は一切変えない。**

## 対象

- 新規 `src/perf/counters.ts`
- `src/editor/AnnotationStore.ts`（計数器の呼び出しを足すだけ）
- `src/app/QuantityTable.tsx`（同上）
- `src/app/FixturePanel.tsx`（同上）
- 新規 `tests/storeBaseline.perf.test.ts`

## 1. `src/perf/counters.ts`（新規）

次の API をこの名前で作る。

```ts
export interface PerfCounter { count: number; totalMs: number; maxMs: number }
export function isPerfEnabled(): boolean
export function setPerfEnabled(value: boolean): void
export function perfCount(name: string, amount?: number): void   // amount 既定 1
export function perfTime<T>(name: string, fn: () => T): T
export function getPerfCounters(): Record<string, PerfCounter>  // 呼び出し元が変更してよい複製を返す
export function resetPerfCounters(): void
```

- 有効/無効は module 内の `let enabled` 1個。初期値は
  `typeof location !== 'undefined' && new URLSearchParams(location.search).get('perf') === '1'`。
  例外が出る環境でも落ちないよう try/catch で false にする。
- 無効時: `perfCount` は即 return。`perfTime` は `return fn()` だけ（performance.now も Map 操作もしない）。
- 有効時: `perfCount` は count に amount を足す（totalMs/maxMs は変えない）。
  `perfTime` は `performance.now()` で前後を測り count+1、totalMs と maxMs を更新する。fn が例外を投げても計測を記録してから再送出する（try/finally）。
- 有効になったとき（初期値が true の場合と `setPerfEnabled(true)` の場合）、`typeof window !== 'undefined'` なら
  `window.__karuPerf = { get: getPerfCounters, reset: resetPerfCounters }` を定義する。`setPerfEnabled(false)` では削除する。
  型は同じファイル内の `declare global { interface Window { __karuPerf?: { get(): Record<string, PerfCounter>; reset(): void } } }`。
- 外部通信・新規パッケージ・URL 文字列（https://...）を追加しない。

## 2. 差し込む計数器（名前はこのとおり固定）

計算・戻り値・呼び出し順・例外の挙動を変えないこと。式を `perfTime(名前, () => 元の式)` で包むか、`perfCount` を1行足すだけにする。

### `src/editor/AnnotationStore.ts`

| 名前 | 場所 | 種類 |
|---|---|---|
| `store.notify.quantity` | `notify(quantityChanged)` で quantityChanged が true のとき | perfCount |
| `store.notify.ui` | 同 false のとき | perfCount |
| `store.listenerCalls` | `notify` でリスナーを呼ぶ回数（ループ前に `perfCount('store.listenerCalls', this.listeners.size)` 1回） | perfCount |
| `store.getCountFixtures` | `getCountFixtures()` の `structuredClone(this.fixtures)` | perfTime |
| `QuantityIndex.build` | `quantityIndex()` 内の `QuantityIndex.build(...)` | perfTime |
| `store.refreshSymbolCandidates` | `refreshSymbolCandidates()` の早期 return より**後**の本体全体 | perfTime（本体を private メソッドに切り出すか、本体を関数で包む。早期 return のときは計上しない） |
| `store.dirtySummary.compute` | `dirtySummary()` でキャッシュが外れて summary を作る部分 | perfTime |
| `store.getPageAnnotations` | `getPageAnnotations(pageIndex)` の本体 | perfTime |
| `store.countOverlayObjNums` | `countOverlayObjNums(pageIndex)` の走査部分（fixturesReady が false の早期 return は除く） | perfTime |
| `store.issueOverlayObjNums` | `issueOverlayObjNums(pageIndex)` の本体 | perfTime |

### `src/app/QuantityTable.tsx`（default export の QuantityTable 関数）

| 名前 | 場所 | 種類 |
|---|---|---|
| `QuantityTable.render` | 関数本体の先頭付近（hooks の順序を変えない位置。hook ではない普通の関数呼び出しなので先頭でよい） | perfCount |
| `QuantityTable.linkRelations` | `useMemo(() => linkRelations(fixtures), [fixtures])` の中身 | perfTime |
| `QuantityTable.buildData` | `useMemo(() => buildQuantityTableData(index, fixtures), ...)` の中身 | perfTime |
| `QuantityTable.project` | `outline` の useMemo 内の `projectQuantityTable(...)` | perfTime |

export 関数 `buildQuantityTableData` / `projectQuantityTable` / `buildQuantityTable` 自体には差し込まない（Node ベンチが直接呼ぶため二重計上を避ける）。

### `src/app/FixturePanel.tsx`（default export の FixturePanel 関数）

| 名前 | 場所 | 種類 |
|---|---|---|
| `FixturePanel.render` | 関数本体の先頭付近 | perfCount |
| `FixturePanel.linkRelations` | `useMemo(() => linkRelations(fixtures), [fixtures])` の中身 | perfTime |
| `FixturePanel.groupFixtures` | `useMemo(() => groupFixtures(fixtures), [fixtures])` の中身 | perfTime |

useMemo の依存配列は1文字も変えない。

## 3. `tests/storeBaseline.perf.test.ts`（新規、Node/vitest）

時間の合否判定はしない（時間を assert しない）。機能の正しさだけ assert し、計測値を出力する。`npm test` に含まれるので、L 構成でも全体で数十秒以内に収まる回数にする。テストのタイムアウトは `it(..., 300_000)`。

### 構成

- S: 項目 F=100、拾い M=1,000、ページ P=10
- L: 項目 F=1,000、拾い M=10,000、ページ P=100

### データ（決定的。Math.random と crypto.randomUUID に結果を依存させない）

- 項目 `f${i}`（i=0..F-1）: `{ id: 'f'+i, code: 'F'+String(i).padStart(4,'0'), name: '項目'+i, category: ['電灯','コンセント','幹線','動力','弱電','火報','空調','衛生','建築','その他'][i % 10], order: i, kind: 'count', style: nextCountStyle([]) }`。
  10件に1件（i % 10 === 0）は `breakdown: { book: '電気設備', section: '庁舎', subject: '電灯設備', middle: '電灯分岐', item: '分電盤' }` を付ける（e2e/quantity-table.annotate.spec.ts で使われている値）。
- `const store = new AnnotationStore(); await store.ensureCountFixtures(async () => fixtures, async () => {})`。
  直後に `store.getCountFixtures().length === F` と breakdown 付きの件数が F/10 であることを assert（読込で落ちていないことの確認）。
- 拾い j（j=0..M-1）: 項目 `f${j % F}`、ページ `(j * 7) % P`、中心 `[20 + (j % 40) * 11, 20 + (Math.floor(j / 40) % 50) * 11]`。
  項目ごとにまとめて `store.createCountMarks(fixtureId, points)` で作る。作った後 `store.quantityIndex()` で各項目の合計が想定どおりであることを1つ以上 assert。

### 計測（各項目: 1回の予熱の後 R=10 回。median / p95 / max / samples を出す。p95 は昇順で ceil(0.95n)-1 番目）

1. `getCountFixtures()`
2. `QuantityIndex.build(全拾い, fixtures)` — 全拾いは全ページの `store.getPageAnnotations(p)` を連結したもの（型が合うことを確認。合わなければ必要な項目だけの写像にする）
3. `buildQuantityTableData(index, fixtures)`
4. `linkRelations(fixtures)`（`src/app/linkRelations.ts`）
5. `projectQuantityTable(data, 'page', {}, () => null, { groupByBreakdown: true })` と `groupByBreakdown: false`
6. `uiRecompute` = 1→4→3→5(true) を続けて行った時間（現状、集計表が通知ごとに行う作業の近似）
7. 項目選択 100 回: `store.selectFixture('f' + ((k * 7) % F))`（k=0..99）。
   (a) リスナーなし、(b) `store.subscribe` で 6 と同じ作業をするリスナー1個を登録した状態。1回ごとの時間の分布と合計、および各回の前後の計数器差分（resetPerfCounters → 100回 → getPerfCounters）を出す。終わったらリスナーを外す。
8. `dirtySummary()`（直前に `selectFixture` で version を進め、キャッシュが外れた状態で測る）
9. 10ページ分の `getPageAnnotations(p)` / `countOverlayObjNums(p)` / `issueOverlayObjNums(p)`
10. 1点追加: `createCountMarks('f1', [{ pageIndex: 0, center: [480, 590] }])` → `store.quantityIndex()`、続いて `undo()` → `quantityIndex()`、`redo()` → `quantityIndex()`。各段を別々に 10 回測る。
11. 100点一括追加: 同様に 100 点（ページ0、y=590 の行に x=5..500 で並べる）。5 回。
12. 図記号候補: `store.selectFixture('f0')`、`store.beginSymbolCandidates('f0', [0, 0, 12, 12])`、
    候補 K 件（K=500 と 2,000）を `appendSymbolCandidates` で一度に追加。候補 c の中心は c が偶数なら既存の拾いの中心（j = c * 13 % M の拾い）、奇数なら `[25 + (c % 37) * 13, 25 + (c % 41) * 13]`、ページは対応する拾いのページまたは `c % P`、rect は中心±6、score 0.9、confidence は c%3===0 なら 'high' それ以外 'check'。
    測るもの: append の時間、続く `createCountMarks('f1', [{ pageIndex: 0, center: [470, 590] }])` の時間（候補の再判定を含む）、計数器 `store.refreshSymbolCandidates` の count/totalMs。
    同等性用の要約: 状態別件数（pending/chosen/counted）、otherFixture 付き件数、候補を配列順に `${pageIndex}:${state}:${otherFixture ?? ''}` で連結した文字列の FNV-1a 32bit ハッシュ。最後に `undo()` と `clearSymbolCandidates()` で元に戻す。

### 同等性の要約（後のフェーズで改修前後を照合するため）

- L 構成の `buildQuantityTableData` の `[fixture.id, total]` を id 順に並べた JSON の FNV-1a 32bit ハッシュ
- `projectQuantityTable(... groupByBreakdown: true)` の rows 数と、rows を JSON.stringify したもののハッシュ
- `store.dirtySummary()` の JSON

### 出力

- `setPerfEnabled(true)` を beforeAll、`setPerfEnabled(false)` と `resetPerfCounters()` を afterAll。
- 結果オブジェクト `{ kind: 'karu-store-baseline', node: process.version, cpu: os.cpus()[0]?.model, cpuCount: os.cpus().length, totalMemGiB, commit, configs: { S: {...}, L: {...} } }`。
  commit は `execSync('git rev-parse HEAD')` を try/catch（失敗時 null）。
- `console.log('KARU-PERF-STORE ' + JSON.stringify(result))`。
- 環境変数 `KARU_PERF_OUT` があれば、そのパスへ整形 JSON を書く（親フォルダを mkdir）。無ければ書かない。

## 禁止事項

- 計算・表示・保存・Undo/Redo・通知の順序や回数を変えないこと。計数器は観測だけ。
- useMemo/useCallback の依存配列、hooks の順序、export 名、関数名を変えないこと。
- `getCountFixtures()` の「複製を返す」契約を変えないこと。
- 指定ファイル以外を変更しないこと。新規パッケージ・外部通信・https:// を含む文字列を足さないこと。
- 既存試験を書き換えないこと。

## 報告してほしいこと

- 変更・追加したファイルと差し込んだ箇所
- SPEC から外れた所と理由
- 計測の前提で気づいた点（例: 型が合わず写像にした等）
