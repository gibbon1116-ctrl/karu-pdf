# SPEC-S10: 形の細部の比較（probe）を、結果を変えずに速くする

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 結果を 1 つも変えない最適化。並び順・同順位の扱いを正確に保つ判断が要る

---

## 目的

「形の細部（円弧・枠・斜線・塗り）も見本と比べる」をオンにすると、1 回の検索が 75〜320ms 遅くなる。そのうち 60〜220ms が probe（`probeVectorMatches`）。結果を変えずに短くする。

## 現状（Claude Code が測ったこと）

Node で実図面 4 例の probe を測った（作業用の測定スクリプト。公開していない）。

| 例 | 候補 | probe の中央値 |
| --- | --- | --- |
| KI 長形 | 46 | 137ms |
| KI 丸形 | 211 | 165ms |
| KA | 52 | 67ms |
| S2 | 14 | 46ms |

CPU プロファイル（4 例 × 8 回）の自己時間：
- `probeSymbolVectorFeatures`：1657ms（候補ごとの処理。主に「所有」の組の総当たり）
- `SymbolFeatureGeometry` の並べ替えの比較関数（`symbolFeatureProfile.ts` 60 行付近）：1098ms
- `SymbolFeatureGeometry` のコンストラクタ：998ms（並べ替え・`every` の確かめ）

候補が 14 件でも 46ms かかるのは、コンストラクタ（ページ全体の線を y で並べ替える）が 1 回 約 30ms かかるため。

## 変更内容（`src/core/symbolFeatureProfile.ts` だけ）

### 1. `SymbolFeatureGeometry` の並べ替えを、比較関数なしにする

- 今：`byY.sort((a,b) => minY(a) - minY(b))`。`minY(i) = Math.min(segments[i+1], segments[i+3])`。
  - TypedArray の `sort` は安定なので、同じ `minY` の線は元の番号の順に並ぶ。
- 新：**同じ並び順**を、比較関数を使わずに作る。
  - 例：各線の `minY` を float32 として、順序を保つ 32 ビットの符号なし整数に変換する（負の数のビット反転、`-0` は `+0` に揃える）。それを 8 ビットずつ 4 回の安定な基数ソート（LSD）で並べる。
  - `NaN` は入らない（コンストラクタで有限を確かめている）。
- `range(y0, y1, maxLength)` の二分探索は今のまま（実際の値で比べる）。
- `segments.every(Number.isFinite)` などの確かめは、`complete` が偽で索引を作らない場合も今と同じに行う（例外の条件を変えない）。ループ 1 回にまとめて速くしてよい。
- `indexBytes` は `byY.byteLength` のまま。並べ替えの作業用の配列は、コンストラクタの中だけで使い、保持しない。

### 2. 「所有」の組の総当たりを、近い端点だけにする

- 今：`all`（最大 512 本）の全部の組 `(i, j)` について、端点が `gap` 以内か（`close`）などを確かめ、Union-Find でつなぐ。
- 新：端点を、1 辺 `gap` の格子に入れ、同じか隣の格子にある端点を持つ組だけを確かめる。
  - 組を確かめる条件（線幅、`close`、平行、同じ直線上）は 1 つも変えない。
  - 同じ組を 2 回確かめても結果は同じだが、無駄なので避ける（`i < j` の組を 1 回だけ）。
  - つながり（連結成分）は、組を確かめる順に関係しない。`enters`・`remote`・`foreign`・`owned` の結果が今と同じになること。
  - `foreign`・`owned` に入る順は、今と同じ `all` の順のままにする。

### 3. ほかは変えない

- `probeSymbolVectorFeatures` の返す値（`topArc`・`annexFrame`・`arc`・`frame`・`interiorLines`・`ownership`・`complete`・`pose`・`region`）は、どの入力でも今と同じ（配列の順も同じ）。
- 上限（`MAX_LOCAL_SEGMENTS`・`MAX_OWNERSHIP_SEGMENTS` など）と、その打ち切りの順（`range` の順に数える）は変えない。
- 公開の関数名・型・引数を変えない。

## 試験（`tests/symbolFeatureProfile.test.ts` に足す）

- 今の実装を、試験の中に「参照の実装」として写す（コンストラクタの並べ替えと、所有の総当たりの部分）。
- 乱数（種を固定）で作った線の集まりで、新旧の結果が完全に一致すること。
  - 同じ `minY` の線が多数ある場合、`-0` と `+0`、負の座標、とても大きい座標を含める。
  - `byY` の並びが、参照の `sort` と完全に一致する。
  - 所有の判定に 512 本近い線が入る場合（打ち切りの手前と超える場合の両方）。
  - いろいろな `pose`（回転を含む）・`strokeWidth` で、`probeSymbolVectorFeatures` の返す値を `toEqual` で比べる。
- 既存の試験がすべて通ること。

## 対象

- 変更してよいファイル：`src/core/symbolFeatureProfile.ts`、`tests/symbolFeatureProfile.test.ts`
- 変更しないファイル：上以外。

## 禁止事項

- 結果を変えること（近似・上限の変更・打ち切りの追加をしない）。
- 関数名・入力名を変えないこと。
- git の操作をしないこと。python・pytest は使わない。

## 報告してほしいこと

- 変更点、SPEC から逸脱した箇所と理由、Claude Code に実行してほしい試験。
