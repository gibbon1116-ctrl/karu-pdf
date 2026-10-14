# SPEC-B05-1: 連動項目のデータと計算

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: PDF に保存する項目の形式の拡張、数量の索引への新しい計算段の組込み（循環・切り上げ・上書き）、項目の削除との整合にまたがる

---

## 背景

計画: 非公開の調査資料（決定 §10）。連動項目は、図面に印を置かず、ほかの項目の拾いから数量を計算する項目。この SPEC はデータ・計算・索引・店（store）の最小限まで。画面は B05-2、集計表・Excel は B05-3。

## 対象

- 新規: `src/core/fixtureLink.ts`、`tests/fixtureLink.test.ts`
- 変更: `src/core/countFixtures.ts`（型・読込・保存の検査）、`src/core/quantityIndex.ts`（計算段）、`src/editor/AnnotationStore.ts`（元の項目の削除、連動項目に拾いを作らない）
- 試験: `tests/quantityIndex.test.ts` に足す
- 変えない: 画面のファイル、集計表、Excel、CSV

## 1. データ（`fixtureLink.ts`、`CountFixture.link`）

```ts
export interface FixtureLinkSource {
  itemId: string
  factor?: number          // 係数。既定 1。0 < factor <= 10000
  perM?: number            // 「÷ 間隔」。0 < perM <= 1000。factor と同時に持てない
  conditions?: string[]    // 元の施工条件の絞り込み。各 validCondition、30件まで。空配列は持たない（省く）。'' は「未設定」を表す
}
export interface FixtureLink {
  kind: 'factor' | 'mass'
  sources: FixtureLinkSource[]                       // 0〜50。itemId は重複不可・自分自身は不可
  condition?: { mode: 'fixed'; value: string }       // 無し = 元の施工条件を引き継ぐ（既定）。value は validCondition
  rounding?: 'total' | 'each' | 'none'               // 無し = 'total'
  densityTPerM3?: number                             // kind 'mass' のときだけ。0 < x <= 30。無ければ t のまま
  override?: { value: number; note?: string }        // 0 <= value <= 1e9、note は 200 字まで・改行なし
}
```

- `CountFixture` に `link?: FixtureLink` を足す。
- `export function fixtureLinkError(f: Pick<CountFixture, 'id' | 'link' | 'convert'>): string | undefined`: 上の形と範囲の検査。**連動項目は `convert` を持てない**（`link` と `convert` の両方があれば誤り）。文は日本語（例: `連動の元は50項目までです。`、`連動の係数は0より大きい数で入れてください。`）。
- `parseCountFixtures`: `link` の形が誤りなら `link` だけを捨てて項目は読む（数量を失わない）。正しければ詰め直して持つ（余計な項目を持ち込まない）。
- `serializeCountFixtures`: `fixtureLinkError` が誤りを返せば保存を止める（今の `fixtureBreakdownError` と同じ扱い）。元の項目が存在しない・循環は**保存を止めない**（計算時に誤りとして扱う。下の 3.）。
- 古い版では `link` は読まれない（数量 0 の項目に見える）。

## 2. 計算（`fixtureLink.ts`）

```ts
export interface LinkSourceEntry { itemId: string; annotationId: string; pageIndex: number; floor?: string; room?: string; value: number; condition?: string; part?: RoutePart }
export interface LinkBasisSource { itemId: string; quantity: number; factor?: number; perM?: number; unitMassKg?: number; subtotal: number }
export interface LinkResult {
  entries: LinkSourceEntry[]        // 連動項目の行（itemId は連動項目の id）
  total: number                     // 切り上げ・上書きの後の合計
  computed: number                  // 上書き前の合計（切り上げ後）
  sources: LinkBasisSource[]        // 根拠
  error?: string                    // 設定の誤り（元が無い・循環）
  warnings: string[]                // 質量が無い元 など
  overridden: boolean
}
export function computeLinks(fixtures: readonly CountFixture[], entriesOf: (itemId: string) => readonly LinkSourceEntry[]): Map<string, LinkResult>
```

- 対象は `link` を持つ項目。**連動項目が無ければ空の Map を返し、何もしない。**
- 順番: 連動項目を元にする連動があるので、元 → 先の順に計算する（トポロジカル順）。**循環**に入る項目は計算せず `error: '連動の元が循環しています。'`、合計 0。元の項目が無い元は無視し `error: '連動の元の項目が見つかりません。'`（ほかの元は計算する。誤りでも数量は残りの元から出す）。
- 元の行: 普通の項目は索引の行（換算後の `value`）、連動項目は計算済みの `entries`。
- 元の行ごとの値:
  - `factor`: `value × factor`（既定 1）
  - `perM`: `value ÷ perM`
  - `mass`: `value × 単位質量kg ÷ 1000`（t）。`densityTPerM3` があれば さらに `÷ densityTPerM3`（㎥）。単位質量は元の項目の `attributes.unitMassKg`、無ければ（個数の項目のとき）`attributes.massKg`。どちらも無い元は 0 とし、`warnings` に `${元の項目の名称}の質量が未設定です。`。`mass` の元にも `factor` を掛けられる（既定 1）。
- 施工条件の絞り込み: 元の `conditions` があれば、元の行の `condition ?? ''` がその中にある行だけ。
- 連動項目の行の施工条件: `link.condition` が無ければ元の行の `condition` をそのまま、`fixed` なら `value`。行の `annotationId`・`pageIndex`・`floor`・`room`・`part` は元の行のまま（集計表の図面別・階別と「位置へ移動」がそのまま使える）。
- 切り上げ（`rounding`）:
  - `'total'`（既定）: 行は丸めず、**合計**を `Math.ceil(合計 - 1e-9)` にする（施工条件別の合計も、それぞれ同じく切り上げる）。
  - `'each'`: **元の拾い（`annotationId`）ごと**に、その拾いの行の合計を切り上げ、差分を行に足す（行の値を、拾いごとの合計が整数になるように比例して増やす）。
  - `'none'`: 丸めない。
  - 切り上げは `perM` を使う元がある項目、または連動項目の単位が個数（`quantityKind === 'count'`）のときだけ。それ以外（m・㎡・t など）は `rounding` にかかわらず丸めない。
- 上書き: `override` があれば `total = override.value`、`overridden = true`、`entries` は空（図面別・階別には出さない）。`computed` は上書き前の値。
- 根拠 `sources`: 元ごとの `quantity`（絞り込み後の元の合計）、係数・間隔・単位質量、`subtotal`（その元からの寄与、丸め前）。

## 3. 索引（`quantityIndex.ts`）

- `QuantityIndex.build` の最後で、`fixtures` に `link` を持つ項目があるときだけ `computeLinks` を呼び、結果の `entries` を今の `add` で入れる（換算は掛けない。連動項目は `convert` を持たない）。
- 切り上げ・上書きで行の合計と違う合計になる項目は、`total(itemId)` と `byCondition(itemId)` の合計をその値にする（`byPage`・`byFloor` などは行の合計のまま。上書きのときは空）。
- 新しい公開メソッド: `linkResult(itemId): LinkResult | undefined`（根拠の表示用。B05-2・B05-3 で使う）。
- 連動項目の行は `countEntriesOnPage`（図面の印の数）に入れない。
- 連動項目が無い文書では、今と同じ計算だけ（追加の繰り返しをしない）。

## 4. 店（`AnnotationStore.ts`）

- 連動項目（`link` を持つ項目）に対して、印・線・面などの拾いを**作らない**: `create`・`createCountMarks`・`reassignCounts`・`setCountComponents`・経路の線要素の追加などで、項目が連動項目なら作らず・変えず（`createCountMarks` は `'連動の項目は図面に拾いません'` の Error、そのほかは何もしない／既存の失敗の文の形で返す）。
- 項目を削除する（`setCountFixtures(…, removeIds)`）とき、ほかの項目の `link.sources` からその項目を外す（同じ履歴の1回で戻る）。
- `fixtureRemovalCounts` は変えない（連動の元から外れることは B05-2 で画面に出す）。新しい公開メソッド `linkDependents(id): CountFixture[]`（その項目を元にしている連動項目）を足す。

## 5. 試験

`tests/fixtureLink.test.ts`:
- `fixtureLinkError`: 正しい形、各範囲外、`factor` と `perM` の同時、`convert` との同時、51件、重複、自分自身。
- `parseCountFixtures`/`serializeCountFixtures`: 往復。誤った `link` は捨てられ項目は残る。
- `computeLinks`:
  - 係数: 器具 DL 10 個 × 1 ＋ SL 3 個 × 2 ＝ 16。
  - ÷ 間隔: E25 10.2 m ＋ E31 4.0 m、`perM` 1.5 → 合計で切り上げ `ceil(14.2/1.5)=10`。`'each'`（別の例: E25 の拾い 3 本 3.0・3.0・4.2 m、`perM` 1.5）→ 2＋2＋3 ＝ 7。`'none'` → 9.466…。
  - 換算: 撤去の器具 5 個（massKg 12）→ 0.06 t。`densityTPerM3` 0.5 → 0.12 ㎥。質量の無い元は 0 で警告。
  - 施工条件: 引き継ぎ（元の条件別の合計がそのまま）、固定、元の絞り込み（露出だけ）。
  - 連鎖: A（拾い）→ B（連動）→ C（B を元）。循環 B↔C は両方 誤り・0。元が見つからない。
  - 上書き: total は上書き値、computed は計算値、entries は空。
  - 連動項目が無ければ空の Map。
- `tests/quantityIndex.test.ts`: 連動項目の `total`・`byCondition`・`byPage`・`byFloor` が上の規則どおり。`linkResult` の根拠。連動項目の行が `countEntriesOnPage` に入らない。
- 店（`tests/fixtureLink.test.ts` か新規の店の試験）: 元の項目を削除すると `sources` から外れ、`undo` で戻る。連動項目への `createCountMarks` は Error。

## 禁止事項

- 連動項目が無い文書の計算・数量を変えないこと。
- 画面・集計表・Excel・CSV を変えないこと。依存パッケージを足さないこと。指定外のファイルを変えないこと。

## 検証項目（Claude Code が実行する）

- [ ] 型検査、単体（変更分・全件）、e2e（数量拾い関係: `count-fixtures`・`quantity-table`・`route-composition`・`count-components`）
- [ ] 計算の時間: 連動項目 20 件・元の拾い 5,000 件で `QuantityIndex.build` の時間を、連動項目 0 件と比べて記録する
