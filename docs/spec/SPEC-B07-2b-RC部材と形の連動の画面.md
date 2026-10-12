# SPEC-B07-2b: 項目の編集画面の「RC 部材」の欄と、連動の欄の RC・形の設定

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 項目の編集画面の新しい欄（部材の種類ごとの入力・鉄筋の表・見本の計算）、連動の欄の新しい種類と元ごとの設定（引き算・開口からの係数）、数量タブからの見本の計算、e2e にまたがる

---

## 背景

B07-1 で計算（`src/core/rcMember.ts` の `RcMember`・`computeRcMember`・`rcMemberError`、`src/core/shapeMetrics.ts` の `collectShapeMetrics`、連動の `kind: 'rc' | 'shape'`、元の `sign`・`factorFrom`）ができた。B07-2a（並行して作業中）で、自動の元の `auto.rcKinds` と、根切りの `shape.clearanceM`（余幅のゆとり幅。`marginM` が無ければ基準どおりに計算）が足される。この SPEC は画面だけ。

## 対象

- 変更: `src/app/FixtureDialog.tsx`、`src/app/FixturePanel.tsx`、`src/styles.css`
- 新規: `e2e/rc-members.annotate.spec.ts`
- 変えない: `src/core/*`、`FixturePresetDialog.tsx`、`catalog.ts`

## 1. 「RC 部材（コンクリート・型枠・鉄筋を計算する）」の欄（`FixtureDialog.tsx`）

`<details className="fixture-rc">`。項目に `rc` があれば開いて始める。連動の項目（`link`）では出さない。

- `<input type="checkbox" aria-label="RC 部材にする">`。オンで `rc = { kind: 部材の既定, bars: [] }`。部材の既定は項目の拾い方から（面積で拾う → `slab`、長さ×高さ → `wall`、線 → `beam`、個数 → `column`）。
- 部材の種類 `<select aria-label="部材の種類">`: 床板（slab）・基礎スラブ（foundationSlab）・壁（wall）・梁（beam）・基礎梁（foundationBeam）・柱（column）・独立基礎（footing）。拾い方と合わない組合せ（面積で拾う項目に梁など）は選べない（床板・基礎スラブ = 囲む、壁 = 長さ×高さ、梁・基礎梁 = 線、柱・独立基礎 = 個数）。
- 寸法（mm の入力。部材ごとに出すものだけ）: 厚さ（床板・基礎スラブ・壁）、幅 b・せい D（梁・基礎梁・柱）、控除する床板の厚さ（梁・基礎梁）、高さ（柱・独立基礎）、幅・長さ（独立基礎: `widthMm`・`depthMm`）。`aria-label` は表示名のまま（例: `厚さ（mm）`）。
- 鉄筋の表: 行ごとに、役割 `<select>`（部材ごとの候補: 床板・基礎スラブ = x 方向・y 方向、壁 = 縦筋・横筋、梁・基礎梁 = 上端筋・下端筋・スタラップ、柱 = 主筋・フープ、独立基礎 = ベース筋）、径 `<select>`（`REBAR_MASS_KG_PER_M` のキー）、間隔（mm）または本数（役割で決まる: 上端・下端・主筋は本数、ほかは間隔）、段（シングル／ダブル。間隔の筋と上端・下端）、`×` で外す。`＋ 鉄筋を足す`。20 本まで。`aria-label` は `鉄筋${n}の役割`・`鉄筋${n}の径`・`鉄筋${n}の間隔（mm）`・`鉄筋${n}の本数`・`鉄筋${n}の段`。
- 定着（d の倍数）・重ね継手（d の倍数）の入力（空なら既定）。既定値の横に `既定値 35d・40d（要確認）`（`rcData.ts` の `ANCHORAGE_LAP_VERIFIED` が false のとき）。継手 `<select aria-label="継手">`: 自動（径 16 以上はガス圧接）・すべて重ね継手・すべてガス圧接。
- **見本**: 新しい省略可能な props `previewRc?(draft: CountFixture): RcResult | undefined`（数量タブから開くときに渡す。今の拾いの合計）。コンクリート ㎥、型枠 ㎡、径ごとの長さ m・質量 t、ガス圧接・重ね継手のか所を出す。拾いが無ければ `拾うと計算します`。
- 保存の検査: `rcMemberError` の文。

## 2. 連動の欄の RC・形（`FixtureDialog.tsx`）

- 種類のラジオに `RC 部材から（コンクリート・型枠・鉄筋）`（`rc`）と `形から（面積・周長・根切り など）`（`shape`）を足す。
- RC: 出力 `<select aria-label="RC の出力">`（コンクリート・型枠・鉄筋・ガス圧接・重ね継手）、鉄筋のとき 設計数量／所要数量（×1.04）のラジオと、径の絞り込み（`REBAR_MASS_KG_PER_M` のキーのチェック。何も付けなければすべて）。自動の元: `RC 部材を自動で元にする` のチェック（オンで `auto.rcKinds: []`）と、部材の種類のチェック（付けたものだけ `rcKinds` に）。
- 形: 出力 `<select aria-label="形の出力">`（面積・周長・長さ×高さ・根切り）。長さ×高さのとき 高さ（m）。根切りのとき ゆとり幅（m、既定 0.5。`clearanceM`）、余幅を手で入れる（m、空なら基準どおり。`marginM`）、深さ（m。元の拾いに深さがあればそれ）。
- 元ごとの行に（すべての種類で）: `引き算`（`aria-label="${code}を引き算にする"`、`sign: -1`）、係数の元 `<select aria-label="${code}の係数の元">`（数値・開口の面積・開口の周長・開口の幅。`factorFrom`）。開口の項目でない元には「開口」の選択肢を出さない（`opening` が無い項目）。
- 見本（今の `previewLink`）はそのまま使う（RC・形の結果も出る）。

## 3. 数量タブ（`FixturePanel.tsx`）

- 項目の編集を開くとき、`previewRc` を渡す: 下書きの項目でほかの項目を置き換えた一覧で、`collectShapeMetrics(注釈, 項目, new Set([下書きの id]))` の各拾いに `computeRcMember` を当てて足し合わせる（`store` の注釈を使う）。
- `previewLink` は今のまま（連動の計算に形の計量も渡すよう、`computeLinks` の第 3 引数に `collectShapeMetrics` の結果を渡す — 連動に `rc`・`shape` があるときだけ）。

## 4. 試験（e2e、新規 `e2e/rc-members.annotate.spec.ts`。`e2e/linked-fixtures.annotate.spec.ts` の作り方に倣う）

1. 面積の項目 `S1`（床板）を作り、RC 部材にする: 厚さ 150、鉄筋 x 方向 D13@200 ダブル、y 方向 D13@200 ダブル。4m×3m を拾う（縮尺は既存の e2e の設定に倣う）。編集を開くと見本が `コンクリート 1.80 ㎥`・`型枠 12.00 ㎡`・`D13` の行。
2. 連動の項目 `鉄筋` を作り、種類 `RC 部材から`、出力 鉄筋・所要数量、`RC 部材を自動で元にする` → 全図面がおよそ `0.35`（t）。設計数量にすると `0.34`。
3. 連動の項目 `根切り` を作り、種類 `形から`・出力 根切り、元に S1（深さ 2.0 を手で入れる）→ `51.52`（(12 ＋ 14×0.8 ＋ 4×0.64) × 2）。
4. 建具の項目（開口 1.8×2.1、印 3 個）と連動の項目 `シーリング`（係数、元に建具・係数の元 開口の周長）→ `23.40`。
5. 引き算: 連動の項目 `埋戻し` = 根切り（＋）− 別の体積の項目（引き算）。

## 禁止事項

- `src/core/*` を変えないこと（足りない関数は報告する）。連動・RC の無い項目の画面を変えないこと。依存パッケージを足さないこと。指定外のファイルを変えないこと。

## 検証項目（Claude Code が実行する）

- [ ] 型検査、単体（全件）、`npm run build` の後 e2e（新規・連動・内訳書・集計表）
- [ ] 画面で RC 部材の欄・見本を確認
