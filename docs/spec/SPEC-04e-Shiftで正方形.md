# SPEC-04e: 四角も Shift を押しながら描くと正方形にする

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 変更は小さいが、作図処理・ヘルプ・画面試験の3ファイルにまたがるため（降格の条件「単一ファイル内で完結」を満たさない）

> Codex デスクトップアプリへ貼り付けて実行する場合は、モデルセレクタを上記に合わせてから貼り付けること。

---

## 目的

利用者から次の要望が出た（2026-10-04）。

> 図形で四角をつくるとき、〇のようにSHIFTを押しながら作図すると正方形が作れるようにしたい。

## 確かめたこと（2026-10-04、現在のコード）

- `src/editor/AnnotationLayer.tsx` の `shapeRect(start, end, square)`（104行）は、第3引数が真のとき縦横を揃える。
- 描いている途中の表示（460行）と確定時（616行）で、第3引数は `operation.creationKind === 'circle' && operation.shift` になっている。丸だけが Shift で正円になり、四角（`'square'`）はならない。
- 「雲（四角）」（`'cloudSquare'`）も同じ処理を通るが、今回の要望の対象ではない。
- 丸の Shift の画面試験はない。

## 対象

- 作業フォルダ: `C:\Users\gibbo\.codex\worktrees\dda9\PDF編集アプリ`
- 変更してよいファイル:
  - `src/editor/AnnotationLayer.tsx` — 460行と616行の条件だけ
  - `src/app/HelpDialog.tsx` — 四角と丸の説明に1文を足すだけ
  - `e2e/shape-shift.annotate.spec.ts` — 新しく作る
- 変更しないファイル: 上記以外のすべて

## 変更内容

1. `src/editor/AnnotationLayer.tsx` の460行と616行の条件を、丸と四角の両方で Shift を有効にする形にする。

   ```ts
   (operation.creationKind === 'circle' || operation.creationKind === 'square') && operation.shift
   ```

   2か所とも同じ条件にする。`'cloudSquare'`、線、矢印、範囲選択（`marquee`）の動きは変えない。
2. `src/app/HelpDialog.tsx` の「四角と丸は塗り・枠線・透明度を選べます。」の段落に、「Shift を押しながら描くと、四角は正方形、丸は正円になります。」を足す。
3. `e2e/shape-shift.annotate.spec.ts` を作る。既存の画面試験（例: `e2e/businessCases.ts` の105行付近「矢印・吹き出しの先端サイズと5度刻み…」、`e2e/copy-opacity.annotate.spec.ts`）の開き方・道具の選び方・座標の求め方に合わせる。
   - 四角: 「図形▼」→「四角」を選び、Shift を押しながら横長（例: 横120px・縦50px）にドラッグする。できた四角の `rect` の幅と高さが等しい（`toBeCloseTo`）ことを確かめる。
   - 四角: Shift なしで同じドラッグをすると、幅と高さが違う（従来どおり）ことを確かめる。
   - 丸: Shift を押しながら同じドラッグをすると、幅と高さが等しいことを確かめる（既存の動きの回帰確認）。
   - 書き込みの取得は `window.__karu.getEditableAnnotations(0)` を使う。

## 禁止事項

- 指定した3ファイル以外を変更しないこと
- 四角・丸以外の道具の動き、`shapeRect` 自体の計算を変えないこと
- **テスト・ビルド・型検査・ブラウザーを実行しないこと**（Claude Code 側で行う）
- **python は使えない（この環境に入っていない）。ファイルの編集は apply_patch で行い、スクリプトによる一括書き換えをしないこと**
- git 操作をしないこと

## 検証項目（Claude Code 側で実施）

- [ ] `npx tsc --noEmit` が通る
- [ ] `npm run build` の後、`e2e/shape-shift.annotate.spec.ts` が通る
- [ ] 既存の図形・連続作図の画面試験（`e2e/continuous-tools.annotate.spec.ts`、`e2e/copy-opacity.annotate.spec.ts`）が通る

## 報告してほしいこと

- 変更・作成したファイル一覧と、変更した行
- SPEC から逸脱した箇所があれば、その内容と理由
