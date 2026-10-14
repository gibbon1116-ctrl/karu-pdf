# SPEC-U10: 溝掘削・埋戻しの連動に、幅・深さと管の体積の控除を入れる

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 連動の計算（computeLinks）の数量が変わり、計算の根拠の表示4か所・Excel 出力・既存の試験に波及するため既定の sol-high。

---

## 背景

利用者の意見（2026-10-15、画面写真あり）:

> 埋設管の土工の数量を計算するとき、4.36×1が数量として入るが、溝掘削として、横幅0.6mと深さ0.8mを設定しているのに、その数値が反映されていない。数量の換算で溝掘削の長さが24mになっているが、この数値も4.36と違う。また、埋め戻しで埋設した配管の体積を除くチェックがあるが、これも反映されていない。

画面の状態:

- 項目「溝掘削 ケーブル・配管の溝掘削（長さ×幅×深さ）」は次の設定。
  - 体積・拾い方 `lengthWidthDepth`、`defaults: { widthM: 0.6, depthM: 0.8 }`。
  - 係数の連動 `link: { kind: 'factor', sources: [{ itemId: <FEP30 波付硬質合成樹脂管>, factor: 1, conditions: ['地中埋設'] }] }`。
- 「今の拾いで計算した見本」は `FEP30 波付硬質合成樹脂管 4.365138 m × 1 ＝ 4.365138 m³`。
- 同じく連動の「埋戻し」（m³）は「埋戻し: 同じ経路の管の体積を引く」（`backfill.deductPipes`）を付けているが、引かれない。

原因:

1. **係数の連動の計算**（`src/core/fixtureLink.ts` の `computeLinks`）は `元の数量 × 係数` だけ。連動の項目の幅・深さ（`defaults.widthM`・`defaults.depthM`）を使わない。
   - 幅・深さと管の控除は、経路の追加要素として拾ったとき（`quantityIndex.ts` → `backfill.ts`）だけ使われる。
2. **「24.00×W0.60×D0.80=11.52 m³」** は `FixtureDialog.tsx` の線の見た目の見本（`quantity-preview`）。
   - 固定の長さ 24m（線は 9.35m）で描いた表示の例で、数量ではない。
   - 連動の項目は図面に印を描かないので、この見本の数値は意味が無いうえ、数量と見誤る。

## 変更内容

### 1. 係数の連動で「長さ × 幅 × 深さ（− 管）」にする（`src/core/fixtureLink.ts`）

`computeLinks` の係数・質量等の共通の経路（`for (const row of rows)` の所）で、次の条件をすべて満たす元を「断面の連動」とする:

- `link.kind === 'factor'`
- 連動の項目 `fixture` の `quantityMethod(fixture) === 'lengthWidthDepth'`
- 元 `original` の `quantityKind(original) === 'length'`

**断面の連動の計算:**

- `widthM = fixture.defaults?.widthM`、`depthM = fixture.defaults?.depthM`。
- **両方が有限で 0 より大きいとき:**
  - 行の `part` が `'rise'` または `'slack'` の行は、断面の連動では数えない（値 0。`basis.quantity` にも足さない）。`part` が無い行・`'plan'` の行だけを使う。溝は平面の長さだけで、立上り・余長は含めない。
  - 行の値: `v = 今の値（row.value × factor または row.value / perM）× widthM × depthM`。
  - **管の控除:** 次をすべて満たすとき、`v -= π/4 × (外径mm/1000)² × row.value` とする（`perM`・`factor` は控除に掛けない。row.value は管の長さ）。
    - `fixture.backfill?.deductPipes === true`
    - 外径 = `pipeOuterDiameterMm(original)`（`src/core/backfill.ts` から import）が分かる
  - 控除で負になった行は 0（警告「管の体積が埋戻しの総体積を超えた行があるため、0 にしています。」を1回）。
  - 外径が分からないときは引かずに、警告 `${pipeLabel} の外径が分からないため引いていません（項目の質量・寸法に外径を入れてください）` を1回出す（`backfill.ts` の文言と同じ。ラベルは記号＋規格、無ければ名称）。
  - 施工条件で絞る（`source.conditions`）は今のまま先に効く。連動では `backfill.conditionIncludes` は使わない（連動の元の行が、そのまま埋設の管の行）。
- **幅・深さのどちらかが未設定（undefined・0・非有限）のとき:**
  - 今のまま（`元 × 係数`）。
  - 警告 `${fixture.name}の幅・深さが未設定のため、元の長さ × 係数のままです。` を1回出す。
- `openingFactor`・`sign` は今と同じ順で掛ける（断面と控除の後に掛ける）。

**計算の根拠（`LinkBasisSource`）に任意の欄を足す:**

```ts
/** 断面の連動（溝掘削・埋戻し）のとき */
section?: { widthM: number; depthM: number }
/** 管の体積の控除の合計（m³）。控除したときだけ */
pipeDeductionM3?: number
/** 控除に使った管の外径（mm） */
pipeOuterDiameterMm?: number
```

**表示用の関数を足す:**

```ts
/** 断面の連動の根拠の文字。例「 × 幅 0.6 × 深さ 0.8 − 管 φ40mm 0.0055」。断面でなければ '' */
export function fixtureLinkSectionText(source: LinkBasisSource): string
```

- 幅・深さは `String(Number(x.toFixed(3)))`、控除は `toFixed(4)`。

### 2. 根拠の表示に断面を出す

次の4か所で、係数（`× 1` 等）の直後に `fixtureLinkSectionText(source)` を足す。

- `src/app/FixtureDialog.tsx`: 「今の拾いで計算した見本」
- `src/app/QuantityBreakdown.tsx`: 「計算の根拠」
- `src/app/quantityXlsx.ts`: 根拠の操作の文字
- `src/app/breakdownXlsx.ts`: 連動の要約。`basis.get(source.itemId)` の section を使う。60字の切り詰めは今のまま。

例: `FEP30 波付硬質合成樹脂管 4.365138 m × 1 × 幅 0.6 × 深さ 0.8 ＝ 2.10 m³`

### 3. 線の見た目の見本を数量と見誤らないようにする（`src/app/FixtureDialog.tsx`）

`quantity-preview`（`{length ? <div className="quantity-preview">…`）:

- **連動の項目（`value.link` がある）:** `QuantitySwatch` だけを出し、`quantityLabel(...)` の数値の文字は出さない。
- **連動でない項目:** 文字の前に `<small>表示の見本（例）</small>` を付ける。
  - `aria-label` は付けない。既存の e2e が見本の文字を探していないか `e2e/` を確認する。探しているなら、その試験が通るように `small` を文字の span の外に置く。

### 4. 幅・深さの欄と埋戻しの説明（`src/app/FixtureDialog.tsx`）

- `quantityMethod(value) === 'lengthWidthDepth'` で `value.link` があるとき、寸法の欄の下の「空欄または0なら、拾うときに寸法を入力します。」に替えて、次を出す。
  - 「連動のときは、元の長さ（平面）× 幅 × 深さで数量を計算します。」
- 埋戻しの説明 `<p>` の文の後ろに次を足す。
  - 「連動のときは、連動の元の管（施工条件で絞った拾い）の体積を引きます。」
- 欄の `aria-label` は変えない。

## 変えないこと

- 保存形式（`link`・`defaults`・`backfill`）。読み書き・検査（`fixtureLinkError`・`readFixtureLink`）。
- 経路の追加要素としての溝・埋戻し（`quantityIndex.ts`・`backfill.ts` の計算）。
- 係数以外の連動（mass・carry・rc・shape・crossing・steel）。
- 元が長さ以外（根切り m³ から埋戻し 等）の係数の連動。
- 連動の項目が `lengthWidthDepth` 以外の係数の連動。

## 試験

### 単体 `tests/fixtureLink.section.test.ts`（vitest。`tests/fixtureLink.test.ts` の作り方にならう）

- **溝掘削:** 幅 0.6・深さ 0.8 の `lengthWidthDepth` 体積の項目。元は長さの項目 `FEP30`（kind length、code 'FEP30'）、行 4.365138。
  - 合計 = 4.365138 × 0.48。
  - 根拠の `section` が `{ widthM: 0.6, depthM: 0.8 }`。
  - `fixtureLinkSectionText` が「 × 幅 0.6 × 深さ 0.8」。
- **埋戻し:** 上に `backfill: { deductPipes: true, conditionIncludes: ['埋設'] }`。
  - 合計 = 4.365138 × 0.48 − π/4 × 0.040² × 4.365138（FEP30 の外径 40mm）。
  - `pipeOuterDiameterMm` が 40。
- **外径不明:** 外径が分からない元は引かず、警告が出る。
- **part:** `part: 'rise'` の行は数えない。`'plan'` と part 無しは数える。
- **未設定:** 幅が未設定なら今のまま（元 × 係数）で、警告が出る。
- **他は不変:**
  - 元が体積の項目（根切り）なら今のまま。
  - 連動の項目が体積でも `lengthWidthDepth` 以外なら今のまま。
- **係数 2:** 長さ × 2 × 幅 × 深さ。控除は係数を掛けない。

### 既存の試験

連動の計算・表示・Excel の既存の試験（`tests/fixtureLink*.test.ts`・`tests/quantityXlsx*.test.ts`・`tests/breakdownXlsx*.test.ts` 等）で、「`lengthWidthDepth` の項目に長さの元の係数の連動」を使って今の値を固定しているものがあれば、新しい値に直し、直した試験の一覧を報告に書く。無ければ書かない。

## 受入条件・停止条件

- 連動を使わない文書の性能は今と同じ（追加の判定は連動の元ごとの条件1つ）。
- 保存形式・データファイルを変えない。
- 戻し方: この段階のコミットの revert。

## 禁止事項

- 上に挙げたファイルと新しい試験以外を変えない（既存の試験の値の修正は可）。外部通信・`https://` を含む文字列を足さない。git 操作をしない。試験を実行しない（Claude Code が実行する）。
