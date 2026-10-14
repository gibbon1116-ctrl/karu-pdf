# SPEC-R7a: 関連の候補の判断を、起点の項目ごとに分ける

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 提案の鍵（保存データのキー）の作りを変え、古い判断を読み替える判断を伴うため既定の sol-high。

---

## 背景（利用者の意見、2026-10-14）

> ケーブルの一つを項目で追加し、他のケーブルを新しく追加したとき、最初に追加した保護管等が判断済みになっているが、項目ごとに全て個別に選択できるようにしたい。ケーブル以外の全ての項目についても、個別に選択できるようにしたい。

今の作り（`src/core/related/suggest.ts`）:

- 提案の鍵は、拾い候補は `item:[編, 提案先, 品目作業]`、確認事項は `check:ルールID`、注意は `note:ルールID`。
- 起点の項目をまたいで同じ鍵に集約し、判断（`KaruRelatedReviews.decisions`）も鍵ごとに1つ。
- そのため、ケーブル A で「追加する」（判断「必要」）にすると、ケーブル B の同じ候補も判断済みになる。
- 提案先の項目がすでにあると「選択済み」になり、判断のボタンが出ない（R5a）。そのため B で別の保護管を追加できない。

## 変更内容

### 1. 鍵を起点ごとに

- `suggestRelated` は、**起点の項目ごとに別の提案**を作る。
  - 鍵 = 今の鍵 ＋ `@` ＋ 起点の項目の ID（例 `item:[…]@fixture-1`、`check:E-016@fixture-1`）。
  - 同じ起点の中で同じ鍵に当たるルールは今と同じく集約する（`mergeRule`）。
  - `originFixtureIds` はその1件だけ。
- 案件区分の確認事項（`contextChecks`）は起点が無いので、今の鍵（`check:ID`・`note:ID`）のまま。
- `hint:work` は今のまま。
- 文書全体の評価（未判断一覧・集計表の件数・Excel）は、起点ごとの提案を数える。同じ提案先でも起点が違えば別の行になる。`groupRelatedReviews` の起点ごとのまとめはそのまま使える。

### 2. 古い判断の読み替え（保存データの互換）

- `parseRelatedReviews`（`src/core/related/reviews.ts`）で、`@` を含まない `item:`・`check:`・`note:` で始まる鍵の判断を、その `originFixtureIds` のそれぞれについて `鍵@起点ID` の判断に展開する。
  - 展開した判断の `originFixtureIds` はその1件。
  - `originFixtureIds` が空のものは今の鍵のまま残す（案件区分の確認事項）。
  - 展開先の鍵がすでにあれば、すでにある方を優先する。
- 書き出し（`serializeRelatedReviews`）は新しい鍵で書く。
- 件数の上限（5000）は展開後に数える。超える分は古い判定日時（`decidedAt`）から捨てる。
- 以前の版でこの PDF を開くと、判断が候補に結び付かず表示されない（データは残る）。報告に書く。

### 3. 選択済みのカードにも判断のボタン

- 選択済み（`flags.registered`）で判断の無いカードにも、ふつうのカードと同じ判断のボタンを出す。
  - ボタン: 「追加する」「不要」「後で確認」「ほかの判断」。
  - R6c の「経路に入れる」はそのまま。
- 見出しの「選択済み（n項目）」の印と薄い表示は残す。
- 選択済みで判断の無いものは、今までどおり未判断の件数に数えない（R5a）。

## 対象

- `src/core/related/suggest.ts`
- `src/core/related/reviews.ts`
- `src/app/RelatedSuggestions.tsx`
- `src/app/relatedReviewList.ts`・`src/app/relatedReviewRows.ts`（鍵の扱いに必要なら）
- `src/app/relatedRouteItems.ts`（R6a の関連の個数の項目）は、起点1件の提案を使うので変更不要のはず。違えば合わせる。
- 試験

## 試験

- 単体 `tests/related.suggest.test.ts`:
  - 同じ分類の起点2件（ケーブル A・B）で、同じ提案先の候補が鍵の違う2件になる。
  - A の判断は B の提案に付かない。
  - 同じ起点で同じ提案先に当たる2つのルールは1件に集約される（今の試験を直す）。
- 単体 `tests/related.reviews.test.ts`: 古い鍵（`item:[…]`、`originFixtureIds: [a, b]`）が `item:[…]@a` と `item:[…]@b` に展開される。起点の無い判断はそのまま。展開先が重なるときは既存を優先。往復で新しい鍵が保たれる。
- 単体 `tests/related.reviewList.test.ts`・`tests/related.xlsx.test.ts`: 起点ごとの行。
- e2e（`e2e/related-r5a.annotate.spec.ts` か新規）:
  - 電線管の分類の長さの項目 A・B を作る。
  - A で E-015 の候補を「不要」にすると、B を選んだときの同じ候補は判断なし。
  - 選択済みのカードに「追加する」がある。
- 既存の関連の試験は、鍵の変更に合わせて最小限直す（意図は変えない）。

## 受入条件・停止条件

- 関連の機能を使っていない文書の表示・保存・Excel は今と同じ（ルールを読まない）。
- 関連・数量の e2e と単体試験全件が合格。
- 戻し方: この段階のコミットの revert。

## 禁止事項

- 保存のキー名（`KaruRelatedReviews`）と判断の中身の形（`RelatedReviewDecision`）を変えない（鍵の文字列だけ変える）。
- 外部通信を足さない。`https://` を含む文字列を足さない。git 操作をしない。
