# SPEC-S15: 「他の項目で拾い済み」を表示したときは、その候補も選んで数量に追加できるようにする

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: ストア・パネル・図面の候補の 3 か所で、選べる条件を揃えて変える。重複の拾い（同じ項目）を防ぐ条件は残す判断が要る

---

## 利用者の要望

> 同じ記号を探すの操作で、「他の項目で拾い済みのものも表示する」にチェックを入れても、数量を拾うことができない。チェックを入れた場合は拾い済みのものも数量を拾えるようにして下さい。

## 現状（Claude Code が確かめたこと）

SPEC-S03 で、別の項目の印と同じ位置の候補（`c.otherFixture`）は「他の項目で拾い済み」として、初めは隠し、表示しても選べない・数量に入らないようにした。

- `src/editor/AnnotationStore.ts`
  - `toggleSymbolCandidate`：`c.otherFixture` なら何もしない。
  - `chooseSymbolCandidates`：`!c.otherFixture` だけ。
  - `chooseHighConfidenceCandidates`：`!c.otherFixture` だけ。
  - `refreshSymbolCandidates`：`if (c.otherFixture && c.state === 'chosen') c.state = 'pending'`。同じ項目の印がある候補は `counted`（こちらが優先）。
  - `setSymbolOtherFilter(value)`：表示・非表示の切替。
- `src/app/SymbolSearchPanel.tsx`
  - `chosen`（「選んだ N 件を数量へ追加」の件数）と `add()` が `!c.otherFixture` だけ。
  - 「確度の高い候補を選ぶ」の押せる条件が `!c.otherFixture`。
- `src/editor/AnnotationLayer.tsx`
  - `c.otherFixture` の候補は `aria-disabled="true"`、`tabIndex=-1`、class `other-fixture`（灰色の破線、カーソルが矢印）。`aria-label` は「記号の候補（他の項目で拾い済み）」。
- `src/styles.css`：`.symbol-search-candidate.other-fixture` の見た目。

## 変更内容

### 1. 選べる条件（`AnnotationStore.ts`）

- 「他の項目で拾い済み」を表示している（`symbolOtherFilter === 'show'`）ときは、`otherFixture` の候補を、普通の候補と同じに扱う。
  - `toggleSymbolCandidate`：選ぶ・外すができる。
  - `chooseSymbolCandidates`：「すべて選ぶ」「すべて外す」に含める（表示中の候補だけ、今と同じ）。
  - `chooseHighConfidenceCandidates`：確度高なら含める。
- 表示していない（`'hide'`）ときは、今と同じ（図面に出ず、選べない）。
- `setSymbolOtherFilter('hide')` にしたら、選んでいた `otherFixture` の候補を `pending` に戻す（隠れた候補を数量に入れない）。
- `refreshSymbolCandidates` の `if (c.otherFixture && c.state === 'chosen') c.state = 'pending'` は、表示していないときだけ行う。
- **同じ項目で拾い済み（`counted`）は今と同じく選べない。** 同じ位置に同じ項目の印を二重に置かないため。

### 2. パネル（`SymbolSearchPanel.tsx`）

- `chosen`・`add()`・「確度の高い候補を選ぶ」の条件から `!c.otherFixture` を外し、「表示中（`visibleSymbolCandidates`）で選んだもの」にする。
  - 隠れている候補は `visibleSymbolCandidates` に入らないので、数量に入らない。
- 表示のチェックの文を「他の項目で拾い済みの {N} 件も表示する（…）」から、選べることが分かる文にする：
  - 「他の項目で拾い済みの {N} 件も表示して拾えるようにする（{内訳}）」

### 3. 図面の候補（`AnnotationLayer.tsx`、`styles.css`）

- 表示中の `otherFixture` の候補は、押せる候補にする（`aria-disabled` を付けない、`tabIndex` は普通の候補と同じ、カーソルは指）。
- 見分けは残す：class `other-fixture`、`aria-label`「記号の候補（他の項目で拾い済み）」、`title` の「・他の項目（…）で拾い済み」。
  - 選んでいない状態：今の灰色の破線のまま。
  - 選んだ状態：普通の候補と同じ緑（`.symbol-search-candidate.chosen` が勝つように、CSS の順や詳しさを直す）。
- 要確認の「?」の表示は、普通の候補と同じ条件にする（`!c.otherFixture` の条件を外す）。

### 4. ヘルプ（`src/app/HelpDialog.tsx`）

「別の項目で拾った印と同じ位置の候補は「他の項目で拾い済み」として初めは図面に出さず、選べません。…「他の項目で拾い済みの…も表示する」で位置を確かめられます。」を、次に直す：

> 別の項目で拾った印と同じ位置の候補は「他の項目で拾い済み」として初めは図面に出しません。例えば、正方形や長形の器具を先にそれぞれの項目で拾っておくと、丸だけの器具を探すときにそれらの中の丸を数えません。「他の項目で拾い済みの…も表示して拾えるようにする」にチェックを入れると、それらも図面に出し、選んで数量に追加できます（灰色の破線で区別します）。

## 変えないこと

- 「他の項目で拾い済み」の判定（位置・半径）。初めは隠すこと。
- 同じ項目で拾い済みの候補は選べないこと。
- 検索の結果。

## 試験

- `tests/AnnotationStore.symbolSearch.test.ts`（足す）：
  - 表示していないとき：`otherFixture` の候補は選べない・すべて選ぶに入らない（今と同じ）。
  - 表示したとき：選べる・すべて選ぶ・確度の高い候補を選ぶに入る。
  - 選んだ後に隠すと `pending` に戻る。
  - 同じ項目の印がある候補（`counted`）は、表示しても選べない。
- `e2e/symbol-other-fixture.annotate.spec.ts`（直す）：
  - 今の「表示しても選べない・数量に入らない」の確かめを、「表示すると選べて、数量に追加でき、その項目の印になる」に直す。
  - 隠している間は、すべて選ぶに入らないことは残す。
  - 追加した後、その候補は `counted`（灰色）になる。

## 対象

- 変更：`src/editor/AnnotationStore.ts`、`src/app/SymbolSearchPanel.tsx`、`src/editor/AnnotationLayer.tsx`、`src/styles.css`、`src/app/HelpDialog.tsx`
- 試験：`tests/AnnotationStore.symbolSearch.test.ts`、`e2e/symbol-other-fixture.annotate.spec.ts`
- 変更しないファイル：上以外。

## 禁止事項

- 既存の関数名・入力名を変えないこと。SPEC にない文言を変えないこと。
- git の操作をしないこと。python・pytest は使わない。

## 報告してほしいこと

- 変更点、SPEC から逸脱した箇所と理由、Claude Code に実行してほしい試験。
