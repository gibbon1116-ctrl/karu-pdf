# SPEC-06i-3: 線で探した候補を、候補の位置だけ画像で確かめて確度を付ける

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 照合 Worker・ページの描画・候補の状態・画面にまたがり、時間の増え方を測って確かめる必要があるため（判定表「新規機能の実装」）

---

## 目的

利用者の指示（2026-10-08）:

- 線の情報があるページは「① 見本を囲む → ② 見本の線を取る → ③ 同じ線の構成を高速に探す → ④ **候補だけ**画像の類似度で確かめる → ⑤ 候補を表示 → ⑥ 人が確かめて数量へ追加」にする。
- **線の情報が無いページは、今の画像の検索（ページ全面を画像で探す）をそのまま使う。この動作は変えない。**

Claude Code の判断（利用者の了承済み）:

- 画像の確かめは**候補を除外しない**。確度の印を付けるだけ（`high`＝線も画像も似ている、`check`＝線は合うが画像では似ていない＝要確認）。理由: 画像の照合は文字や線が重なった記号を「似ていない」とするため（七ヶ浜町の机で画像は 58 件、線は 138 件）、除外すると線で見つけた正しい記号を落とす。
- 画像の確かめのために、ページは**1 回だけ**描き（今の `renderSearchImage`）、候補の位置の近くでだけ類似度を求める（全面の粗い検索はしない）。

## 現状（Claude Code が確認したこと）

- `src/client/SymbolSearchClient.ts`: ページごとに線を取り出し（`VectorCache`）、`classifyPage` が `vector`/`mixed` で見本に線が 2 本以上なら Worker で線の照合（`vector-search` メッセージ、`src/worker/symbolSearchMessages.ts` の `searchVectorMessage`）、それ以外は画像の照合（`renderSearchImage` でページと見本を描いて `search` メッセージ、`src/core/symbolSearch.ts` の `searchSymbol`）。
- 線の照合の結果 `VectorSymbolMatch { rect, center, score, angle }`。
- 画面: `src/app/SymbolSearchPanel.tsx`（似ている度合い 0.55〜0.98、既定 0.85。画像の照合には `値 − 0.15`）。候補の状態は `AnnotationStore` の `symbolCandidates`（`pending`/`chosen`/`counted`）。描画は `src/editor/AnnotationLayer.tsx`（`data-testid="symbol-search-candidate"`、`data-state`）。

## 対象

- 対象フォルダ: `C:\Users\gibbo\Desktop\PDF編集アプリ\.claude\worktrees\karupdf-quantity-ui-8301e6`
- 変更してよいファイル: `src/core/symbolSearch.ts`（候補の位置だけで類似度を求める関数を足す）、`src/worker/symbolSearch.worker.ts`・`src/worker/symbolSearchMessages.ts`、`src/client/SymbolSearchClient.ts`、`src/app/SymbolSearchPanel.tsx`、`src/editor/AnnotationStore.ts`（候補に確度を持たせるだけ）、`src/editor/AnnotationLayer.tsx`（候補の描き分けだけ）、`src/app/HelpDialog.tsx`、`src/styles.css`、`tests/`、`e2e/`（`e2e/vector-search-snap.annotate.spec.ts` に足す）、`e2e/vector-paths.perf.spec.ts`（測定を足す）
- 変更しないファイル: 上以外。**線の無いページの画像検索の流れ（`search` メッセージ・`searchSymbol`）は変えない。**

## 変更内容

### 1. 候補の位置だけで類似度を求める（`symbolSearch.ts`）

```ts
export interface VerifyTarget { x: number; y: number; width: number; height: number; angle: number }  // 画素の座標（ページの描画の左上原点）、angle は度
export function verifyCandidates(page: GrayImage, template: GrayImage, targets: readonly VerifyTarget[], options: { searchRadius?: number /* 既定 3px */; shouldStop?: () => boolean; onProgress?: (done: number, total: number) => void }): Float32Array  // 各候補の最高の類似度（NCC、0〜1。負は 0）
```

- 見本の画像を候補の `angle` で回す（双線形。90° の倍数の近くは正確に回す）。候補ごとに、候補の中心の ±`searchRadius` px の範囲で NCC の最高値を取る。窓の分散がほぼ 0 なら 0。
- 全面の粗い検索・ピラミッドは使わない。

### 2. 線のページの流れ（`SymbolSearchClient.ts`）

- 線の照合の候補が 1 件以上で、パネルの「画像でも確認する」がオン（既定）のとき:
  1. 今の画像の照合と同じ倍率で、ページ（`searchRect` があればその範囲）と見本を `renderSearchImage` で描く（ページは 1 回だけ）。
  2. Worker に新しいメッセージ `verify`（ページ・見本の画素、候補の位置と角度）を送り、`verifyCandidates` の結果を受け取る。
  3. 各候補に `imageScore` と `confidence` を付ける: `imageScore >= 画像の下限`（今の画像の照合と同じ `似ている度合い − 0.15`）なら `high`、それ以外は `check`。
- 「画像でも確認する」がオフのとき、または線の照合の候補が 0 件のとき: 描画しない。候補の `confidence` は付けない（`undefined`）。
- 線の無いページ: 今の画像の照合のまま（`confidence` は付けない）。
- 進みの表示: `ページ 1 / 1・線で照合中` → `画像で確認中`。中止・60 秒の監視は `verify` にも効く。
- 結果の `metrics` に `vectorMs`・`verifyRenderMs`・`verifyMs` を足す。

### 3. 候補の確度（`AnnotationStore`・描画・パネル）

- 候補に `confidence?: 'high' | 'check'` と `imageScore?: number` を持たせる（メモリだけ）。
- 描き分け（`pending` のとき）: `high` は今の橙の破線、`check` は橙の点線と右上に小さな「?」。`data-confidence` 属性を付ける。`chosen`・`counted` の描き方は今のまま。`title` に `線 0.93・画像 0.81` のように両方の値。
- パネル:
  - 「画像でも確認する」（checkbox、既定オン。`localStorage` の `karu-pdf:symbol-search-verify`）。線の無いページには関係しない旨を `title` に書く。
  - 結果: `候補 138 件（確度高 120 件・要確認 18 件）`。ページごとの行にも確度の内訳。
  - ボタン「確度の高い候補を選ぶ」（`high` で `pending` のものを `chosen` にする）。今の「すべて選ぶ」「すべて外す」は残す。
- 候補を除外しない（`check` も表示し、選べる）。

### 4. ヘルプ

線のページは線で探し、候補だけ画像で確かめて「確度高」「要確認」を付けること。要確認は文字や線が重なった記号のこともあるので、図面で確かめて選ぶこと。線の無いページは画像で探すこと。

## テスト

### 単体（`tests/`）

- `verifyCandidates`: 合成の画像で、正しい位置は 0.9 以上、違う記号の位置は低い。90°・任意の角度（30°）に回した記号でも高い。`searchRadius` 内のずれを許す。`shouldStop` で止まる。
- 確度の付け方（下限の境目）。

### 画面（`e2e/vector-search-snap.annotate.spec.ts` に足す）

- 線の試験の PDF（×の入った四角 6 か所、うち 2 か所に横切る線）で探す → 候補 6 件、`data-confidence` が付く。「確度の高い候補を選ぶ」で `high` の候補だけ `chosen`。
- 「画像でも確認する」をオフにして探す → `data-confidence` が付かない。
- 画像だけのページでは今どおり画像で探す（`data-confidence` が付かない）。

### 測定（`e2e/vector-paths.perf.spec.ts` に足す）

- 七ヶ浜町 1 ページの机（見本 `[742,174,753,182]`）で、確認オン・オフのそれぞれの時間（`vectorMs`・`verifyRenderMs`・`verifyMs`・合計）と、確度の内訳を記録。

## 禁止事項

- 線の無いページの画像検索の動作を変えないこと。
- 画像の確かめで候補を除外しないこと。候補を自動で数量に入れないこと。
- 候補ごとにページを描き直さないこと（ページは 1 回だけ描く）。
- 画面のスレッドで類似度の計算をしないこと（Worker で行う）。
- PDF を開く・表示・スクロールのときに何もしないこと。
- 試験から `work/` へ書き込まないこと。対象外のファイルを変更しないこと。git の操作をしないこと。python・pytest は使わない。
- Worker の入口のファイル（`*.worker.ts`）から値を export しないこと（単一 HTML 版の組み立ての条件）。
- `npx tsc --noEmit` と単体試験は実行してよい。e2e は実行しなくてよい。

## 報告してほしいこと

- 変更したファイルと要点
- SPEC から逸脱した箇所と理由、残課題
