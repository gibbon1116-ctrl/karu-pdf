# SPEC-S21: 部屋の範囲を「部屋の組」にして、同じ階の図面で共通に使う

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 文書全体の保存データ（部屋の組）とページごとの結び付けを、読込み（Worker）→ストア→保存→画面まで通す。S18・S20 の部屋の範囲の操作を、組の範囲にも同じように効かせる判断が要る

---

## 利用者の要望

> 部屋の範囲設定は記憶できるようにしておき、各図面ごとに必要に応じて設定を共通できるようにしたい。一階であれば一度設定すれば他の図面でもその設定の通りの部屋の範囲設定を使用できるようにしたい。

利用者の選択：
- 階ごとの「部屋の組」を共有する。図面ごとに使う組を選ぶ。1 か所で範囲を直すと、その組を使うすべての図面に反映される。
- 記憶はその PDF の中だけ（PDF に保存する）。
- 図面名から階が分かるとき（「1階電灯設備平面図」など）、同じ階の組を候補として出し、1 押しで使う（自動では使わない。配置の違う図面では使わないでおける）。

## 現状（Claude Code が確かめたこと）

- 部屋の範囲（S18）はページごと：ページの辞書 `KaruRooms`（`src/core/rooms.ts` の `readRoomRegions`・`writeRoomRegions`・`readDocumentRoomRegions`）。
  - 道筋：Worker の開く・ページの組み直し・ヘッダー等の結果 `pageRoomRegions`（`pdf.worker.ts` 421・681・729・756 行付近、`protocol.ts` 352・485 行、`PdfWorkerPool.ts` 55・124・295・303・785・810・932 行付近）→ `App.tsx` 823 行、`finishPageLayout`（1321 行）→ `documentModel.updateAfterPageLayout` → `store.loadRoomRegions`。
  - 保存の編集 `setRoomRegions`（`annotations.ts` 123・1504 行付近）。
  - ストア：`roomRegions`・基準・保存待ち・履歴の `roomRegions`、`getRoomRegions`・`setRoomRegions`・`pickupLocation(page, point)`・`pickupsInRoom`・`roomEditTarget`（S20）・`roomCapturePage`。
  - 画面：`FixturePanel.tsx` の現在の場所の下の一覧（範囲を直す・名前を変える・削除）、`MeasurementOverlay.tsx`（囲む・登録の画面 `RoomRegionDialog`・確認 `RoomPickupDialog`・形の編集）、`AnnotationLayer.tsx`（描画）。
- 文書全体のデータは、カタログ（Root）の `Karu` で始まる鍵に置くと、ページの組み直し（`pageOps.ts` の `preserveCatalog`）で残る（項目の一覧 `KaruCountFixtures` と同じ）。
- 他の PDF からページを足すとき（`pageOps.ts` の `graftDrawingPage`）、`KaruRooms` を写している（S18）。
- 図面名からの階の推定：`floorFromDrawingName(store.getDrawingInfo(pageIndex)?.name ?? '')`、`normalizeFloor`（`src/core/location.ts`）。

## 変更内容

### 1. データ（`src/core/rooms.ts` に足す）

- `RoomSet = { id: string; name: string; floor?: string; regions: RoomRegion[] }`。
  - `name`：1〜40 文字（例「1階」）。`floor`：正規化した階（`normalizeFloor`）、無くてもよい。`regions`：S18 の決まり、200 個まで。組は 100 個まで。
  - 範囲の `id` は、組とページの範囲をまたいで重ならないこと（新しく作るときは `crypto.randomUUID()`）。
- 文書全体：カタログの `KaruRoomSets` に JSON（`{ version: 1, sets: RoomSet[] }`）。空なら鍵を消す。`readRoomSets(doc)`・`writeRoomSets(doc, sets)`・`parseRoomSets`。
- ページの結び付け：ページの辞書の `KaruRoomSet` に組の `id`（文字列）。無ければ鍵を消す。`readPageRoomSet(page)`・`writePageRoomSet(doc, page, setId | null)`・`readDocumentPageRoomSets(doc): Array<[pageIndex, setId]>`。
  - 結び付いた組が無いページ（組を消したなど）は、結び付けが無いのと同じに扱う。
- ページで使う範囲 = そのページの範囲（`KaruRooms`） ＋ 結び付いた組の範囲。重なりの扱い（内側の小さい範囲を優先）は S18 の `roomAt` のまま。

### 2. 保存と読込みの道筋

- 編集を足す（`annotations.ts`）：
  - `{ kind: 'setRoomSets'; pageIndex: 0; sets: RoomSet[] }` → `writeRoomSets`。
  - `{ kind: 'setPageRoomSet'; pageIndex: number; setId: string | null }` → `writePageRoomSet`。
  - どちらもページの再描画を伴わない編集（`documentModel.ts` の `recordSavedRendering` の除外に足す）。
- Worker の結果に `roomSets?: RoomSet[]` と `pageRoomSets?: Array<[number, string]>` を、`pageRoomRegions` と同じ所すべてに足す（開く・ページの組み直し・ヘッダー等）。型・受け渡しも同じく。
- アプリ：`loadRoomRegions` を呼んでいる所すべてで `loadRoomSets(result.roomSets ?? [], result.pageRoomSets ?? [])` を呼ぶ。
- ページの組み直し：ページの辞書にあるのでページと一緒に動く。カタログの `KaruRoomSets` は `preserveCatalog` で残る（確かめるだけ）。
- 他の PDF からページを足すとき（`graftDrawingPage`）：元のページが組を使っていれば、その組の範囲を、足したページの `KaruRooms` に写す（組の id は持ってこない。足したページは組を使わない）。すでにページの範囲があれば後ろに足す（200 個まで。範囲の id が重なれば新しい id にする）。

### 3. ストア（`AnnotationStore.ts`）

- 組：`roomSets`（一覧）・基準・保存待ち。ページの結び付け：`pageRoomSets`（ページ → 組の id）・基準・保存待ち。`reset` で消す。履歴に `roomSets` と `pageRoomSets` を足す（`roomRegions` と同じ扱い）。
- `loadRoomSets(sets, links)`・`getRoomSets()`・`getPageRoomSet(pageIndex): RoomSet | undefined`。
- `effectiveRoomRegions(pageIndex): Array<{ region: RoomRegion; setId?: string }>`（ページの範囲 ＋ 組の範囲）。
- 範囲を変える関数は、範囲がページのものか組のものかを見て、正しい所を変える（どれも 1 回の Undo）：
  - `addRoomRegion(pageIndex, region, toSet: boolean)`：`toSet` で、そのページの組に足す。
  - `updateRoomRegion(pageIndex, region)`（名前・階・形。id で探す）。
  - `removeRoomRegion(pageIndex, id)`。
  - S18・S20 の画面（囲んで登録・名前を変える・範囲を直す・削除）は、これらを使うように直す。今の `setRoomRegions` はページの範囲を変える関数として残す。
- 組を作る・使う（どれも 1 回の Undo）：
  - `createRoomSetFromPage(pageIndex, name, floor?)`：そのページの範囲を新しい組に移し（ページの範囲は空にする）、そのページを組に結び付ける。
  - `useRoomSet(pageIndex, setId | null)`：結び付ける・外す。外すとき、組の範囲はページに残さない。
  - `renameRoomSet(setId, name, floor?)`、`deleteRoomSet(setId)`（結び付いたページの結び付けも外す）。
- `pickupLocation(pageIndex, point)`・`pickupsInRoom`・`getRoomNames`・S20 の `startRoomEdit`/`roomEditTarget`（組の範囲も直せる）は、`effectiveRoomRegions` を使う。
- 組の候補：`suggestedRoomSets(pageIndex): RoomSet[]`：ページが組を使っていないとき、図面名から推定した階（`floorFromDrawingName`、正規化）と `floor` が同じ組。
- 未保存の内容：`DirtySummary` の `rooms` に、結び付けが変わったページも入れる。組の変更は `roomSets: boolean` を足し、`documentModel.dirtyDescription` に「部屋の組」を足す。

### 4. 画面（`FixturePanel.tsx` の現在の場所の下）

- 組を使っていないページ：
  - 候補があれば（`suggestedRoomSets`）、行ごとに：「部屋の組「1階」を使う（6室）」ボタン。
  - 選択欄「部屋の組を使う」（組が 1 つ以上あるとき。選ぶとその組を使う）。
  - ページの範囲が 1 つ以上あれば、ボタン「この図面の範囲を部屋の組にする」→ 小さな画面（`<dialog>`、`aria-label="部屋の組"`）：「組の名前」（初期値は図面名からの階、無ければ「部屋の組1」など）、「階」（初期値は同じ）→「作る」。
- 組を使っているページ：
  - 「部屋の組「1階」を使っています（N 図面で共通）」、ボタン「組を外す」「組の名前を変える」。
  - 組を削除するボタン「組を削除」（確認：「部屋の組「1階」を削除します。使っている N 図面から範囲が消えます（Ctrl+Z で戻せます）」）。
- 範囲の一覧：組の範囲には「（組）」と付け、「範囲を直す」「名前を変える」「削除」は組の範囲を変える（使っているすべての図面に反映）。ページの範囲は今のまま。
- 「部屋の範囲を囲む」：組を使っているページでは、登録の画面にチェック「部屋の組「1階」に足す（共通の図面すべてに反映）」（初期値オン）。
- 組を使い始めたとき（候補・選択欄）：そのページで、組の範囲の中にある拾いのうち、部屋（範囲に階があれば階も）が違うものがあれば、S18 と同じ確認を出す：「この図面の {N} 件の拾いに部屋を入れますか（Ctrl+Z で戻せます）」［部屋を入れる］［入れない］。入れるときは、拾いごとにその位置の部屋（`roomAt`）を入れ、1 回の Undo にまとめる。
- 組の範囲を直したとき、他の図面の拾いの部屋は変えない（今の図面の確認は S20 のとおり）。

### 5. 図面の表示（`AnnotationLayer.tsx`）

- `effectiveRoomRegions` を描く。組の範囲は、ページの範囲と同じ見た目でよい（名前の札の後ろに小さく「組」と付けてもよい）。
- 部屋の範囲も組も無いページでは、今と同じく何もしない（速さを変えない）。

### 6. ヘルプ（`src/app/HelpDialog.tsx`）

部屋の範囲の説明（S20 で足した段落）の後に足す：

> 部屋の範囲は「この図面の範囲を部屋の組にする」で組にでき、同じ階の他の図面でも使えます。図面名から階が分かる図面では、数量タブに「部屋の組「1階」を使う」が出ます。押した図面だけで使い、使わない図面には出たままにしておけます。組の範囲を直すと、その組を使うすべての図面に反映されます（拾いの部屋は、その図面で確認したものだけ変わります）。部屋の組は PDF に保存します。他の PDF へページを写すと、組の範囲はそのページの範囲として写ります。

## 変えないこと

- 組を使わないページの部屋の範囲（S18・S20 のまま）。保存済みの `KaruRooms` の形。
- 部屋の範囲も組も無いページの表示と速さ。開いたときの読込み（組の JSON を 1 つ読むだけ）。

## 試験

**単体**：
- `parseRoomSets`・`writeRoomSets`・`readDocumentPageRoomSets`：決まりに合わないものを捨てる、上限、空で鍵を消す。
- ストア：`createRoomSetFromPage`・`useRoomSet`・`addRoomRegion(toSet)`・`updateRoomRegion`・`removeRoomRegion`・`deleteRoomSet` がそれぞれ 1 回の Undo。`effectiveRoomRegions`、`pickupLocation` が組の範囲を使う、`suggestedRoomSets` の階の一致。
- PDF：保存して開き直すと組と結び付けが残る。ページの並べ替えで結び付けがページと一緒に動く。他の PDF からページを足すと組の範囲がページの範囲として写る。

**画面**（新規 `e2e/room-sets.annotate.spec.ts`。手順は `e2e/room-regions.annotate.spec.ts` を参考に。図面名は `writeDrawingInfo` などで「1階電灯設備平面図」「1階コンセント設備平面図」「2階電灯設備平面図」を入れる）：
1. 1 ページ目で範囲を 2 つ囲み、「この図面の範囲を部屋の組にする」→ 組「1階」。
2. 2 ページ目（1階）に「部屋の組「1階」を使う（2室）」が出る → 押すと範囲が出て、範囲の中で拾うと部屋が入る。3 ページ目（2階）には候補が出ない。
3. 2 ページ目に既存の拾いがあるとき、組を使い始めると確認が出る →「部屋を入れる」で部屋が入る。1 回の Ctrl+Z で戻る。
4. 2 ページ目で組の範囲を「範囲を直す」で広げる → 1 ページ目の範囲も変わっている。
5. 保存して開き直すと、組と結び付けが残る。「組を外す」で 2 ページ目から範囲が消え、1 ページ目には残る。

## 対象

- 変更：`src/core/rooms.ts`、`src/core/annotations.ts`、`src/core/pageOps.ts`、`src/worker/pdf.worker.ts`、`src/worker/protocol.ts`、`src/client/PdfWorkerPool.ts`、`src/App.tsx`、`src/app/documentModel.ts`、`src/editor/AnnotationStore.ts`、`src/editor/AnnotationLayer.tsx`、`src/editor/MeasurementOverlay.tsx`、`src/app/FixturePanel.tsx`、`src/app/HelpDialog.tsx`、`src/styles.css`、既存の試験（`tests/saveState.test.ts` の未保存の内容など）
- 新規：試験ファイル（単体は `tests/` に置く）
- 変更しないファイル：上以外。

## 禁止事項

- 既存の関数名・入力名・文言を、SPEC にない形で変えないこと（引数を足すのはよい）。
- git の操作をしないこと。python・pytest は使わない。

## 報告してほしいこと

- 変更点、SPEC から逸脱した箇所と理由、Claude Code に実行してほしい試験。
