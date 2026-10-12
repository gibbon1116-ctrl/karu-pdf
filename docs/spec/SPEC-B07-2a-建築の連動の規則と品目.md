# SPEC-B07-2a: 建築の連動の規則（RC・形）と、t・1式の細目を連動の項目として作る

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 自動の元の条件の拡張、根切りの余幅の基準どおりの計算、品目一覧と標準マスタからの追加での規則の当て方にまたがる

---

## 背景

B07-1 で RC 部材（`CountFixture.rc`）と連動の `rc`・`shape` ができた。建築の標準の規則は Claude が `src/core/breakdown/linkRules.ts` に足した（**変えないこと**）:
- `LinkRule.kind` に `'rc' | 'shape'`、`LinkRule.rc`（`output`・`basis`）、`LinkRule.shape`（`output`・`heightM`・`clearanceM`）。
- `LinkAutoSources.rcKinds`（RC 部材の種類。空の配列 = RC 部材の項目すべて）。
- 規則: 異形鉄筋（所要数量）・鉄筋加工組立・鉄筋運搬・ガス圧接・コンクリート（基礎部／軸部）・型枠（基礎部／地上軸部）・型枠運搬・根切り・埋戻し・建設発生土・延べ面積（墨出し・養生・整理清掃後片付け）・外部足場・安全手すり・幅木・ガラス・シーリング。
- `src/core/breakdown/buildingDetails.ts` に土工の別紙明細（すきとり・根切り・床付け・埋戻し・盛土・構内敷きならし）。

## 対象

- 変更: `src/core/fixtureLink.ts`、`src/core/catalog.ts`、`src/app/FixturePresetDialog.tsx`
- 試験: `tests/fixtureLink.test.ts`・`tests/catalog.test.ts` に追記、`e2e/linked-fixtures.annotate.spec.ts` に1件
- 変えない: データ、`rcMember.ts`・`shapeMetrics.ts`、項目の編集画面（B07-2b）

## 1. 自動の元の `rcKinds`（`fixtureLink.ts`）

- `auto.rcKinds` があれば、元の項目は `rc` を持ち、配列が空でなければ `rc.kind` がその中にあること（ほかの条件と AND）。検査・保存・読込に入れる（値は 7 種の中、7 件まで）。

## 2. 根切りの余幅（`fixtureLink.ts` の `shape.output === 'excavation'`）

- `shape.marginM` が無いとき、余幅を基準どおりに計算する: `余幅 = clearanceM（既定 0.5）＋ 法の係数 × 深さ ÷ 2`。法の係数は 深さ 1.5m 未満 0、1.5m 以上 5.0m 未満 0.3、5.0m 以上 0.6（公共建築数量積算基準 第3編）。`marginM` があればそれを使う（今のまま）。
- `shape.clearanceM`（0〜5）を型・検査・保存に足す。
- 根拠の `note` に使った余幅（例: `余幅 0.5m（ゆとり 0.5、法 0）`）。

## 3. t・1式の細目を連動の項目として作る（`catalog.ts`）

- 細目の行・別紙明細の明細のうち、単位が拾えない（`kindForUnit` が無い）もので、`linkRuleForDetail(名前)` の規則があるものは、規格（option）を 1 つ持つ品目にする（`kind: 'count'`、`method: 'click'`。単位と数量は連動から出る。B06 の搬入と同じ考え方）。規則の無いものは今のまま（拾えない）。

## 4. 標準マスタから追加するときの規則（`FixturePresetDialog.tsx`）

- 規則の当て方: 追加する項目の名前に規則があるとき、
  - 規則の種類が `factor`・`mass`・`carry`（B06 までの規則）なら、今と同じく必ず連動の項目として作る。
  - 規則の種類が `rc`・`shape`（建築の規則）なら、次のどちらかのときだけ連動の項目として作る:
    - (a) 細目・明細の単位が拾えない（t・式 など。`kindForUnit` が無い）。
    - (b) 規則の `auto` に条件があり（`rcKinds` など）、今ある項目（追加する項目を含む）に当たるものが 1 つ以上ある。
    - どちらでもなければ、ふつうの（拾う）項目として作る（例: RC 部材の無い図面で「普通コンクリート（軸部）」を足すと、体積を拾う項目になる。「延べ面積」の墨出し（㎡）も、元を選ぶまでは面積を拾う項目になる）。
- 連動の中身: `kind`、`auto`（規則のまま）、`rc`（規則の `rc`。`rebar` で `basis` があればそれ）、`shape`（規則の `shape`）、`factor`（規則にあれば）。`sources: []`。
- 状態の文は今のまま（付けた規則の名前を並べる）。

## 5. 試験

- `fixtureLink.test.ts`: `rcKinds` の当たり（空 = RC 部材すべて、種類の絞り込み、RC 部材でない項目は当たらない）。根切りの余幅（深さ 1.0m → 余幅 0.5、2.0m → 0.5 ＋ 0.3×2/2 = 0.8、6.0m → 0.5 ＋ 0.6×6/2 = 2.3、`clearanceM` 0.1、`marginM` を指定したとき）。4m×3m・深さ 2.0m の根切り: (12 ＋ 14×0.8 ＋ 4×0.64) × 2 = 51.52 ㎥。
- `catalog.test.ts`: 建築の「異形鉄筋」（t）が規格を 1 つ持つ品目になる。規則の無い t の細目（例: 形鋼）は今のまま拾えない。
- e2e（`e2e/linked-fixtures.annotate.spec.ts`）: `page.evaluate` で RC 部材の項目（床板、`rc: { kind: 'slab', thicknessMm: 150, bars: [{ role: 'x', size: 'D13', spacingMm: 200, layers: 2 }, { role: 'y', size: 'D13', spacingMm: 200, layers: 2 }] }`、面積で拾う）を作り、4m×3m の床を 1 枚拾う。標準マスタの「内訳書から選ぶ」→ 建築 → 鉄筋 → 躯体 → 異形鉄筋 を追加 → 連動の項目（`link.kind === 'rc'`）で、全図面がおよそ `0.35`（t）。RC 部材が無い文書で「普通コンクリート（軸部）」を追加すると、ふつうの体積の項目（`link` なし）になる。

## 禁止事項

- データ（`linkRules.ts`・`buildingDetails.ts`）を変えないこと。電気・機械の規則（factor・mass・carry）の当て方を変えないこと。
- 依存パッケージを足さないこと。指定外のファイルを変えないこと。

## 検証項目（Claude Code が実行する）

- [ ] 型検査、単体（全件）、`npm run build` の後 e2e（連動・内訳書）
