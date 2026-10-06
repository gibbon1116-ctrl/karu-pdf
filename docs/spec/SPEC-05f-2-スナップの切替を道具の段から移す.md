# SPEC-05f-2: スナップの切替を、道具の段から「計測▼」と数量タブへ移す（SPEC-05f の追補）

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 画面の部品の置き場所の変更で、道具の段・数量タブ・App の状態の受け渡しと、既存の試験にまたがるため

> Codex デスクトップアプリへ貼り付けて実行する場合は、モデルセレクタを上記に合わせてから貼り付けること。

---

## 目的

SPEC-05f で、道具の段のズームの横に「スナップ」ボタン（`data-testid="snap-toggle"`、`src/app/ToolRow.tsx:154`）を足した。この分だけ道具の段が広くなり、GitHub の公開の流れ（Linux の Chromium、幅 1440px、Windows より文字が広い）で、道具の段が2段に折り返す幅にかかった。道具を選ぶと段の数が変わって図面の位置がずれ、既存の画面試験（文字に印・縮尺の設定のメニュー）が次々に失敗している。

道具の段の幅を、スナップを足す前と同じに戻すため、スナップの切替を道具の段から外し、次の2か所に置く。

## 現状（Claude Code が確認したこと）

- 状態: `src/App.tsx:262` の `snapEnabled`（`localStorage` の `karu-pdf:snap`）、`:1705-1707` で `ToolRow` に `snapEnabled`・`snapAvailable`・`onSnapToggle` を渡している。`SnapContext`（`:1768`）で計測の操作へ渡している。
- 「計測▼」のプルダウン（`ToolRow.tsx:121`）の最後に、区切りと「縮尺の設定…」がある。`Dropdown` の項目は `checked` を持つとチェックの付く項目（`menuitemcheckbox`）になる（`src/ui/Dropdown.tsx:178-185`）。
- 試験: `e2e/snap.annotate.spec.ts`・`e2e/snap.perf.spec.ts` が `getByTestId('snap-toggle')` を使っている。

## 対象

- 変更してよいファイル: `src/app/ToolRow.tsx`、`src/App.tsx`、`src/app/FixturePanel.tsx`（と、数量タブに状態を渡すのに必要な `src/app/documentModel.ts` の Context など最小限）、`src/app/HelpDialog.tsx`、`src/styles.css`、`e2e/snap.annotate.spec.ts`、`e2e/snap.perf.spec.ts`、`tests/`
- 変更しないファイル: 上以外。スナップの探索・索引（`src/core/snap.ts`、`src/editor/MeasurementOverlay.tsx`）の動きは変えない。

## 変更内容

1. **道具の段からスナップのボタンを外す**（`ToolRow.tsx:154` のボタンと、その props）。道具の段の並び・幅は SPEC-05f の前と同じになること。
2. **「計測▼」のプルダウン**の最後（「縮尺の設定…」の後）に、区切りを挟んで、チェックの付く項目を足す:
   - 名前: `スナップ（既存の頂点に合わせる）`、説明: `計測・数量拾い・縮尺のなぞりで、既存の頂点に吸い付く（Alt で一時解除）`、`checked` は今のオン・オフ。選ぶと切り替わる。
   - 計測の道具を使っていないときでも切り替えられる（状態を決めておけるように）。今の `snapAvailable` による無効化はやめる。
3. **数量タブ**（`FixturePanel.tsx`）の「図面に長さ・面積・体積の数値を表示」のチェックの下に、同じ状態のチェックを置く: `☐ スナップ（既存の頂点に合わせる）`。
4. 状態の持ち方（`App.tsx` の `snapEnabled`、`localStorage` の `karu-pdf:snap`、既定オフ、`SnapContext`）は今のまま。2か所のどちらで切り替えても同じ状態が変わる。
5. ヘルプ（`HelpDialog.tsx`）のスナップの説明を、切替の場所に合わせて直す。
6. 試験を新しい場所に合わせて直す（試験の意図は変えない）:
   - `snap.annotate.spec.ts`・`snap.perf.spec.ts` の `snap-toggle` の操作を、「計測▼」の項目（`menuitemcheckbox` の `スナップ（既存の頂点に合わせる）`）か、数量タブのチェックで行う。両方の場所で切り替えられること、状態が再読み込みで残ること、既定がオフであることを確かめる。
   - 「計測以外の道具では押せない」を確かめていた箇所（`toBeDisabled`）は、新しい仕様（いつでも切り替えられる）に合わせて、計測以外の道具ではスナップが働かないこと（吸い付かないこと）の確かめに変える。
   - 道具の段の幅の試験（`e2e/menu.annotate.spec.ts` の「1600pxでは道具の段を1段に収め…」など）が通ること。

## 禁止事項

- スナップの探索・索引の動きを変えないこと。保存の形を変えないこと。
- 試験から `work/` など Git の管理外のフォルダへ書き込まないこと。
- 対象外のファイルを変更しないこと。git の変更操作をしないこと。python・pytest は使わない。

## 検証項目

- [ ] `npx tsc --noEmit`、`npm test`、`npm run build` が成功する。
- [ ] `e2e/snap.annotate.spec.ts`、`e2e/menu.annotate.spec.ts`、`e2e/measure.annotate.spec.ts`、`e2e/text-mark.annotate.spec.ts`、`e2e/continuous-tools.annotate.spec.ts`、`e2e/business-improvements.annotate.spec.ts` が、Edge と `PLAYWRIGHT_CHANNEL=chromium` の両方で成功する。

## 報告してほしいこと

- 変更したファイルと要点、検証の結果
- SPEC から逸脱した箇所と理由
