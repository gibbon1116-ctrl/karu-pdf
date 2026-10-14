# SPEC-R8b: 機器ごとに分ける構成要素を電気設備・建築にも広げる

## 実行モデル指定（必須）

- モデル: `gpt-6-luna`
- reasoning effort: `max`
- 選定理由: R8a の共通関数 `src/core/perEquipment.ts` 1ファイルの定義の作り方を、Claude が作ったデータの表に合わせる局所修正。規則は下に全部書いてあり判断を伴わないため luna-max。

---

## 背景

R8a（コミット 63ca115）で、構成要素の「機器据付」等を親の機器ごとに「機器据付（冷却塔）」の項目に分けた。
利用者の追加の指示: 機械設備だけでなく、電気設備・建築でも該当するものは同様にする。

Claude がデータを作成済み（コミット d64b416）: `src/core/breakdown/perEquipmentComponents.ts`

```ts
export interface PerEquipmentComponent {
  name: string
  label?: string            // 親を特定する値を入れる摘要の区分
  value?: 'name' | 'code'   // その値。'name' は親の名称、'code' は親の記号（空なら名称）
  copy?: readonly string[]  // 親の摘要から同じ区分の値を写す区分
}
export const PER_EQUIPMENT_COMPONENTS: readonly PerEquipmentComponent[]
export const PER_EQUIPMENT_COMPONENT_NAMES: readonly string[]  // 上の name の一覧
export const PER_EQUIPMENT_SUMMARY_LABEL = '名称'               // R8a 用。R8b では使わない
```

## 変更内容（`src/core/perEquipment.ts` だけ）

`equipmentDefinition(base, parent)` を次の規則にする。対象の判定（`isPerEquipmentComponent`）は今のまま（名称の正規化で `PER_EQUIPMENT_COMPONENT_NAMES` と比べる）。基の名称から表の行を引く（`normalizeItemName` で比べる）。

1. **親の呼び名** `parentLabel`: 親の `code` が空でなければ `${parent.name} ${parent.code}`、空なら `parent.name`。
   - 理由: 同じ名称の機器（鋼製ボイラー B-1・B-2）も別の項目にする。
2. **名称**: `${base.name}（${parentLabel}）`。
3. **摘要**（`summary`。基の摘要を写してから）:
   - 表の行に `label` があるとき: 値 = `value === 'code'` なら `parent.code`（空なら `parent.name`）、それ以外は `parentLabel`。区分 `label` があれば値を置き換え、無ければ先頭に足す（R8a と同じ）。
   - 表の行に `copy` があるとき: 各区分について、親の `summary` に同じ区分（`normalizeItemName` で比べる）があり値が空でなければ、その値を基の同じ区分に入れる（あれば置き換え、無ければ末尾に足す）。親に無ければ何もしない。
   - `label` も `copy` も無い行は無い（データ上）。あっても名称だけ分ける。
4. ほか（`perEquipmentComponentIdentity`・`perEquipmentComponentFixture` の流れ・`id`・`order`・`style`）は今のまま。
5. `PER_EQUIPMENT_SUMMARY_LABEL` の import をやめ、`PER_EQUIPMENT_COMPONENTS` を使う。

## 試験（`tests/perEquipment.test.ts` を直す・足す）

- R8a の試験の親（`fixture('BOILER', 'ボイラー', 0)` 等。`code` が `BOILER`）は、名称が `機器据付（ボイラー BOILER）`、摘要の名称が `ボイラー BOILER` になる。期待値をそれに合わせる。
- 追加:
  - 親の `code` が空 → `機器据付（冷却塔）`、摘要の名称 `冷却塔`。
  - 電気: 基「器具取付」（摘要 `[{label:'記号',value:''}]`）・親「ＬＥＤ照明器具」記号 `A1` → 名称 `器具取付（ＬＥＤ照明器具 A1）`、摘要の記号 `A1`。親の記号が空なら記号は親の名称。
  - 電気: 基「盤撤去」（摘要 `盤名称`・`処理`）・親「分電盤」記号 `L-1` → 摘要の盤名称 `分電盤 L-1`、処理はそのまま。
  - 建築: 基「アルミニウム製建具撤去」（摘要 `[{label:'寸法',value:''}]`）・親「AW」記号 `AW-1`・親の摘要 `[{label:'寸法',value:'W1800×H2000'}]` → 名称 `アルミニウム製建具撤去（AW AW-1）`、摘要の寸法 `W1800×H2000`。親に寸法が無ければ基の寸法のまま。
  - 建築: 基「ルーフドレン撤去」（摘要 種別・径）・親の摘要に 種別 `たて形`・径 `100` → 両方写る。
  - 対象外（「スリーブ」「冷媒管」「機器搬入」）は分けない。
- e2e `e2e/per-equipment-components.annotate.spec.ts` の期待の名称（`機器据付（ボイラー）` 等）は、e2e の親の記号を見て合わせる（記号が `B`・`T` 等なら `機器据付（ボイラー B）`）。

## 受入条件・停止条件

- `npx tsc --noEmit` が通る。R8a の単体・e2e の試験が新しい名称で合格。
- 戻し方: このコミットの revert。

## 禁止事項

- `src/core/breakdown/perEquipmentComponents.ts` を変えない（Claude のデータ）。保存形式を変えない。
- ほかのファイルを変えない（試験の2ファイルを除く）。外部通信・`https://` を含む文字列を足さない。git 操作をしない。
