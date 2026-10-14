# SPEC-B03e: 品目ごとの施工条件の候補を付ける

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 品目一覧（catalog）への規則の適用、既存の項目への後付け（一括の取り消しを含む）、データの整合の試験にまたがる

---

## 利用者の要望と決定（2026-10-11）

> 新規に追加した項目が、今まで選択したものが全て施工条件の設定ができない。事前調査を行い、各施工条件の選択肢を作成する準備を行ってください。

調査: 非公開の調査資料。決定:
- 標準単価積算基準 R8 に施工の区分がある品目は、その区分を候補にする（倍率は書かない。単価の補正は利用者が別途行う）。
- 基準で区分していない品目にも設置方法の候補を付ける。
- 照明器具・ケーブルラックは、今の候補と基準の区分の両方を残す。

データは Claude が作成済み（変えないこと）: `src/core/breakdown/conditionCandidates.ts`（`CONDITION_RULES`。上から順に見て最初に当たった規則の候補を使う）。

## 対象

- 変更: `src/core/catalog.ts`、`src/app/FixtureDialog.tsx`、`src/app/FixturePanel.tsx`
- 試験: `tests/catalog.test.ts`（足す）、e2e は `e2e/breakdown-master.annotate.spec.ts` に1件
- 変えない: `src/core/breakdown/*`、`src/core/quantityMaster.ts`

## 変更内容

### 1. 品目の候補（`catalog.ts`）

- `export function conditionCandidatesFor(item: CatalogItem): readonly string[]`: `CONDITION_RULES` を上から見て、`types` に `item.type` が含まれるか、`categories` に `item.category` が含まれる最初の規則の `conditions`。当たらなければ `[]`。
- `catalogPresets` の `conditions` を、**option の `conditions` → 施工条件の区分（`slot.condition`）の choices → `conditionCandidatesFor(item)`** の順に重複なく並べたものにする（30 件を超えたら先頭の 30 件）。今は候補が空の品目でも、規則に当たれば候補が入る。
- `export function catalogConditionsForFixture(f: Pick<CountFixture, 'code' | 'spec' | 'name' | 'category'>): string[]`: 既存の項目に当たる品目を探し、その品目で作る項目と同じ並びの候補を返す（見つからなければ `[]`）。探し方（最初に見つかったもの）:
  1. option の `code`・`spec`（無ければ空同士）・`name` が項目と同じ品目。
  2. `item.name === f.name` かつ `item.category === f.category` の品目。
  3. `item.name === f.name` の品目。
  4. `item.type === f.code`（略号が空でないとき）の品目。

### 2. 既存の項目に後から付ける

- 項目の編集画面（`FixtureDialog.tsx`）の「標準の候補を入れる」: 今の `standardConditionsForFixture(value)` に加え、`import('../core/catalog')` の `catalogConditionsForFixture(value)` も足す（今の候補の後ろに、重複なく）。文言は変えない。
- 数量タブ（`FixturePanel.tsx`）の「表示の設定・図面番号」の `<details>` の中に、ボタン `すべての項目に標準の施工条件の候補を入れる` を足す。押すと、すべての項目について「標準の候補を入れる」と同じ候補を、今の候補の後ろに重複なく足す（30 件まで）。候補が増える項目が無ければ何もしない。変更は `setCountFixtures` の1回（Ctrl+Z 1回で戻る）。終わったら `N 項目に施工条件の候補を入れました（Ctrl+Z で戻せます）` を状態の文に出す（0 件なら `足す候補はありませんでした`）。
- 既存の候補の名前・並び・既定の施工条件は変えない（足すだけ）。

### 3. 試験

`tests/catalog.test.ts` に:
1. **データの整合**: `CONDITION_RULES` の `types` の各値が、`catalogItems()` のどれかの `type` に一致する（綴りの誤りを見つけるため。一致しない値があれば試験は落とし、Claude に報告）。`categories` の各値も、どれかの品目の `category` に一致する。各 `conditions` の値は `validCondition`（`quantity.ts`）を満たし、1つの規則の候補は 30 件以下。
2. ライティングダクトの項目の `conditions` が `['直付', 'つり下げ', '埋込み']`。分電盤（盤類）が `['壁掛', '自立', '埋込']`。CR の項目が `['屋内', '屋外', '1段積', '2段積の2段目']`。ＬＥＤ照明器具が照明の 8 候補。熱感知器が `['天井付', '壁付', 'システム天井']`。ケーブル（CV）は今と同じ候補（規則に当たらない）。
3. `catalogConditionsForFixture`: 分電盤 L-1（分類「盤類」）→ `['壁掛', '自立', '埋込']`。CV 38sq-3C → CV の候補。見つからない項目 → `[]`。

e2e（1件）: `addFixturePresets('電気設備')` で入れた「照明器具」の DL と、内訳書から足した分電盤（第1版のように候補の無い状態にするため、`page.evaluate` で `conditions` を空にした項目を作るか、項目を追加で作る）について、「すべての項目に標準の施工条件の候補を入れる」を押すと、分電盤の書式欄の施工条件に「壁掛」が選べるようになり、Ctrl+Z で元に戻る。

## 禁止事項

- データを変えないこと（規則の綴りが品目と合わないときは報告する）。
- 既存の項目の候補を消したり並べ替えたりしないこと。
- 依存パッケージを足さないこと。指定外のファイルを変えないこと。

## 検証項目（Claude Code が実行する）

- [ ] 型検査、単体、e2e（内訳書・数量拾い関係）
