# SPEC-B03g: 集計表（画面・Excel）を内訳書の構成の見出しで表示する

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 仮想スクロールの表の区分の行の多段化、並べ方（内訳書のマスタ順）、Excel の集計表シートとのそろえ、既存試験の更新にまたがる

---

## 利用者の要望（2026-10-12、試用版 第3版）

> 出力するエクセル、集計表ともに、「内訳書の位置」という行（列）を作成するのではなく、添付のような形で内訳書の構成のどこに入力した項目なのかが分かるような構成にしてください。

添付は Excel の「細目別内訳」シート（`breakdownXlsx.ts`）の形:

```
電気設備            ← 編
庁舎                ← 種目
　電灯設備          ← 科目
　　電灯分岐        ← 中科目
ケーブル  1 式  別紙明細-1
```

## 対象

- 変更: `src/app/QuantityTable.tsx`、`src/app/quantityXlsx.ts`、`src/styles.css`
- 試験: `tests/quantityTable.test.ts`、`tests/quantityXlsx.test.ts`、`e2e/quantity-table.annotate.spec.ts`、そのほか「内訳書の位置」列（`.quantity-table-breakdown`）を前提にしている試験（`e2e/quantity-conditions.annotate.spec.ts` など）
- 変えない: `src/core/*`、CSV、Excel の「明細」「細目別内訳」「別紙明細」シート

## 変更内容

### 1. 「内訳書の位置」列をなくす

- 画面の集計表から「内訳書の位置」列（`quantity-table-breakdown`）を消す。「摘要」列は残す（全図面の直後、固定しない列のまま）。
- Excel の集計表シートからも「内訳書の位置」列を消す（摘要は残す）。
- `QUANTITY_TABLE_METADATA_HEADERS` は `['摘要']` にする。列幅・colSpan・表の幅の計算を合わせる。`quantityTableFixtureText` の `position`・`positionTitle` は使わなくなるので消してよい。

### 2. 内訳書の構成の見出しで並べる

`projectQuantityTable` の「内訳書の位置でまとめる」（`display.groupByBreakdown`）がオンのときの区分の行を、1行の「編 種目／科目／中科目」から、**段ごとの見出しの行**に変える。

- 見出しの段（`QuantityTableRow` に `level?: 0 | 1 | 2 | 3 | 4` を足す。分類でまとめるときは付けない）:
  - level 0: 編（`book`。例: 電気設備）
  - level 1: 種目（`section`。例: 庁舎）
  - level 2: 科目（`subject`。例: 電灯設備）
  - level 3: 中科目（`middle`。無ければこの段の見出しは出さない）
  - level 4: 細目（`item`）。**その細目がマスタで別紙明細の行（`row.separate`）のときだけ**出す。文字は `${item}（別紙明細）`。分電盤のように細目そのものが項目のときは出さない。
- 項目の並びが変わるたびに、変わった段から下の見出しを出す（上の段が変われば下の段も出し直す）。`breakdownXlsx.ts` の `bookChanged`／`sectionChanged`… と同じ考え方。
- 並べ方: 項目ごとに、(1) 中科目の群のマスタ順、(2) 群の中の細目の行のマスタ順、(3) `fixture.order`。マスタに無い位置は、同じ段の中で後ろ（群の中の項目の `order` の最小値の順）。位置の無い項目は最後に、見出し `（内訳書の位置なし）`（level 0）の下に `order` の順。
- マスタの順の情報: 今の `breakdownGroupOrder`（群の鍵 → 順）を、`breakdownOrder?: { groups: ReadonlyMap<string, number>; rows: ReadonlyMap<string, { index: number; separate: boolean }> }` に置き換える。`rows` の鍵は `JSON.stringify([book, section, subject, middle ?? '', item])`、`index` は `breakdownEntries()` の並び、`separate` は `entry.row.separate === true`。作る関数 `createQuantityBreakdownOrder(entries)` を `QuantityTable.tsx` から export する（引数は `breakdownEntries()` と同じ形の配列。マスタを静的に import しないため、今と同じく遅延読込した結果を渡す）。
- **表のどの項目にも内訳書の位置が無いときは、オンでも今の分類でまとめる**（位置を使わない人の表が「（内訳書の位置なし）」だけにならないように）。
- 施工条件の行（`conditionKey`）・展開・「未設定だけ」の絞り込みは今と同じ。見出しの行の下に項目が1つも残らない見出しは出さない（絞り込みで空になった段は出ない）。

### 3. 「内訳書の位置でまとめる」の既定をオンに

- 覚えておく鍵を `karu-pdf:quantity-table-group-by-breakdown-v2` に変え、値が無いときは**オン**にする（第3版までの鍵は読まない）。チェックを外せば今までどおり分類でまとめ、その状態を覚える。
- オンのとき、集計表を開いたら `import('../core/breakdownMaster')` でマスタの順を読み込む（今と同じ遅延読込。読み込むまでは分類でまとめた形で出す）。通常の閲覧では読み込まない。

### 4. 画面の見出しの行

- 見出しの行は今の区分の行（`quantity-table-category`）と同じ作り（固定列6列ぶんを結合した `th`、残りは空の `td`）。`data-level` に段を入れ、CSS で段ごとに字下げする（level 0・1: なし、2: 1em、3: 2em、4: 3em。level 0 は太字）。文字は字下げの空白を含めない。
- React の `key` は段と位置の全体から作り、重ならないようにする。

### 5. Excel の集計表シート

- 画面と同じ並び・同じ見出しの行を書く。見出しの文字は、`breakdownXlsx.ts` と同じく全角空白で字下げする（level 2: `　`、3: `　　`、4: `　　　`）。見出しの行は今の区分の行と同じ書式（`category`、固定列の範囲を結合）。
- 表の上の条件の文（「内訳書の位置でまとめる」）は今と同じ。

### 6. 試験

- `tests/quantityTable.test.ts`: 位置でまとめたときの見出しの行の並びと段（編→種目→科目→中科目→別紙明細の細目→項目。分電盤のような細目そのものの項目には細目の見出しが出ない）、マスタ順、マスタに無い位置、位置なしは最後、どの項目にも位置が無ければ分類でまとめる、絞り込みで空になった見出しは出ない。オフでは今と同じ。
- `tests/quantityXlsx.test.ts`: 集計表シートの列から「内訳書の位置」が消える。見出しの行が全角空白の字下げで入る。既存の期待値の列の位置を直す（直した箇所を報告）。
- e2e（`e2e/quantity-table.annotate.spec.ts` の内訳書の試験を直す）: 分電盤 L-1 を電灯分岐に追加して集計表を開くと（既定でオン）、見出しの行に `電気設備`・`庁舎`・`電灯設備`・`電灯分岐` が順に出て、その下に L-1 の行。「内訳書の位置」列は無い。チェックを外すと分類の見出し（盤類）に戻り、再読み込みしても外れたまま。

## 禁止事項

- 数量の計算・絞り込み・展開・CSV を変えないこと。
- `breakdownMaster` を通常の画面の塊に入れないこと（遅延読込のまま）。
- 依存パッケージを足さないこと。指定外のファイルを変えないこと。

## 検証項目（Claude Code が実行する）

- [ ] 型検査、単体（全件）、`npm run build` の後 e2e（集計表・数量拾い関係・`format-panel-width`・`review-cursor`・内訳書）
- [ ] 画面と Excel で、添付と同じ見出しの並びを確認
