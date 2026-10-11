# SPEC-S18: 平面図に部屋の範囲を囲み、その中の拾いに部屋を入れる

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: ページごとの保存データを足し、読込み（Worker）→ストア→保存→画面までを通す。縮尺の範囲（scale regions）と同じ道筋を、取りこぼしなく作る判断が要る

---

## 利用者の要望

> 平面図上で部屋の範囲指定をできるようにしたい。部屋指定された範囲で器具等の拾いがされた場合は、集計表数量拾いの部屋情報にはその部屋の情報も反映されるようにしたい。

利用者の選択：
- 部屋の範囲は**多角形で囲む**。囲んだ後に部屋名を入れる。
- 後から囲んだとき、中の既存の拾いの部屋は**たずねてから反映**（Ctrl+Z で戻せる）。
- 線の拾い（配線など）は、**始点のある部屋**にする（切り分けない）。
- 範囲は**アプリだけで表示**する。PDF には範囲の情報だけを保存し、他のビューアーでは見えない（縮尺の範囲と同じ扱い）。

## 現状（Claude Code が確かめたこと）

- 拾いの階・部屋：`AnnotationStore.pickupLocation(pageIndex)` が、「現在の場所」の階（空なら図面名からの推定）と部屋を返す。呼ぶ場所：
  - `AnnotationStore.ts` 381 行付近（`createCountMarks`、同じ記号を探すの数量への追加）
  - `AnnotationLayer.tsx` 767 行付近（個数のクリック）
  - `MeasurementOverlay.tsx` 319 行付近（長さ・面積・体積の拾い）
- 集計表の「階・部屋別」は、拾いの `floor`・`room` から作る（`quantityIndex.ts`）。
- 縮尺の範囲（ページの中の別の縮尺）の道筋（手本）：
  - 読み書き：`measure.ts` の `readScaleRegions(page)`・`writeScaleRegions(doc, page, regions)`・`readDocumentScaleMetadata(doc)`（`pageScaleRegions: Array<[pageIndex, ScaleRegion[]]>`）。
  - 保存の編集：`annotations.ts` の `{ kind: 'setScaleRegions'; pageIndex; regions }`（1499 行付近）。
  - Worker：`pdf.worker.ts` 419 行付近で開くときに読む。`protocol.ts` の結果の型に `pageScaleRegions`。`PdfWorkerPool.ts` で受け渡し（開く・ページの組み直し・ヘッダー等）。
  - アプリ：`App.tsx` 822 行付近と `documentModel.ts` 206 行付近で `annotationStore.loadScaleRegions(...)`。
  - ストア：`scaleRegions`・`scaleRegionBaselines`・`pendingScaleRegions`・`loadScaleRegions`・`getScaleRegions`・`setScaleRegions`（Undo つき）・`toEdits` で差分だけを保存。
- 除外範囲を囲む操作（SPEC-S17）：`store.startAreaHoles(id)`・`areaHoleTarget`・`endAreaHoles()` と、`MeasurementOverlay.tsx` の多角形の描き方。

## 変更内容

### 1. データ（新規 `src/core/rooms.ts`）

- `RoomRegion = { id: string; name: string; floor?: string; points: Point[] }`（ページの pt 座標）。
  - `name`：1〜40 文字、前後の空白なし、改行なし。`floor`：0〜40 文字（空なら無し）。`points`：3〜500 点、有限。1 ページ 200 個まで。
- `parseRoomRegions(raw)`・`serializeRoomRegions(regions)`：決まりに合わないものは捨てる。
- `readRoomRegions(page)`・`writeRoomRegions(doc, page, regions)`：ページの辞書の `KaruRooms` に JSON の文字列で保存（空なら消す）。
- `readDocumentRoomRegions(doc): Array<[pageIndex, RoomRegion[]]>`。
- `roomAt(regions, point): RoomRegion | undefined`：点を含む範囲（辺の上も含む）。重なっていれば、面積の小さいほう（内側の部屋を優先）。
- 拾いの位置の決め方（関数にする。例：`pickupPoint(...)`）：
  - 個数：印の中心。
  - 長さ（線）・長さ×高さ・長さ×幅×深さ：始点。
  - 囲む・囲む×深さ：多角形の重心（面積で重み付けした重心。面積 0 なら頂点の平均）。

### 2. 保存と読込みの道筋（縮尺の範囲と同じ）

- `annotations.ts`：編集 `{ kind: 'setRoomRegions'; pageIndex; regions }` を足し、`writeRoomRegions` で書く。ページの再描画を伴わない編集として扱う（`documentModel.ts` 189 行付近の除外の並びに足す）。
- Worker：開くとき・ページの組み直し・ヘッダー等の結果に `pageRoomRegions` を足す（`pageScaleRegions` と同じ所すべて）。`protocol.ts`・`PdfWorkerPool.ts` の型と受け渡しも同じく。
- アプリ：`loadScaleRegions` を呼んでいる所すべてで、`loadRoomRegions(result.pageRoomRegions ?? [])` を呼ぶ。
- ページの組み直しで、部屋の範囲はページと一緒に動く（ページの辞書にあるため。確かめるだけ）。

### 3. ストア（`AnnotationStore.ts`）

- `roomRegions`（ページ → 一覧）・基準・保存待ちを、縮尺の範囲と同じ作りで持つ。`reset` で消す。
- `loadRoomRegions(entries)`・`getRoomRegions(pageIndex)`・`setRoomRegions(pageIndex, regions)`（Undo つき。履歴に `roomRegions` を足す。縮尺の範囲の `scaleRegions` と同じ扱い）。
- `toEdits`・保存後の処理：縮尺の範囲と同じく、変わったページだけ `setRoomRegions` を出す。
- `pickupLocation(pageIndex, point?)`：
  - `point` があり、そのページの部屋の範囲に入れば：`room` はその部屋名。`floor` はその範囲の `floor`、無ければ今と同じ（現在の階か図面名からの推定）。
  - 入らなければ今と同じ。
  - `point` が無ければ今と同じ。
- 3 つの呼ぶ場所で、拾いの位置（1 の決め方）を渡す。同じ記号を探すの追加（`createCountMarks`）は候補の中心。
- 部屋の範囲に入る既存の拾いを探す関数（例：`pickupsInRoom(pageIndex, region): string[]`）。拾いの位置（1 の決め方）で判定する。個数・長さ・面積・体積の拾いすべて。
- 表示の切替：`showRoomRegions`（初期値 true、保存しない）と `setShowRoomRegions`。
- 部屋の範囲を囲む状態：`roomCapturePage: number | null`、`startRoomCapture(pageIndex)`・`endRoomCapture()`（S17 の除外範囲と同じ作り）。

### 4. 画面

**数量タブの「現在の場所」の行（`FixturePanel.tsx`）**
- ボタン「部屋の範囲を囲む」：表示中のページで、部屋の範囲を囲む状態にする。
- その下に、表示中のページの部屋の一覧（無ければ出さない）。行ごと：部屋名（階があれば「1階 事務室」）、「名前を変える」、「削除」。
  - 「名前を変える」は名前と階を入れ直す（下の名前の入力と同じ）。範囲の中の拾いの部屋は変えない（変えたいときは囲み直す）。
  - 削除は 1 回の Undo で戻せる。拾いの部屋は変えない。
- 「表示の設定・図面番号」の折りたたみに、チェック「部屋の範囲を表示」（`showRoomRegions`）。

**囲む操作（`MeasurementOverlay.tsx`）**
- 部屋の範囲を囲む状態のとき、面積と同じ多角形の描き方で囲む（クリックで点、ダブルクリックか Enter で決定、Backspace で 1 点戻す、Esc でやめる）。案内：「部屋の範囲を囲んでください（Enter・ダブルクリックで決定、Esc で中止）」。
- 決定すると、部屋名を入れる小さな画面（`<dialog>`、`aria-label="部屋の範囲"`）：
  - 「部屋名」（必須、候補は今の文書の部屋名の一覧）、「階」（初期値は現在の階か図面名からの推定）。
  - 「登録する」で `setRoomRegions` に足す。「やめる」で何もしない。
- 登録した範囲の中に既存の拾いがあれば（`pickupsInRoom`）、たずねる：
  - 「この範囲の {N} 件の拾いの部屋を「{部屋名}」にしますか（Ctrl+Z で戻せます）」［部屋を入れる］［入れない］。
  - 「部屋を入れる」：その拾いの `room` を部屋名にし、範囲に `floor` があれば `floor` も入れる。今の `updatePickupLocation(ids, key, value)` を使い、範囲の登録とは別の 1 回の Undo にする。
- 登録したら、囲む状態を終える。

**図面の表示（`AnnotationLayer.tsx`、`styles.css`）**
- `showRoomRegions` が true のとき、そのページの部屋の範囲を、薄い色の塗り（例：青系 8% 程度）と細い破線、部屋名（重心の位置、小さな文字）で描く。拾い・書き込みの操作を邪魔しない（`pointer-events: none`、拾いの印より下）。
- 通常の閲覧（部屋の範囲が無いページ）では、何も描かない。

### 5. ヘルプ（`src/app/HelpDialog.tsx`）

数量タブの現在の場所の説明の近くに足す：

> 「部屋の範囲を囲む」で平面図の部屋を囲み、部屋名（と階）を入れると、その範囲の中で拾った器具などに部屋名が入ります（線の拾いは始点、囲む拾いは重心の位置で判定）。範囲の外では「現在の場所」の部屋を使います。後から囲んだときは、中の既存の拾いに部屋を入れるかたずねます。部屋の範囲はアプリの表示だけで、PDF の見た目には描きません。「表示の設定・図面番号」の「部屋の範囲を表示」で表示を切り替えられます。

## 変えないこと

- 部屋の範囲が無いページの拾いの階・部屋（今と同じ）。
- 縮尺の範囲・保存・ページ操作のほかの結果。通常の閲覧の速さ（範囲の無いページで描画・計算を足さない）。

## 試験

**単体**（新規 `tests/rooms.test.ts`）：
- `parseRoomRegions`・`serializeRoomRegions`：決まりに合わないものを捨てる、上限。
- `roomAt`：中・外・辺の上、重なりは小さいほう。
- 拾いの位置の決め方（個数・線の始点・多角形の重心）。
- ストア：`setRoomRegions` の Undo、`pickupLocation(page, point)` の優先順、`pickupsInRoom`。
- PDF：`setRoomRegions` で保存して読み直すと同じ。ページの組み直しでページと一緒に動く。

**画面**（新規 `e2e/room-regions.annotate.spec.ts`）：
1. 「部屋の範囲を囲む」で四角を囲み、「事務室」を登録 → 図面に範囲と名前が出る。
2. その範囲の中で個数を拾う → 拾いの部屋が「事務室」。範囲の外で拾う → 現在の場所の部屋。
3. 既存の拾いがある所に別の範囲を囲む → たずねる → 「部屋を入れる」で部屋が変わる。Ctrl+Z で戻る。
4. 線を範囲の中から外へ引く → 始点の部屋。
5. 集計表の「階・部屋別」に部屋の列が出る。
6. 保存して開き直すと、範囲が残る。「部屋の範囲を表示」を外すと見えない。

## 対象

- 新規：`src/core/rooms.ts`、試験ファイル
- 変更：`src/core/annotations.ts`、`src/worker/pdf.worker.ts`、`src/worker/protocol.ts`、`src/client/PdfWorkerPool.ts`、`src/App.tsx`、`src/app/documentModel.ts`、`src/editor/AnnotationStore.ts`、`src/editor/AnnotationLayer.tsx`、`src/editor/MeasurementOverlay.tsx`、`src/app/FixturePanel.tsx`、`src/app/HelpDialog.tsx`、`src/styles.css`
- 変更しないファイル：上以外。

## 禁止事項

- 既存の関数名・入力名・文言を、SPEC にない形で変えないこと（引数を足すのはよい）。
- git の操作をしないこと。python・pytest は使わない。

## 報告してほしいこと

- 変更点、SPEC から逸脱した箇所と理由、Claude Code に実行してほしい試験。
