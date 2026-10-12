# SPEC-B06-2: 標準の連動の画面（規則の選択・搬入・発生材・標準マスタからの自動）

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 項目の編集画面の連動の欄の拡張、標準マスタから追加するときの規則の自動付与、根拠の表示（画面・Excel）、e2e にまたがる

---

## 背景

計画: `docs/調査/連動B06_計画.md`。B06-1 で `FixtureLink` に `auto`（`LinkAutoSources`）・`kind: 'carry'`・`carry: { class, alone? }` が入り、計算（自動の元、機器搬入の区分と補正率、電線管の質量の既定、発生材の種類からの見かけ比重）ができた。根拠（`LinkBasisSource`）に `auto?`・`note?`、`LinkResult` に `densityTPerM3?` がある。データ: `src/core/breakdown/linkData.ts`、`src/core/breakdown/linkRules.ts`（`LINK_RULES`、`linkRuleForDetail(name)`）。

## 対象

- 変更: `src/app/FixtureDialog.tsx`、`src/app/FixturePresetDialog.tsx`、`src/app/QuantityBreakdown.tsx`、`src/app/quantityXlsx.ts`（計算根拠シート）
- 試験: `e2e/linked-fixtures.annotate.spec.ts` に足す、`tests/quantityXlsx.test.ts` に足す
- 変えない: `src/core/*`、データの2ファイル

## 1. 項目の編集画面の連動の欄

- 種類のラジオに `機器搬入・搬出（重量品・容積品の補正）`（`carry`）を足す。
- **標準の規則**: 種類の上に `<select aria-label="標準の規則">`。選択肢は `（規則を使わない）` と `LINK_RULES` の `label`。選ぶと:
  - `kind` を規則の種類に、`auto` を規則の `auto` に、係数の規則なら手で選んだ元の係数の既定（新しく選ぶ元）を `rule.factor` にする。手で選んだ元（`sources`）は残す。
  - `carry` の規則: `carry.class` を、項目の摘要に `区分` が `容積品` なら `bulky`、それ以外は `heavy`。`alone` は付けない。
  - `waste` の規則: `kind: 'mass'`。下の「発生材の種類」を出す。
  - 規則の `note` を欄の中に小さく出す。
  - 今の連動がどの規則と同じか（`kind` と `auto` が同じ）で、選択の初期値を決める。
- **自動で元にする項目**: `link.auto` があれば、その条件を文で出し（例: `分類「照明器具」・個数の項目`、`施工条件「撤去（廃棄）」の候補がある項目`、`100kg 以上`）、今当たっている項目の数と名前（5件まで＋「ほか N 件」）。ボタン `自動の選択をやめる`（`auto` を外す）。
- **搬入・搬出**（`kind === 'carry'`）: ラジオ `重量品`／`容積品`（`carry.class`）、チェック `単独搬入（補正率を30％増し）`（`carry.alone`）。元の各行に、その元の区分と補正率の見込み（`見本` の計算結果の根拠から）を出す。
- **発生材の種類**（`kind === 'mass'` のとき）: `<select aria-label="発生材の種類">` に `（指定しない）` と `WASTE_DENSITIES` の `type`（`${type}（${tPerM3} t/㎥）`）。選ぶと項目の `attributes.wasteType` を入れ、`link.densityTPerM3` を外す（種類の値を使う）。見かけ比重の入力に値を入れれば、それが優先（今のまま）。単位の表示は、見かけ比重か種類があれば ㎥、無ければ t。
  - 単位の判定（種類だけでも ㎥）は B06-1 で入った（`fixtureLinkDensity`）。`countFixtures.ts` は変えない。

## 2. 標準マスタから追加したときの自動の規則（`FixturePresetDialog.tsx`）

- 追加する項目（両方のタブ）の名称が `linkRuleForDetail(name)` に当たるとき、その項目を連動項目として作る: `link = { kind: rule.kind, sources: [], auto: rule.auto, ...(carry) }`。`carry` の規則は、その項目の摘要の `区分` の値（重量品／容積品）から `class` を決める（無ければ `heavy`）。`waste` の規則は `kind: 'mass'`（種類は未指定）。
- そうして作った項目は `convert` を持たない（連動と換算は同時に持てない）。
- 追加の後、状態の文に `連動の規則を付けました: 器具取付、機器搬入（重量品）`（付けたものがあれば）。

## 3. 根拠の表示

- 数量の内訳（`QuantityBreakdown.tsx`）の計算の根拠: 自動の元には `（自動）`、`note` があれば行の後ろに `（${note}）`。発生材で種類の見かけ比重を使ったときは、合計の行に `÷ ${densityTPerM3} t/㎥（${wasteType}）`。搬入は元ごとに `質量 ${m}kg × 補正率 ${factor}`。
- Excel の計算根拠シート: 同じ内容を備考の列に（自動、note、見かけ比重と種類、搬入の区分と補正率）。種類 `機器搬入・搬出`。

## 4. 試験

- e2e（`e2e/linked-fixtures.annotate.spec.ts` に足す）:
  1. 照明器具の分類の DL（印 2）と、分類 盤類 の盤 P-1（massKg 1200、外形 800×400×1800、印 1）を作る。標準マスタの「内訳書から選ぶ」から `器具取付` を追加 → 連動の札、全図面 2、状態の文に `連動の規則を付けました: 器具取付`。あとから照明器具の SL（印 1）を足すと 3 になる。
  2. 項目 `機器搬入`（「内訳書から選ぶ」の 搬入費、区分 重量品）を追加 → `1.02 t`（1.2 × 0.85）。編集で単独搬入にすると `1.33 t`（1.02 × 1.3 = 1.326）。
  3. 項目 `発生材処分` を追加し、発生材の種類 `金属くず` を選ぶ → 単位 ㎥。撤去（廃棄）の配管撤去 E25 を 10 m 拾うと、内訳の根拠に `JIS C 8305 の質量` と `÷ 1.13 t/㎥（金属くず）`。
- `tests/quantityXlsx.test.ts`: 計算根拠シートの備考に 自動・note・見かけ比重と種類・搬入の補正率。

## 禁止事項

- `src/core/*` とデータを変えないこと（足りない関数・型があれば報告）。
- 規則に当たらない項目の追加の動きを変えないこと。依存パッケージを足さないこと。指定外のファイルを変えないこと。

## 検証項目（Claude Code が実行する）

- [ ] 型検査、単体（全件）、`npm run build` の後 e2e（連動・内訳書・集計表）
