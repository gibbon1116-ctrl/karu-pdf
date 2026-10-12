# SPEC-B12-B13-1: 交差の数え上げと鉄骨の連動の計算

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 図形の交差の判定（線分どうし・同じ図面の中だけ）、保存形式の拡張（鉄骨の部材）、連動の 2 つの新しい種類、性能への配慮にまたがる

---

## 背景

計画の B12（交差の数え上げ）・B13（鉄骨）。B07 で、拾いの形の計量（`src/core/shapeMetrics.ts`）と連動の `rc`・`shape` ができた。データは Claude が作成済み（**変えないこと**）:
- `src/core/breakdown/steelData.ts`: `H_SECTIONS`（H形鋼 21 寸法: 名前・H・B・t1・t2・r・断面積・単位質量）、`sectionSurfaceM2PerM(section, 'contour' | 'box' | 'boxBeam')`、`STEEL_REQUIRED_FACTOR`（形鋼 1.05 など）。
- `src/core/breakdown/linkRules.ts` に足す規則（この SPEC の後に Claude が戻す）: 種類 `'crossing'`（`crossing: { barrierNameIncludes: string[]; includeRises?: boolean; planCrossings?: boolean }`）・`'steel'`（`steel: { output: 'mass' | 'paint' | 'fireproof'; basis?: 'design' | 'required'; surface?: 'contour' | 'box' | 'boxBeam' }`）。規則: 防火区画貫通処理・スリーブ・デッキプレート開口切断・形鋼（所要）・工場加工組立／鉄骨運搬／現場建方／溶融亜鉛めっき（設計）・錆止め塗装・耐火被覆。

## 対象

- 変更: `src/core/fixtureLink.ts`、`src/core/countFixtures.ts`（`steel` の型・読込・保存・単位）、`src/core/shapeMetrics.ts`（線の点列を持たせる）、`src/core/quantityIndex.ts`（交差・鉄骨のときも形の計量を集める）、`src/core/breakdown/linkRules.ts`（**型だけ**: `LinkRule.kind` に `'crossing' | 'steel'`、`crossing?`・`steel?` の型を足す。規則の中身は足さない）
- 新規: `src/core/crossings.ts`、`src/core/steelMember.ts`、`tests/crossings.test.ts`、`tests/steelMember.test.ts`
- 変えない: データ（steelData.ts）、画面

## 1. 線の点列（`shapeMetrics.ts`）

- `ShapeMetrics` に `pathPoints?: Array<[number, number]>`（PDF の点のまま。図面の座標で交差を見るため）と、経路の立上り・立下りの数 `riseCount?: number`（`routeRises(q)` の数）を足す。線（polyline）の拾いだけ。囲む拾いは外形の点列を `pathPoints` に（閉じる）。

## 2. 交差（`crossings.ts`、連動の `kind: 'crossing'`）

```ts
export function countSegmentCrossings(path: ReadonlyArray<[number, number]>, barriers: ReadonlyArray<ReadonlyArray<[number, number]>>): number
```
- 線分どうしが交わる点の数（端点の接触・重なり（同一直線上）は数えない）。同じ交点を 2 つの区画の線が共有するときは、それぞれ 1 と数える。
- 連動 `crossing: { barrierItemIds?: string[]; barrierNameIncludes?: string[]; includeRises?: boolean; planCrossings?: boolean }`:
  - 区画の項目 = `barrierItemIds` の項目 ＋ 名称に `barrierNameIncludes` のどれかを含む線・囲む項目（自分自身と元の項目は除く）。
  - 元の拾い（経路）ごとに、`planCrossings`（既定 true）なら **同じ図面（pageIndex）** の区画の拾いの点列との交差の数、`includeRises` なら `riseCount` を足す。値は か所（条数は掛けない: 同じ穴を通る）。
  - 連動の行の図面・階・部屋・施工条件は元の拾いのまま。
- 性能: 図面ごとに区画の線分の外接矩形で絞ってから線分の交差を見る。区画も交差の連動も無い文書では何もしない。

## 3. 鉄骨の部材（`steelMember.ts`、`CountFixture.steel`）

```ts
export interface SteelMember { section: string; customMassKgPerM?: number; customSurfaceM2PerM?: number; lengthMm?: number }
export function steelSection(member: SteelMember): { massKgPerM: number; surfaceM2PerM: (kind) => number } | undefined
export function steelMemberError(member: unknown): string | undefined
```
- `section` が `H_SECTIONS` の名前ならその値、そうでなければ `customMassKgPerM`・`customSurfaceM2PerM` が必要（自由な断面: 角形鋼管など）。
- 拾い方: 線（梁・ブレース: 拾いの長さ）、個数（柱: `lengthMm` × 個数）。
- 連動 `kind: 'steel'`、`steel: { output, basis?, surface? }`: 元は鉄骨の部材の項目。元の拾いごとに 長さ m を出し、
  - `mass`: 長さ × 単位質量 / 1000（t）。`basis: 'required'` なら × `STEEL_REQUIRED_FACTOR.section`。
  - `paint`・`fireproof`: 長さ × 表面積（`surface` の種類。既定 contour）（㎡）。
- 単位: `countFixtures.ts` で `steel` の連動の単位（mass t・桁 2・`'mass'`、paint／fireproof ㎡・桁 2・`'area'`）。
- 根拠の `note`: `H-400×200×8×13 65.4kg/m × 12.0m` など。

## 4. 試験

- `tests/crossings.test.ts`: 十字の交差 1、平行 0、端点の接触 0、折れ線が 1 本の区画を 2 回またぐ 2、別の図面の区画は数えない、立上り 2 つ ＋ 交差 1 = 3、区画の名称の絞り込み。
- `tests/steelMember.test.ts`: H-400×200×8×13 の梁 12m → 0.7848 t、所要 × 1.05 = 0.82404 t、塗装 12 × (800＋800−16)/1000 = 19.008 ㎡、箱張り（梁）12 × (800＋200)/1000 = 12 ㎡。柱 2 本 × 3.5m の H-300×300×10×15 → 0.651 t。表に無い断面で単位質量の指定が無ければ誤り。
- 交差・鉄骨の連動が無い文書では形の計量を集めない（B07 の試験と同じ考え方）。

## 禁止事項

- データを変えないこと（linkRules.ts は型だけ）。既存の連動の結果を変えないこと。依存パッケージを足さないこと。指定外のファイルを変えないこと。

## 検証項目（Claude Code が実行する）

- [ ] 型検査、単体（全件）、e2e（連動）
- [ ] 計算の時間: 経路 2,000 本・区画の線 200 本・20 図面で、交差の連動ありとなしの索引の作り直しを記録する
