# SPEC-P06a: 個数の印の再描画の省略

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 描画部品のメモ化で、props の同一性の前提を誤ると印が更新されない不具合になる判断を伴うため既定の sol-high。

---

## 目的

フェーズ4後（1,000項目×10,000拾い、100頁）でも項目を選ぶたびに表示中15ページの AnnotationLayer が描画され、各ページ約100個の `CountMarker` が毎回 `countMarkerData` の移動とパス文字列（`countSvgPath`）を作り直している。
`CountMarker` の props（`style`, `code`, `showCode`, `x`, `y`）は、項目定義と印の位置が変わらない限り同じ値・同じ参照である
（`style` は `store.fixtureForCount(...)` が返すストア内部の項目の `style` で、項目の配列が置き換わるまで同じ参照。置き換え時は新しいオブジェクトになる）。
`CountMarker` を `React.memo` で包み、props が同じ印の再描画を省く。描画結果（DOM）は変えない。

## 対象

- `src/editor/countMarkers.ts`
- 新規 `tests/countMarkers.memo.test.ts`

## 変更内容

1. `CountMarker` を `memo` で包む。export 名 `CountMarker` と props の型・既定値・描画内容は1文字も変えない。
   例: 中身を `function CountMarkerView(...) { ...今の本体... }` にし、`export const CountMarker = memo(CountMarkerView, sameCountMarkerProps)`。
   比較関数 `sameCountMarkerProps(a, b)`: `code`・`showCode`・`x`・`y` が `Object.is` で等しく、かつ `a.style === b.style` であるか、`CountStyle` の全フィールドが等しい（`color` は要素ごとに `Object.is`、それ以外は `Object.is`。フィールドの集合は `Object.keys` の和集合で比べ、片方にしか無いキーがあれば不等）。
   理由: 数量パネルの一覧（1,000行）などは `style={{ ...f.style, size: 24, opacity: 1 }}` と描画ごとに新しいオブジェクトを渡すため、参照比較だけでは省略できない。
   `memo` は `react` から import する（既に `createElement` を import している行に足す）。
2. `countMarkerData` / `countSvgPath` / `countPdfPath` / `QuantitySwatch` は変えない。

## 試験 `tests/countMarkers.memo.test.ts`（新規）

既存の試験に React の描画試験の作り方があればそれにならう。無ければ `react-dom/server` の `renderToStaticMarkup` を使う（新規パッケージは入れない）。

1. `CountMarker` が memo 化されていること（`(CountMarker as unknown as { $$typeof: symbol }).$$typeof === Symbol.for('react.memo')`）。比較関数を `(CountMarker as unknown as { compare: (a: object, b: object) => boolean }).compare` で取り出し、同じ値の別オブジェクトの style では true、`color` の1要素・`size`・`fill`・`x`・`code` のどれかが違えば false になること。
2. 代表的な style（全 `COUNT_SHAPES` × `COUNT_FILLS` の組合せのうち、circle/solid、doubleCircle/half、star/hatch、cross/dot、square/none）について、
   `renderToStaticMarkup(createElement(CountMarker, props))` の出力が、同じ props で中身を直接呼んだ場合と一致すること。
   直接呼ぶ版は、変更前の実装と同じ式を試験内に書かず、`countMarkerData` と `countSvgPath` から期待するパス文字列（`d` 属性）を組み立てて、出力にその `d` が含まれることを確認する。`showCode` と `code` の有無で `<text>` の有無が変わることも確認する。

## 禁止事項

- 印の形・色・不透明度・略号の表示・DOM 構造を変えないこと。
- AnnotationLayer やその他のファイルを変えないこと。
- 外部通信・新規パッケージ・https:// を含む文字列を足さないこと。

## 報告してほしいこと

- 変更点と、`CountMarker` の利用箇所（このファイル内に見える範囲）で props の参照が描画ごとに新しくなる箇所があれば、その指摘（変更はしない）
