# SPEC-06h-2: 同じ記号を探す（Visual Search）— 画面・候補の確認・数量への追加

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 図面上の範囲の指定、Worker の照合の呼び出し、候補の描画・採否・数量への一括追加（履歴1回）、取り消しとメモリの解放にまたがる新機能のため（判定表「新規機能の実装」）

---

## 目的

利用者の指示の流れ: 数量項目を選ぶ →「同じ記号を探す」→ 図面上で見本の記号を囲む → 探す範囲を決める → 探す → 候補を図面上に出す → 利用者が確かめる → 正しい候補だけ選ぶ → 数量へ追加。**自動では数量に入れない**。検索中に中止できる。使わない利用者に負担をかけない。

照合の部品は SPEC-06h-1・06h-1b でできている（`src/client/SymbolSearchClient.ts` の `SymbolSearchClient.search(request, onProgress)` → `{ promise, cancel }`、`dispose()`、候補 `SymbolCandidate { pageIndex, rect, center, score, rotation }`）。実図面の測定（A3 1ページ、机の記号）: 描画 3.8 秒＋照合 0.7 秒、候補 58（すべて正しい記号）、検索中のスクロールの p95 16.8ms。

## 現状（Claude Code が確認したこと）

- 図面上で四角を囲んで見本を取る操作: `App.tsx` の `sampleCapture`・`requestFixtureSample`・`completeFixtureSample`・`finishSampleCapture` と、`AnnotationLayer.tsx` の `FixtureSampleContext`（`selection: { docId, complete(pageIndex, rect) }` があるあいだ、ドラッグで四角を描き `complete` を呼ぶ）。上に `fixture-sample-instruction` の帯（「中止」ボタン、Esc で中止）。
- 拾いバー: `src/app/PickupBar.tsx`。数量タブ: `src/app/FixturePanel.tsx`。
- 個数の拾いの作り方: 数量拾いの道具でクリックしたときの処理（`AnnotationLayer.tsx` の `count` の道具の処理と `store` の作成。場所 `store.pickupLocation(pageIndex)` を付ける）。
- `window.__karu.symbolSearch` などの試験用フック（`App.tsx`）。

## 対象

- 対象フォルダ: `C:\Users\gibbo\Desktop\PDF編集アプリ\.claude\worktrees\karupdf-quantity-ui-8301e6`
- 変更してよいファイル: 新規 `src/app/SymbolSearchPanel.tsx`、`src/App.tsx`（範囲の指定の操作を、見本の取り方と同じ仕組みで「同じ記号を探す」にも使えるようにする。パネルの置き場所）、`src/editor/AnnotationLayer.tsx`（候補の描画とクリックでの採否だけ）、`src/editor/AnnotationStore.ts`（候補の状態（メモリだけ）と、個数の拾いの一括作成）、`src/app/PickupBar.tsx`・`src/app/FixturePanel.tsx`（ボタンを1つずつ）、`src/client/SymbolSearchClient.ts`（必要な最小限）、`src/app/HelpDialog.tsx`、`src/styles.css`、`tests/`、新規 `e2e/symbol-search.annotate.spec.ts`
- 変更しないファイル: 上以外。保存の形は変えない（候補は保存しない）。

## 変更内容

### 1. 始め方

- 個数の項目（`quantityKind === 'count'`）を選んでいるとき、拾いバーと数量タブ（「拾う」「管理」）に「同じ記号を探す」ボタン（`aria-label="同じ記号を探す"`）。長さ・面積・体積の項目では出さない。
- 押すと、上に帯 `探す記号を四角で囲んでください（Esc で中止）`（見本の取り方と同じ帯の部品）。図面上で四角を囲む（見本の取り方と同じ操作。小さすぎる四角は今と同じ扱い）。
- 囲み終えると、「同じ記号を探す」パネルを開く（下の 2.）。

### 2. パネル（`SymbolSearchPanel.tsx`）

- 置き場所: 図面の表示領域の右上に重ねる小さな欄（`role="dialog"`、`aria-label="同じ記号を探す"`、`aria-modal` なし。図面は操作できる）。幅 260px 程度。
- 中身:
  - 見本の小さな画像（囲んだ範囲を `renderFixtureSample` と同じ方法で描いたもの）と、項目の名前（`fixtureCode` と名称）。「見本を囲み直す」。
  - 探す範囲（radio）: 「このページ」（既定）・「ページを指定」（`1-3, 5` の形の欄）・「すべてのページ」。
  - 「回転した記号も探す」（checkbox、既定オフ）。
  - 「似ている度合い」（range、0.55〜0.95、刻み 0.05、既定 0.70。値を数字でも出す）。
  - 「探す」ボタン。探している間は「中止」ボタンと進み（`ページ 2 / 5・描画中` / `照合中`、`<progress>`）。
  - 結果: `候補 23 件（拾い済み 4 件）`、ページが複数ならページごとの件数（押すとそのページへ移る）。
  - 「すべて選ぶ」「すべて外す」「選んだ 12 件を数量へ追加」「閉じる」。
- 探す: ページを1つずつ順に `SymbolSearchClient.search`（ページごとに描画と照合）。結果が出たページから候補を図面に描く。「中止」で今のページの検索を取り消し（`cancel()`）、残りのページは探さない。そこまでの候補は残す。
- 似ている度合いを変えたら: 結果は消して「探す」を押し直す（再検索）。（照合の画像の使い回しはしない。キャッシュを持たない）
- 閉じる・別の項目を選ぶ・PDF を閉じる・ページ整理・別のタブに切り替える: 検索中なら取り消し、候補を消し、`SymbolSearchClient.dispose()` で Worker を止める。

### 3. 候補の描画と採否（図面の上）

- 候補は `AnnotationStore` にメモリだけで持つ（`symbolCandidates: Array<{ id; pageIndex; rect; center; score; state: 'pending' | 'chosen' | 'counted' }>`、変更は `notify(false)`、保存しない・履歴に積まない）。
- `AnnotationLayer` は、そのページの候補を四角で描く: `pending` は橙の破線、`chosen` は緑の実線で中に ✓、`counted`（すでにその項目の印が候補の中心から見本の短い辺の半分以内にある）は灰色の細い破線で選べない。候補の描画は候補があるページだけ（候補が無いときは何もしない）。
- 候補の四角をクリックすると `pending` ⇄ `chosen`（どの道具のときでも、候補の上のクリックは他の処理より先に受ける）。
- 候補の上に点数を出さない（`title` に `似ている度合い 0.87` を付ける）。

### 4. 数量への追加

- 「選んだ N 件を数量へ追加」: `chosen` の候補の中心に、選んでいる個数の項目の印を作る（場所は `store.pickupLocation(pageIndex)` で、今の数量拾いのクリックと同じ）。**1回の Ctrl+Z で全部戻る**（`AnnotationStore` に `createCountMarks(fixtureId, points: Array<{ pageIndex; center }>)` のような一括作成を足し、履歴は1つ）。追加したものは候補の状態を `counted` にする。状態欄に `12 件を数量へ追加しました（Ctrl+Z で戻せます）`。
- 候補は自動では追加しない。`pending` のまま閉じたら何も追加しない。

### 5. 性能・メモリ

- 「同じ記号を探す」を押すまで、照合の Worker・描画・候補の配列を作らない（今の試作どおり）。照合の画像はキャッシュしない。
- 候補の数の上限はページあたり 500（`maxResults`）。
- 検索中もスクロール・拡大はできる（描画の優先度は表示より低い）。

### 6. ヘルプ

数量拾いの説明に「同じ記号を探す」（候補は自動で数量に入らない、選んで追加、似ている度合い、回転、中止）を足す。

## テスト

### 単体（`tests/`）

- `createCountMarks`: N 件を作り、1回の undo で全部消え、redo で戻る。場所が付く。
- 候補の状態: `counted` の判定（既存の印からの距離）、`pending`⇄`chosen`、項目を変える・閉じると消える。
- ページ指定の解釈（`1-3, 5` → [0,1,2,4]、範囲外・不正は Error）。

### 画面（新規 `e2e/symbol-search.annotate.spec.ts`）

mupdf で白紙1ページ（500×500pt）を作り、同じ記号（円と十字のパス、直径 12pt）を 6 か所、違う記号（四角）を 3 か所にページの内容として描く（注釈ではなく内容）。

1. 個数の項目 `LED` を作り選ぶ →「同じ記号を探す」→ 記号の1つを囲む → パネルが開く →「探す」→ 候補が 6 件（四角の記号は候補にならない）。
2. 候補を3つクリックして `chosen` →「選んだ 3 件を数量へ追加」→ 印が3つ、数量タブの全図面が 3。残りの候補は `pending` のまま。Ctrl+Z で3つとも消える。
3. もう一度「探す」→ 印のある所は `counted`（選べない）。
4. 「すべて選ぶ」→ 追加 → 全図面が 6。
5. 検索中に「中止」→ 候補は増えず、パネルは「中止しました」。閉じると候補の四角が消える。
6. 項目を長さの項目に替えると「同じ記号を探す」のボタンが消える。
7. 「同じ記号を探す」を一度も押さない通常の操作では、照合の Worker が作られない（`performance.getEntriesByType('resource')` に照合の Worker の JS が無い、など）。

## 禁止事項

- 候補を自動で数量に入れないこと。
- 候補・照合の画像を保存しない、キャッシュしないこと。
- PDF を開くとき・表示・スクロールのときに照合の処理をしないこと。
- 名称の文字列で記号を判定しないこと。
- 試験から `work/` へ書き込まないこと。対象外のファイルを変更しないこと。git の操作をしないこと。python・pytest は使わない。
- 試験の実行はしなくてよい（Claude Code が実行する）。書くだけでよい。`npx tsc --noEmit` は実行してよい。

## 報告してほしいこと

- 変更したファイルと要点
- SPEC から逸脱した箇所と理由、残課題
