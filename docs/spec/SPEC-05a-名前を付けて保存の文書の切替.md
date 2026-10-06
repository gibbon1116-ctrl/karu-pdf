# SPEC-05a: 「名前を付けて保存」の後に、文書を保存先へ切り替える

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 文書の識別（名前・ファイルの場所・表示位置の記録・最近使ったファイル・タブ）にまたがる不具合の修正で、取り違えるとほかのファイルを上書きする危険があるため（判定表「既存機能の不具合修正（複数ファイル）」）

> Codex デスクトップアプリへ貼り付けて実行する場合は、モデルセレクタを上記に合わせてから貼り付けること。

---

## 目的

利用者の改修指示書（2026-10-06）の 19:

> A.pdf を開く → 名前を付けて保存 → B.pdf として保存 → 現在のタブ等は A.pdf のまま、となる問題を修正してください。（中略）正常に B.pdf として保存した後は、現在開いている文書名、タブ名、FileSystemFileHandle、次回上書き保存先、最近使ったファイル、復元用情報、必要な文書識別情報を B.pdf 側へ切り替えてください。その後 Ctrl+S を実行した場合、B.pdf へ上書きされ、A.pdf は変更されないこと。画面上のファイル名だけを変える修正は禁止します。

## 現状と原因（Claude Code が確認したこと）

- `src/App.tsx:753` の `saveDocument(saveAs)`:
  - 保存先を `pickSaveHandle(session.name, …)` で選び、書き込み後に `session.handle = handle` にしている。だから Ctrl+S の書き込み先は B.pdf になる。
  - しかし `DocumentSession.name`（`src/app/documentModel.ts:48`）は `readonly` で、開いたときの名前（A.pdf）のまま。タブ、上の帯のファイル名、`saveLastOpenedHandle(handle, session.name)`（最近使ったファイル。B のファイルの場所に A の名前を付けて記録する）、次の「名前を付けて保存」の提案名、`documentViewId(session.name, session.byteLength)`（表示位置の記録。`App.tsx:521`）がすべて A.pdf のまま。
  - `DocumentSession.byteLength` も `readonly` で開いたときの大きさのまま。表示位置の記録の鍵（`名前\n大きさ`）は、保存の後は開き直したときの鍵と合わない（ふつうの上書き保存でも同じ）。
- 開くとき（`App.tsx:600-635`）は、`name`・`byteLength`・`handle` から `DocumentSession` を作り、`loadViewPosition(documentViewId(name, byteLength))` で表示位置を戻し、`saveLastOpenedHandle(handle, name)` で最近使ったファイルに入れている。

## 対象

- 対象フォルダ: `C:\Users\gibbo\Desktop\PDF編集アプリ\.claude\worktrees\quantity-pickup-expansion-ea43cf`
- 変更してよいファイル: `src/app/documentModel.ts`、`src/App.tsx`、`src/editor/recentStore.ts`、`src/editor/fileAccess.ts`、文書名を表示している部品（タブ・上の帯など。`grep` で `session.name`・`.name` の利用を洗い出す）、`tests/`、`e2e/`
- 変更しないファイル: `docs/`、`public/`、設定ファイル、`src/core/`、`src/worker/`

## 事前確認

- `session.name`・`session.byteLength`・`session.handle` を使っている箇所をすべて洗い出し、「開いたときの値」と「今の保存先の値」のどちらであるべきかを分ける。例:
  - 今の保存先であるべき: タブ名、上の帯のファイル名、`listTabs`（試験の窓口）、最近使ったファイル、表示位置の記録の鍵、次の「名前を付けて保存」の提案名、CSV・画像として保存・確定版などの出力ファイル名の元になる名前（`rasterizedName`・`finalizedName`・`_数量.csv` など）。
  - 変えない: `docId`（Worker の文書の識別子。保存先が変わっても同じ文書）。
- 「復元用情報」として、上のほかに、開いているタブや最後に開いたファイルを覚えて次回に開き直す仕組み（`loadLastOpenedHandle`、`e2e/resume.spec.ts` など）があれば、それも保存先の側へ切り替える。

## 変更内容

1. `DocumentSession` に、保存先を切り替える1つのメソッドを作る（名前は任せる。例: `rebindToFile(handle, name, byteLength)`）。
   - `name`・`byteLength`・`handle` を一緒に変える。`name`・`byteLength` は外から勝手に書き換えられないよう、読み取りだけを公開する形を保つ（`readonly` をやめる場合も、変更はこのメソッドだけで行う）。
   - `docId`・書き込みの内容・取り消しの履歴・表示の状態は変えない。
2. `saveDocument` で、書き込みに**成功した後で**、このメソッドを呼ぶ。
   - `name` は保存先のファイル名（`handle.name`）。`byteLength` は書き込んだバイト数。
   - ふつうの上書き保存（保存先が同じ）でも `byteLength` を更新し、表示位置の記録の鍵が開き直したときと合うようにする。
   - 書き込みに失敗したとき・保存先の選択を取りやめたとき（`AbortError`）は、何も切り替えない（A.pdf のまま）。
   - その後で、最近使ったファイルに新しい名前で記録し（`saveLastOpenedHandle(handle, 新しい名前)`）、今の表示位置を新しい鍵で記録し、タブを描き直す（`refreshTabs`）。
3. 保存先を選べない環境（`showSaveFilePicker` が無く、ダウンロードで保存する場合）は、今の動きのまま（文書の名前もファイルの場所も変えない）。
4. 「画像として保存」「確定版」など、別のファイルへ書き出す機能は、今の文書の保存先を変えない（今どおり）。変えるのは「名前を付けて保存」と、ファイルの場所が無い文書の初めての保存だけ。
5. ほかのタブで同じファイルを開いている場合の扱いは、今どおりでよい（新しい警告は作らない）。

## テスト

- **単体**（`tests/documentModel.test.ts` など）: 切り替えのメソッドで `name`・`byteLength`・`handle` が変わり、`docId` と書き込みの状態が変わらないこと。
- **画面（e2e）**: 保存先の選択（`showSaveFilePicker`）を試験用に差し替えて、ファイルの場所の代わりの物（書き込まれたバイトを記録する）を返すようにする。今ある試験の差し替え方があれば、それに倣う。
  1. A.pdf を開く（A のファイルの場所の代わりの物から）。書き込みを1つ足し、「名前を付けて保存」で B.pdf を選ぶ。
  2. タブ名・上の帯の名前が B.pdf になり、`listTabs()` の `name` も B.pdf。
  3. 書き込みをもう1つ足して Ctrl+S → B の代わりの物にだけ書き込まれ、A の代わりの物には何も書かれない（書き込み回数で確かめる）。
  4. 最近使ったファイルの一番上が B.pdf。
  5. 「名前を付けて保存」の提案名が B.pdf。
  6. 保存先の選択を取りやめた（`AbortError`）ときは、名前も保存先も A.pdf のまま。
- 既存の `e2e/resume.spec.ts`、保存・最近使ったファイル・文書のタブに関わる試験が通ること。

## 禁止事項

- 画面の文字だけを変える修正にしないこと（保存先・最近使ったファイル・表示位置の記録まで切り替える）。
- `docId` を変えないこと。Worker の文書を開き直さないこと。
- 対象外のファイルを変更しないこと。git の変更操作をしないこと。python・pytest は使わない。

## 検証項目

- [ ] `npx tsc --noEmit`、`npm test`、`npm run build` が成功する。
- [ ] 新しい e2e と、`resume`・`finish`・`shell`・`sidebar` など保存とタブに関わる既存の e2e が成功する。

## 報告してほしいこと

- `session.name`・`byteLength`・`handle` の利用箇所の洗い出しの結果（どちらの値であるべきかの判断）
- 変更したファイルと要点、検証の結果
- SPEC から逸脱した箇所と理由、残課題
