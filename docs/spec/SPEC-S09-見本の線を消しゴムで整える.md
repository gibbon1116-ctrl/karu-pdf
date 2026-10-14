# SPEC-S09: 見本の不要な線を消しゴムで消し、消した線は探さない

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 検索の見本（テンプレート）の作り方に、利用者が選んだ線だけを使う経路を足す。Worker・保存データ・画面の操作にまたがる

---

## 利用者の要望

> 同じ記号を探すで図形を切り取ったとき、図形から検索すべき記号のみを指定できるように、不要な線を消しゴム機能等で消せるようにしたい。消した線については不要な線として検索しないようにしたい。この機能は、記号の検索性能向上のために導入したいと考えているので、検索性能の向上に誤差程度の違いしか現れない場合は導入しない。

## 効果の測定（Claude Code が実施。詳しくは 非公開の調査資料）

- 器具本体だけをきれいに囲んだ見本では、今の自動の整理で十分（差なし）。
- 少し広く囲んだ見本では、自動の整理が配線の破線や添字（C・W）を見本に残し、正解をほとんど見つけられない。
  - 長形 0/13、丸形 0/4、火災報知の埋込 2/6。
  - 記号の線だけにすると、13/13、4/4、6/6。
- 自動の整理が、記号の線（差動式の横線、上の円弧の一部）を消すこともある。
- **判断：作る。** 消すだけでなく、自動の整理が消した線を戻す操作も入れる。

## 現状（Claude Code が確かめたこと）

- 見本の線は、`prepareVectorTemplate(pageSegments, pageWidths, sampleRect)`（`src/core/vectorSymbolSearch.ts`）が作る。
  - 四角の中の線（両端が四角から許容差 `defaultVectorTolerance(rect)` 以内、長さ > 0）を集める。
  - 線幅の多い線に合わせて細い線を除き（thin）、配線（wiring）とそれ以外の小さな線（other）を除く。
  - 結果：`segments`・`widths`・`bounds`・`strokeWidth`・`tolerance`・`removed`・`total`・`cleaned`。
- `vectorSymbolSearch(...)` が、この結果を使って探す。Worker では `searchVectorMessage(message)`（`src/worker/symbolSearchMessages.ts`）が呼ぶ。
- 見本のページの線は、`session.vectorCache.get(pageIndex, pool, signal)` で読める（`kind` が `vector`・`mixed` のとき `segments`・`widths`）。
- 見本は項目に登録され、場所（`rect`）も保存される（SPEC-S07）。

## 変更内容

### 1. 選んだ線で見本を作る（`src/core/vectorSymbolSearch.ts`）

- 新しい関数 `manualVectorTemplate(segments: Float32Array, widths: Float32Array, sampleRect: Rect, total: number): PreparedTemplate` を作る。
  - 渡された線をそのまま見本の線にする（自動の整理をしない）。
  - `bounds`：渡された線の外接の四角。
  - `strokeWidth`：`prepareVectorTemplate` の `finish` と同じ求め方（線幅 > 0 の線の、長さで重みを付けた中央値。無ければ 0）。
  - `tolerance`：`defaultVectorTolerance(bounds)`。
  - `removed`：`{ wiring: 0, other: total - 線の数, thin: 0 }`。`total` は四角の中の線の数。`cleaned`：`total > 線の数`。
  - 線が 2 本未満、または有限でない値があれば、例外を投げる。
- `vectorSymbolSearch` に、省略できる引数 `manual?: { segments: Float32Array; widths: Float32Array }` を最後に足す。
  - あれば、`prepareVectorTemplate` の代わりに `manualVectorTemplate` を使う。
  - それ以外（線幅での絞り込み、塗りの比較、周りの線の確かめなど）は今と同じ。
  - 無いときの結果は、今と 1 つも変えない。
- 画面で使うため、四角の中の線の番号を返す関数を公開する：
  - `templateCandidateLines(pageSegments, pageWidths, sampleRect): { ids: number[]; kept: Set<number> }`
    - `ids`：`prepareVectorTemplate` が四角から集める線（線幅で除く前）。番号は線の順番（`segments` の 4 つ組の何番目か）。
    - `kept`：自動の整理の後に残る線の番号。
  - `prepareVectorTemplate` の結果を変えずに求めること（同じ処理を共有してよい）。

### 2. Worker への受け渡し（`src/worker/symbolSearchMessages.ts`、`src/client/SymbolSearchClient.ts`）

- `VectorSearchMessage` に `sampleLines?: { segments: Float32Array; widths: Float32Array }` を足す。
- `searchVectorMessage`：`sampleLines` があれば、線が 2 本以上あることを確かめ、`vectorSymbolSearch` に `manual` として渡す。
- `SymbolSearchRequest` に `sampleLines?: { segments: Float32Array; widths: Float32Array }` を足し、`vector-search` に渡す。
  - 線の情報が無いページ（画像で探す）では使わない。

### 3. 消しゴムの画面（新規 `src/app/SymbolSampleEraser.tsx`、`src/app/SymbolSearchPanel.tsx`）

**パネル**

- 見本の画像の下に、ボタン「見本の線を整える」を足す。
  - 見本のページの線を読めない（`kind` が `raster`、線が 2 本未満）ときは、ボタンを無効にし、`title` に「線の情報が無い見本は整えられません」。
- 線を整えた後は、見本の下に「線を整えた見本（使う線 {N} 本・消した線 {M} 本）」と、ボタン「整えた線を元に戻す」（自動の整理に戻す）を出す。
- 線を整える・元に戻すと、前の候補を消す（`invalidate()`）。
- 「探す」：整えた線があれば、`sampleLines` として渡す。

**消しゴムの画面**（`<dialog>` で開く。`aria-label="見本の線を整える"`）

- 見本の四角の周り（四角を各辺 20% 広げた範囲）を、大きく表示する。長い辺がおよそ 480px。
  - 背景：その範囲の図面を描いた画像を薄く（`pool.renderSearchImage` などで描く。方法は任せる）。
  - 見本の四角を破線で示す。
  - 四角の中の線（上の `ids`）を、太さ 3px ほどで重ねる。
    - 使う線：濃い青。消した線：薄い赤の破線。
    - 各線に `data-testid="sample-line"`、`data-line-id`、`data-state`（`use`・`erased`）。
- 初めの状態：前に整えた線があればそれ。無ければ自動の整理の結果（`kept` を使う、それ以外を消した線）。
- 操作：
  - 「消しゴム」と「戻す」の切替ボタン（`aria-pressed`）。初めは「消しゴム」。
  - 図面の上をドラッグすると、ポインタの円（半径 10px）に触れた線を、消しゴムなら消す、戻すなら使う線に戻す。クリックでも同じ（1 本だけ）。
  - 「自動の整理に戻す」：初めの自動の状態に戻す。
  - 「すべての線を使う」：消した線をすべて戻す。
  - 「元に戻す」（1 つ前の操作に戻す。ドラッグ 1 回を 1 つの操作とする）。
- 下に「使う線 {N} 本・消した線 {M} 本」。使う線が 2 本未満なら、決定のボタンを無効にし「線を 2 本以上残してください」。
- ボタン「この線で探す」：決定してパネルに戻る。「やめる」・Esc：変えずに戻る。
- 線が多い見本（四角の中の線が 4096 本を超える）は、開かずに「線が多すぎるため整えられません。小さく囲んでください」。

### 4. 項目の見本に、整えた線を保存する（`src/core/countFixtures.ts`、`src/App.tsx`）

- `CountFixtureSample` に `lines?: { segments: number[]; widths: number[] }` を足す（使う線。ページの pt 座標）。
  - 読込み：`segments` の長さが 4 の倍数、`widths` の長さがその 1/4、すべて有限、線幅は 0 以上、線は 2〜256 本、のときだけ残す。それ以外は `lines` を捨て、見本は残す。
  - `rect` が無い見本の `lines` は捨てる。
  - 他の PDF から読み込むときは、`rect` と同じく外す。
- パネルで線を整えて決定したら、項目の見本の `lines` を更新する（`setCountFixtures`。Ctrl+Z で戻せる）。
  - 257 本以上なら保存せず、その検索だけで使う。状態表示「線が多いため、整えた線は項目に保存しません」。
  - 「整えた線を元に戻す」では、`lines` を外す。
- 登録済みの見本で探すとき（SPEC-S07 の 4）、`lines` があれば、それを使う線として最初から使う。パネルには「線を整えた見本（…）」を出す。
- 見本を囲み直したときは、`lines` を外す（新しい見本は自動の整理から）。

### 5. ヘルプ（`src/app/HelpDialog.tsx`）

同じ記号を探すの説明に、次を足す。

> 見本に配線や文字が入ってうまく探せないときは、「見本の線を整える」で不要な線を消しゴムで消してください。消した線は探しません。自動で消された記号の線は「戻す」で戻せます。整えた線は項目の見本と一緒に保存します。

## 変えないこと

- 線を整えないときの検索の結果と速さ（`manual` が無いときの `vectorSymbolSearch` の結果を変えない）。
- 画像で探すページの検索。
- スナップ・保存・通常の閲覧。消しゴムの画面は、ボタンを押したときだけ読み込む。

## 試験

**単体**（`tests/vectorExtraction.test.ts` か新しい試験ファイル）

- `manualVectorTemplate`：線の外接・strokeWidth・removed・2 本未満で例外。
- `templateCandidateLines`：`kept` が `prepareVectorTemplate` の結果の線と一致する（今ある試験の見本で）。
- 自動の整理が配線を見本に残す例を合成し（本体の線＋本体の四角に入る短い配線の断片）、
  - 自動のままでは見つからない（または件数が少ない）。
  - `manual` で本体の線だけを渡すと、すべての本体が見つかる。
- `manual` が無いときの結果が、今の試験と同じ（既存の試験が通ること）。
- `searchVectorMessage` が `sampleLines` を `manual` として渡す。
- `CountFixtureSample.lines` の読込み・保存・捨てる条件。

**画面の試験**（新規 `e2e/symbol-sample-eraser.annotate.spec.ts`）

- `tests/symbolShapeFixtures.ts` の図面に、見本の四角へ入る余分な線を足した図面を作るか、新しい小さな図面を作る（試験用。実図面は使わない）。
- 「見本の線を整える」→ 線が表示される → 余分な線をクリックで消す → 「この線で探す」→「探す」で、正しい件数が出る。
- 「整えた線を元に戻す」で、前と同じ件数に戻る。
- 決定後、項目の見本に `lines` が保存される。

**変わらないことの確認**（Claude Code が実行する）

- 記号の検索の既存の単体・画面の試験、性能の試験（`tests/symbolLabels.performance.test.ts` など）。

## 対象

- 変更してよいファイル：
  - `src/core/vectorSymbolSearch.ts`、`src/worker/symbolSearchMessages.ts`、`src/client/SymbolSearchClient.ts`
  - `src/app/SymbolSearchPanel.tsx`、新規 `src/app/SymbolSampleEraser.tsx`、`src/styles.css`
  - `src/core/countFixtures.ts`、`src/App.tsx`、`src/app/FixturePanel.tsx`、`src/app/HelpDialog.tsx`
  - 試験ファイル
- 変更しないファイル：上以外。

## 禁止事項

- 実図面の座標・線の番号で分岐しないこと。
- 関数名・入力名・既存の文言を、SPEC にない形で変えないこと。
- git の操作をしないこと。python・pytest は使わない。

## 報告してほしいこと

- 変更点、SPEC から逸脱した箇所と理由、Claude Code に実行してほしい試験。
