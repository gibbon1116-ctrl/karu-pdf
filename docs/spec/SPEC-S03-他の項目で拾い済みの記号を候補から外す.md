# SPEC-S03: 他の項目で拾い済みの位置の候補を、初めは隠して選べないようにする

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: ストア・パネル・図面の描画にまたがり、数量の二重計上にかかわるため

---

## 利用者の要望

ある実案件の照明の図には、次の3つの照明器具がある。

1. 正方形の中に丸
2. 長形（翼の中央に丸）
3. 丸だけ

1と2は、それぞれの項目で個別に拾える。ところが3の丸で探すと、1と2の中の丸も候補になる。

> 事前に1番目と2番目を指定している器具については、3番目の器具を検索しないようにしたい。

## 現状（Claude Code が確かめたこと）

- 丸の見本で探すと 225 件。そのうち、正方形の器具の中が 21 件、長形の器具の中が 19 件。
- 形の細部の比較（SPEC-S02）では、正方形の 21 件はすべて「同じ」になる。今の外の枠の判定は横の翼だけを見るため。長形も、縦向きの 8 件は残る。
- `AnnotationStore.refreshSymbolCandidates` は、同じ項目の数量の印から半径 `symbolCandidateRadius` 以内の候補を `counted` にしている。他の項目の印は見ていない。

## 変更内容

### 1. ストア（`src/editor/AnnotationStore.ts`、記号の候補の部分だけ）

**候補の型と、他の項目の印の判定**
- `SymbolSearchCandidate` に `otherFixture?: string` を足す。その位置を拾っている、他の項目の id。
- `refreshSymbolCandidates` で、検索中の項目以外の項目の数量の印（削除済みを除く）も見る。
  - 同じ項目の印による `counted` は、今のまま優先する。
  - そうでない候補について、他の項目の印の中心が `symbolCandidateRadius` 以内にあれば、最も近い印の項目 id を `otherFixture` に入れる。
    - そのとき `chosen` なら `pending` に戻す。
  - 該当する印が無くなれば（Undo など）、`otherFixture` を消す。
  - 今と同じく、数量が変わったとき（1934 行付近）に呼ばれる。

**表示と選択**
- `symbolOtherFilter: 'hide' | 'show' = 'hide'` と `setSymbolOtherFilter(value)` を足す（`notify(false)`）。
- `isSymbolCandidateVisible`: 今の条件に加えて、`symbolOtherFilter === 'show' || !c.otherFixture`。
- `clearSymbolCandidates`・`beginSymbolCandidates` で `'hide'` に戻す。
- `otherFixture` のある候補は、表示中でも選べない（`counted` と同じ扱い）。
  - 対象: `toggleSymbolCandidate`、`chooseSymbolCandidates(true)`、`chooseHighConfidenceCandidates`。
  - 数量への追加にも入らない。

### 2. 検索パネル（`src/app/SymbolSearchPanel.tsx`）

- `otherFixture` のある候補が1件以上あるとき、形の細部のチェックの下に、次のチェックを出す。
  ```
  [ ] 他の項目で拾い済みの 40 件も表示する（□ 照明A 21・L 長形 19）
  ```
  - ラベル名: `他の項目で拾い済みの ${n} 件も表示する`。続けて括弧で、項目ごとの件数を「・」でつなぐ。
  - 項目名は `fixtureCode(fixture) + ' ' + fixture.name`。
  - オンで `store.setSymbolOtherFilter('show')`、オフで `'hide'`。
- 添字の件数は、隠れていない候補だけを数える（形の細部と同じ扱いに、他の項目の条件も足す）。
- 件数の行に、`（拾い済み ${counted} 件）` に続けて、他の項目の数があれば `（他の項目で拾い済み ${n} 件）` を出す。

### 3. 図面の候補（`src/editor/AnnotationLayer.tsx`、記号の候補の `<g>` だけ）

- `otherFixture` のある候補に、class `other-fixture` と `data-other="true"` を付ける。
- `aria-disabled` と `tabIndex = -1` は、`counted` と同じ扱い。
- `aria-label` は `記号の候補（他の項目で拾い済み）`。
- `<title>` の末尾に `・他の項目（C 照明A）で拾い済み` を足す。

### 4. 見た目（`src/styles.css`）

- `.symbol-search-candidate.other-fixture` は、拾い済み（`.counted`）と同じ灰色の破線にする。カーソルは既定。

### 5. ヘルプ（`src/app/HelpDialog.tsx`）

「同じ記号を探す」の段落の末尾に、次を足す。

> 別の項目で拾った印と同じ位置の候補は「他の項目で拾い済み」として初めは図面に出さず、選べません。例えば、正方形や長形の器具を先にそれぞれの項目で拾っておくと、丸だけの器具を探すときにそれらの中の丸を数えません。「他の項目で拾い済みの…も表示する」で位置を確かめられます。

## 試験

**単体**（`tests/AnnotationStore.symbolSearch.test.ts`）
- 他の項目の印と同じ位置の候補は、既定で表示されない。`setSymbolOtherFilter('show')` で表示される。
- 表示中でも、選ぶ操作3つで選ばれず、数量に入らない。
- 同じ項目の印がある位置は、今どおり `counted`（`otherFixture` を付けない）。
- 他の項目の印を消す・Undo すると、`otherFixture` が消えて選べるようになる。
- `chosen` の候補の位置に、他の項目の印ができると `pending` に戻る。

**画面**（e2e、新規 `e2e/symbol-other-fixture.annotate.spec.ts`。書くだけでよい）
- `tests/symbolShapeFixtures.ts` の PDF を使う。
- 項目「感知器A」を作り、円弧付きの本体を見本にして探す。形の比較は外す。
- 8件のうち、円弧付きの4件だけを選んで数量に追加する。
  - 上の y が小さい4件が円弧付き（fixture の並びを参照）。
- 項目「感知器B」に切り替え、同じ見本で探す（形の比較は外す）。確かめること:
  - 候補は4件だけ表示される。
  - パネルに `他の項目で拾い済みの 4 件も表示する（D 感知器A 4）` が出る。
  - チェックを入れると8件になる。
  - 4件が `data-other="true"` で、クリックしても選ばれない。
  - 「すべて選ぶ」→ 追加で、感知器B の印は4件だけ増える。

## 対象

- 変更してよいファイル:
  - `src/editor/AnnotationStore.ts`（記号の候補の部分だけ）
  - `src/app/SymbolSearchPanel.tsx`、`src/app/HelpDialog.tsx`
  - `src/editor/AnnotationLayer.tsx`（記号の候補の `<g>` だけ）
  - `src/styles.css`（記号の候補だけ）
  - `tests/AnnotationStore.symbolSearch.test.ts`、`e2e/symbol-other-fixture.annotate.spec.ts`（新規）
- 変更しないファイル: 上以外（検索の処理・Worker・保存の形式を含む）。

## 禁止事項

- 他の項目の印・数量・保存データを変えないこと。候補は保存・履歴に入れないこと（今と同じ）。
- 通常の閲覧・スクロール・スナップに処理を足さないこと。印の見直しは、検索の候補があるときだけ行う（今と同じ）。
- git の操作をしないこと。python・pytest は使わない。

## 報告してほしいこと

- 変更点、SPEC から逸脱した箇所と理由、Claude Code に実行してほしい試験
