# SPEC-B03d-2: 「摘要」「内訳書の位置」の列を固定列の外へ出す

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 仮想スクロールの表の列の並びと固定（sticky）の変更、Excel の列と固定表示のそろえ、複数の試験の列の位置の更新

---

## 背景

SPEC-B03d で集計表の固定列（sticky）を8列にした結果、固定列の幅の合計が 774px になり、狭い画面では図面別の列が固定列の下に隠れてクリックできなくなった（e2e `format-panel-width` の「fits three openings…」で、`button[data-column-key="0"]` の上に `quantity-table-fixed-7` が重なる）。

## 変更内容

1. 集計表（`src/app/QuantityTable.tsx`・`src/styles.css`）:
   - 固定列（sticky）を **B03d より前と同じ6列**（見本・略号・名称・規格・単位・全図面。クラス `quantity-table-fixed-0`〜`5`、`left` も B03d より前の値: 0・44・144・294・384・434px、`-5` に影の線）に戻す。
   - 「摘要」「内訳書の位置」は **全図面の直後の、固定しない列** にする（クラス `quantity-table-summary`・`quantity-table-breakdown`、幅 120px・150px、文字は1行で省略、`title` に全文）。その後ろに図面別などの列が続く。
   - 見出し・区分の行・間隔の行の `colSpan`、表の幅の計算を合わせる。区分の行の見出し（`th`）は固定列6列ぶんを結合し、摘要・位置・図面別の列ぶんは空の `td` にする。
   - 「内訳書の位置でまとめる」・値・`title` の中身は変えない。
2. Excel の集計表（`src/app/quantityXlsx.ts`）: 列の並びを画面と同じにする（見本・略号・名称・規格・単位・全図面・摘要・内訳書の位置・図面別…）。固定表示（`freeze`）は6列のまま。見出しの結合・列幅を合わせる。
3. 試験: 列の位置を前提にしている試験を新しい並びに合わせる（`tests/quantityXlsx.test.ts`、`tests/fixtureConvert.test.ts`、`tests/quantityTable.test.ts`、`e2e/quantity-table.annotate.spec.ts`、`e2e/quantity-conditions.annotate.spec.ts`、`e2e/review-cursor.annotate.spec.ts`、`e2e/breakdown-master.annotate.spec.ts`）。B03d の前の試験の期待値（固定6列）に戻るものはそのとおりにする。摘要・位置の列は新しいクラスで確かめる。

## 禁止事項

- 数量・絞り込み・並べ方・CSV を変えないこと。指定外のファイルを変えないこと。

## 検証項目（Claude Code が実行する）

- [ ] 型検査、単体、e2e（集計表・数量拾い関係・`format-panel-width`・`review-cursor`）
