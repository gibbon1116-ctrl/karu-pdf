# SPEC-U1: 既存の標準マスタの品目を、内訳書標準書式の品目に吸収する（電気設備・機械設備）

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 標準マスタの一覧の作り方（catalog.ts）を変え、両タブ・検索・既存項目の照合・試験に波及するため既定の sol-high。

---

## 背景

利用者の依頼と決定（2026-10-14）:

- 「規格から選ぶ」と「内訳書から選ぶ」で出る品目が違う。共通にし、重複は消す。
- 決定（調査 非公開の調査資料 §7 の1・2）:
  - 既存の標準マスタの品目（記号と規格を持つ。ダウンライト DL、大便器 WC、VA 管 等）は、内訳書の品目にまとめる。
  - 記号・規格はその品目の選択肢にする。既存の品目は一覧から消す。
  - 品目名は書式どおりにする（ダウンライト → ＬＥＤ照明器具・記号 DL、VA → 給水管・管種 VA）。
  - 既に PDF にある項目の名称は変えない。
  - 書式に行がない品目は、標準マスタの追加行として残す。

Claude がデータを作成済み:

- `src/core/breakdown/masterAbsorption.ts`: `MASTER_ABSORPTIONS`（型の説明はファイルの注釈）。
  - 電気設備 28件・機械設備 45件。全件、吸収先が今の一覧にあることを確認済み。
  - 照明器具の7種・非常用照明・誘導灯・煙感知器・熱感知器・スピーカ・カメラは、今の `ELECTRICAL_ROW_MASTERS` の重ね合わせを置き換える。
- `src/core/breakdown/mechanicalGroups.ts`: 書式に行がない9行を追加（`note: SUPPLEMENT_ROW_NOTE`）。
  - フレキシブルダクト×2、天井換気扇、壁付換気扇、排気ガラリ、流し（衛生器具設備・組）、給湯器、消火器、スプリンクラーヘッド。
- `src/core/breakdown/catalogMap.ts`: `MECHANICAL_ROW_CATEGORY` にフレキシブルダクト→ダクト、排気ガラリ→制気口。
- `src/core/related/rules.ts`: 消える品目を指していた E-035・M-010・M-090 の提案先を、書式の品目（スイッチ・配管保温）に直した。

## 変更内容

### 1. 一覧の作り方（`src/core/catalog.ts` の `catalogIndex`）

今までどおり masters・行の品目・明細の品目を作った後、`MASTER_ABSORPTIONS` を順に当てる。

**吸収先の品目 T を解く**（同じ編 `field === master[0]`）:

- `{ row, unit? }`: `key` が `row:` で始まり、`name === row`（unit があれば `unit === unit`）の品目すべて。
- `{ detailRow, detail }`: `key` が `detail:` で始まり、`breakdownItem === detailRow` かつ `name === detail` の品目すべて。
- 吸収先が1件も無いときは、例外にする（データの誤り。試験で検出する）。

**既存の品目 M**は `masterKey(...master)` の品目。

**`mode` が 'merge'（既定）のとき**、M の各規格 o を、各 T の規格の末尾に次の形で足す:

- `key`: `o.key`（標準マスタの規格の鍵。T の中で重複しない）
- `label`・`code`・`spec`・`kind`・`method`・`defaults`・`conditions`・`convert`: o のまま
- `name`: **T.name**（書式の名称）
- `summary`: 次を合わせたもの（値が空なら入れない）
  - `absorption.summary`
  - `codeLabel` があれば `{ [codeLabel]: o.code }`
  - `specLabel` があれば `{ [specLabel]: specValue === 'stripPhi' ? o.spec から先頭の φ を除いた値 : o.spec }`（o.spec が無ければ入れない）
- `formerName`: **M.name**（新しい任意の欄。`CatalogOption.formerName?: string`「吸収前の品目名」）

**`mode` が 'drop' のとき**は規格を足さない。

**どちらのときも**:

- T の `formerNames`（新しい任意の欄 `CatalogItem.formerNames?: readonly string[]`）に M.name を足す。
- T の `search` を作り直し、formerNames・足した規格の label・spec を含める（「ダウンライト」「角ダクト」「VA」で検索すると吸収先が出る）。
- M を `items`・`byKey` から除く。`masters` には残してよい（明細の `master` の重ね合わせ＝電線・ケーブル等が使う。吸収した品目はそこで使われていない）。

### 2. 内訳書タブ（`catalogItemsForBreakdownRow`）

- `ELECTRICAL_ROW_MASTERS` の重ね合わせ（`#row:` の鍵の品目を作る処理）を消す。行の品目（吸収済み）だけを返す。
- `src/core/breakdown/electricalDetails.ts` の `ELECTRICAL_ROW_MASTERS` を削除する（Claude のデータだが、この SPEC で削除してよい）。
- `defaultSymbolFromCode` が使われなくなれば、欄と関連の処理（`catalogPresets`・`BreakdownPicker.tsx`）を消す。

### 3. 規格の表示（`src/app/CatalogChooser.tsx`）

- `formerName` のある規格は、`formerName` ごとの見出しの群にまとめる（今の建築の群と同じ形。`role="group"`、`aria-label="{formerName}の規格"`、`<h4>{formerName}（件数）</h4>`）。
- T 自身の規格（formerName なし）は群の外に先に出す。建築の今の群の作り方は変えない。

### 4. 既存の項目の照合

`catalogConditionsForFixture` で、規格の一致（`sameOption`）は `option.name === f.name` に加えて、`option.formerName === f.name` も一致とする。

- 既存の PDF の「ダウンライト」（記号 DL・規格 φ100）の項目も、施工条件の候補が今と同じに出るようにする。

### 5. 代表の位置

- `representativeBreakdownPosition` は、吸収した品目（M）を返さなくなるだけでよい。
- `REPRESENTATIVE_POSITION_ROWS` の電気・機械の行は残してよい（使われなくなる）。

## 試験

- **単体（新規）`tests/catalog.absorption.test.ts`:**
  - `MASTER_ABSORPTIONS` の全件で、M が一覧（`catalogItems()`）に無い。吸収先 T が1件以上あり、'merge' なら T に M の規格が全部ある（`formerName === M.name`）。
  - 「ＬＥＤ照明器具」（個）の規格に DL の規格がある。`catalogPresets` で作った項目は、名称「ＬＥＤ照明器具」・記号 DL・規格 φ100・摘要の記号 DL。
  - 「給水管」の規格に VA 20A がある。作った項目の摘要に 管種「水道用硬質塩化ビニルライニング鋼管（SGP-VA）」・呼び径「20A」。
  - 「スパイラルダクト」の RD φ200 の項目の摘要の口径が「200」。
  - 「大便器」の WC の項目の単位が 組、摘要の記号等が WC。
  - 「コンセント」（別紙明細）の C2E の項目の摘要の種類が「2P15A×2 接地極付」。
  - 長方形ダクト（drop）: 規格の数が今と同じ。一覧に「角ダクト」が無い。`searchCatalog('角ダクト')` で長方形ダクトが出る。
  - `searchCatalog('ダウンライト')` で ＬＥＤ照明器具が出る。
  - 追加行（流し 組・天井換気扇 等）が一覧と内訳書タブ（`catalogItemsForBreakdownRow`）の両方に出る。
  - `catalogConditionsForFixture({ name: 'ダウンライト', code: 'DL', spec: 'φ100', category: '照明器具' })` が今と同じ候補を返す。
  - 電気設備・機械設備で、「規格から選ぶ」の品目の鍵の集合と、全行の `catalogItemsForBreakdownRow` の品目の鍵の集合が同じ。
    - 明細の `master` の重ね合わせの鍵は `#` の前で比べる。
    - 0件の行（1式・別紙明細で明細が無い行）は U2 で扱うので、この比較では無視してよい。
- **既存の試験:** `tests/catalog.test.ts`・`tests/fixtureConditions.test.ts`・`tests/quantityMaster.test.ts`・`e2e/breakdown-master.annotate.spec.ts` 等で、吸収した品目（電気・機械の `master:` の鍵、`defaultSymbolFromCode`、`ELECTRICAL_ROW_MASTERS`）を前提にしている所は、新しい形に直す。
  - 意図が同じ試験は残す（例: DL を選んだら記号が DL になる → ＬＥＤ照明器具の DL の規格で確かめる）。
  - 直した試験の一覧を報告に書く。
  - 渡された抜粋に無い試験は、Claude が実行して失敗を渡すので、今回は直さなくてよい。

## 受入条件・停止条件

- 電線・ケーブル・電線管・ラック・建築・仮設・土工の品目と、その試験の結果は今と同じ。
- 保存形式（CountFixture）は変えない。既に PDF にある項目の名称・記号・規格は変えない。
- 戻し方: この段階のコミットの revert。

## 禁止事項

- `masterAbsorption.ts`・`mechanicalGroups.ts`・`catalogMap.ts`・`rules.ts` のデータを変えない（`ELECTRICAL_ROW_MASTERS` の削除を除く）。
- 外部通信・`https://` を含む文字列を足さない。git 操作をしない。
