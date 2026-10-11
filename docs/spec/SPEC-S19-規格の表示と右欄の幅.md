# SPEC-S19: 規格を図面の略号に付けない・集計表の規格欄・開口部の横スクロール・右欄の幅

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 略号の表示は、アプリの描画・PDF の見た目・札の文字・集計表・Excel の 5 か所にまたがる。どこを変えて、どこを変えないかの判断が要る。右欄の幅は、グリッドの列と分割表示に関わる

---

## 利用者の要望

> 数量拾いの項目を編集で規格を記入すると、略号に反映されるが、略号に反映させると図面が見にくくなるため中止したい。集計表には、名称と単位の間に規格欄を作成したい。壁仕上げで開口部を追加をクリックすると、横スクロールが発生し、操作性が悪い。横スクロールはなくしたい。また、画面右側の数量拾い欄の表示スペースの変更ができない。変更できるようにしたい。ただし、入力マスの大きさ等の関係で表示するための最小幅を設定する必要がある場合は、最小幅は確保するようにしたい。

## 現状（Claude Code が確かめたこと）

- `src/core/countFixtures.ts` 27 行：`fixtureCode(f)` は `[f.code, f.spec].filter(Boolean).join(' ')`（例：略号 `DS`、規格 `1.2m*2m` → `DS 1.2m*2m`）。これが図面の印の横の文字、拾いの札、集計表の「略号」に使われている。
- 図面の印の横の文字：
  - アプリ：`src/editor/AnnotationLayer.tsx` 901 行付近 `<CountMarker ... code={fixtureCode(fixture)} .../>`
  - PDF の見た目：`src/core/annotations.ts` の `drawCountMarker`（1152・1164・1166 行付近）、見た目の再利用の鍵（1367 行付近）、個数の印の大きさ（1703 行付近）
  - 書式欄の印の見本：`src/app/FormatPanel.tsx` 192 行付近
- 長さ・面積・体積の札（図面に描く文字）：`quantityLabel(..., code, showCode, extraCode, openingSize)` に `fixtureCode(f)` を渡している。
  - `src/editor/AnnotationStore.ts` 1254 行付近 `quantityText`（拾いの札を作り直すとき）
  - `src/editor/MeasurementOverlay.tsx` 205 行付近 `extraCode`、355・412 行付近
- 集計表：`src/app/QuantityTable.tsx` 357〜400 行付近。固定列は「見本・略号・名称・単位・全図面」（幅 44・100・150・50・90、`styles.css` 131〜134 行で `left`）。「略号」は `fixtureCode(f)`。
- Excel：`src/app/quantityXlsx.ts` も同じ 5 列で、「略号」は `fixtureCode(fixture)`。
- CSV（`annotationCsv.ts`）は、すでに「略号」（`f.code`）と「規格」の列が分かれている。変えない。
- 書式欄の「開口部（差し引く）」（`FormatPanel.tsx` 356 行〜の `QuantityOpenings`）：
  - 一覧の `<ol>` に `maxHeight: 360, overflowY: 'auto'` があり、欄の中に小さなスクロール枠ができる（`overflow-y: auto` のため横にもスクロールする）。
  - 選択欄の建具名（例：`DS 1.2m*2m 片開き戸（1.20×2.00）`）や入力欄が欄の幅を超え、書式欄（`.format-panel`、`overflow-y: auto`）にも横スクロールが出る。
- 右欄（書式欄）の幅：`styles.css` 109〜112 行の `.document-workspace` の `grid-template-columns` で 210px に固定。左の欄は `src/app/SidePanel.tsx` で幅を変えられる（`role="separator"`、`localStorage` の `karu-pdf:side-panel-width`、220〜480px）。

## 変更内容

### 1. 規格を図面の略号に付けない

- `countFixtures.ts` に `fixtureDrawingCode(f)` を足す。個数・面積・体積の項目は `f.code`、長さの項目（`kind === 'length'`）は今までどおり `fixtureCode(f)`。
  - 追記（利用者の判断、Codex の実装の後）：標準マスタの配線（CV・VVF・IV・FP など）は太さ・心数を規格に持つ（略号 CV、規格 38sq-3C）。規格を外すと配線の札が「CV（立上り）×2」になり太さが分からないため、利用者に確かめ、「線の拾いだけ規格を残す」となった。
- 次の場所は `fixtureCode` の代わりに `fixtureDrawingCode` を使う（**図面に描く文字だけ**）：
  - アプリの印の横の文字（`AnnotationLayer.tsx`）、書式欄の印の見本（`FormatPanel.tsx` 192 行付近。見本の幅の計算も）。
  - PDF の見た目（`annotations.ts` の `drawCountMarker`、見た目の再利用の鍵、個数の印の大きさの計算）。
  - 長さ・面積・体積の札に渡す `code` と `extraCode`（`AnnotationStore.quantityText`、`MeasurementOverlay.tsx`）。
- 次の場所は、今のまま `fixtureCode`（略号＋規格）を使う：
  - 項目を選ぶ所（最近使った項目、拾いバー、項目の検索、書式欄の「項目を変更」・開口部の建具の選択、線の構成）。規格だけが違う項目（例：DL φ150 と DL φ125）を見分けるため。
  - 注釈の内容の文（`個数: DS 1.2m*2m 片開き戸` など。図面には描かない）、状態の文、`aria-label`。
- 既存の拾い：
  - アプリの図面の印は、表示のたびに項目から描くので、すぐ規格なしになる。
  - 保存済みの札の文字と PDF の見た目は、開いただけでは変えない（通常の閲覧を重くしない）。
  - 「項目を編集」で項目を保存したときは、変更が無くても、その項目の拾いの札と見た目を作り直す。
    - `setCountFixtures(fixtures, removeIds, refreshIds?)` のように引数を足し、`FixturePanel.saveFixture` で編集した項目の id を渡す。
    - 作り直すのは、その項目の拾いのうち、札の文字が変わるもの（長さ・面積・体積）と、`style.showCode` が有効で規格のある項目の個数の印だけ。何も変わらなければ履歴を積まず、未保存にもしない。
    - 1 回の Ctrl+Z で戻せる（今の `setCountFixtures` の履歴と同じ 1 回）。

### 2. 集計表と Excel に「規格」の列

- 集計表（`QuantityTable.tsx`）：固定列を「見本・略号・名称・規格・単位・全図面」にする。
  - 「略号」は `f.code`。「規格」は `f.spec ?? ''`（施工条件の行は空）。
  - 規格の列の幅は 90px。固定列の `left` と表の幅（`434 + 列数 × 140`）、区分の行の `colSpan`、間隔の行の `colSpan` を合わせて直す（`styles.css` の `.quantity-table-fixed-*`）。
  - 項目の検索（126 行付近）は、今のまま略号・規格・名称で探せる。
- Excel（`quantityXlsx.ts`）：集計表と同じ列にする（「略号」は `fixture.code`、「規格」は `fixture.spec ?? ''`）。列の幅・見出しの結合・見本の画像の位置（0 列目のまま）を合わせて直す。明細のシートは変えない。
- CSV は変えない。

### 3. 開口部の欄に横スクロールを出さない

- `QuantityOpenings` の `<ol>` の `maxHeight`・`overflowY` を外し、書式欄全体の縦スクロールだけにする。
- 開口部の欄の中のもの（選択欄・入力欄・行の面積と削除）が、書式欄の幅（最小幅のときも）に収まるようにする。
  - 選択欄・入力欄は `width: 100%`、`max-width: 100%`、`min-width: 0`、`box-sizing: border-box`。
  - 幅・高さの 2 つの入力は、収まらなければ折り返す（`flex-wrap: wrap`、各 `flex: 1 1 80px; min-width: 0`）。
  - 長い建具名は選択欄の中で切れてよい（選択欄の幅は増やさない）。
  - 箇条の番号（1. 2.）の左の余白で、はみ出さないようにする。
- 書式欄（`.format-panel`）は `overflow-x: hidden` にする。ただし、はみ出しを隠すだけで済ませず、書式欄のほかの欄（除外範囲・施工条件・線の構成など）も最小幅で横にはみ出さないことを試験で確かめる。
- インラインの `style` が多いので、CSS のクラス（例：`.quantity-openings`、`.quantity-opening-row`、`.quantity-opening-size`）に移してよい。文言・`aria-label` は変えない。

### 4. 右欄（書式欄）の幅を変えられるようにする

- 書式欄の左端に、つまみ（`role="separator"`、`aria-label="右の欄の幅"`、`aria-orientation="vertical"`、`aria-valuemin`・`aria-valuemax`・`aria-valuenow`、`tabIndex={0}`）を置く。
  - ドラッグで幅を変える（左へ動かすと広がる）。←・→ キーで 10px ずつ（← で広がる）。
  - 幅は `localStorage` の `karu-pdf:format-panel-width` に覚える（ドラッグを終えたとき・キーで変えたとき）。読めないとき・値がおかしいときは 210px。`localStorage` が使えなくても動く（今の `SidePanel.tsx` と同じ）。
- 最小幅 210px（今の幅。色・記号の並びと入力欄が収まる幅）。最大幅 560px。ただし、図面の欄が狭くなりすぎないよう、ウィンドウの幅の 45% を超えない（210px より小さくはしない）。ウィンドウの大きさを変えたときも、この範囲に収める。
- `.document-workspace` の `grid-template-columns` の 210px を、CSS の変数（例：`var(--format-panel-width, 210px)`）にし、`DocumentWorkspace` の要素の `style` で変数を設定する。書式欄を隠しているとき（`format-hidden`）は今のまま。
- 分割表示（`SplitView`）でも同じ幅を使う（右欄は 1 つ）。
- つまみは、左の欄のつまみと同じ見た目（`.side-panel-resizer` を参考に）。図面の操作を邪魔しない。

### 5. ヘルプ（`src/app/HelpDialog.tsx`）

数量拾いの項目の説明の近くに足す：

> 項目の規格は、個数の印と面積・体積の札の略号には付けません。線（配線・配管）の札には、太さ・心数が分かるよう規格も付けます。項目を選ぶ一覧では、規格も並べて表示します。集計表と Excel では「規格」の列に出ます。右の欄の幅は、左端のつまみをドラッグして変えられます。

## 変えないこと

- CSV の列と値。項目のデータ（`code`・`spec` の保存の形）。
- 規格の無い項目の表示と札。
- 通常の閲覧（開いたときに拾いの札を作り直さない）。
- 左の欄の幅の仕組み。

## 試験

**単体**：
- `fixtureDrawingCode` は規格を付けない。
- `quantityText`（または `quantityLabel` を呼ぶ所）：規格のある項目の札に規格が入らない。
- `setCountFixtures(..., refreshIds)`：規格のある項目の札が作り直され、1 回の Undo で戻る。変わらないときは履歴を積まず、未保存にしない。
- PDF の見た目：規格のある個数の項目で保存すると、見た目の文字が略号だけ（既存の見た目の試験を参考に）。
- Excel（`tests/quantityXlsx.test.ts`）：見出しが「見本・略号・名称・規格・単位・全図面・…」で、規格の値が入る。

**画面**（既存の `e2e/quantity-table.annotate.spec.ts` の列の数などを直す。新しい試験は `e2e/format-panel-width.annotate.spec.ts` など）：
1. 規格のある個数の項目で拾う → 図面の印の横の文字が略号だけ。集計表の「略号」が略号だけで、「規格」の列に規格が出る。
2. 面積の拾い（長さ×高さ）を選び、「開口部を追加」を 3 回（建具を 1 つ、寸法を入力を 2 つ）→ 書式欄（210px）に横スクロールが無い（`scrollWidth <= clientWidth`）。開口部の一覧に別のスクロール枠が無い。
3. 右欄のつまみを左へドラッグ → 書式欄が広がる。再読込しても幅が残る。最小幅より狭くならない。キーの ←・→ で変わる。
4. 右欄の幅を最大にしても、図面の欄が残る（ウィンドウ 1280px で図面の欄が 500px 以上など）。

## 対象

- 変更：`src/core/countFixtures.ts`、`src/core/annotations.ts`、`src/editor/AnnotationLayer.tsx`、`src/editor/AnnotationStore.ts`、`src/editor/MeasurementOverlay.tsx`、`src/app/FormatPanel.tsx`、`src/app/FixturePanel.tsx`、`src/app/QuantityTable.tsx`、`src/app/quantityXlsx.ts`、`src/app/DocumentWorkspace.tsx`、`src/app/HelpDialog.tsx`、`src/styles.css`、既存の試験
- 新規：試験ファイル
- 変更しないファイル：上以外（`annotationCsv.ts` は変えない）。

## 禁止事項

- 既存の関数名・入力名・文言を、SPEC にない形で変えないこと（引数を足すのはよい）。
- git の操作をしないこと。python・pytest は使わない。

## 報告してほしいこと

- 変更点、SPEC から逸脱した箇所と理由、Claude Code に実行してほしい試験。
