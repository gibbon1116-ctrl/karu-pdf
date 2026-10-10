# SPEC-S01: 記号の本体の線と、通り抜ける配線を分ける（内部の白い領域の比較）

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 図形の所有関係の判定で、誤ると正しい器具を除外するため

---

## 前提

- 計画: `docs/調査/標準図記号登録と実図面検索_改善計画_20261010.md`（工程②）。
- 記録: `docs/調査/標準図記号検索_実装記録_20261010.md`。
- 対象のモジュール `src/core/symbolFeatureProfile.ts` は試作である。アプリ・Worker からは import していない。この SPEC でも import させない。

## 現状（Claude Code が実データで確かめたこと）

実案件の電気図（KI）の長形照明は、細長い四角（左右の翼）の中央に、白く塗った円がある記号である。

- 配線が、左右から翼の中を通って中央の円まで入ってくる。翼の白い領域が、配線で上下2つに割れる。
- 割れ方は器具ごとに違う。配線が来ない側の翼は割れない。
- そのため `compareSymbolInteriors` で穴の数が合わない。`unknown` になる。
- 位置の合った正解13個のうち12個が、この理由で `unknown` になる。
- 見本そのものも、右の翼だけ割れている（穴4つ: 円 0.139、左翼 0.133、右翼 0.052×2）。

実案件の火災報知の図（KA）の半円の機器でも、配線が本体を横切る1個が同じ理由で `unknown` になる。

## 変更内容（`src/core/symbolFeatureProfile.ts`）

### 1. 線の所有の判定（`probeSymbolVectorFeatures` の中）

**集める線**
- 今の `local`（線幅で選んだ線、最大 256 本）とは別に、**線幅で選ばない**近くの線を集める。名前は例えば `all`。
  - 範囲・長さの条件は `local` と同じ。
  - 上限は 512 本。超えたら所有の判定はしない（`ownership` を付けない）。
  - このとき、ほかの特徴（円弧・枠・内部の線）の判定は今のまま続ける。
- 今の `local` の扱い（256 本を超えたら全体を `unknown`）は変えない。

**座標と寸法**（すべて正規化した座標。本体の枠 B = `[0, 0, w, h]`）
- `tol` は今の `tolerance`。
- `out = max(2·tol, 0.04·long, 0.3)`。
- `m = max(2·tol, 0.15·min(w, h))`。
- 芯の枠 C = `[m, m, w − m, h − m]`。
- C が空になる（`w` か `h` が `2m` 以下）ときは、所有の判定をしない。

**直線のつながり（run）**
- 端点どうしが `tol` 以内でつながり、次の2つを満たす線を、1つの run にまとめる（union-find）。
  - 向きの差が 3° 以内。
  - 一方の線からもう一方の端点までの距離が `tol` 以内（同じ直線上にある）。
- 曲がった先へはたどらない。曲がって本体の中に入る配線は、この SPEC では扱わない（`unknown` のまま残る）。

**外の線（foreign）**
- run が次の両方を満たすとき、その run のすべての線を外の線とする。
  1. run のどれかの線を C で切り取った部分の長さが 0 より大きい（芯に入る）。
  2. run のどれかの端点が、B を `out` 広げた枠の外にある（本体の外から来ている）。

**本体の線（owned）**
- 外の線でない線のうち、B を `tol` 広げた枠と交わる線。

**probe の結果**
- 次の項目を足す。
  ```ts
  ownership?: {
    foreign: Array<{ a: Point; b: Point; width: number }>
    owned: Array<{ a: Point; b: Point; width: number }>
  }
  ```
- 座標は正規化した座標。`width` は元の線幅（無いときは 0）。
- `geometry.complete` が false のときと、今 `unknown` を返している所では付けない。

**理由**
- 見本の枠 B は、整理した見本の線の外接矩形である。見本の線は B の外へ出ない。B の外から芯まで入ってくる直線は、本体の線ではない。
- 本体の枠の辺（B の縁にある線）は、姿勢の誤差（±数度、寸法の差）で少し外へ出ても、芯 C には入らない。そのため外の線にならない。

### 2. 内部の比較から外の線を除く（`describeSymbolInterior`）

- 3つ目の引数を足す: `describeSymbolInterior(image, pose, ownership?)`。
- 引数が無ければ、今と同じ結果を返す（既存の試験を保つ）。
- 引数があるとき:
  - 今と同じに、描画から 48×48 のマスクを作る。
  - 格子1つの大きさは `cw = w/48`、`ch = h/48`。
  - 線ごとの半径 `r = max(width, 0.1)/2 + 1.5/image.scale + 0.5·hypot(cw, ch)`。
  - 外の線から `r` 以内にあり、どの本体の線からも、その線の `r` 以内にない格子を、白にする（消す）。
  - 計算は線ごとに、その線の外接矩形 ± `r` の格子だけを調べる。全格子 × 全線の総当たりにしない。
  - 消した後のマスクで、今と同じに、インクの割合と白い領域（穴）を求める。
- 結果に `erased`（消した格子の数 ÷ 全格子数）を足す。引数が無いときは付けない。
- 消した格子が、消す前のインクの格子の 50% を超えたら、`known: false`、`unknownReason: 'foreign-dominated'`。
- 消した後のインクが 8 格子未満なら、今と同じ `blank-body`。

### 3. 変えないこと

- `compareSymbolInteriors`・`compareSymbolFeatureProfiles`・`confirmSymbolVectorFeatures` の判定の規則。
- 円弧（`topArc`）・枠（`annexFrame`）・内部の線（`interiorLines`）の判定と、その線幅の選び方。
- 元の配列（`segments`・`widths`）を書き換えない。コピーもしない。
- アプリ・Worker・`vectorSymbolSearch.ts`・`vectorExtract.ts` は変えない。

## 試験（`tests/symbolFeatureProfile.test.ts` に足す）

今の `fixture` の作り方（MuPDF で PDF を作り、抽出して描画する）に倣う。長形の姿勢は `{center:[30,60], width:20, height:4, angle:0}`。

1. **長形器具を通る配線**
   - 四角 `20 58 20 4 re S`。中央に白い円（白で塗ってから黒で縁取る。半径 1.6）。
   - 左から円まで来る配線 `5 60 m 28.4 60 l S` がある器具と、配線の無い器具を比べる。
   - 所有を渡すと `same`。
   - 渡さないと `unknown`（今の動作）。
2. **外枠で2本に切れた配線**
   - `5 60 m 20 60 l S 20 60 m 28.4 60 l S` → 所有を渡すと `same`。
3. **違う器具は違うまま**
   - 円の無い四角と円のある四角。どちらにも配線がある → `different`。
4. **本体の中の斜線は消さない**
   - 四角の中だけにある斜線は `owned` に入り、`foreign` に入らない。
   - 斜線ありと斜線なし（どちらも配線あり）は `same` にならない。
5. **細い背景線**
   - 線幅 0.1 の線が、記号の全体を横切る（両側が外へ出る）→ `foreign` に入り、`same`。
6. **本体の辺は消さない**
   - 描画を 2° 回した器具を、姿勢 0° で調べる。
   - 四角の4辺は `foreign` に入らない。
7. **上限**
   - 近くの線が 512 本を超えると、`ownership` が付かない。`describeSymbolInterior` は今と同じ結果になる。
8. **不変性**
   - `segments`・`widths`・`segmentEndpoints` が呼ぶ前後で同じ。

## 対象

- 対象フォルダ: `C:\Users\gibbo\.codex\worktrees\dfd5\PDF編集アプリ`
- 変更してよいファイル: `src/core/symbolFeatureProfile.ts`、`tests/symbolFeatureProfile.test.ts`
- 変更しないファイル: 上以外（`work/` を含む）。

## 禁止事項

- 実図面の座標・器具名・ページ番号で分岐しないこと。しきい値を、上の式から変えないこと。変える必要があれば、理由を報告すること。
- 対象外のファイルを変更しないこと。git の操作をしないこと。python・pytest は使わない。
- `npx vitest run tests/symbolFeatureProfile.test.ts tests/symbolRecognitionEvaluation.test.ts` と `npx tsc --noEmit` は実行してよい。
- 試験の記録を `tests/` に Markdown で置かないこと（報告は返信に書く）。

## 報告してほしいこと

- 変更点
- 試験の結果
- SPEC から逸脱した箇所と理由
