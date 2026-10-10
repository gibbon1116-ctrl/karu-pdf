# SPEC-S02b: 形の細部の比較の、設定と表示（検索パネル・候補の表示）

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 検索パネル・ストア・図面の描画にまたがり、選択と数量追加の安全にかかわるため

---

## 前提

- SPEC-S02a（コミット `2196d6c`）で、`SymbolSearchClient.search` に `shapeCheck` を渡すと、候補に `shape: SymbolShapeDecision` が付く。
  - `decision` は `same`・`different`・`unknown`。
  - `differences` と `unknown` に、`topArc`・`annexFrame`・`interiorLines`・`interior` が入る。
  - `same` 以外の候補の確度は `check`（要確認）になる。
- 正解の5組で、違う形の候補を「確定」にした数が 0 になった（`docs/調査/標準図記号検索_実装記録_20261010.md`）。

## 目的

- 利用者が、形の細部の比較を選べるようにする。
- 見本と形が違う候補を、初めは図面に出さない。
- 利用者が見たいときだけ出せるようにする。

## 変更内容

### 1. 検索パネル（`src/app/SymbolSearchPanel.tsx`）

**設定のチェック**
- 「画像でも確認する」の下に、次のチェックを足す。
  - 表示: `形の細部（円弧・枠・斜線・塗り）も見本と比べる`
  - `title`: `線で探した候補の周りを描き、見本と円弧・外の枠・中の斜線・中の塗りを比べます。違う候補は初めは図面に出さず、分からない候補は要確認にします。検索が少し遅くなります。`
- 既定はオン。`localStorage` のキー `karu-pdf:symbol-search-shape` に、今の `verify` と同じ書き方で保存する（`'false'` のときだけオフ。読み書きの失敗は無視）。
- 変えたら `invalidate()`（今の他の設定と同じ）。
- `client.current.search({...})` に `shapeCheck` を渡す。

**結果の表示**（候補があるとき）
- 形の結果がある候補（`shape` あり）のうち、`decision === 'different'` の数を数える。
  - 違いの種類ごとの数も数える。1つの候補が2つの違いを持つときは、両方に数える。
  - 違いの名前: `topArc`=円弧、`annexFrame`=外の枠、`interiorLines`=中の斜線、`interior`=中の塗り。
- 違う候補が1件以上あるとき、添字の欄の下に次を出す。
  ```
  [ ] 形の細部が見本と違う 4 件も表示する（円弧 4）
  ```
  - チェックのラベル名: `形の細部が見本と違う ${n} 件も表示する`。続けて括弧で、種類ごとの数を「・」でつなぐ（数が 0 の種類は出さない）。
  - オンで `store.setSymbolShapeFilter('all')`、オフで `'same'`。
- 違う候補が 0 件で、形の比較をしたとき（`shape` のある候補が1件以上）は、`形の細部も見本と比べました` と1行出す。
- 「候補 n 件」の数は、今どおり表示中の候補の数。

### 2. ストア（`src/editor/AnnotationStore.ts`、記号の候補の部分だけ）

- `SymbolSearchCandidate` に `shape?: SymbolShapeDecision` を足す（型は `../core/symbolShapeDecision` から import）。
- `symbolShapeFilter: 'same' | 'all' = 'same'` を足す。
- `isSymbolCandidateVisible`: 今の条件に加えて、`symbolShapeFilter === 'all' || c.shape?.decision !== 'different'`。
- `setSymbolShapeFilter(value: 'same' | 'all')`: 値を入れて `notify(false)`。
- `clearSymbolCandidates` と `beginSymbolCandidates` で、`'same'` に戻す。
- `appendSymbolCandidates` の引数の型に `shape?: SymbolShapeDecision` を足す。
  - 入れるときは写しを作る: `{decision, differences:[...], unknown:[...]}`。
- 選ぶ・数量に追加する操作は、今の「表示中の候補だけ」の規則をそのまま使う。隠れた違う候補は選べず、数量に入らない。
- 保存・履歴・未保存の判定には入れない（今の候補と同じ）。

### 3. 図面の候補の表示（`src/editor/AnnotationLayer.tsx`、記号の候補の `<g>` だけ）

**class と data 属性**
- `decision === 'different'` の候補の `<g>` に、class `shape-different` を足す。
- `data-shape={c.shape?.decision ?? 'none'}` を足す。

**`<title>` の末尾**
- `different` なら `・形の細部が違う（円弧・中の塗り）`。
- `unknown` なら `・形の細部は不明（円弧）`。
- `same` なら何も足さない。
- 括弧の中は、`differences` か `unknown` を上の日本語名で「・」でつないだもの。

### 4. 見た目（`src/styles.css`、記号の候補の部分だけ）

- `.symbol-search-candidate.shape-different rect`: 灰色（`#7a7a7a`）の細かい破線（`stroke-dasharray: 2 2`）。塗りは今より薄く。
- 選んだとき（`.chosen`）は、今の緑の表示を優先する。

### 5. ヘルプ（`src/app/HelpDialog.tsx`）

「同じ記号を探す」の説明の段落の末尾に、次を足す。

> 「形の細部（円弧・枠・斜線・塗り）も見本と比べる」がオンなら、線で探した候補の周りを描いて、見本と上の円弧・外の枠・中の斜線・中の塗りを比べます。形が違う候補は初めは図面に出さず、「形の細部が見本と違う…も表示する」で出せます（灰色の細かい破線）。描画の打ち切りや重なった線で判断できない候補は要確認になります。標準図の記号の意味は決めません。器具の種類は図面の凡例で確かめてください。

## 試験

### 単体（`tests/AnnotationStore.symbolSearch.test.ts` に足す）

- `shape` が `different` の候補は、既定で表示中に入らない。`setSymbolShapeFilter('all')` で入る。
- 隠れた候補は、`chooseSymbolCandidates(true)`・`chooseHighConfidenceCandidates`・`toggleSymbolCandidate` で選ばれない。
- `beginSymbolCandidates` と `clearSymbolCandidates` で、`'same'` に戻る。
- `appendSymbolCandidates` で `shape` の配列は写しになる（元の配列を変えても、ストアの値は変わらない）。

### 画面（e2e、新規 `e2e/symbol-shape.annotate.spec.ts`。書くだけでよい）

**図面の作り方**（新規 `tests/symbolShapeFixtures.ts`）
- `tests/symbolLabelFixtures.ts` と同じ作り方で、MuPDF で PDF を作る。
- 背景に、線幅 0.06 の格子を描く。
- 線幅 0.42 で、半円の感知器の本体（`tests/symbolFeatureProfile.test.ts` の `cup` と同じ形）を8個描く。
  - 4個は、上に円弧（同じファイルの `arc` と同じ形）を付ける。
  - 残り4個は付けない。
  - 位置を少しずつずらし、2個には横から配線を通す。
- 関数 `symbolShapePdf(): number[]` を export する。
  - 見本に使う、円弧のある1個の本体の位置（表示 pt の矩形）も export する（`symbolShapeSampleRect`）。

**操作**
- `symbol-labels.annotate.spec.ts` の手順で、個数の項目を作って「同じ記号を探す」を押す。
- `symbolShapeSampleRect` の本体だけを囲む。円弧は枠の外にする。
- 「画像でも確認する」を外して「探す」を押す。
- 確かめること:
  - 「形の細部（円弧・枠・斜線・塗り）も見本と比べる」が既定でオン。
  - 候補は4件だけ表示され、すべて `data-shape="same"`。
  - パネルに `形の細部が見本と違う 4 件も表示する` のチェックがあり、括弧に「円弧 4」が出る。
  - そのチェックを入れると候補が8件になり、4件が `data-shape="different"`。その4件の `<title>` に「形の細部が違う（円弧）」が入る。
  - チェックを外し、「すべて選ぶ」→「選んだ 4 件を数量へ追加」で、数量の印が4件だけ増える。
- 比較をオフにして探し直すと、候補が8件表示され、`data-shape="none"` になる。

## 対象

- 対象フォルダ: `C:\Users\gibbo\.codex\worktrees\dfd5\PDF編集アプリ`
- 変更してよいファイル:
  - `src/app/SymbolSearchPanel.tsx`、`src/app/HelpDialog.tsx`
  - `src/editor/AnnotationStore.ts`（記号の候補の部分だけ）
  - `src/editor/AnnotationLayer.tsx`（記号の候補の `<g>` だけ）
  - `src/styles.css`（記号の候補の部分だけ）
  - `tests/AnnotationStore.symbolSearch.test.ts`、`tests/symbolShapeFixtures.ts`（新規）、`e2e/symbol-shape.annotate.spec.ts`（新規）
- 変更しないファイル: 上以外（`SymbolSearchClient.ts`、Worker、`symbolFeatureProfile.ts` を含む）。

## 禁止事項

- 違う形の候補を、利用者の操作なしに数量へ入れないこと。隠れた候補を選べるようにしないこと。
- 今の添字・GC の絞り込み、確度、選択、数量追加の動作を変えないこと。
- 保存の形式・履歴・未保存の判定に、候補や設定を入れないこと。
- 通常の閲覧・スクロール・スナップに処理を足さないこと。
- git の操作をしないこと。python・pytest は使わない。

## 報告してほしいこと

- 変更したファイルと要点
- SPEC から逸脱した箇所と理由
- Claude Code に実行してほしい試験
