# SPEC-S07: 探すときに囲んだ見本を項目に登録し、次からは囲み直さずに探す

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 保存データ（項目の見本）に場所を足す。古い版との互換、他の PDF からの読込み、ページ編集後の食い違いの扱いに判断が要る

---

## 利用者の要望

> 「項目を編集」の「図面から見本を切り取る」で同じ記号を探すで記号を検索している場合は、検索した図形が自動で登録されるようにしたい。

利用者の選択：
- 項目にもう見本があっても、毎回新しい見本で上書きする。Ctrl+Z で前の見本に戻せる。
- 見本の場所も覚え、次からは囲み直さずに探せるようにする。

## 現状（Claude Code が確かめたこと）

- 項目の見本は `CountFixtureSample { png; width; height; pageIndex }`（`src/core/countFixtures.ts`）。PDF に保存される。
  - `parseCountFixtureSample` は知らない項目を捨てる。古い版は、足した項目を読み飛ばす。
- 「図面から見本を切り取る」（`FixtureDialog`）も「同じ記号を探す」も、App の `completeFixtureSample` で `pool.renderFixtureSample(docId, pageIndex, rect)` を呼び、同じ形の見本を作る。
  - 探すときは、見本の四角（`pending.rect`）を `SymbolSearchSelection.rect` としてパネルに渡す。項目には登録しない。
- 項目の変更は `store.setCountFixtures(next)`。履歴に入り、Ctrl+Z で戻せる。
- ヘルプには「見本は表示用で、記号の自動検索には使いません。」とある。
- 「他のPDFから読み込む」（`FixturePanel`）は、見本を含めて項目を写す。
- ページの挿入・削除で、見本の `pageIndex` は付け替えない。

## 変更内容

### 1. 見本に場所を足す（`src/core/countFixtures.ts`）

- `CountFixtureSample` に `rect?: Rect` を足す（ページの pt 座標、`[x0, y0, x1, y1]`）。
- `parseCountFixtureSample`：
  - `rect` が 4 つの有限の数で、`x1 > x0`・`y1 > y0` のときだけ残す。
  - 正しくない `rect` は捨てる。見本そのもの（png など）は今と同じ条件で残す。
- 保存（`serializeCountFixtures`）は `rect` も書く。上限の確かめは今と同じ。

### 2. 切り取った見本に場所を付ける（`src/App.tsx`）

- `completeFixtureSample` で作った見本に、囲んだ `rect` を付ける（`{ ...sample, rect }`）。
  - 「図面から見本を切り取る」も「同じ記号を探す」も同じ。

### 3. 探すときに、見本を項目に登録する（`src/App.tsx`）

- 「同じ記号を探す」で見本を囲み終えてパネルを開くとき（`startSymbolSearch` の `resolve`）、その見本で項目の見本を上書きする。
  - `store.setCountFixtures` で、その項目の `sample` だけを替える（ほかの項目・ほかの値は変えない）。
  - 今の見本と、png と rect が同じなら何もしない。
  - 登録できたら、状態表示に「見本を項目に登録しました（Ctrl+Z で戻せます）」を出す（`showStatus`）。
  - 登録に失敗しても（容量など）、検索は続ける。状態表示に「見本を項目に登録できませんでした：{理由}」を出す。
- 「見本を囲み直す」で囲み直したときも、同じく上書きする。

### 4. 登録済みの見本で、囲み直さずに探す（`src/App.tsx`）

- `startSymbolSearch(session, fixtureId)` で、項目の見本に `rect` があるとき：
  1. `pageIndex` がページ数の範囲にあり、`rect` がそのページの大きさの中にあるか確かめる。
  2. `pool.renderFixtureSample(docId, pageIndex, rect)` で今の図面から見本を作り直し、登録済みの png と比べる。
     - 同じ大きさで、灰色にした画素の差の平均が 6 以下（0〜255）なら「同じ」とする。
     - 比べ方（画像の読み込み・canvas）は任せる。比べる関数は単体で試験できるよう分ける（例：`src/app/fixtureSampleMatch.ts`）。
  3. 同じなら、囲む操作を出さずに、登録済みの見本と `rect` でパネルを開く。
     - 状態表示：「登録済みの見本で探します。替えるときは「見本を囲み直す」を押してください」。
     - この場合は上書きの登録をしない（同じ見本のため）。
  4. 違う・確かめられない（範囲外、描画の失敗）なら、今と同じく囲む操作を始める。
     - 案内：「登録した見本の場所が図面と合わないため、探す記号を四角で囲んでください（Esc で中止）」。
- 作り直しの最中に、別の文書・ページ編集・別の項目の選択・パネルを閉じる操作があったら、結果を捨てる（今の `resolve` の確かめと同じ条件）。
  - 作り直しの最中に「同じ記号を探す」をもう一度押したら、前の作り直しの結果は捨てる。
- 「見本を囲み直す」（`onRecapture`）は、登録済みの見本があっても、必ず囲む操作を始める。
  - 例：`startSymbolSearch(session, fixtureId, { capture: true })`。形は任せる。

### 5. 他の PDF から読み込むときは、場所を外す（`src/app/FixturePanel.tsx`）

- 「他のPDFから読み込む」で写す項目の見本から `rect` を外す（png・大きさ・pageIndex は今どおり写す）。
  - 別の PDF の場所は、この PDF では意味が無いため。
- 同じ PDF の中の複製は、`rect` も写す（今の複製と同じ）。

### 6. ヘルプ（`src/app/HelpDialog.tsx`）

見本の段落の「見本は表示用で、記号の自動検索には使いません。」を、次に替える。

> 「同じ記号を探す」で囲んだ見本は、その項目の見本として自動で登録します（前の見本は上書きし、Ctrl+Z で戻せます）。登録した見本は場所も覚え、次に「同じ記号を探す」を押すと囲み直さずに探します。図面と合わない場合や、替えたい場合は囲み直してください。他のPDFから読み込んだ見本は場所を覚えていないため、初めの1回は囲みます。

## 変えないこと

- 検索の結果と速さ（見本の作り方、`SymbolSearchClient` に渡す値）。
- 見本の画像の作り方・大きさの上限。
- 見本の場所を持たない古い保存データの読み方（今と同じ。初めの1回は囲む）。
- 見本の表示（項目の行・集計表・拡大表示）。

## 試験

**単体**

- `tests/countFixtures*.test.ts`（既存の書き方に合わせる）：
  - `rect` 付きの見本を保存して読むと `rect` が残る。
  - 正しくない `rect`（3 つ、NaN、幅 0、逆向き）は捨て、見本は残る。
  - `rect` の無い古いデータは今と同じに読める。
- 比べる関数（例：`fixtureSampleMatch.ts`）：同じ画素 → 同じ、大きさ違い → 違う、差の平均が 6 を超える → 違う。

**画面の試験**（新規 `e2e/symbol-sample-register.annotate.spec.ts`。`e2e/symbol-other-fixture.annotate.spec.ts` を参考に）

1. 項目を追加し、「同じ記号を探す」で見本を囲む。
   - パネルが開き、項目の見本が登録される。`window.__karu` には項目を読む関数が無いので、試験用に `getCountFixtures(): CountFixture[]`（作業中の文書の項目）を足し、`sample.rect` を確かめる。
   - 状態表示に「見本を項目に登録しました」。
2. パネルを閉じ、もう一度「同じ記号を探す」→ 囲む操作を出さずにパネルが開く。「登録済みの見本で探します」。
   - 「探す」で、1 と同じ件数の候補が出る。
3. 「見本を囲み直す」→ 囲む操作が始まる。
4. Ctrl+Z で、登録の前に戻せる（1 の直後で確かめてよい）。

**変わらないことの確認**（Claude Code が実行する）

- `e2e/symbol-search.annotate.spec.ts`、`e2e/symbol-other-fixture.annotate.spec.ts`、`e2e/symbol-search-area.annotate.spec.ts`、見本の切り取りの既存の試験（`fixture-sample` などの名前の試験）。

## 対象

- 変更してよいファイル：
  - `src/core/countFixtures.ts`、`src/App.tsx`、`src/app/FixturePanel.tsx`、`src/app/HelpDialog.tsx`
  - 新規：比べる関数のファイル、試験ファイル
  - 既存の試験ファイル（見本の保存・読込みの試験に足す場合）
- 変更しないファイル：上以外。

## 禁止事項

- 関数名・入力名・既存の文言を、SPEC にない形で変えないこと。
- git の操作をしないこと。python・pytest は使わない。

## 報告してほしいこと

- 変更点、SPEC から逸脱した箇所と理由、Claude Code に実行してほしい試験。
