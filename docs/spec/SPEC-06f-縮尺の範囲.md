# SPEC-06f: 1ページ内の縮尺の範囲（平面図 1/100 の中の詳細図 1/20 など）

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: PDF への保存の形（ページの `/VP`）の拡張と後方互換、Worker の読み書き、ストアの履歴、計測・数量拾いの縮尺の決め方にまたがる新機能のため（判定表「新規機能の実装」）

---

## 目的

利用者の指示（要約）: 1ページの中に平面図 1/100、詳細図 1/20、部分詳細図 1/10 などが混ざることがある。ページ全体を1つの縮尺で扱うと数量を誤る。図面上の範囲を指定して「この範囲は 1/20」と決められるようにする。ページには「ページの縮尺（既定）」と「追加の縮尺の範囲」を持たせる。拾った位置が範囲の中ならその縮尺、どの範囲にも入らなければページの縮尺を使う。範囲が重なるときの決め方は安全な仕様を決める。縮尺の範囲が無い普通の PDF では、今より重くしない。毎フレーム複雑な判定をしない。

## 現状（Claude Code が確認したこと）

- ページの縮尺: `PageScale`（`src/core/measure.ts`）。PDF ではページの辞書の `/VP`（Viewport の配列）に、ページ全体の `/BBox`・`/Measure`・`/KaruScale`（JSON）の Viewport を1つ書く（`writePageScale`）。他のアプリの Viewport は残す。読むのは `readPageScale`（`/VP` を後ろから見て、`/KaruScale` か標準の `/Measure` を持つ最初のもの）。開くときに Worker が `readDocumentScales` で全ページ分を読み、`pageScales` として返す。
- ストア: `AnnotationStore` の `scales`・`scaleBaselines`・`getScale(pageIndex)`・`setScale(pageIndices, scale, recalculate)`（`recalculate` ならそのページのすべての計測・数量拾いを新しい縮尺で計算し直す）。保存の edit は `setPageScale`。履歴の `HistoryState.scales`。
- 計測・数量拾い: `src/editor/MeasurementOverlay.tsx` の `useMeasurementInteraction`。`props.store.getScale(props.pageIndex)` を `redraw`（毎フレームの下書き）と `commit` と `pointerDown`（縮尺が無ければ縮尺の画面を開く）で呼ぶ。作った注釈は `measure.mmPerPoint` を自分で持つ（集計・CSV はこの値を使う）。
- 縮尺の画面: `src/app/ScaleDialog.tsx`（比率か2点のなぞり）。開くのは `App.tsx` の `openScale(pageIndex, required)`。状態欄の `status-scale` ボタン。計測▼の「縮尺の設定…」。
- ページ整理の後: `DocumentSession.updateAfterPageLayout(pageSizes, canUndo, scales, drawings)`。

## 対象

- 対象フォルダ: `C:\Users\gibbo\Desktop\PDF編集アプリ\.claude\worktrees\karupdf-quantity-ui-8301e6`
- 変更してよいファイル: `src/core/measure.ts`、`src/core/annotations.ts`（edit の種類と適用だけ）、`src/worker/pdf.worker.ts`・`src/worker/protocol.ts`・`src/client/PdfWorkerPool.ts`（開く・ページ整理の応答に範囲を足す）、`src/editor/AnnotationStore.ts`、`src/editor/MeasurementOverlay.tsx`、`src/editor/AnnotationLayer.tsx`（範囲の枠の描画と、範囲を描く操作）、`src/app/ScaleDialog.tsx`、`src/app/documentModel.ts`、`src/App.tsx`（縮尺の画面と範囲の操作のつなぎ、状態欄）、`src/app/ToolRow.tsx`（計測▼の項目）、`src/app/HelpDialog.tsx`、`src/styles.css`、`tests/`、新規 `e2e/scale-regions.annotate.spec.ts`
- 変更しないファイル: 上以外。`docs/`、設定ファイル、`scripts/`

## 変更内容

### 1. データ

```ts
// measure.ts
export interface ScaleRegion { id: string; rect: Rect; scale: PageScale; label?: string }  // rect はページの表示座標（注釈と同じ、左上が原点）
export function validScaleRegion(value: unknown): value is ScaleRegion
// 点に使う縮尺。範囲の中なら範囲の縮尺（重なりは面積が小さい方、同じ面積なら配列の後ろの方）、どれにも入らなければページの縮尺。
export function resolveScale(page: PageScale | null, regions: readonly ScaleRegion[] | undefined, point: Point): { scale: PageScale; region?: ScaleRegion } | null
```

- 重なりの決め方の理由: 詳細図は平面図の中に置かれるので、小さい方（内側）を優先するのが安全。同じ面積は後から作った方。
- 1ページの範囲は最大 20。`rect` は幅・高さが 10pt 以上でページの中に収める。`label` は 40 文字まで（任意、例 `A部詳細`）。

### 2. PDF への保存（後方互換）

- 範囲は、ページの `/VP` に Viewport を1つずつ足して書く: `/Type /Viewport`、`/BBox`（範囲をページの利用者空間に直したもの。`writePageScale` と同じ変換）、`/Name`（`label` があれば）、`/KaruScaleRegion`（`{ id, scale, label }` の JSON 文字列）。**`/Measure` は書かない**。
  - 理由: 今までのかるPDF（1.3.9 以前）は `/VP` を後ろから見て `/KaruScale` か `/Measure` を持つ最初の Viewport をページの縮尺とする。範囲に `/Measure` を書くと、古い版が範囲の縮尺をページの縮尺と読み違える。`/Measure` が無ければ古い版は範囲を読み飛ばし、ページの縮尺は今どおり読める。範囲の中で作った計測・数量拾いは、注釈自身が `/Measure` を持つので、他のアプリでも値は正しい。
- `writePageScale` は今どおり「`/KaruScale` を持つ Viewport だけを置き換え、他は残す」。新しい `writeScaleRegions(doc, page, regions)` は「`/KaruScaleRegion` を持つ Viewport だけを置き換え、他は残す」。どちらを先に呼んでも、もう一方を消さない。
- `readScaleRegions(page): ScaleRegion[]`（不正なものは捨てる）。開くとき、`readDocumentScales` と同じ所で全ページの範囲も読み（`/VP` を見るだけ。文字・図形は読まない）、範囲のあるページだけを `pageScaleRegions: Array<[pageIndex, ScaleRegion[]]>` として返す。ページ整理の応答も同じ。
- 保存の edit: `{ kind: 'setScaleRegions'; pageIndex: number; regions: ScaleRegion[] }`。

### 3. ストア（`AnnotationStore`）

- `scaleRegions: Map<number, ScaleRegion[]>` と、その保存済みの基準。`loadScaleRegions(entries)`、`getScaleRegions(pageIndex)`、`scaleAt(pageIndex, point)`（= `resolveScale(getScale(pageIndex), getScaleRegions(pageIndex), point)`）。
- `setScaleRegions(pageIndex, regions, recalculate)`: 履歴（`HistoryState` に `scaleRegions?: Array<{ pageIndex; regions }>` を足す。undo/redo）。`recalculate` のとき、そのページの計測・数量拾いのうち、**始点（`vertices[0]`）が変更の前か後の範囲に入るもの**だけを、`scaleAt(始点)` で決まる縮尺で計算し直す（今の `setScale` の計算し直しと同じ処理）。
- `setScale(..., recalculate)`（ページの縮尺）: 計算し直す対象を、**始点がどの範囲にも入らないもの**だけにする（範囲の中のものはページの縮尺を変えても変わらない）。範囲の無いページは今と同じ。
- 未保存の判定・`toEdits`・`markApplied` に範囲を足す（SPEC-06a の `stableJson` と `dirtySummary` に合わせる。`dirtySummary` の縮尺のページに範囲の変更も含める）。
- ページ整理の後（`updateAfterPageLayout`）、範囲も読み直す。

### 4. 計測・数量拾い（`MeasurementOverlay.tsx`）

- 1本を拾い始めた点（最初の `pointerDown`）で `store.scaleAt(pageIndex, 点)` を1回だけ求め、その拾いが終わるまで `ref` に持つ。`redraw`（毎フレーム）と `commit` はその値を使う（毎フレーム判定しない）。範囲の無いページでは今と同じく `getScale(pageIndex)`。
- `scaleAt` が null（ページの縮尺も範囲も無い）なら、今どおり縮尺の画面を開く。範囲の中ならページの縮尺が無くても拾える。
- 確定したとき、頂点のどれかが始点の範囲の外（範囲の中から始めた場合）か、どこかの範囲の中（範囲の外から始めた場合）にあれば、状態欄に `縮尺の範囲をまたいでいます。始点の縮尺（1/20）で計算しました` を出す（拾いはそのまま作る）。
- 頂点を動かしたとき（`updateMeasureVertices`）は縮尺を変えない（今と同じ）。

### 5. 画面

- 計測▼に「縮尺の範囲を追加…」（説明「ページの一部に別の縮尺を決める（詳細図など）」）。押すと、図面の上で四角をドラッグして範囲を描く状態になり（上に `縮尺の範囲を四角で囲んでください（Esc でやめる）` の帯）、描き終えると縮尺の画面を「縮尺の範囲の設定（N ページ）」として開く（比率・2点のなぞりは今と同じ。「すべての同じ大きさのページに」は出さない。名前の欄 `範囲の名前（任意）` を足す）。決定で `setScaleRegions`。範囲の中にすでに計測・数量拾いがあれば、今の縮尺の画面と同じく「計算し直しますか」を聞く。
- 縮尺の画面（ページの縮尺）に「このページの縮尺の範囲」の一覧を足す（範囲があるときだけ）: 各行に名前・縮尺（`scaleLabel`）・「縮尺を変える」・「削除」。削除は `setScaleRegions`（範囲の中の計測があれば計算し直すかを聞く）。
- 図面の上の枠: 計測の道具・数量拾いの道具・範囲を描く状態・縮尺の画面を開いているときだけ、そのページの範囲を細い破線の四角（`#7a4cc2`、画面上 1px）と、左上に小さな札（`1/20` か `A部詳細 1/20`）で描く（`pointer-events: none`）。それ以外の道具のときは描かない。範囲の無いページでは何も描かない。
- 状態欄の縮尺のボタン（`status-scale`）: ページに範囲があれば `縮尺 1/100（範囲 2）`。ページの縮尺が無く範囲だけがあれば `縮尺の範囲 2` と出し、押すと縮尺の画面を開く。

## テスト

### 単体（`tests/`）

- `resolveScale`: 範囲の中・外、重なり（小さい方）、同じ面積（後ろの方）、範囲だけでページの縮尺が無い、両方無い（null）。
- PDF の読み書き（mupdf）: ページの縮尺と範囲2つを書いて読むと戻る。`writePageScale` の後に範囲が残る、`writeScaleRegions` の後にページの縮尺が残る、他のアプリの Viewport が残る。範囲の Viewport に `/Measure` が無い。今の `readPageScale` が、範囲があってもページの縮尺を返す（古い版の読み方の確認）。
- ストア: `setScaleRegions` の undo/redo、未保存の判定と保存の edit、範囲の計算し直しが始点の入るものだけ、ページの縮尺の計算し直しが範囲の外のものだけ。

### 画面（新規 `e2e/scale-regions.annotate.spec.ts`）

白紙1ページ（500×500pt）。ページの縮尺 1/100。長さの項目 CV。

1. 範囲の外で2点（100,100）→（172,100）をなぞる → 72pt × 1/100 = 2.54 m。
2. 計測▼ →「縮尺の範囲を追加…」→ (250,250)〜(450,450) を囲む → 1/20、名前 `A部詳細` → 決定。範囲の中で (300,300)→(372,300) をなぞる → 72pt × 1/20 = 0.51 m（`toFixed(2)`）。図面に `A部詳細 1/20` の札が見える（数量拾いの道具のとき）。選択の道具では見えない。
3. 範囲の縮尺を 1/10 に変えて「計算し直す」→ 範囲の中の経路だけ 0.25 m、外は 2.54 m のまま。Ctrl+Z で 0.51 m に戻る。
4. ページの縮尺を 1/200 に変えて計算し直す → 外の経路だけ 5.08 m、中は変わらない。
5. 範囲をまたいでなぞる（(200,300)→(300,300)）→ 状態欄に `縮尺の範囲をまたいでいます`。
6. 保存（`__karu.saveToBytes()`）して開き直す → 範囲（名前・縮尺・位置）と数量が戻る。mupdf で、ページの `/VP` に `/KaruScale` の Viewport が1つ、`/KaruScaleRegion` の Viewport が1つ、範囲の Viewport に `/Measure` が無い。
7. 範囲の無いページの PDF を開いて拾う流れが今と同じ（既存の `quantity-length` の e2e が通ること）。

## 禁止事項

- 範囲の無い PDF・ページで処理を足さないこと（開くときに `/VP` を見る以外の読み取りをしない、毎フレームの判定をしない）。
- 範囲の Viewport に `/Measure` を書かないこと。ページの縮尺の書き方を変えないこと。
- 既存の計測・数量拾いの値を、利用者が計算し直しを選ばない限り変えないこと。
- 試験から `work/` など Git の管理外のフォルダへ書き込まないこと。
- 対象外のファイルを変更しないこと。git の操作をしないこと。python・pytest は使わない。
- 試験の実行はしなくてよい（Claude Code が実行する）。書くだけでよい。`npx tsc --noEmit` は実行してよい。

## 検証項目

- [ ] `npx tsc --noEmit` が通る。
- [ ] 上の単体試験・e2e を書いた。

## 報告してほしいこと

- 保存の形の例（実際の `/VP` の中身）と、古い版での読まれ方の確かめ方
- 変更したファイルと要点
- SPEC から逸脱した箇所と理由、残課題
