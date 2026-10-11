# SPEC-S22: 部屋の組を図面ごとに位置合わせする（支点とマウス操作）

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: ページの結び付けに「ずらし量」を足し、読込み（Worker）→ストア→保存→画面まで通す。組の範囲を直す・囲んで足す（S20・S21）を、ずらした座標と組の座標の行き来で壊さない判断が要る

---

## 利用者の要望

> 図面ごとに、平面図の縮尺や部屋の大きさ等は同じでも、図面上で配置されている座標がずれているため、設定した部屋の範囲が部屋ごとに異なるという問題が発生している。部屋の組ごとに、図面上での支点を決めて、座標の調整ができるようにしたい。マウス操作で調整ができるようにしたい。

前提（利用者の説明から）：縮尺と部屋の大きさは同じ。ずれは平行移動だけ（回転・拡大縮小はしない）。

## 現状（Claude Code が確かめたこと。S21 `b1d30bb`）

- 組：カタログの `KaruRoomSets`（`RoomSet = { id; name; floor?; regions }`）。ページの結び付け：ページの辞書の `KaruRoomSet` に組の id（文字列）。
  - `src/core/rooms.ts`：`readRoomSets`・`writeRoomSets`・`readPageRoomSet`・`writePageRoomSet`・`readDocumentPageRoomSets`・`readDocumentRoomMetadata`。
  - 道筋：`pageRoomSets: Array<[number, string]>` が Worker（`pdf.worker.ts` 421 行付近ほか）・`protocol.ts`・`PdfWorkerPool.ts`・`App.tsx`・`documentModel.ts` を通り、`store.loadRoomSets(sets, links)`。
  - 保存の編集：`setRoomSets`・`setPageRoomSet { pageIndex; setId }`。
- ストア：`pageRoomSets`（ページ → 組の id）、`effectiveRoomRegions(pageIndex)`（ページの範囲 ＋ 組の範囲）、`addRoomRegion(page, region, toSet)`・`updateRoomRegion`・`removeRoomRegion`、S20 の形の編集（`startRoomEdit` ほか）。
- 画面：`FixturePanel.tsx` の部屋の組の欄（組を使っているとき：「部屋の組「1階」を使っています（N 図面で共通）」「組を外す」「組の名前を変える」「組を削除」）。図面の操作は `MeasurementOverlay.tsx`、描画は `AnnotationLayer.tsx`。
- スナップ：`MeasurementOverlay` の `resolvePoint`（既存の頂点・図面の線の端点。Alt で解除）。
- 他の PDF へページを写すとき（`pageOps.ts` の `graftDrawingPage`）、組の範囲をページの範囲として写す。

## 変更内容

### 1. データ

- 組に支点を足す：`RoomSet.anchor?: Point`（組の座標。1 つ）。
- 結び付けにずらし量を足す：`RoomSetLink = { id: string; dx?: number; dy?: number }`（pt。無ければ 0）。
  - ページの辞書 `KaruRoomSet`：ずらしが 0 なら今と同じ id の文字列、ずらしがあれば JSON `{"id":…,"dx":…,"dy":…}`。読むときはどちらも受け付ける（S21 で保存した PDF も読める）。
  - `dx`・`dy` は有限で、絶対値 100,000pt 以内。
- 道筋の型 `pageRoomSets` を `Array<[number, RoomSetLink]>` にする（Worker・protocol・Pool・App・documentModel・ストアの読込み）。保存の編集 `setPageRoomSet` に `dx?`・`dy?` を足す。
- 図面で使う組の範囲 = 組の範囲の各点に `(dx, dy)` を足したもの（`effectiveRoomRegions`）。拾いの部屋の判定（`pickupLocation`・`pickupsInRoom`・`roomSetPickupChanges`）・描画・一覧は、ずらした範囲を使う。
- 組の範囲を直す・名前を変える・囲んで組に足す（S20・S21）を、ずらしたページで行ったときは、点から `(dx, dy)` を引いて組の座標に戻してから保存する（他の図面ではそれぞれのずらしで表示される）。
- 他の PDF へページを写すとき：組の範囲を、そのページのずらしを足した座標でページの範囲として写す。

### 2. 位置を合わせる操作（組を使っているページ）

- 部屋の組の欄に、ボタン「位置を合わせる」を足す（「組を外す」の前）。押すと位置合わせの状態（`store.startRoomSetAlign(pageIndex)`・`roomSetAlignPage: number | null`・`endRoomSetAlign()`。保存しない、履歴に入れない）。部屋の範囲を囲む・範囲を直す・除外範囲を囲む状態とは同時に使わない。
- 位置合わせの状態の図面：
  - その組の範囲を、ふだんより濃い枠で描く。支点があれば、ずらした位置に十字の印（`data-testid="room-set-anchor"`）を描く。
  - 案内（画面上部）：
    - 支点があるとき：「この図面で支点に当たる点をクリックすると、部屋の組を合わせます。範囲をドラッグしても動かせます（矢印キーで1pt、Shift で10pt。Enter・Esc で終える）」
    - 支点が無いとき：「部屋の組の支点にする点（通り芯の交点など）をクリックしてください。範囲をドラッグしても動かせます（Enter・Esc で終える）」
  - クリック（ほとんど動かさずに押して離す）：
    - 支点があるとき：その点に支点が来るように、このページのずらしを変える（`dx = 点x − anchor x`、`dy = 点y − anchor y`）。1 回の Undo。
    - 支点が無いとき：その点を組の支点にする（`anchor = 点 − (dx, dy)`）。ずらしは変えない。1 回の Undo。
    - クリックの点はスナップ（`resolvePoint`）を使う。
  - 組の範囲の中を押してドラッグ：範囲全体（と支点の印）が動いて見え、離すとずらしを変える（1 回の Undo）。
  - 矢印キー：1pt（Shift で 10pt）ずらす。続けて押した分は 1 回の Undo にまとめてよい（既存の `nudgeMany` と同じく 700ms 以内）。
  - 案内の中にボタン「支点を決め直す」：押すと、次のクリックで支点を決め直す（ずらしは変えない）。
  - Enter・Esc・部屋の組の欄の「合わせ終える」（位置合わせ中はボタン名を替える）で終える。
- 終えるとき：ずらしを変えていて、組の範囲の中に部屋（範囲に階があれば階も）が違う拾いがあれば、S21 の組を使い始めたときと同じ確認を出す（「この図面の {N} 件の拾いに部屋を入れますか（Ctrl+Z で戻せます）」）。範囲の外に出た拾いの部屋は変えない。
- ページを替える・道具を替える・組を外す／削除した（Undo を含む）ときは、確認を出さずに終える。
- 部屋の組の欄：組を使っているページで、ずらしがあれば「（位置を合わせ済み：右へ 12.0pt・下へ 5.0pt）」のように小さく出し、ボタン「位置を戻す」（ずらしを 0 にする。1 回の Undo）を出す。支点が無い組には「支点：未設定」と出す。

### 3. ヘルプ（`src/app/HelpDialog.tsx`）

部屋の組の説明（S21 で足した段落）の後に足す：

> 図面によって部屋の組の位置がずれるときは、部屋の組の欄の「位置を合わせる」を押します。初めに、組を作った図面で支点（通り芯の交点など、どの図面にもある点）をクリックして決めます。ほかの図面では、同じ点をクリックすると組の範囲がその位置に合います。範囲をドラッグしたり、矢印キー（Shift で大きく）で動かしたりして細かく合わせられます。Enter か Esc で終えます。合わせた位置は図面ごとに覚え、組の範囲を直すと、どの図面にもそれぞれの位置で反映されます。「位置を戻す」で元の位置に戻せます。

## 変えないこと

- ずらしの無い結び付け（S21 で保存した PDF）と、組を使わないページの部屋の範囲。
- 部屋の範囲も組も無いページの表示と速さ。

## 試験

**単体**（`tests/` に置く）：
- `KaruRoomSet` の読み書き：文字列の id と JSON の両方、ずらし 0 は文字列、不正な値は捨てる。
- ストア：`effectiveRoomRegions` がずらしを足す。ずらしたページで `updateRoomRegion`・`addRoomRegion(toSet)` すると組の座標に戻して保存し、別のページでは別のずらしで見える。支点の設定・ずらしの変更・位置を戻すがそれぞれ 1 回の Undo。
- 他の PDF へ写すと、ずらしを足した範囲がページの範囲になる。

**画面**（新規 `e2e/room-set-align.annotate.spec.ts`。手順は `e2e/room-sets.annotate.spec.ts` を参考に）：
1. 1 ページ目で範囲を囲んで組「1階」を作り、「位置を合わせる」→ 点をクリックして支点を決める。
2. 2 ページ目で組を使い、「位置を合わせる」→ 支点から (30, 20) ずらした点をクリック → 範囲が (30, 20) ずれる。1 回の Ctrl+Z で戻る。
3. 範囲をドラッグして動かす、矢印キーで 1pt・Shift で 10pt 動く。
4. ずらした 2 ページ目で、範囲の中で拾うと部屋が入る。範囲の外（ずらす前の位置）では入らない。
5. 2 ページ目で組の範囲を「範囲を直す」で広げる → 1 ページ目では、ずらしの無い位置で同じ形に広がっている。
6. 保存して開き直すと、ずらしと支点が残る。「位置を戻す」でずらしが 0 になる。

## 対象

- 変更：`src/core/rooms.ts`、`src/core/annotations.ts`、`src/core/pageOps.ts`、`src/worker/pdf.worker.ts`、`src/worker/protocol.ts`、`src/client/PdfWorkerPool.ts`、`src/App.tsx`、`src/app/documentModel.ts`、`src/editor/AnnotationStore.ts`、`src/editor/AnnotationLayer.tsx`、`src/editor/MeasurementOverlay.tsx`、`src/app/FixturePanel.tsx`、`src/app/HelpDialog.tsx`、`src/styles.css`、既存の試験（型が変わる所）
- 新規：試験ファイル（単体は `tests/`）
- 変更しないファイル：上以外。

## 禁止事項

- 既存の関数名・入力名・文言を、SPEC にない形で変えないこと（引数を足すのはよい）。
- git の操作をしないこと。python・pytest は使わない。
- 渡した本文に無い所を推測で書き換えないこと。足りない本文があれば、作れる範囲の EDIT を返し、足りない所を報告に書く。

## 報告してほしいこと

- 変更点、SPEC から逸脱した箇所と理由、Claude Code に実行してほしい試験。
