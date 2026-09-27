# SPEC-00b-2: 試作（書き込み操作と保存の画面）

## 実行モデル指定（必須）

- モデル: `gpt-5.6-sol`
- reasoning effort: `high`
- 選定理由: 新しい機能（書き込みの操作画面、保存）の実装で、Viewer、PageView、App と新しいモジュールにまたがるため

---

## 目的

SPEC-00b-1 で作った注釈の中核（Worker 0 の `listAnnotations`、`layoutText`、`applyAndSave`）を画面につなぐ。利用者が次のことをできるようにする。

1. **文字**ツールで、ページに日本語を書き込む。
2. **四角**ツールで、四角を描く。
3. **選択**ツールで、書き込みを選ぶ、動かす、消す。文字は、ダブルクリックで書き直す。
4. **上書き保存**（Ctrl+S）と**別名で保存**（Ctrl+Shift+S）をする。開き直すと、書き込みを再編集できる。

あわせて、合格基準の④（文字の入力や図形のドラッグで遅れを感じない）を計測する。

最初に `docs/要件と設計方針.md`（第4章と第5章）、SPEC-00b-1、今の `src/` を読むこと。

## 試作の範囲（これ以外は作らない）

- ツールは、選択／文字／四角の3つ。
- 書式は固定する。
  - 文字: BIZ UDゴシック、10.5pt、赤
  - 四角: 赤、1pt
  - 色や太さを選ぶ画面は、第1版で作る。
- 作らないもの: 大きさを変える取っ手、元に戻す／やり直し、タブ、サムネイル一覧、明朝体、付箋、そのほかの図形。

## 対象

- 新しく作るファイル:
  - `src/editor/AnnotationStore.ts`: 書き込みの状態を管理する（main thread）
  - `src/editor/AnnotationLayer.tsx`: ページごとの SVG の重ね表示と、操作
  - `src/editor/TextEditor.tsx`: 文字の入力欄
  - `src/editor/fileAccess.ts`: File System Access API の薄い包み（型定義も含む）
  - テスト: `tests/AnnotationStore.test.ts`、`e2e/annotate.spec.ts`、`e2e/perf-edit.spec.ts`
- 変更してよいファイル: `src/App.tsx`、`src/viewer/Viewer.tsx`、`src/viewer/PageView.tsx`、`src/styles.css`、`src/client/PdfWorkerPool.ts`（必要な小修正だけ）、`playwright.config.ts`（project の追加だけ）、`index.html`（`@font-face` 用の preload だけ）
- 変更しないファイル: `docs/`、`public/fonts/`、`LICENSE`、`src/core/`、`src/worker/`、`vite.config.ts`、`tsconfig.json`

## 変更内容

### 1. 書き込みの状態（`AnnotationStore.ts`、React に依存しないクラス）

```ts
type Kind = 'freetext' | 'square'
interface EditableAnnotation {
  id: string                 // 画面側の識別子（新規は 'new-…'、既存は 'obj-<objNum>'）
  objNum: number | null      // 保存済みなら注釈オブジェクトの番号
  pageIndex: number
  kind: Kind
  rect: Rect                 // ページ座標（pt）
  text: string               // freetext
  fontSize: number           // freetext（10.5）
  color: RGB                 // 赤 [1,0,0]
  borderWidth: number        // square（1）
  layout: LayoutResult | null  // freetext の配置（Worker 0 の layoutText の結果）
  dirty: boolean             // 最後の保存から変わったか
}
```

- **既存の注釈**（PDF にもともとあるもの）は、ページの DOM が作られたときに `pool.listAnnotations(pageIndex)` で読み、ページ単位でキャッシュする。`editable` のものだけを扱う。
- 「**触れた**」既存の注釈（選んだ、動かした、書き直した、消した）の objNum を、ページごとに `touchedObjNums(pageIndex)` として返す。
  - これを**描画要求の `excludeAnnotObjNums` に渡し、下地から除く**。
  - 触れた注釈は、SVG の重ね表示で描く。
- 触れていない既存の注釈は下地にそのまま描かれている。重ね表示では、透明な当たり判定の矩形だけを置く（選択ツールのときだけ）。
- 操作: `create`、`touch`（既存 → 編集可能にする）、`move`、`updateText`、`remove`
  - 変更があるたびに購読者へ通知する。ただし、ドラッグ中のマウスの動きごとには通知しない（第3章）。
- `toEdits(): AnnotationEdit[]`
  - `dirty` なものから、SPEC-00b-1 の `AnnotationEdit` を作る。
    - 新規 → `create…`
    - 既存 → `update…`
    - 削除 → `delete`（objNum があるものだけ）
  - 新規で作ってから消したものは、送らない。
- `markSaved(result)`: `applyAndSave` の `created`（新規の作成順の objNum）を、対応する新規の注釈に割り当てる。すべての `dirty` を false にする。
  - 保存後も、触れた注釈は重ね表示のまま扱う。他の Worker の文書は古いままなので、下地に描かせない。
- `isDirty()`: 1つでも `dirty` があるか、未保存の削除があれば true。

### 2. 重ね表示（`AnnotationLayer.tsx`、PageView の中に置く）

- ページと同じ大きさの `<svg>` を、プレビューの canvas の上に置く。`viewBox="0 0 <ページ幅pt> <ページ高さpt>"` で、ページ座標をそのまま使う（拡大縮小は SVG に任せる）。
- 文字は、`layout.lines` の各行を `<text>` で描く。
  - `x = rect[0] + line.x`、`y = rect[1] + line.baseline`
  - `font-family: 'KaruBIZUDGothic'`（`public/fonts/BIZUDGothic-Regular.ttf` の `@font-face`）
  - `font-size` は pt 値、`fill` は色、`xml:space="preserve"`、`font-kerning: none`
- 四角は `<rect>` で描く。`fill="none"`、`stroke` は色、`stroke-width` は太さ（pt）。
- 選んでいるものは、点線の枠で示す。
- `pointer-events` は、ツールに応じて切り替える。
  - 選択ツール: 書き込みと当たり判定の矩形だけが反応する。
  - 文字・四角ツール: svg 全体が反応する。

### 3. 操作

- **遅れを出さないための決まり**（合格基準④）
  - ドラッグ中（作成と移動）は、`pointermove` ごとに React の state を更新しない。
    - 対象の SVG 要素の属性（`transform`、`x`、`y`、`width`、`height`）を ref で直接書き換える。
    - 書き換えは requestAnimationFrame で1フレームに1回へまとめる。
  - ストアへ反映するのは、`pointerup` のときだけにする。
  - `setPointerCapture` を使う。
- **文字ツール**
  - クリックすると、その位置を左上として、幅 200pt の新しい文字を作り、すぐに入力欄を開く。
  - ドラッグした場合は、その幅にする（最小 20pt）。
- **入力欄**（`TextEditor.tsx`）
  - `<textarea>` を、書き込みの位置に CSS px で重ねる（ページ座標 × zoom × 96/72）。
  - 見た目:
    - フォントは `KaruBIZUDGothic`、大きさは `fontSize × zoom × 96/72` px、行の高さは 1.2
    - 内側の余白は 2pt 相当、色は赤
    - 背景は半透明の白、枠は薄い青
    - 幅は書き込みの幅。高さは入力に合わせて伸ばす
  - 確定するのは、枠の外をクリックしたとき、`Esc`、`Ctrl+Enter`。`Enter` は改行にする。
  - **日本語入力（IME）で変換している間は、`Esc` と `Enter` で確定しない**（`isComposing` と `compositionstart`／`compositionend` で判定する）。
  - 確定したら `pool.layoutText(text, fontSize, 幅)` を呼び、結果の `height` で rect の高さを決めて、ストアへ反映する。
  - 本文が空なら、その書き込みを消す。
- **四角ツール**: ドラッグで作る。4pt 未満の大きさなら作らない。
- **選択ツール**
  - クリックで選ぶ（既存の注釈なら `touch`）。ドラッグで動かす。
  - `Delete` と `Backspace` で消す（入力欄を開いていないときだけ）。
  - 文字をダブルクリックすると、書き直しの入力欄を開く。
  - 空いている所をクリックするか `Esc` を押すと、選択を外す。
- ツールの切り替えは、ツールバーのボタン（選択／文字／四角）で行う。今のツールを目立たせる。

### 4. 下地の描画との連動（`PageView.tsx`、`Viewer.tsx`）

- 描画要求に、ページの `touchedObjNums` を `excludeAnnotObjNums` として渡す。
- 低解像度版、プレビュー、詳細のキャッシュの key に、除く注釈の一覧（`x=12.15` のような形）を含める。
- 除く注釈が変わったら、新しい key で `want` する。**新しい画像が届くまで、古い画像を表示し続ける。** 一瞬、書き込みが二重に見えてもよい。

### 5. 保存（`App.tsx`、`fileAccess.ts`）

- ツールバーに「上書き保存」「別名で保存」を置く。キーは `Ctrl+S` と `Ctrl+Shift+S`（ブラウザ標準の保存は `preventDefault` で止める）。
- 保存の前に、入力欄が開いていれば確定する。
- **上書き保存**
  1. 開いたときのファイルハンドルがあれば、`requestPermission({mode:'readwrite'})` を求める。
  2. `pool.applyAndSave(store.toEdits(), 'incremental')` を呼ぶ。
  3. `createWritable()` → `write(bytes)` → `close()` で書き込む。
  4. `store.markSaved(result)` を呼ぶ。
  - ハンドルがなければ、別名で保存にする。
- **別名で保存**: `showSaveFilePicker({suggestedName: 元の名前, types: PDF})` で保存先を選んで書き込み、以後はそのハンドルを使う。API がないブラウザでは、`<a download>` でダウンロードする。
- 結果を画面の下に数秒表示する。
  - 成功: 「保存しました（増分保存・0.4秒）」
  - 失敗: 理由を日本語で表示する。
- 未保存の変更があれば、ファイル名の前に「●」を付ける。`beforeunload` で警告を出す。
- 別のファイルを開くときに未保存の変更があれば、`confirm` で確認する。
- **注意**: 上書き保存では、利用者のファイルを書き換える。自動テストでは実ファイルに書かず、次のテスト用の窓口を使う。

### 6. テスト用の窓口（`?test=1` のときだけ）

`window.__karu` に次を追加する。

- `saveToBytes(): Promise<Uint8Array>`: `applyAndSave` の結果を返し、`markSaved` まで行う。ファイルには書かない。
- `openBytes(bytes, name)`: バイト列から開く。
- `getEditableAnnotations(pageIndex)`: ストアの内容を返す。
- `getFrameStats()`: 直近のドラッグと入力の計測値を返す（第7章）。

### 7. 計測（合格基準④）

- `src/perf/metrics.ts` への追加は禁止なので、計測の処理は `src/editor/` の中に置く。
- **ドラッグ中**: requestAnimationFrame の間隔を記録し、`pointerup` のときに p95 と最大値を確定する。
- **文字の入力**: `input` イベントから次の requestAnimationFrame までの時間を記録し、p95 と最大値を出す。
- `e2e/perf-edit.spec.ts`（project: bench）
  1. `heavy-300p.pdf` を開き、6ページ目（A1）を 400% にして、`isSharp()` を待つ。
  2. 四角を作り、2秒かけて 120 回のマウス移動でドラッグする。
  3. 文字を作り、50文字を 30ms 間隔で1文字ずつ入力する。
  4. 目標は次のとおり。結果を JSON（`bench-results/`）とコンソールに出す。
     - ドラッグ: p95 ≤ 20ms、最大 ≤ 50ms
     - 入力: p95 ≤ 50ms
- 同じことを、`test-data/real/七ヶ浜町_実施設計図.pdf` の 12ページ目でも行う（ファイルがあるときだけ）。

### 8. テスト

- `tests/AnnotationStore.test.ts`: 作成、触れる、移動、削除、`toEdits` の中身、新規を消したら送らない、`markSaved` による objNum の割り当て、`dirty`。
- `e2e/annotate.spec.ts`（project: e2e）: `sample-small.pdf` で次を順に確かめる。
  1. 文字ツールで1ページ目をクリックし、`page.keyboard.insertText('日本語の書き込み')`、`Enter`、`insertText('二行目')` を入力する。枠の外をクリックして確定し、SVG に2行の文字があることを確かめる。
  2. 四角ツールでドラッグして四角を作る。選択ツールでドラッグして動かす。
  3. `saveToBytes()` → `openBytes()` の後、`getEditableAnnotations(0)` に次があることを確かめる。
     - 本文「日本語の書き込み\n二行目」の FreeText（`madeByKaru`）
     - 動かした位置の Square
  4. 既存の "Existing note" を選び、ダブルクリックして「書き換えた」に変える。保存して開き直し、本文が変わっていることを確かめる。
  5. 四角を選んで `Delete` で消す。保存して開き直し、無いことを確かめる。
  6. 最後の保存結果を `test-results/ui-roundtrip.pdf` に書き出す。

## 禁止事項

- 対象外のファイルを変更しないこと。git の操作をしないこと。
- 自動テストで、利用者のファイルや `test-data/` の元ファイルを上書きしないこと。
- 注釈に作成者名を入れないこと。
- ドラッグ中に、マウスの動きごとに React の state を更新しないこと。
- 自分で起動したサーバーは必ず止めること。一時ファイルは削除すること。

## 検証項目

- [ ] `npm run build`、`npm test`、`npm run e2e` がすべて成功する（annotate.spec を含む）。
- [ ] `npm run bench` の中の perf-edit の結果が出る（既存の perf.spec も壊さない）。
- [ ] `npm run dev` で起動し、手で「文字を書く → 保存 → 開き直す → 書き直す」ができる。この確認は Playwright の画面操作で代えてよい。

## 報告してほしいこと

- 作成、変更したファイル
- 合格基準④の計測結果（heavy の A1 と、実施設計図の p12）
- 手動（または Playwright）で確認した操作の流れと、気づいた点（IME の扱い、二重に見える時間など）
- 逸脱と残課題
