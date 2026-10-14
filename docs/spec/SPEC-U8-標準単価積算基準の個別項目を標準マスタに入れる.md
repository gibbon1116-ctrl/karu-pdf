# SPEC-U8: 標準単価積算基準の個別項目（利用者の CSV）を標準マスタに入れる

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 標準マスタの一覧の作り方（catalog.ts）に新しい出どころを足し、吸収・独立の品目・検索・既存の試験に波及するため既定の sol-high。

---

## 背景

利用者の依頼（2026-10-14）:

> 添付のCSVは「公共建築工事標準単価積算基準」のPDFを標準マスタに記載するために整理したものです。CSV内容を参照し、標準マスタの細目等の内容を修正または追記してください。

CSV は 15,913 行（1行 = 名称・略号・規格・摘要・施工条件の組）。Claude が群にまとめて、データを作成済み。

- `src/core/breakdown/standardMasterTypes.ts`: `StandardGroup`・`StandardTarget`（説明は注釈）。
- `src/core/breakdown/standardMasterGroups.ts`（生成）: `STANDARD_GROUPS` 985 群・規格 4,852 件。
  - **吸収先あり 549 群:** 書式の品目に規格として足す。配管は用途から行（給水管 等）を決め、管種・接合方法・呼び径を摘要に入れる。
  - **吸収先なし 436 群:** 独立の品目。
- 生成は 生成スクリプト（非公開）。結び付けの一覧は 非公開の調査資料。

## 変更内容（`src/core/catalog.ts` の `catalogIndex`）

U1 の吸収（`MASTER_ABSORPTIONS`）の後、U2 の同じ名称の行のまとめの前に、`STANDARD_GROUPS` を順に当てる（i = 群の番号、j = 規格の番号）。

### 1. 規格（option）の作り方（群 g の規格 j = `[spec, code]`）

- `key`: `std:${i}:${j}`
- `label`: `[code, spec].filter(Boolean).join(' ')`。両方空なら `''`
- `code`: code
- `spec`: spec（空なら付けない）
- `name`: 吸収先なら吸収先の品目の名称、独立なら `g.name`
- `kind`・`method`: `g.kind`・`g.method`
- `conditions`: `g.conditions`（空なら付けない）
- `formerName`: `g.name`（吸収先のとき。独立のときは付けない）
- `summary`: 次を合わせたもの（値が空のものは入れない）
  - `g.summary`
  - `g.specLabel` があり spec が空でなければ `{ [g.specLabel]: spec + (g.specSuffix があり spec が数字だけなら g.specSuffix) }`

### 2. 吸収先あり（`g.targets`）

吸収先の品目 T は U1 と同じ解き方（同じ編、`row:` は名称と単位、`detail:` は細目名と明細名）。

- **単位の確認:** T の単位と `g.unit` が同じか、両方が個数の単位（`COUNT_UNITS` のうち '式' 以外）のときだけ足す。それ以外の T には足さない。
- 足せる T が1つも無い群は、独立の品目にする（3 と同じ）。
- T の規格の末尾に 1 の規格を足す（鍵の重複は足さない）。
- T の `formerNames` に `g.name` を足す。`withSearch` で作り直す。

### 3. 吸収先なし（独立の品目）

- `key`: `std:${JSON.stringify([g.field, g.category, g.name, g.unit])}`（同じ鍵が既にあれば規格を足すだけ）
- `field`: `g.field`
- `category`: `g.category`
- `type`・`name`: `g.name`
- `unit`: `g.unit`
- `options`: 1 の規格
- `slots`: `[]`
- `breakdownItem`: 付けない
- 「規格から選ぶ」の一覧・検索に出る。内訳書の位置は代表の位置が無いので、追加するときに選ぶ（今の位置の欄）。
- 内訳書タブには出ない（書式に行が無いため）。

### 4. その他

- `catalogItemsForBreakdownRow` は変えない（吸収した規格は行の品目に入っているので出る）。
- `REPRESENTATIVE_POSITION_ROWS` は変えない。

## 試験

- **単体 `tests/catalog.standardMaster.test.ts`:**
  - 機械設備の「給水管」の規格に、formerName「水道用硬質塩化ビニルライニング鋼管(SGP-VA) (給水) ねじ接合 (管端防食継手)」・規格「20」の規格がある。
    - その規格で作った項目の摘要に、管種「水道用硬質塩化ビニルライニング鋼管(SGP-VA)」・接合方法「ねじ接合 (管端防食継手)」・呼び径「20A」。
    - 施工条件の候補に「地中配管」を含む。
  - 独立の品目「ルームエアコンディショナー (ウインド形)」（機械設備・単位 台）が一覧にあり、規格が4件。
  - 電気設備の「プルボックス」（㎡ の群）は、明細「プルボックス」（個）に足されず、独立の品目になる。
  - `STANDARD_GROUPS` の吸収先ありの群は、どれも少なくとも1つの品目に足されているか、独立の品目になっている（規格が失われない）。
  - `searchCatalog('ルームエアコンディショナー')` で出る。
- **既存の試験:** 「規格タブの鍵の集合と内訳書タブの鍵の集合が同じ」等の試験は、`std:` の独立の品目を除いて比べるように直す（独立の品目は書式に行が無いので規格タブだけに出る）。品目数の固定値も直す。直した試験の一覧を報告に書く。

## 受入条件・停止条件

- 標準マスタを開かない普段の操作の性能は今と同じ（データは標準マスタを開いたときだけ読む）。
- 保存形式は変えない。データファイルを変えない。
- 戻し方: この段階のコミットの revert。

## 禁止事項

- `standardMasterGroups.ts`・`standardMasterTypes.ts` を変えない。外部通信・`https://` を含む文字列を足さない。git 操作をしない。
