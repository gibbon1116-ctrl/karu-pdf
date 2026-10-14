# SPEC-R6b: 保温など面積（㎡）の項目を、経路の線要素として拾う（周長×長さ）

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 経路の集計（QuantityIndex）・ストアの検査・線要素の画面にまたがり、数量の計算規則の判断を伴うため既定の sol-high。

---

## 背景（試用版 related2 の利用者の意見、2026-10-14）

> 機械設備でダクトを入れたときに、線要素として保温が選択できない。ダクトや配管に沿って保温は行うため、線要素として拾えるようにしたい。保温の高さや横幅については、ダクト形状が自動で反映されるようにしたい。

今の線要素（経路の `extra`）は次の2つだけ:
- 長さの項目（`quantityMethod === 'polyline'`）
- 体積の溝（`lengthWidthDepth`）

ダクト保温（標準マスタ `DUCT-GW`「ダクト保温（長方形）（長さ×周長）」、内訳書の「ダクト保温」）は面積（㎡）の項目なので選べない。

- 長方形ダクト（内訳書の行から作った `SD500×300` 等）は、長さで拾い、`convert: { factor: 周長(m), unit: '㎡' }` で㎡にしている。
- 設備数量積算基準では、ダクト保温の数量はダクトの表面積。

## 決めごと（Claude）

面積の項目（`quantityKind(f) === 'area'`、連動でない）を、経路の**追加の線要素**にできるようにする。

- 数量は次のとおり（長さの線要素と同じ部分＝平面・立上り・その他の加算、施工条件も同じ）:

  ```
  経路の長さ（その線要素の数える部分）× 条数 × 周長（m）
  ```

- 周長は今の「1m あたり」（`RouteExtra.perM`、0 より大きく 10000 以下、小数3桁）を使う。保存形式は変えない。
- 面積の項目は主にできない（今の溝と同じ）。

### 周長の自動の値

線要素に足すとき、経路の**主の項目**から次の順で決め、`perM` に入れる（小数3桁に丸める）。

1. 主の項目の `convert.unit === '㎡'` で `convert.factor > 0` → `factor`（長方形ダクトの周長）
2. 主の項目の `spec` か `name` に `幅×高さ`（`/(\d+(?:\.\d+)?)\s*[×xX＊*]\s*(\d+(?:\.\d+)?)/`、mm）→ `2×(幅＋高さ)/1000`
3. `φ` または `Φ` に続く数（mm）→ `π×D/1000`
4. 決まらないときは入れない（`perM` なし）。画面に「周長（m）を入れてください」を出し、数量は 0 とする。

- 自動で入れた値は利用者が直せる。
- 主の項目を変えても自動では入れ直さない。「主の寸法から入れ直す」ボタンで入れ直す。

## 対象

- `src/core/quantityIndex.ts`
  - 経路の `routeMembers` の線要素で、面積の項目（`quantityKind === 'area'`、連動でない、主でない）を数える。
  - `routePortions(planM, q, member.cond)` の各部分について、`value = lengthM × count × (perM ?? 0)` を足す。`routeCount`・`routePerM` を付ける。
  - `perM` が無いときは数量 0。溝の空の経路と同じ扱いでよい。
  - `convert` は今の `add` の処理のまま（面積の項目に換算があればそれを掛ける）。
- `src/editor/AnnotationStore.ts`（`setRouteMembers`）: 追加の線要素に面積の項目を許す。主にはできない。
- 新規 `src/core/routeSurface.ts`:
  - `surfacePerimeterM(main: CountFixture): number | undefined`（上の決めごと 1〜3）
  - `isRouteSurfaceFixture(f: CountFixture): boolean`
- `src/app/LinePicker.tsx`
  - 候補に面積の項目を加える。今の候補（長さ・溝）の後に見出し「表面積（周長×長さ）」でまとめる。標準マスタの検索結果でも、規格の `method` が `polygon` / `lengthHeight` のものを同じ見出しで出す。
  - 足すとき `perM` に `surfacePerimeterM(主の項目)` を入れる。
- `src/app/RouteItems.tsx`
  - 面積の線要素の行:
    - 「1m あたり」の入力（`RoutePerM`）の見出しを「周長」、単位を m にする。
    - 説明（`detail`）を「平面 … ＋ 立上り … ＝ L m × 周長 P m ＝ A ㎡」にする。
    - 「主の寸法から入れ直す」ボタン。
    - 周長が無いときは「周長（m）を入れてください」（`role="status"`）。
  - 「主にする」は無効（title「面積の線要素は主にできません」）。
- `src/editor/AnnotationLayer.tsx` の経路の構成の title 等で面積の線要素が崩れないこと（略号×条数の表示は今のままでよい）。
- 経路の label（`quantityText`）・CSV・Excel・集計表は `QuantityIndex` の値を使うので、追加の対応は要らない。違う所があれば揃える。

## 試験

- 単体 `tests/routeSurface.test.ts`: `surfacePerimeterM` の
  - `convert`
  - `500×300`（1.6）
  - `φ200`（0.628）
  - 決まらない場合
- 単体（QuantityIndex）: 長さ 10m の経路に周長 1.6 の保温の線要素 → 16㎡。
  - 立上り 2m を足すと 19.2㎡。
  - 立上りを除外した施工条件で 16㎡。
  - 条数 2 で 32㎡。
  - `perM` 無しで 0。
- 単体（ストア）: 面積の項目を追加の線要素にできる。主にはできない。
- e2e（`e2e/route-surface.annotate.spec.ts`、R5c の `route-points` の作りにならう）:
  - 項目は次の2つ:
    - 長方形ダクト（`kind: 'length'`、`spec: '500×300'`、`convert: { factor: 1.6, unit: '㎡', basis: '周長' }`）
    - ダクト保温（`kind: 'area'`、`method: 'lengthHeight'`）
  - 経路を引いて「＋ 線要素を追加」から保温を足すと、周長が 1.600 で入る。
  - 保温の数量が「長さ×1.6」になる。
  - 保存して開き直して残る。

## 受入条件・停止条件

- 面積の線要素の無い経路・文書の数量・保存データ・表示は変わらない。
- 経路・数量・溝（埋戻し）・関連の e2e と単体試験全件が合格。
- 戻し方: この段階のコミットの revert。

## 禁止事項

- 経路の保存形式（`RouteExtra`）に欄を足さない。
- 長さの線要素・溝・埋戻し・連動の計算を変えない。
- 外部通信を足さない。`https://` を含む文字列を足さない。git 操作をしない。
