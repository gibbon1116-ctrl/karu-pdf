# SPEC-06b: 選択中の線・図形・数量拾いを、表示だけ一時的に最前面に出す

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 注釈の描画層（`AnnotationLayer`）の描く順番と、PDF の画像に描かれた保存済みの注釈の重ね描きを扱い、性能と保存の順番を壊さないことが条件のため（判定表「既存アプリの中核ロジック改修」）

---

## 目的

利用者の要望: 線・連続線・面・図形・数量拾い（ケーブル・配管・ダクト・ラック・面積・体積）が重なると、選んだものが他の要素の下に隠れ、何を選んでいるかわかりにくい。選んでいる間だけ、表示上で最前面に出す。

条件:

- PDF の中の注釈の順番、保存する順番、作った順番を変えない。
- 選択を外すと元の表示に戻る。
- 複数選んだときは、選んだもの全体を選んでいないものより前に出し、選んだもの同士の元の順番は保つ。
- 選んだことがわかる強調は足してよいが、線や図形の元の色を誤認させない。
- PDF の再描画をしない。全注釈の再集計・Worker の処理を足さない。

## 現状（Claude Code が確認したこと）

- `src/editor/AnnotationLayer.tsx` が1ページ分の SVG を描く。`annotations`（`store.getPageAnnotations(pageIndex)` を `isShownOnDrawing` で絞ったもの、作った順）を `annotations.map(renderAnnotation)` で描き、その後に個数の印のまとめ描き（`countPaths`、印が 500 を超えるとき）と略号の文字を描く。
- 保存済みで編集していない線・図形などは、PDF のページ画像（MuPDF）の中に描かれ、SVG では `visible` が false（当たり判定の透明な図形だけ）。数量拾い（`annotation.quantity`）・個数の印（`annotation.count`）・指摘・編集した注釈（`touched`）・保存前の注釈は SVG に描く（`visible` の式は `renderAnnotation` の中）。
- 選択の枠は `<rect className="annotation-selection">`（薄い青の塗りと破線、SPEC-05g）。

## 対象

- 対象フォルダ: `C:\Users\gibbo\Desktop\PDF編集アプリ\.claude\worktrees\karupdf-quantity-ui-8301e6`
- 変更してよいファイル: `src/editor/AnnotationLayer.tsx`、`src/editor/MeasurementOverlay.tsx`（`MeasurementShape` に強調を足す場合のみ）、`src/styles.css`、`tests/`、新規 `e2e/selection-front.annotate.spec.ts`
- 変更しないファイル: 上以外（特に `AnnotationStore.ts`・`annotations.ts`・保存の処理）。`docs/`、設定ファイル、`scripts/`

## 変更内容

### 1. 描く順番（SVG の中）

- `renderAnnotation` で描く順番を「選んでいないもの（元の順）→ 選んだもの（元の順）」にする。配列をこの描画のために並べ替えるだけで、`store` の中の順番は変えない。選択が1件も無いときは今と同じ配列をそのまま使う（余分な配列を作らない）。
- 個数の印のまとめ描き（`countPaths`）: 選んだ印を含むグループ（`group.selected`）を、選んでいないグループの後に描く。単一選択の印は今どおりまとめ描きから外して個別に描くが、その個別の描画も、まとめ描きより後（最前面）になるようにする（今は `annotations.map` の中で描かれ、その後のまとめ描きに隠れうる）。
- 当たり判定の順番も描く順番に従う（選んだものが上）。これは意図どおりとする。

### 2. PDF の画像の中にある選択中の注釈を SVG に重ねる

- 選択中（`selectedIds.has(id)`）で、今は `visible` が false の注釈のうち、SVG の描画が遅延で読む文字の配置（`annotation.layout`）に頼らない種類 — 線・矢印・四角・丸・手書き・雲・距離・連続した長さ・面積（`measure`）・記号 — は、SVG にも描いて（`visible` を true として扱い）画像の上に出す。画像の中にも同じものがあるので、重ねて描いても形と色は同じ。
- ただし、不透明度が 1 未満のもの（`opacity < 0.99`）と蛍光ペン（`highlight`）・文字ハイライトは、重ねると濃く見えて色を誤認させるので重ねない（下の強調だけ付ける）。文字・吹き出し（`freetext`・`callout`）も重ねない（文字の配置の読み込みを増やさないため）。
- この重ね描きは選択中だけ。PDF の画像（`touchedObjNums`・除外する注釈の一覧）は変えない。**選択の変更でページの再描画を起こさないこと**（`touchedObjNums` に入れない、`store.touch` を呼ばない）。

### 3. 選んだことがわかる強調（色は変えない）

- 選んだ線状のもの（線・矢印・手書き・距離・連続した長さ・面積の輪郭・数量拾いの経路と面・雲）には、その線の**下**に、白の半透明の縁（`stroke: #fff`、不透明度 0.85、線幅 = 元の線幅 + 画面上で 4px 相当、`vector-effect` などで画面の拡大率によらず見える幅にする）を描く。元の線の色・線種・太さは変えない。
- 既存の選択の枠（`annotation-selection`）と、選択ツールでの頂点の取っ手は今のまま。
- 個数の印は今の青い輪郭（`group.selected`、個別描画の選択の枠）のまま。

### 4. 性能

- 選択が無いときの描画の手間を今と同じにする（並べ替え・重ね描きの判定は、選択があるときだけ）。
- 選択の変更は SVG の再描画だけで済むこと（PDF の画像の描き直し・Worker への依頼が起きない）。

## テスト

### 単体（`tests/`）

描く順番を決める純粋な関数を切り出してよい（例: `frontOrder<T extends { id: string }>(items: readonly T[], selected: ReadonlySet<string>): readonly T[]`、選択が空なら同じ配列を返す）。その試験: 選択なし → 同じ配列（同一参照）、1件 → 末尾へ、複数 → 選んだもの同士の元の順を保って末尾へ。

### 画面（新規 `e2e/selection-front.annotate.spec.ts`）

mupdf で作る白紙1ページの PDF を `__karu.openBytes` で開く（`e2e/quantity-location-route.annotate.spec.ts` の作り方を参考）。

1. 長さの項目を2つ（色の違う CV と PF28）作り、縮尺 1/100 を付け、ほぼ同じ所を通る経路を2本なぞる（1本目 CV、2本目 PF28）。選んでいない状態で SVG の `g[data-annotation-id]` の順番が作った順（CV が先）。
2. 1本目（CV）を選ぶ → SVG の中で CV の `g` が PF28 より後（最前面）。選択を外す（Esc か何もない所をクリック）→ 元の順に戻る。
3. Shift で2本とも選ぶ → 2本とも選んでいない注釈（別に置いた個数の印など）より後で、2本の間は元の順。
4. 保存（`__karu.saveToBytes()`）して mupdf で開き、1ページ目の注釈の順番（`listAnnotations` の objNum の並び）が、選ぶ前に保存したものと同じ。
5. 保存済みの線（「線」の道具で1本引いて保存し、開き直す）を選ぶと、SVG にその線の `line` が描かれ（`visible`）、選択を外すと SVG の線は消える。選択の前後で、そのページの画像の描き直しが起きないこと（`__karu.getWorkerStats()` などで描画の依頼の数が増えないことを確かめる。確かめる手段が無ければ、`PageView` の画像の `src`・`data-*` が変わらないことで代える）。
6. 選んだ経路の下に白の縁（`stroke="#fff"` か、そのための `className`）があり、経路の線の `stroke` の色は選ぶ前と同じ。

## 禁止事項

- `store` の注釈の順番、保存する順番、PDF の `/Annots` の順番を変えないこと。
- 選択の変更でページの画像を描き直さないこと。全注釈の再集計・Worker の処理を足さないこと。
- 線・図形の色を変える強調をしないこと。
- 試験から `work/` など Git の管理外のフォルダへ書き込まないこと。
- 対象外のファイルを変更しないこと。git の操作をしないこと。python・pytest は使わない。
- 試験の実行はしなくてよい（Claude Code が実行する）。書くだけでよい。`npx tsc --noEmit` は実行してよい。
- 同じ作業フォルダで、別の作業（保存状態の改修: `App.tsx`・`AnnotationStore.ts`・`documentModel.ts` など）が同時に進んでいる。対象外のファイルに型エラーや変更があっても触らず、報告だけすること。

## 検証項目

- [ ] `npx tsc --noEmit` が通る。
- [ ] 上の単体試験・e2e を書いた。

## 報告してほしいこと

- 変更したファイルと要点（重ね描きの対象にした種類・しなかった種類と理由）
- SPEC から逸脱した箇所と理由、残課題
