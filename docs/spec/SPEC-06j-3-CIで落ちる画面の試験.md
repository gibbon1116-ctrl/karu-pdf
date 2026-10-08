# SPEC-06j-3: CI（Linux）で失敗する画面の試験2件を、環境に左右されないようにする

## 実行モデル指定（必須）

- モデル: `gpt-6-luna`
- reasoning effort: `max`
- 選定理由: 既存の e2e 試験2つの局所修正（製品のコードは変えない）

---

## 目的

GitHub Pages への公開（`.github/workflows/deploy.yml` の `npm run e2e`）が 1.4.1 から失敗し、公開されていない。製品の不具合ではなく、試験が画面の大きさと時間に依存しているため。製品のコードは変えずに、試験だけを直す。

## 現状（Claude Code が確認したこと）

### 1. `e2e/quantity-order.annotate.spec.ts` の `category selection, visible steps, drag moves, Undo, and persisted category/order`

- CI では毎回失敗する。71 行の `toHaveText('新LED')` で、実際は「非常用照明」。
- 1.4.1 で数量パネル（管理）に「図面の線の端点にも合わせる」のチェックが 1 行増え、項目の一覧が下がった。
- 試験は画面の高さを 1400px にし、ほかの分類を畳んで、ドラッグの両端が見える前提にしている（コメント: `dragTo does not simulate scrolling during a drag`）。
- CI の Linux は文字が高く、両端が見えなくなる。
- Windows でも高さを 1250px にすると同じ形で失敗する（「ベースライト（埋込）」）。1400px では通る。

### 2. `e2e/menu.annotate.spec.ts` の `キーボードでファイルメニューの2番目を実行する`

- CI で 1 回だけ失敗した。`getMenuActions()` が空のまま。
- `ArrowDown` を 2 回続けて押してすぐ `Enter` を押すので、メニューが開く前・フォーカスが移る前にキーが届くことがある、とみている。

## 対象

- 対象フォルダ: `C:\Users\gibbo\Desktop\PDF編集アプリ\.claude\worktrees\karupdf-quantity-ui-8301e6`
- 変更してよいファイル: `e2e/quantity-order.annotate.spec.ts`、`e2e/menu.annotate.spec.ts`
- 変更しないファイル: 上以外すべて（`src/` は変えない）

## 変更内容

1. quantity-order: ドラッグの前に、ドラッグ元と先の両方が数量パネルのスクロールの中で見えていることを保証する。
   - 例: 画面の高さを十分にする（2000px 等）。または、ドラッグ元と先が見えるようにパネルをスクロールしてから、両方が viewport 内にあることを `boundingBox` で確かめる。
   - 文字の高さが Windows より 1 割程度高くても通るようにする。試験の意図（ドラッグで分類の先頭へ動く・Undo・上へボタン等）は変えない。
2. menu: 各キーの後に、画面の状態（メニューが開いたこと、2 番目の項目にフォーカスがあること等）を待ってから次のキーを押す。
   - 期待（`save` が実行される）は変えない。
   - メニューの DOM の構造は、`src/app/` の該当コンポーネントを読んで、実在する role・属性で待つこと。

## 禁止事項

- 製品のコード（`src/`）を変えないこと。期待値を緩めて意図を失わせないこと（`test.skip` や `toContain` の範囲の拡大など）。
- git の操作をしないこと。python・pytest は使わない。
- e2e は実行しなくてよい（実行は Claude Code が行う）。`npx tsc --noEmit` は実行してよい。

## 報告してほしいこと

- 変更点と、なぜ環境に左右されなくなるか
