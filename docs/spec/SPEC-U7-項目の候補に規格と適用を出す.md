# SPEC-U7: 構成要素・線要素・頂点の項目の候補に、規格と適用（摘要）を出し、名称は1回にする

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 3つの画面（構成要素・線要素・頂点の個数）の候補の表示を共通の関数でそろえ、既存の e2e の名前の指定に波及するため既定の sol-high。

---

## 背景

利用者の意見（2026-10-14、試用版 第6版）:

> 構成要素の追加や線の要素に頂点の要素の追加を行うとき、規格や適用が不明なため、どれが適用できる仕様なのか分からない。規格や適用が分かるようにして下さい。また、現在名称が二回連続で記載されているが、名称の記載は一回でよい。

今の表示は `{fixtureLabelCode(f)} {f.name}`。

- `fixtureLabelCode` は記号（線は記号＋規格）が空なら名称を返す。そのため記号の無い項目は「冷却塔 冷却塔」「機器据付（冷却塔） 機器据付（冷却塔）」と名称が2回出る。
- 規格（`spec`）と摘要（`summary`）が出ない。そのため同じ名称の項目（機器用基礎（冷却塔）が2つ 等）を見分けられない。

## 変更内容

### 1. 共通の関数（`src/core/countFixtures.ts`）

```ts
/** 候補の一覧に出す文字。記号は名称と違うときだけ。detail は規格と摘要（「区分 値」を「・」でつなぐ）。 */
export function fixtureChoiceLabel(f: Pick<CountFixture, 'code' | 'spec' | 'name' | 'summary' | 'kind'>): {
  code: string      // 記号（名称と同じ、または空なら ''）
  name: string
  detail: string    // 例「規格 φ150・寸法 900×900×150・種類 防振基礎」。無ければ ''
  text: string      // 1行の文字: [code, name, detail].filter(Boolean).join(' ')（detail は「（…）」で囲む）
}
```

- **code:** `f.code.trim()`。名称（`normalizeItemName` で比べる）と同じなら ''。
- **detail の要素:**
  - `f.spec` があれば `規格 {spec}`（code に既に含まれる値なら省く）。
  - `f.summary` の各区分 `{label} {value}`（値が空のものは省く）。
- **text の例:**
  - 「機器用基礎（冷却塔） （寸法 900×900×150・種類 防振基礎）」
  - 「FD 防火ダンパー （寸法 面積 0.5㎡以下）」
  - 「冷却塔 （仕様等 冷却能力 104kW以下）」

### 2. 表示を変える所

- **`src/app/RouteItems.tsx`:**
  - 頂点の個数の項目の select の `<option>`（関連の項目・そのほかの個数の項目・選択中の項目）の文字を `fixtureChoiceLabel(f).text` にする。
  - 関連の項目の「＋ …」ボタン、頂点の行の `<small>`（329行付近）も同じにする。
- **`src/app/ComponentPicker.tsx`・`src/app/LinePicker.tsx`:**
  - 候補のボタンを `<strong>{code}</strong><small>{name}</small>` から、次の形にする。
    - code があれば `<strong>`
    - 名称は1回
    - その下に detail を `<small className="line-picker-detail">`
  - 標準マスタの候補（`'id' in candidate` でないもの）も、`candidate.preset` に同じ関数を使う。
  - ボタンの `aria-label` は今のまま（既存の e2e が記号で探している）。ただし記号が空で名称と同じになる場合は名称1回のまま。
  - ホバーの説明（`show(...)`）は今のまま。
- **`src/styles.css`:** `.line-picker-detail` は小さめの文字で折り返す（ボタンの幅を超えない）。

## 試験

- **単体 `tests/fixtureChoiceLabel.test.ts`:**
  - 記号が空 → code ''、text に名称が1回だけ。
  - 記号が名称と同じ → code ''。
  - 記号 FD・名称 防火ダンパー・摘要 寸法 → 「FD 防火ダンパー （寸法 …）」。
  - 規格 φ150 があり code（線の記号＋規格）に含まれないとき → detail に「規格 φ150」。
  - 摘要の空の値は出さない。
- **e2e:**
  - 頂点の個数の select の選択肢の文字・構成要素の候補の文字が変わる。名称や「記号 名称」で探している既存の試験を、新しい文字に合わせて直す。
    - 例 `e2e/route-points.annotate.spec.ts`・`e2e/related-route.annotate.spec.ts`・`e2e/count-components.annotate.spec.ts`・`e2e/per-equipment-components.annotate.spec.ts`
    - 抜粋に無い試験は Claude が実行して直す。
  - 新しい e2e を `e2e/route-points.annotate.spec.ts` に1つ足す。
    - 摘要の違う同名の項目2つ（機器用基礎 寸法 600×600×150 と 900×900×150）がある PDF で、頂点の個数の select の2つの選択肢の文字が違い、どちらも名称が1回だけ。

## 禁止事項

- 保存形式・データを変えない。外部通信・`https://` を含む文字列を足さない。git 操作をしない。
