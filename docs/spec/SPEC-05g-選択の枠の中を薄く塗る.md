# SPEC-05g: 選んだ書き込み・数量拾いの印の点線の枠の中を、薄く塗る

## 実行モデル指定（必須）

- モデル: `gpt-6-luna`
- reasoning effort: `max`
- 選定理由: CSS の1つの規則を変えるだけの、判断を伴わない局所の修正のため（判定表「単一ファイル完結の局所修正」）

> Codex デスクトップアプリへ貼り付けて実行する場合は、モデルセレクタを上記に合わせてから貼り付けること。

---

## 目的

利用者の要望（2026-10-07）:

> 数量拾いで項目を選択したとき、選択された図中の記号等が点線で囲まれるが、どこが囲まれているのか分かりにくい。点線で囲んだうえで、点線の中を薄く色付けるようにしたい。

## 現状（Claude Code が確認したこと）

- 選んだ書き込み（数量拾いの印・拾いを含む）の枠は `src/editor/AnnotationLayer.tsx:807` の `<rect className="annotation-selection" …>` で描き、見た目は `src/styles.css:285` の規則だけで決まっている。

```css
.annotation-selection { fill: none; stroke: #1473e6; stroke-width: 1; stroke-dasharray: 4 3; vector-effect: non-scaling-stroke; pointer-events: none; }
```

## 対象

- 変更してよいファイル: `src/styles.css` だけ

## 変更内容

1. `src/styles.css` の `.annotation-selection` の `fill: none` を、枠の線と同じ青の薄い塗り `fill: rgba(20, 115, 230, 0.15)` に変える。ほかの指定（線の色・太さ・点線・`pointer-events: none` など）は変えない。
2. ほかの規則（`.annotation-draft`・`.annotation-resize-preview` など）は変えない。

## 禁止事項

- `src/styles.css` 以外を変更しないこと。
- **`npm run build`・`npm test`・`npx playwright` など、ビルドと試験を実行しないこと**（Claude Code が別の試験を実行中で、配布物の作り直しがそれを壊すため。検証は Claude Code が行う）。
- git の変更操作をしないこと。python・pytest は使わない。

## 報告してほしいこと

- 変更した行（前後）
