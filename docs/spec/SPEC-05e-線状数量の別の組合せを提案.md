# SPEC-05e: 長さ・面積・体積の項目の「別の組合せを提案」（色・線種・線幅）

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 既存の個数の印の候補選び（`nextCountStyle`）と考え方を共通にした、線の見た目の候補選びの追加と、項目の画面・追加の流れへの接続のため（判定表「既存パターンを広げる複数ファイルの変更」）

> Codex デスクトップアプリへ貼り付けて実行する場合は、モデルセレクタを上記に合わせてから貼り付けること。

---

## 目的

利用者の改修指示書（2026-10-06）の 14:

- 個数の項目にある「別の組合せを提案」（形・塗り・色）を、ケーブル・ラック・配管・ダクトなどの長さの項目でも使えるようにする（面積・体積の項目も線で描くので同じにする）。
- 線の見た目の既存の属性（色・線種・線幅）を使う。優先順位は **1. 色、2. 線種、3. 必要なときに線幅**。色だけに頼らず、実線・破線・一点鎖線・点線も使って、図面の上で見分けやすくする。
- `nextCountStyle()` の考え方を参考に、候補選びを共通にする。同じ見た目の項目があるときは、今と同じく警告する。

## 現状（Claude Code が確認したこと）

- `nextCountStyle(fixtures, excluded)`（`src/core/countFixtures.ts`）: 形・塗り・色の全部の組合せを決まった順で並べ、使われていない組合せのうち、使われている数（形・色・塗りそれぞれの使用数の和）が最も少ないものを選ぶ。
- 項目の画面（`src/app/FixtureDialog.tsx:127` 付近）の「別の組合せを提案」は、提案済みのもの（`suggestions`）・今の値・編集前の値を除いて `nextCountStyle` を呼ぶ。個数の項目だけで表示している。
- 長さ等の項目の線は `line: { width, dash }`（`QUANTITY_LINE_WIDTHS`・`QUANTITY_DASHES`）と `style.color`。新しく足すときは、`nextCountStyle` の色と `{ width: 1.5, dash: 'solid' }`（`FixturePanel.tsx:98` 付近、項目の画面の種別の切替）。
- 見た目の重なりの判定は `sameFixtureAppearance`（個数以外は、拾い方・色・線種・線幅が同じとき）。

## 対象

- 対象フォルダ: `C:\Users\gibbo\Desktop\PDF編集アプリ\.claude\worktrees\quantity-pickup-expansion-ea43cf`
- 変更してよいファイル: `src/core/countFixtures.ts`、`src/app/FixtureDialog.tsx`、`src/app/FixturePanel.tsx`、`tests/countFixtures.test.ts`、`e2e/`（新しい試験か、`quantity-length` などへの追加）
- 変更しないファイル: 上以外

## 変更内容

1. `countFixtures.ts` に、線の見た目の候補選びを作る。

```ts
export interface QuantityLineAppearance { color: RGB; line: QuantityLineStyle }
export function nextQuantityLineStyle(fixtures: readonly CountFixture[], excluded?: readonly QuantityLineAppearance[]): QuantityLineAppearance
```

   - 候補の順（優先順位）: まず線種を実線に固定して、色（`COUNT_COLORS` の 24 色を、`nextCountStyle` と同じように見分けやすい順に並べ替えた順）を全部使う。次に破線・一点鎖線・点線の順で、それぞれ全部の色。それでも足りなければ線幅（1.5 → 3 → 0.5 → … の順、`QUANTITY_LINE_WIDTHS` から）を変えて、同じ順で回す。
   - 比べる相手は、個数以外の項目全部（長さ・面積・体積。拾い方の違いは問わない。図面の上で見分けたいため）。使われている組合せ（色・線種・線幅）と `excluded` は選ばない。
   - 同じ点数なら上の候補の順で先のものを選ぶ。点数は「その色の使用数 + その線種の使用数（×小さめの重み）+ その線幅の使用数（×さらに小さい重み）」。色の重なりを最も避け、次に線種、最後に線幅となるように重みを決める。
   - `nextCountStyle` と共通にできる部分（候補の表を一度だけ作って使い回す、使用数を数える、除外の判定）は共通の小さな関数にする。`nextCountStyle` の結果（選ぶ組合せの順）は変えないこと（既存の試験がそのまま通ること）。
   - 全部の組合せ（24 色 × 4 線種 × 6 線幅 = 576）が使われていたら、今の `nextCountStyle` と同じく例外を投げる。
2. 項目の画面（`FixtureDialog.tsx`）
   - 「別の組合せを提案」を、長さ・面積・体積の項目でも出す。押すと `nextQuantityLineStyle(他の項目, [提案済み, 今の値, 編集前の値])` で色・線種・線幅を替える（形・塗りは触らない）。
   - 種別を個数から長さ等に切り替えたとき、新しい項目なら `nextQuantityLineStyle` の結果を入れる（今の固定の `{ width: 1.5, dash: 'solid' }` と `nextCountStyle` の色をやめる）。
   - 同じ見た目の警告（`sameFixtureAppearance`）は今のまま出す。
3. 追加の流れ
   - 「項目を追加」「複製」「見本から追加」「他の PDF から読み込む」で、新しく作る長さ・面積・体積の項目に、`nextQuantityLineStyle` の結果を入れる（複数を一度に足すときは、足した分を順に除外に入れて重ならないようにする。今の個数の `addMany` の考え方と同じ）。他の PDF から読み込む項目は、元の見た目が今の一覧と重ならない限り、元の見た目を保つ（今の個数の扱いと同じ）。
   - 複製のときは、元の項目と違う見た目にする（色を優先して替える）。

## テスト

- **単体（`tests/countFixtures.test.ts`）**:
  - 長さの項目が無いとき、最初の候補は実線・1.5pt・最初の色。
  - 24 色の実線を使い切った後は、破線になる（色は使用数の少ないもの）。
  - `excluded` を渡して繰り返すと、毎回違う組合せになり、既存の項目と重ならない（20 回繰り返して確かめる）。
  - 個数の項目の見た目は、線の候補選びに影響しない（個数の色を使っていても、線の候補は最初の色から）。
  - `nextCountStyle` の既存の試験がそのまま通る。
- **画面**: 見本から長さの項目を 6 つ足すと、6 つとも違う見た目になる。項目の画面で「別の組合せを提案」を 3 回押すと、色・線種・線幅が毎回変わり、一覧の他の項目と同じ見た目の警告が出ない。

## 禁止事項

- 試験のコードから、`work/` など Git の管理外のフォルダへ書き込まないこと（GitHub の公開の流れには無いフォルダで、試験が失敗する）。報告用のファイルは試験の外で作る。

- 個数の項目の候補の順（`nextCountStyle` の結果）を変えないこと。
- 保存の形を変えないこと（色・線種・線幅は今の欄を使う）。
- 対象外のファイルを変更しないこと。git の変更操作をしないこと。python・pytest は使わない。

## 検証項目

- [ ] `npx tsc --noEmit`、`npm test`、`npm run build` が成功する。
- [ ] 新しい e2e と、既存の `count-fixtures`・`quantity-*` の e2e が成功する。

## 報告してほしいこと

- 候補の順と重みの決め方
- 変更したファイルと要点、検証の結果
- SPEC から逸脱した箇所と理由、残課題
