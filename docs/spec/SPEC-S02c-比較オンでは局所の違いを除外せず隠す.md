# SPEC-S02c: 形の比較がオンのときは、局所画像の違いで候補を除外せず「形が違う」として隠す

## 実行モデル指定（必須）

- モデル: `gpt-6-luna`
- reasoning effort: `max`
- 選定理由: 判断は Claude Code が済ませた。1つの関数の数行と、試験の期待値の更新だけの局所修正のため

---

## 現状

- `src/client/SymbolSearchClient.ts` の局所画像の比較では、`compareLocalBody(sample, d)` が `different` の候補を `keep` で除外する（P26 の改修）。
- そのため、形の比較（`shapeCheck`）がオンでも、斜線入り・黒塗りの候補は「形の細部が見本と違う」の表示に出てこない。黙って消える。
- 既存の e2e `斜線入りも候補に残し、画像の確認がオフでも要確認に分ける`（`e2e/symbol-search.annotate.spec.ts`）は、P26 の改修の後から失敗している。引継ぎ時点のコミット `7f758db` でも、3件（確度高3件）で失敗することを確かめた。

## 変更内容

### 1. `src/client/SymbolSearchClient.ts`

**`request.shapeCheck` が真のとき**
- `compareLocalBody` が `different` の候補を、除外しない（`keep` を真にする）。
- その候補の番号を覚えておく（例: `localDifferent: boolean[]`。`keep` で減らすときも同じ順で減らす）。
- 形の判定（`decideSymbolShape`）の後、覚えた候補の結果を次のようにする。
  - `decision` を `'different'` にする。
  - `differences` に `'interior'` を入れる（重複させない）。
  - `unknown` から `'interior'` を除く。
- `structureCheck` の扱い（`same` で外す）は今のまま。

**`request.shapeCheck` が偽・未指定のとき**
- 今とまったく同じ（`different` は除外する）。

### 2. `e2e/symbol-search.annotate.spec.ts`

**試験 `斜線入りも候補に残し、画像の確認がオフでも要確認に分ける`**
- 今の動作（形の比較オフ）に合わせて、名前と期待値を変える。
  - 新しい名前: `形の比較がオフなら、局所画像で明らかに違う斜線入りは候補から除く`
  - 期待値:
    - `search(page, 3)`
    - 確度高 3 件
    - 要確認 0 件
    - 「確度の高い候補を選ぶ」で3件選ばれる
    - 数量の印は 0
  - 斜線入りの位置（y ≥ 240）を確かめていた部分は、表示中の3件がすべて y < 240 であることを確かめる形に変える。

**試験 `形の細部の比較では、斜線入りを違う形として初めは隠す`**
- 今の書き方のまま通るはず。直さない。
- 通らない場合は、理由を報告すること。

## 対象

- 対象フォルダ: `C:\Users\gibbo\.codex\worktrees\dfd5\PDF編集アプリ`
- 変更してよいファイル: `src/client/SymbolSearchClient.ts`、`e2e/symbol-search.annotate.spec.ts`
- 変更しないファイル: 上以外。

## 禁止事項

- `shapeCheck` が偽のときの動作を変えないこと。
- 他の試験を変えないこと。git の操作をしないこと。python・pytest は使わない。

## 報告してほしいこと

- 変更点、SPEC から逸脱した箇所と理由
