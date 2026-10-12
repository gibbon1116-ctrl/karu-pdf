# SPEC-B03: 標準マスタの「内訳書から選ぶ」タブ

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 新しい画面部品（階層の選択、摘要の入力と標準の選択肢、別紙明細の展開、既存マスタの規格の選択）と、項目の同一判定の変更（よく使う構成への波及を含む）、遅延読込の境界、e2e の追加にまたがる

---

## 背景

計画 `docs/調査/内訳書標準書式対応_計画.md` の段階 B03。B02 で作った `src/core/breakdownMaster.ts`（電気の内訳書マスタの一覧・検索・項目への変換）を、「標準マスタから追加」の画面から使えるようにする。B03 の後に利用者の試用（試用1）を行う。

利用者の決定: 同じ規格でも内訳書の位置（中科目など）が違えば別の項目。今回あわせて、**同じ名称・位置でも摘要が違えば別の項目**にする（例: 分電盤 L-1 と L-2）。

## 対象

- 対象フォルダ: リポジトリのルート
- 新規:
  - `src/app/BreakdownPicker.tsx` — 「内訳書から選ぶ」タブの中身
  - `e2e/breakdown-master.annotate.spec.ts` — e2e
- 変更:
  - `src/app/FixturePresetDialog.tsx` — 3つ目のタブ、追加の処理
  - `src/core/countFixtures.ts` — `fixtureIdentity` に摘要を含める
  - `src/app/routeSets.ts`、`src/app/RouteItems.tsx` — よく使う構成に摘要を含める
  - `src/app/FixtureDialog.tsx` — 「内訳書」の欄に CSS のクラスを付けるだけ
  - `src/styles.css` — 新しい画面と「内訳書」の欄の CSS
  - `tests/fixtureBreakdown.test.ts` — 同一判定の試験を足す
- 変えない: `src/core/breakdownMaster.ts`、`src/core/breakdown/*`、`src/core/quantityMaster.ts`

## 変更内容

### 1. 同一判定に摘要を含める（`countFixtures.ts`）

- `fixtureIdentity(f)` を `JSON.stringify([f.code, f.spec ?? '', f.name, breakdownKey(f), summaryText(f)])` にする。引数の型の `Pick` に `'summary'` を足す。
- 摘要の無い項目同士の判定は今と同じ結果になる（`summaryText` は ''）。
- `tests/fixtureBreakdown.test.ts` に、「摘要の値だけが違う2項目は別」「摘要の無い項目の判定は B01 と同じ」を足す。既存の試験は変えない（通らなくなる既存の試験があれば報告）。

### 2. よく使う構成（`routeSets.ts`・`RouteItems.tsx`）

- `RouteSetItem` に `summary?: SummaryField[]` を足す。`validItem` で、あれば `fixtureBreakdownError({ summary })` が `undefined` であること。
- `identity` は今どおり `fixtureIdentity`（1 の変更で摘要も含まれる）。
- `resolveRouteSet` で項目を作るとき `summary` を複製して持たせる。
- `RouteItems.tsx` の `currentItems` で、項目に摘要があれば `summary` を複製して含める。
- 摘要の無い既存の構成はそのまま読めること。

### 3. 「標準マスタから追加」の3つ目のタブ（`FixturePresetDialog.tsx`）

- タブを「規格から選ぶ」「分野の一式」「内訳書から選ぶ」の順に3つにする。新しいタブは `role="tab"`、`id="quantity-master-breakdown-tab"`、`aria-controls="quantity-master-breakdown-panel"`。開いたときの既定は今どおり「規格から選ぶ」。
- 「他のPDFから読み込む」（`sources` があるとき）はタブを出さない（今どおり）。
- 内訳書タブのとき、タブの中身は `<BreakdownPicker fixtures={fixtures} onChange={...} />`（`role="tabpanel"`、`id="quantity-master-breakdown-panel"`、`aria-labelledby="quantity-master-breakdown-tab"` の要素で包む）。
- 追加ボタンの文言は内訳書タブでも `選んだ項目を追加（N件）`。N は BreakdownPicker が渡す、作る予定の項目のうち **既存の項目と同一でないもの**（`fixtureIdentity` で判定、作る予定どうしの重複も1つに数える）の数。0 件か、BreakdownPicker が誤りを渡しているときは無効。
- 押したら、既存の「規格から選ぶ」と同じく `quantityMaster` の `fixtureFromPreset` で項目にし、`onAdd` に渡して閉じる（重複は除いて渡す）。

### 4. `BreakdownPicker.tsx`（新規）

```ts
export default function BreakdownPicker(props: {
  fixtures: readonly CountFixture[]
  /** 選択が変わるたびに、作る予定の項目（重複を含む）と誤りを渡す */
  onChange(result: { presets: FixturePreset[]; error?: string }): void
}): JSX.Element
```

#### 読み込み

- 表示したときに `import('../core/breakdownMaster')` で読み込む（静的に import しない。型だけの `import type` はよい）。読み込み中は `<p role="status">内訳書のマスタを読み込んでいます…</p>`。失敗したら `<p role="alert">内訳書のマスタを読み込めませんでした: …</p>` と「もう一度読み込む」ボタン。
- `fixtureCode` など `countFixtures` の関数は静的に import してよい（起動時の塊に既にある）。

#### 検索と階層

- 上に検索欄: `<input type="search" aria-label="内訳書を検索" placeholder="例: 電灯分岐 分電盤、感知器、電線管">`。空でなければ `searchBreakdown(query)` の結果を一覧に出し、階層の列は隠す。結果が 200 件を超えたら「ほか N 件。言葉を足して絞り込んでください」。0 件なら「該当する細目がありません。」。
- 検索が空のときは、既存の「規格から選ぶ」と同じ見た目の列を左から4つ並べる（同じ CSS クラス `quantity-master-browser`・`quantity-master-navigation` を使う）:
  - 「編」`role="group" aria-label="内訳書の編"`: `BREAKDOWN_BOOKS` のボタン。データの無い編（今は電気設備以外）は `disabled`、`title="準備中"`。
  - 「種目」`aria-label="内訳書の種目"`、「科目」`aria-label="内訳書の科目"`、「中科目」`aria-label="内訳書の中科目"`。中科目の無い科目では、中科目の列に「（中科目なし）」とだけ出す。
  - 上の列を選ぶと、下の列は最初の値になる。選んだボタンは `aria-pressed="true"`。
- 右の列（クラス `quantity-master-specs`）に、選んだ群の細目を書式の順に並べる。見出し `<h3>` は `${中科目 ?? 科目}の細目`（検索中は `検索結果（N件）`）。検索結果の各行には `${科目}／${中科目}／`（中科目なしなら `${科目}／`）を名前の前に小さく出す。

#### 細目の行（クラス `breakdown-row`）

細目の種類ごとに次のように出す。

1. **拾える細目**（`entry.pickable`）: チェックボックス（`aria-label` は `${row.name}（${row.unit}）`）と、名前・単位。チェックしたときだけ、`row.summary` の区分ごとに入力欄を出す。
   - 入力欄: `<input aria-label={`${row.name}の${区分名}`} list={データリストの id}>` と `<datalist>`（`summaryChoices(row.name, 区分名)` の値）。選択肢の無い区分はデータリストを付けない。
   - 区分名が「記号」「盤名称」「名称」「建具番号」の欄には、`placeholder="、で区切ると複数作ります"`。
2. **別紙明細で標準の明細がある細目**（`row.separate && details.length`）: 名前の横に「1式 別紙明細」と、ボタン `明細を選ぶ（N）`（N は明細の数、`aria-expanded`）。開くと明細を並べる:
   - **標準マスタを使う明細**（`template.master`）: `detailMasterEntries(template)` を種類（`MasterEntry.type`）ごとにまとめ、種類のボタン（`aria-label` は `${template.name}の種類 ${type}`、押すと開閉）と、その中の規格のチェックボックス（`aria-label` は `${fixtureCode(e)} ${e.name}`）。`template.summary` があれば、その入力欄（1 と同じ形、`aria-label` は `${template.name}の${区分名}`）も出す。
   - **標準マスタを使わない明細**: チェックボックス（`aria-label` は `${template.name}（${template.unit}）`）。チェックしたら `template.summary` の入力欄（1 と同じ形、選択肢は `slot.choices`、`aria-label` は `${template.name}の${区分名}`）。
   - **拾えない単位の明細**（`kindForUnit(template.unit)` が無い。今は搬入費・搬出費の t）: 無効のチェックボックスと「（連動で計算する予定）」。
3. **別紙明細で標準の明細が無い細目**: 名前と「1式（数量なし）」を灰色で出す。チェックボックスは無い。
4. **拾えない単位の細目**（separate でなく `pickable` でもない。例: ソフトウェア 1式）: 名前と単位と「（拾えない単位）」を灰色で。

`row.renovation` の行には名前の後に「※」（`title="改修工事の際に必要となる項目の例"`）。

#### 作る項目（onChange に渡す）

- 選んだ行・明細ごとに、`presetFromRow` または `presetsFromDetail` で作る。摘要の値は入力欄の値（前後の空白を取る。空は渡さない）。
- **複数作る**: 区分名が「記号」「盤名称」「名称」「建具番号」の欄の値を `/[、,，]/` で区切り、空でない値ごとに1つずつ作る（その区分だけ値を差し替え、ほかの区分は同じ）。1つの行・明細に該当する区分が複数あるときは、最初の区分だけを区切る。
- **略号**: 上の区分の値が 16 字以内で、作る項目の `code` が空なら、その値を `code` にする（図面の印・札に「L-1」のように出るため）。標準マスタの規格から作る項目（`code` がある）は変えない。
- 作れないとき（`fixtureBreakdownError` の文などの `Error`）は、作れた項目と `error`（文）を渡す。誤りの文は画面にも `role="alert"` で出す。
- **追加済み**: 作る予定の項目と `fixtureIdentity` が同じ既存の項目があれば、その行・規格の横に「追加済み」（クラス `quantity-master-added`）。チェックは外さない（追加のときに除く）。
- 選んだ状態と入力値は、階層の移動・検索の切替で消えない。タブを切り替えて戻ったときは消えてよい。

#### 見た目

- 既存の「規格から選ぶ」と同じダイアログの幅・列の CSS を使う。細目の一覧は `.quantity-master-specs .fixture-presets` と同じく縦にスクロールする（`max-height: 46vh`）。
- 摘要の入力欄は、チェックボックスの下に字下げして、区分名のラベルと入力を横に並べる（狭い画面では縦）。
- 幅 390px の画面でダイアログに横スクロールが出ないこと（既存の「stacks field, category, type and specs on a narrow screen」と同じ確かめ方）。

### 5. 項目の編集画面の「内訳書」の欄（`FixtureDialog.tsx`・`styles.css`）

- B01 で作った `<details>` に `className="fixture-breakdown"` を付けるだけ（中身・文言は変えない）。
- CSS: `.fixture-breakdown fieldset > label`（と単位・備考のラベル）を、ラベル幅 4em ＋入力欄の2列の格子にする。今は「科目」などが縦に1字ずつ折り返して窮屈なため。摘要の行（`ol > li`）は、区分名・値・削除を横に並べ、狭いときは折り返す。

### 6. e2e（`e2e/breakdown-master.annotate.spec.ts`、新規）

既存の `e2e/quantity-master.annotate.spec.ts` の `open`・`blankPdf` と同じ形で PDF を開く（`test.use({ serviceWorkers: 'block' })`）。

1. **細目を摘要つきで複数追加**: 標準マスタ → 「内訳書から選ぶ」 → 編「電気設備」・種目「庁舎」・科目「電灯設備」・中科目「電灯分岐」 → 「分電盤（面）」をチェック → 「分電盤の盤名称」に `L-1、L-2` → 「選んだ項目を追加（2件）」。数量の一覧に `L-1 分電盤`・`L-2 分電盤` の行。保存した PDF の項目（`readCountFixtures`）で、2件とも `unit: '面'`、`breakdown` が `{ book: '電気設備', section: '庁舎', subject: '電灯設備', middle: '電灯分岐', item: '分電盤' }`、`summary` が `[{ label: '盤名称', value: 'L-1' }]` と `L-2`。もう一度開いて同じく `L-1` を入れると「追加済み」が出て、ボタンは「選んだ項目を追加（0件）」で無効。
2. **別紙明細の規格**: 「電灯幹線」の「電線管」で「明細を選ぶ」→ 種類「E」→ 規格 `E25 ねじなし電線管` をチェックして追加。続けて「動力幹線」でも同じ規格を追加できる（「追加済み」が出ない）。保存した項目で E25 が2件、`breakdown.middle` が「電灯幹線」と「動力幹線」、`kind: 'length'`。
3. **検索と標準の選択肢**: 検索欄に「煙感知器」→ 行が出る → チェック → 「煙感知器の形式」の入力欄のデータリストに「光電式スポット型2種」がある。
4. **遅延読込**: PDF を開いた直後は、データに固有の文字列「電力平準化用蓄電装置」を含むスクリプトを読んでいない。「内訳書から選ぶ」を開くと読む（既存の「loads the master JS only when its spec dialog is opened」と同じ確かめ方）。
5. **狭い画面**: 幅 390px で「内訳書から選ぶ」を開き、ダイアログに横スクロールが無い。

## 禁止事項

- `src/core/breakdownMaster.ts`・`src/core/breakdown/*`・`src/core/quantityMaster.ts` を変えないこと（足りない関数があれば報告する）。
- 既存の2つのタブの動き・文言・`aria-label` を変えないこと。
- `BreakdownPicker` から `breakdownMaster` を静的に import しないこと。
- 依存パッケージを足さないこと。指定外のファイルを変えないこと。

## 検証項目（Claude Code が実行する）

- [ ] `npx tsc --noEmit`
- [ ] 単体: `tests/fixtureBreakdown.test.ts`・`tests/breakdownMaster.test.ts`・全件
- [ ] `npm run build` の後、e2e: `e2e/breakdown-master.annotate.spec.ts` と数量拾い関係
- [ ] 画面で、項目の編集画面の「内訳書」の欄が窮屈でないこと

## 報告してほしいこと

- 変更したファイルと、各ファイルで変えた関数・処理
- SPEC から外れた所と理由
- 残課題
