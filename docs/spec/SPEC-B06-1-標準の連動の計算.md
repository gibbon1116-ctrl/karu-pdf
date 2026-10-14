# SPEC-B06-1: 標準の連動の計算（自動の元・機器搬入・発生材）

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 保存形式の拡張、連動の計算への新しい種類（区分と補正率の表引き）と自動の元の解決、既存の計算・循環判定との整合にまたがる

---

## 背景

計画: 非公開の調査資料。データは Claude が作成済み（変えないこと）: `src/core/breakdown/linkData.ts`（`WASTE_DENSITIES`・`CARRY_*`・`CONDUIT_MASS_KG_PER_M`）、`src/core/breakdown/linkRules.ts`（`LinkAutoSources`・`LINK_RULES`）。

## 対象

- 変更: `src/core/fixtureLink.ts`（型・検査・計算）、`src/core/countFixtures.ts`（単位: 搬入は t）
- 試験: `tests/fixtureLink.test.ts`（足す。末尾に追記する形の EDIT で）
- 変えない: データの2ファイル、`quantityIndex.ts`（`computeLinks` の呼び方は今のまま）

## 1. 型と検査

- `FixtureLink` に足す:
  - `auto?: LinkAutoSources`（`linkRules.ts` の型。分類・語は各 40 字・20 件まで、`condition` は `validCondition`、`kinds` は4種の中、`minMassKg` は 0〜1e6）。
  - `kind` に `'carry'` を足す。`carry?: { class: 'heavy' | 'bulky'; alone?: boolean }`（`kind === 'carry'` のときだけ、必須）。
- `sources` は今のまま 0〜50（`auto` と合わせて元になる）。`'carry'` の元は個数の項目だけ（違えば計算時に無視して警告）。
- `fixtureLinkError` を合わせて直す。`parseCountFixtures` の詰め直しにも足す。

## 2. 元の解決（auto）

- `computeLinks` で、連動項目ごとの元 = 手で選んだ `sources` ＋ `auto` に当たる項目（自分自身・連動項目・手で選んだ項目は除く）。auto の元は `{ itemId, factor: rule の factor（link に無ければ 1）}` として扱い、`auto.condition` があれば `conditions: [auto.condition]` の絞り込みを付ける。
- 当たりの条件（すべて満たす）: `categories` があればそのどれか、`nameIncludes` があれば名称にどれかを含む、`condition` があれば項目の `conditions` にその条件がある、`kinds` があれば `quantityKind` がそのどれか、`minMassKg` があれば `attributes.massKg >= minMassKg`。
- 循環の判定（強連結成分）では、auto の元は連動項目を含まないので、今のままでよい。
- 根拠 `sources` に auto の元も入れ、`auto: true` を付ける（`LinkBasisSource` に `auto?: boolean` を足す）。

## 3. 機器搬入・搬出（`kind: 'carry'`）

元の個数の項目ごとに:
- 単体質量 `m = attributes.massKg`。無い → 0 として警告 `${名称}の質量が未設定です。`。`m < CARRY_MIN_MASS_KG` → 数えない（警告なし。根拠には小計 0 で `100kg未満` と分かるよう `note` を付ける — `LinkBasisSource` に `note?: string` を足す）。
- 容積 `v = 幅×奥行×高さ`（mm → ㎥）。3つのどれかが無い → 区分できないので数えず、警告 `${名称}の外形（幅・奥行・高さ）が未設定です。`。
- 区分: `m / v >= CARRY_HEAVY_DENSITY_KG_PER_M3` なら重量品、それ以外は容積品。連動項目の `carry.class` と違う区分の元は数えない（根拠に `note: '容積品'` などで残す）。
- 補正率: 重量品は `CARRY_HEAVY_FACTORS` の `m <= maxKg` の最初の値（15,000kg 超は最後の値と警告 `${名称}は補正率の表（15,000kg）を超えます。`）。容積品は `CARRY_BULKY_FACTORS` の `m/v < belowKgPerM3` の最初の値（どれにも当たらなければ 1.00）。
- 値（元の行ごと）: `元の行の value（個数）× m / 1000 × 補正率 × (carry.alone ? CARRY_ALONE_INCREASE : 1)`。根拠の `unitMassKg` に m、`factor` に補正率（単独搬入の増しを含む）を入れる。
- 単位は t（`quantityUnit`・`quantityDecimals`・`quantityOutputKind` は `'mass'` と同じ扱い。`countFixtures.ts` で `link.kind === 'carry'` を mass と同じにする）。切り上げはしない。

## 4. 発生材の質量の既定（電線管）

- `kind: 'mass'` の元の単位質量が無いとき（`unitMassKg` も `massKg` も無い）、元の項目の `${code}${spec}`（空白を除く）または `code` が `CONDUIT_MASS_KG_PER_M` にあれば、その値を使う（警告は出さず、根拠の `note` に `JIS C 8305 の質量` と書く）。
- 見かけ比重: `link.densityTPerM3` があればそれ（今のまま）。無く、連動項目の `attributes.wasteType` が `WASTE_DENSITIES` の `type` にあれば、その値を使う（根拠の合計の行に使った値が分かるよう、`LinkResult` に `densityTPerM3?: number` を足す）。

## 5. 試験（`tests/fixtureLink.test.ts` に追記）

- auto: 分類「照明器具」の DL・SL（個数）と CV（長さ・分類 電気）→ `器具取付`（auto categories 照明器具, kinds count）が DL＋SL の合計。あとから分類「照明器具」の項目を足すと元に入る。auto と手で選んだ元が重ならない。連動項目は auto の元にならない。
- auto の condition: `撤去（廃棄）` を候補に持つ項目だけ、その条件の行だけ。
- carry: 盤 A（massKg 1,200、外形 800×400×1,800 mm → 2,083 kg/㎥ 重量品、補正率 0.85）2 面 → `2 × 1.2 × 0.85 = 2.04 t`。単独搬入 ×1.3。容積品の機器（massKg 300、外形 1000×1000×1500 → 200 kg/㎥ → 「200 未満」に当たらず 300 未満 1.70）→ class bulky の項目に `0.3 × 1.70 = 0.51 t`、class heavy の項目には入らない。80kg の機器は数えない。外形の無い機器は警告。
- 電線管の質量の既定: 配管撤去 E25（code 'E', spec '25'、10 m、撤去（廃棄））→ `10 × 0.716 / 1000 = 0.00716 t`、wasteType 金属くず → ㎥ `0.00716 / 1.13`。
- 検査: `carry` の無い `kind: 'carry'`、範囲外の `auto` は誤り。往復（parse/serialize）。

## 禁止事項

- データの2ファイルを変えないこと。B05 の計算の結果（auto・carry を使わない連動）を変えないこと。
- 依存パッケージを足さないこと。指定外のファイルを変えないこと。

## 検証項目（Claude Code が実行する）

- [ ] 型検査、単体（全件）、e2e（連動・集計表）
