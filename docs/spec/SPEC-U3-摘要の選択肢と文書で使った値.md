# SPEC-U3: 摘要の欄に、選択肢とその文書で使った値の候補を出す

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 標準マスタの画面（規格・内訳書の両タブ）と項目の画面の両方に、候補の出し方を足す。共通の関数を新設するため既定の sol-high。

---

## 背景

利用者の依頼（2026-10-14）:

> 標準マスタから入力しようとするとき、部位、工法、種別、仕様、型式、寸法、形、仕上等を記載する欄が出るものが多々あるが、選択肢が用意できるものは可能な限り選択肢を準備するようにしたい。選択肢を提示したうえで、自由記載欄も用意したい。

Claude がデータを作成済み（コミット a102e22）:

- `src/core/breakdown/commonChoices.ts`（発生材・ダクト寸法・制気口寸法 等）。
- `electricalDetails.ts`・`mechanicalDetails.ts` の選択肢を追加。選択肢のある区分は 電気 63%→72%、機械 36%→52%。

残りは図面ごとに値が違う区分（記号・盤名称・名称・記号等・型番・機器の仕様等）。決めた方針:

- これらは固定の選択肢を持たない。
- **その文書ですでに使った値**を候補に出す。

今の画面の作り:

- 選択肢のある区分: チェックボックス＋「ほかの値」の自由記載（`src/app/CatalogChooser.tsx`）。
- 選択肢の無い区分: 自由記載の欄だけ。

## 変更内容

### 1. 文書で使った値（新規 `src/core/summaryValues.ts`）

```ts
/** 文書の項目の摘要から、区分 label の値を集める。同じ名称の項目の値を先に、ほかの項目の値を後に。重複なし、最大 30。 */
export function documentSummaryValues(
  fixtures: readonly Pick<CountFixture, 'name' | 'summary'>[],
  label: string,
  name?: string,
): string[]
```

- 名称は `normalizeItemName`（`src/core/related/suggest.ts`）で比べる。
- 値は trim し、空は除く。

### 2. 標準マスタの画面（`CatalogChooser.tsx`）

- 新しい任意の prop: `fixtures?: readonly CountFixture[]`（文書の項目）。
  - `FixturePresetDialog` と `BreakdownPicker` から、今持っている `fixtures` を渡す。
- **選択肢の無い区分の欄**:
  - `<datalist>` で `documentSummaryValues(fixtures, slot.label, item.name)` を候補に出す（`list` 属性。id は品目の鍵と区分から作り、ページ内で重複させない）。
  - 候補が1件以上あるときだけ、欄の下に小さく「この文書で使った値: A・B・C（5件まで）」と出す。
- **選択肢のある区分の「ほかの値」の欄**: 同じ datalist を付ける（選択肢と同じ値は除く）。
- 今の入力・組合せ・「、で区切ると複数作ります」の動きは変えない。

### 3. 項目の画面（`src/app/FixtureDialog.tsx` の「摘要」）

**値の欄**（`摘要の値n`）に `<datalist>` を付ける。候補は次の順で重複なし:

1. 内訳書の位置（`breakdownDraft`）と項目の名称から引いた、標準の選択肢。
   - 新規の関数 `summaryChoicesForFixture(position, name, label)` を `src/core/breakdownMaster.ts` に置く。
   - 位置の行が「1式・別紙明細」でなければ `summaryChoices(行の名称, label, 編)`。
   - 別紙明細なら、その行の明細（`entry.details`）のうち `name` が項目の名称と同じ明細の `summary` の区分 `label` の `choices`。
   - 位置が無い・行が見つからないときは空。
2. `documentSummaryValues(fixtures, label, 項目の名称)`。

**区分名の欄**（`摘要の区分名n`）に `<datalist>` を付ける。候補は、位置の行の摘要の区分名（行の `summary`、別紙明細なら明細の `summary` の label）と、文書で使った区分名。

- `breakdownMaster` は今どおり遅延読込。読み込む前は datalist 無しでよい。

## 試験

- **単体 `tests/summaryValues.test.ts`:** 同じ名称の値が先・重複なし・空を除く・30件まで。
- **単体 `tests/breakdownMaster.summaryChoices.test.ts`:**
  - `summaryChoicesForFixture` で、機械設備の「吹出口」の行（換気設備 ダクト設備）の「寸法」に `GRILLE_SIZES` が返る。
  - 電気設備 電灯設備 コンセント分岐「配線器具」の明細「コンセント」の「種類」に7件が返る。
  - 発生材処分の「種類」に `WASTE_KINDS`。
  - 位置なしは空。
- **e2e `e2e/summary-choices.annotate.spec.ts`**（`breakdown-master.annotate.spec.ts` の作りにならう）:
  - 記号 `PAC-1` の「パッケージ形空気調和機」の項目がある PDF で、標準マスタの「規格から選ぶ」から「パッケージ形空気調和機」を選ぶ。
    - 記号の欄の datalist に `PAC-1` がある。
    - 「この文書で使った値: PAC-1」が出る。
  - 「吹出口」を選ぶと、寸法の選択肢（300×150 等）のチェックボックスと「ほかの値」が出る。
  - 項目を編集の画面で、内訳書の位置が 換気設備 › ダクト設備 › 吹出口 の項目の摘要「寸法」の値の欄に datalist があり、300×150 を含む。

## 受入条件・停止条件

- 今の標準マスタ・項目の画面の操作と試験の結果は今と同じ（候補が増えるだけ）。
- 戻し方: この段階のコミットの revert。

## 禁止事項

- 選択肢のデータ（`commonChoices.ts`・`*Details.ts`・`*Groups.ts`）を変えない。保存形式を変えない。
- 外部通信・`https://` を含む文字列を足さない。git 操作をしない。
