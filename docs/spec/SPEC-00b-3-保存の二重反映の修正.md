# SPEC-00b-3: 試作（保存の二重反映の修正）

## 実行モデル指定（必須）

- モデル: `gpt-5.6-sol`
- reasoning effort: `high`
- 選定理由: SPEC-00b-2 の続きで、同じスレッドで保存の処理の正しさを直すため

---

## 目的

レビューで、保存の処理に、書き込みが二重にできてしまう不具合が2つ見つかった。これを直す。

## 不具合

1. **保存を続けて実行すると二重になる**
   - Ctrl+S を素早く2回押すと、1回目の `applyAndSave` が終わる前に、2回目が同じ `toEdits()`（同じ `create…`）を送る。
   - その結果、新しい注釈が Worker 0 の文書に2回作られる。
2. **ファイルへの書き込みに失敗すると、次の保存で二重になる**
   - `applyAndSave` が成功した時点で、Worker 0 の文書には変更が反映されている。
   - しかし、その後の `writePdf` が失敗すると（例: 共有フォルダのファイルを他の人が開いている）、`markSaved` が呼ばれない。
   - 次に保存すると、同じ `create…` をもう一度送ってしまう。
3. （軽微）`result.errors` があっても `markSaved` がすべての変更を保存済みにするため、失敗した変更が失われる。

## 対象

- 変更してよいファイル: `src/App.tsx`、`src/editor/AnnotationStore.ts`、`tests/AnnotationStore.test.ts`、`e2e/annotate.spec.ts`
- 上記以外は変更しない。

## 変更内容

1. **保存中は次の保存を受け付けない**
   - `saveDocument` と `saveToBytes` に、保存中を表す印（ref）を持たせる。
   - 保存中に呼ばれたら、何もせずに「保存中です」と表示する。
   - ツールバーの保存ボタンは、保存中は押せないようにする。
2. **「文書に反映済み」と「ファイルに保存済み」を分ける**
   - `AnnotationStore.markSaved(result)` を `markApplied(result)` に改める。
     - `applyAndSave` が成功したら、**ファイルへの書き込みより前に**呼ぶ。
     - 役割は、`created` の objNum の割り当てと、成功した変更の `dirty` を消すこと。
   - `result.errors` にある変更（`editIndex` で分かる）は、`dirty` を残す。
     - そのためには、`toEdits()` が返した変更と、ストアの注釈との対応を覚えておく必要がある。
   - App 側では「**ファイルが最新でない**」を表す印（`fileOutdated`）を別に持つ。
     - `applyAndSave` が成功した時点で true にする。
     - ファイルへの書き込みが成功したら false にする。
     - ファイル名の前の「●」と `beforeunload` の警告は、「`store.isDirty()` または `fileOutdated`」で判定する。
   - ファイルへの書き込みに失敗したら、`fileOutdated` は true のままにする。次の保存では `toEdits()` が空になるが、それでも `applyAndSave([], 'incremental')` で同じ文書を保存し直せるようにする。
3. **テスト**
   - `tests/AnnotationStore.test.ts`
     - `markApplied` の後、`toEdits()` が同じ create を返さないこと。
     - errors にある変更は `dirty` が残ること。
   - `e2e/annotate.spec.ts`
     - `saveToBytes()` を2回同時に呼ぶ（`Promise.all`）。保存して開き直し、FreeText が1つだけであることを確かめる。

## 禁止事項

- 対象外のファイルを変更しないこと。git の操作をしないこと。
- 自分で起動したサーバーは必ず止めること。

## 検証項目

- [ ] `npm run build`、`npm test`、`npm run e2e` がすべて成功する。

## 報告してほしいこと

- 変更したファイルと、変更の要点
- 検証の結果
