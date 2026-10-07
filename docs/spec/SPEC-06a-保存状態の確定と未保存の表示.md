# SPEC-06a: 保存状態 — 未確定の入力の確定、未保存の内容とPDF名の表示、比較の安定化、保存・終了の試験

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 保存・終了という中核の流れ（`App.tsx`・`AnnotationStore`・`DocumentSession`）にまたがり、データを失わないことが条件のため（判定表「既存アプリの中核ロジック改修」「原因不明のバグ調査」）

---

## 目的

利用者の報告: 「上書き保存を正常に完了した直後にアプリを終了しようとすると『未保存の変更があります』と出る場合がある。上書き保存後に新しい編集をしていなければ、この警告は不適切」。

Claude Code の調査（Edge・使い捨ての e2e）では、単一の PDF の通常の流れ（経路・追加の線要素・条数・範囲・立上り・余長・縮尺・図面番号の手動変更と自動に戻す・図面番号の読み取り中の保存・ページ整理の後の保存）では、保存後に `dirty` は `false` に戻った。見つかった不具合と原因の候補は次の4つ。**表面的な回避（保存後しばらく警告を止める、保存を押した時点で無条件に未保存を消す等）は禁止**。根本の原因をつぶす。

1. **未確定の入力が失われる（確認済み）**: 書式欄の `QuantityValueInput`（立上り・立下り、余長・その他など）や `RouteItems` の条数（`RouteCount`）、`LocationInput` は、Enter かフォーカスが外れたときに値を確定する。値を打って Enter を押さずに Ctrl+S を押すと、保存は確定前の状態で行われ、保存後の `clearSelection()` で欄が消えて値が捨てられる。逆に欄が残っていると、タブの×を押したときのフォーカス移動で値が確定して「保存直後なのに未保存」になる。
2. **別のタブの未保存がわからない**: `beforeunload` は開いているすべての PDF のどれかが未保存なら警告するが、どの PDF の何が未保存かを出していない。タブを閉じる確認も「未保存の変更があります」だけ。
3. **比較が JSON の文字列**: `AnnotationStore.isDirty()`・`toEdits()` は、図面情報・縮尺・項目一覧・注釈を `JSON.stringify` の文字列で比べる。値が同じでもキーの順番が違うと「変更あり」になる（例: `updateQuantityValues` は 0 のとき `delete a.quantity.slackM` するので、1 → 0 → 1 と戻すと `slackM` が末尾に付き直り、保存済みと同じ値でも未保存になる）。
4. **保存後の後処理の失敗で保存済みにならない**: `saveDocument` はファイルへの書き込み（`writePdf`）の後に `saveLastOpenedHandle`・`persistView`・`refreshRecent` を呼び、最後に `session.fileOutdated = false` にする。後処理が例外を出すと、ファイルは書けているのに「保存できませんでした」と出て未保存のまま残る。

## 対象

- 対象フォルダ: `C:\Users\gibbo\Desktop\PDF編集アプリ\.claude\worktrees\karupdf-quantity-ui-8301e6`
- 変更してよいファイル:
  - `src/App.tsx` — 保存・タブを閉じる・`beforeunload`・`applyPendingEdits` の流れ
  - `src/app/documentModel.ts` — `DocumentSession` の未保存の内容
  - `src/editor/AnnotationStore.ts` — 未保存の判定と内容、比較の安定化、判定のキャッシュ
  - `src/app/DocumentTabs.tsx`、`src/app/MenuBar.tsx` — 未保存の印に内容の説明（`title`）を付ける
  - 新規 `src/app/pendingInput.ts` — 未確定の入力を確定する関数
  - 新規 `src/core/stableJson.ts` — 順番に依存しない比較用の文字列
  - `tests/`（単体）、新規 `e2e/save-state.annotate.spec.ts`
- 変更しないファイル: 上以外。`docs/`、設定ファイル、`scripts/`、既存の e2e（失敗する場合は報告だけ）

## 事前確認

- `src/App.tsx` の `saveDocument`・`saveToBytes`・`closeDocument`・`applyPendingEdits`・`beforeunload` の処理、`src/editor/AnnotationStore.ts` の `toEdits`・`markApplied`・`isDirty`・`editEntries`・`samePersisted`・`notify`、`src/app/documentModel.ts` の `dirty`・`fileOutdated` を読む。
- `e2e/save-as.annotate.spec.ts` の `showSaveFilePicker`・ファイルハンドルの差し替え方を読み、新しい e2e で同じ方式を使う。

## 変更内容

### 1. 未確定の入力の確定（`src/app/pendingInput.ts`）

```ts
// 書式欄・数量タブなどの、フォーカスが外れたときに確定する入力欄の値を確定させる。
// 文字の書き込みの編集欄（TextEditor）は commitEditor が受け持つので対象外。
export function commitFocusedField(): void
```

- `document.activeElement` が `input`・`select`・`textarea` で、文字の書き込みの編集欄（`data-testid="text-editor"` かその中）でなければ `blur()` する。React の `onBlur` は同期で走るので、呼び終わった時点で値はストアに入っている。
- 次の処理の**最初**で呼ぶ: `saveDocument`、`saveToBytes`、`applyPendingEdits`、`closeDocument`（未保存の確認より前）、`beforeunload` の処理（未保存の判定より前）。
- 結果: Ctrl+S で入力中の値も保存される。タブを閉じる・アプリを終了するときは、入力中の値を確定してから判定する（未保存なら正しく警告）。

### 2. 未保存の内容（`AnnotationStore.dirtySummary()`・`DocumentSession.dirtyDescription()`）

```ts
// AnnotationStore
dirtySummary(): { annotations: number; fixtures: boolean; scales: number[]; drawings: number[] }
// DocumentSession
dirtyDescription(): string   // 未保存でなければ ''
```

- `annotations`: 保存していない書き込み・数量の拾いの件数（`editEntries().length`）。`fixtures`: 項目一覧の変更。`scales`・`drawings`: 変更のあるページ番号（0 始まり、昇順）。
- `dirtyDescription()` の文言: 次を「、」で並べる。
  - `書き込み・数量の拾い N件`（N > 0）
  - `数量拾いの項目`（fixtures）
  - `縮尺（1・3ページ）`（ページ番号は 1 始まり、5 ページを超えたら `縮尺（1・3・4・7・9ページ ほか N ページ）`）
  - `図面番号・図面名称（2ページ）`（同じ）
  - `ページの編集・まだ保存していない文書`（`fileOutdated` が true で、上のどれにも当たらないとき。当たるときも末尾に付ける）
- `isDirty()` は `dirtySummary()` と同じ判定にする（どれかがあれば true）。

### 3. 確認の文言

- タブを閉じる（`closeDocument`）: `「${name}」に保存していない変更があります（${dirtyDescription()}）。\n保存せずに閉じますか？`
- `beforeunload`: 文言はブラウザーが決めるので変えられない。未保存の PDF があれば、今と同じく `preventDefault()` し、加えて状態欄に `保存していない変更があるPDF: A.pdf、B.pdf` を出す（`showStatus`）。利用者が「このページにとどまる」を選んだとき、どの PDF かわかる。
- タブ（`DocumentTabs.tsx`）とメニューのファイル名（`MenuBar.tsx`）の未保存の印 ` ●` に `title` で `dirtyDescription()` を付ける（`aria-label="未保存"` は残す）。`MenuBar` へは `dirtyDescription` を props で渡す（`dirty` の props は残す）。

### 4. 比較の安定化（`src/core/stableJson.ts`）

```ts
// オブジェクトのキーを並べ替え、undefined の値を省いた JSON 文字列。配列の順番は保つ。
export function stableJson(value: unknown): string
```

- `AnnotationStore` の未保存の判定・保存する変更の選び出しで使う比較をすべて `stableJson` に替える: `samePersisted`、図面情報（`drawings` と `drawingDirtyBaselines`・`drawingBaselines`）、縮尺（`scales` と `scaleBaselines`）、項目一覧（`fixtures` と `fixtureBaseline`。`fixtureBaseline` と `pendingFixtureSave.json` は `stableJson` の文字列にする。**PDF に書く項目一覧の文字列（`setCountFixtures` の edit）は今のまま**で、比較用の文字列だけを変える）。
- 何も変わらない操作は、履歴にも未保存にも残さない: `setCountFixtures` で `stableJson` が同じで `removeIds` が空なら何もしない。`setDrawingInfo` で全ページの値が `stableJson` で同じなら何もしない。`setScale` も同じ（`recalculate` で注釈が変わらない場合）。

### 5. 判定のキャッシュ

- `isDirty()` は、タブとメニューの描画のたびに全注釈を走査している。`AnnotationStore` の `version`（`notify()` で増える）が前回と同じなら、前回の `dirtySummary()` の結果を返す。
- `notify()` を通らずに未保存の判定に関わる状態を変えている箇所が無いか確認し、あれば `version` を進めるかキャッシュを捨てる（例: `toEdits()` が指摘の色を直す処理、`markApplied()`、`loadDrawingInfos`・`loadScales`・`ensureCountFixtures`・`reset`）。

### 6. 保存後の後処理（`saveDocument`）

- `writePdf(handle, bytes)` が成功し `rebindToFile` した直後に `session.fileOutdated = false` にする。ダウンロードの場合は `downloadPdf` の直後。
- その後の `saveLastOpenedHandle`・`persistView`・分割表示の名前の更新・`refreshRecent` は個別に `try/catch` し、失敗しても保存は成功として扱う。失敗したら状態欄に `保存しました（最近使ったファイルの記録に失敗しました: 〈理由〉）` を出す。
- `writePdf` が失敗したときは今どおり未保存のまま（`fileOutdated` は true のまま、エラーを表示）。`applyAndSave` が失敗したときも今どおり。
- 保存中に新しい編集があった場合: `toEdits()` の後の編集は、`markApplied()` の後も未保存のまま残ること（今の仕組みでそうなっているはずなので、単体試験で確かめる）。

## テスト

### 単体（`tests/`）

- `stableJson`: キーの順番が違っても同じ文字列、`undefined` を省く、配列の順番は保つ。
- `AnnotationStore`:
  - 経路の余長を 1 → 0 → 1（`updateQuantityValues`）と戻すと、保存済みの状態と同じなので `isDirty()` が false。
  - `setCountFixtures` に同じ一覧（キーの順番違い）を渡しても履歴・未保存が増えない。
  - `toEdits()` の後、`markApplied()` の前に注釈を変えると、`markApplied()` の後も `isDirty()` が true で、`dirtySummary().annotations` が 1。
  - `markApplied()` に失敗（`errors`）を含めると、その変更は未保存のまま。
  - `dirtySummary()`・`dirtyDescription()` の文言（書き込み、項目、縮尺のページ、図面情報のページ、5ページを超える場合）。
  - `isDirty()` のキャッシュ: 変更 → `notify` の後に値が変わる。

### 画面（新規 `e2e/save-state.annotate.spec.ts`）

`e2e/save-as.annotate.spec.ts` と同じく `showOpenFilePicker`・`showSaveFilePicker`・ファイルハンドルを `addInitScript` で差し替え、書き込みの成否を切り替えられるようにする。PDF は mupdf で作る白紙 2 ページ（500×500pt）。縮尺 1/100。

- **ケースA（保存後に変更なし）**: 開く → 数量タブ → 長さの項目2つ（CV・PF28）を追加 → 経路を1本なぞる → 書式欄で条数 2・立上り 3・余長 1 → 「この経路に足す」で PF28 → PF28 の範囲を「立上り・立下りのみ」→ 個数の項目を1つ追加して1つ拾う → Ctrl+S → 書き込みが1回終わる → `listTabs()[0].dirty` が false → タブの×を押して確認のダイアログが**出ない**（`page.on('dialog')` で数える）。もう一度開いて同じ状態で保存し、`page.close({ runBeforeUnload: true })` で `beforeunload` のダイアログが**出ない**。
- **ケースA'（未確定の入力）**: 経路を選んだまま「余長・その他」に 2 を打ち、Enter を押さずに Ctrl+S → 保存された PDF の `/KaruQuantity` の `slackM` が 2、保存後 `dirty` が false。
- **ケースB（保存後に再編集）**: ケースAの保存の後、経路の条数を変える → `dirty` が true → タブの×で確認が**出て**、文言に PDF 名と `書き込み・数量の拾い 1件` を含む（ダイアログは dismiss して閉じない）。`page.close({ runBeforeUnload: true })` で `beforeunload` のダイアログが出る（dismiss）。
- **ケースC（保存の失敗）**: 書き込みを失敗させて Ctrl+S → エラーが表示され、`dirty` が true のまま。成功に戻して Ctrl+S → false。
- **ケースD（複数の PDF）**: 2つの PDF を開き、1つ目を編集して保存、2つ目を編集して保存しない → 1つ目のタブの `dirty` は false、2つ目は true。`beforeunload` を起こすと（`page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })))` などで）状態欄に `保存していない変更があるPDF:` と2つ目の名前だけが出る。2つ目のタブの未保存の印の `title` が `dirtyDescription()` と同じ。

## 禁止事項

- 保存後しばらく警告を止める、保存を押した時点で無条件に未保存を消す、実際に保存されていない変更があっても警告を消す、などの表面的な回避をしないこと。
- 保存する PDF の中身（項目一覧の文字列、注釈の内容）を変えないこと。比較用の文字列だけを変える。
- 通常の閲覧・スクロールに処理を足さないこと。
- 試験から `work/` など Git の管理外のフォルダへ書き込まないこと。
- 対象外のファイルを変更しないこと。git の操作をしないこと。python・pytest は使わない。
- 試験の実行はしなくてよい（Claude Code が実行する）。書くだけでよい。`npx tsc --noEmit` は実行してよい。

## 検証項目

- [ ] `npx tsc --noEmit` が通る。
- [ ] 上の単体試験・e2e を書いた。

## 報告してほしいこと

- 変更したファイルと要点
- `notify()` を通らずに未保存の判定に関わる状態を変えていた箇所（見つかったもの）と、その扱い
- SPEC から逸脱した箇所と理由、残課題
