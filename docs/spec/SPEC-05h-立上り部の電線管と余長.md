# SPEC-05h: 経路の項目ごとの範囲（全長／平面＋立上り／立上りのみ）と、加算の「立上り・立下り」「余長・その他」への分割

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 拾いの保存の形（`KaruQuantity`）の拡張と後方互換、集計の索引、図面の文字、書式欄・項目の画面にまたがるため（判定表「新規機能の実装」）

> Codex デスクトップアプリへ貼り付けて実行する場合は、モデルセレクタを上記に合わせてから貼り付けること。

---

## 目的

利用者の要望（2026-10-07）:

> 数量拾いで電線・ケーブルは、立ち上がり部分のみ電線管を加算できるようにしたい。

利用者の回答（同日）:

| 問い | 回答 |
|---|---|
| 付け方 | **経路の項目ごとに範囲を選ぶ**。「この経路の項目」の各行に範囲を付ける。例: CV×2（経路全体）、PF28×1（立上りのみ）。配管・ラックにも使える |
| 立上りの長さ | **立上りと余長を分ける**。加算を「立上り・立下り」と「余長・その他」の2欄にし、ケーブルは両方を足し、立上りのみの電線管は立上り・立下りだけを使う。今の加算の値は立上り・立下りとして読む |

## 現状（Claude Code が確認したこと）

- `src/core/quantity.ts:6` の `QuantityMark`: `addM?`（立上り・立下りの加算）、`count?`（主の項目の条数）、`extra?: Array<{ itemId; count }>`（同じ経路の他の項目）。
- 値: `quantity.ts:53` の `polyline` は `平面の長さ + addM`。文字は `:68`（`9.35+3.00=12.35 m`、経路の複数項目は `CV 38sq-3C×2, PF28  …`）。
- 集計の索引: `src/core/quantityIndex.ts:50-51` で、主の項目に `経路の長さ × count`、`extra` の各項目に `経路の長さ × e.count`。
- 書式欄の経路の表: `src/app/RouteItems.tsx`。加算の入力: `src/app/FormatPanel.tsx`（`QuantityValueInput`、`store.updateQuantityAdd`／`updateQuantityValues`）。
- 項目の初期値: `CountFixture.defaults.addM`（項目の画面の「立上り・立下りの加算（新しく拾うときの初期値）」）。

## 対象

- 変更してよいファイル: `src/core/quantity.ts`、`src/core/quantityIndex.ts`、`src/core/countFixtures.ts`、`src/core/annotations.ts`（読み書きの検査に必要な最小限）、`src/editor/AnnotationStore.ts`、`src/editor/MeasurementOverlay.tsx`、`src/app/RouteItems.tsx`、`src/app/FormatPanel.tsx`、`src/app/FixtureDialog.tsx`、`src/app/annotationCsv.ts`（必要なら）、`src/app/HelpDialog.tsx`、`src/styles.css`、`tests/`、`e2e/`
- 変更しないファイル: 上以外。`docs/`、設定ファイル、`.env.*`、`scripts/`

## 変更内容

### 1. 保存の形（`QuantityMark`。`version` は 1 のまま、欄を足すだけ）

```ts
addM?: number      // 意味を「立上り・立下り」とする（名前は互換のため変えない）。0〜1,000
slackM?: number    // 新規: 余長・その他。0〜1,000。0 なら書かない
scope?: RouteScope // 新規: 主の項目の範囲。省略 = 'all'
extra?: Array<{ itemId: string; count: number; scope?: RouteScope }>  // scope を足す。省略 = 'all'
export type RouteScope = 'all' | 'noSlack' | 'rise'
```

- 範囲ごとの長さ（`P` = 平面の長さ、`R` = `addM`、`S` = `slackM`）:

| scope | 画面の名前 | 長さ |
|---|---|---|
| `all` | 全長（平面＋立上り＋余長） | `P + R + S` |
| `noSlack` | 平面＋立上り | `P + R` |
| `rise` | 立上り・立下りのみ | `R` |

- 各項目の数量 = その範囲の長さ × その条数。主の項目も `scope` を持てる（既定 `all`）。
- `slackM`・`scope` は `method` が `polyline` のときだけ（ほかでは捨てて読む）。
- **後方互換**: 欄の無い今の拾いは、`addM` を立上り・立下りとして、すべて `all` で今と同じ数量になる。古い版のかるPDF は新しい欄を無視する（主の項目は `P + R`、`extra` は条数どおりの `P + R` で数える。許容する）。

### 2. 集計の索引（`quantityIndex.ts`）

- 主の項目と `extra` の各項目の値を、上の表の範囲の長さで出す。entry に `scope` を持たせてよい（SPEC-05d の内訳・明細 CSV の値は、この値をそのまま使う）。

### 3. 図面の文字と `/Contents`（`quantityLabel`）

- 長さの式: 余長が無ければ今と同じ（`9.35+3.00=12.35 m`）。余長があれば `9.35+3.00+余1.00=13.35 m`（立上りが 0 なら `9.35+余1.00=10.35 m`）。式の値は `all` の長さ。
- 項目の並び: 範囲が `all` 以外の項目は、名前の後ろに `（平面＋立上り）`・`（立上り）` を付ける。例: `CV 38sq-3C×2, PF28（立上り）  9.35+3.00+余1.00=13.35 m`。
- 項目が1つで、範囲が `all` で1条なら、今と同じ形（`CV 9.35+3.00=12.35 m`）。

### 4. 書式欄（長さの拾いを1つ選んだとき）

- 「立上り・立下りの加算」の欄を、2つに分ける: `立上り・立下り [ 3.00 ] m`、`余長・その他 [ 1.00 ] m`（入力の決まりは今の加算と同じ。`Ctrl+Z` で戻せる）。
- 「この経路の項目」の各行に、範囲の選択を置く（`<select aria-label="〈項目名〉の範囲">`、3つの選択肢）。行の数量の式も範囲に合わせる（例 `3.00×1 = 3.00 m`）。主の項目の行にも置く。
- 「この経路に足す」で足すときの範囲は、足す項目の `routeScope`（下の5.）。

### 5. 項目（`CountFixture`）

- 長さの項目に、省略可能な `routeScope?: RouteScope`（経路に足すとき・その項目で新しく拾うときの範囲の初期値。省略 = `all`）と、`defaults.slackM?`（余長・その他の初期値）を足す。読み書きの検査を合わせる（不正なら今の方針どおり項目ごと捨てる）。
- 項目の画面（長さの項目）: 「立上り・立下り（新しく拾うときの初期値）」（今の加算の欄の名前を変える）、「余長・その他（初期値）」、「経路での範囲（初期値）」の選択（3つ）を出す。
- 見本: 電線管・ケーブルラックの見本は `routeScope` を指定しない（`all` のまま）。利用者が「立上りのみ」の電線管の項目を自分で作る（複製して範囲を変える）想定。

### 6. ヘルプ

`HelpDialog.tsx` の数量拾いの説明に、立上り・立下りと余長の分け方、経路の項目の範囲（例: 立上り部分だけの電線管）を足す。

## テスト

- **単体**: 範囲ごとの長さと数量（`P=9.35, R=3, S=1` で CV×2 `all` → 26.70m、PF28×1 `rise` → 3.00m、ラック×1 `noSlack` → 12.35m）、`quantityLabel` の文字（上の例）、`parseQuantityMark` の新しい欄の検査（不正な scope、`polyline` 以外の slackM）、欄の無い古い拾いが今と同じ数量・文字になること、`parseCountFixtures` の `routeScope`・`defaults.slackM`。
- **結合**: 上の経路を保存して開き直し、`/KaruQuantity`・`/Contents`・索引の数量が戻ること。古い形の拾い（`addM` だけ）が今と同じ数量で読めること。
- **画面（`e2e/quantity-location-route.annotate.spec.ts` に足すか、新しいファイル）**: ケーブルの経路を1本なぞり、書式欄で立上り 3・余長 1 を入れ、PF の項目（範囲の初期値「立上りのみ」）を「この経路に足す」→ PF の全図面が 3.00m、ケーブルが `平面＋4.00`。範囲を「平面＋立上り」に変えると PF が `平面＋3.00` になる。`Ctrl+Z` で戻る。保存して開き直しても残る。

## 禁止事項

- 既存の拾いの数量を変えないこと（欄の無いものは今と同じ）。保存の形の `version` を上げないこと。
- 名前で範囲を決めないこと。
- 試験から `work/` など Git の管理外のフォルダへ書き込まないこと。
- 対象外のファイルを変更しないこと。git の変更操作をしないこと。python・pytest は使わない。

## 検証項目

- [ ] `npx tsc --noEmit`、`npm test`、`npm run build` が成功する。
- [ ] 新しい・変えた e2e と、`quantity-*`・`count-fixtures` の e2e が、Edge と `PLAYWRIGHT_CHANNEL=chromium` の両方で成功する。

## 報告してほしいこと

- 保存の形の例（実際に書いた JSON）と、互換の確かめ方
- 変更したファイルと要点、検証の結果
- SPEC から逸脱した箇所と理由、残課題
