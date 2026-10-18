# SPEC-T9: 関連候補の「追加する」で、積算基準どおりの数量が出る連動にする（作り直し）

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol` / reasoning effort: `high`
- 選定理由: 図形の意味（平面・立面・経路）と積算基準の算定方法を、既存の連動の計算へ正しく接続する設計判断を伴うため。

## 試用で分かった不具合（利用者の報告 2026-10-18）

1. 軽量鉄骨壁下地を「面（囲む）」と「長さ×高さ」で混在して拾うと、墨出しが反応しない。複数の壁下地の項目のうち、カードで押した1項目にしか反応しない。
2. ビニル幅木が壁の底辺に沿って拾われない（壁の立面の外周 2×(長さ+高さ) が出ていた）。
3. 一つの項目を RC 部材にすると、ほかの項目を RC 部材に選べない（梁を「長さ×幅×深さ」で拾っていて、その拾い方に RC の部材の種類が無いため）。
4. 電線管の「配管塗装」に、配管の表面積が反映されない（連動が付かず 0）。
5. 共通: 利用者が指定しなくても、積算基準どおりの数量が自動で出るようにする。

## 原因（Claude の分析）

- 前回（SPEC-T7）は、既存の「標準の連動規則」（`src/core/breakdown/linkRules.ts`、37規則）を使わず、範囲の分類だけで決める別表（`src/app/relatedLinkRules.ts`）を作った。
- 連動の元を `sources: [origin]`（押した1項目）にしていた。既存の「自動の元」（`link.auto`、`fixtureLinkSources`）を使っていない。
- 同じ分類（幅木）でも、関連元が床（平面の面）か壁（立面の面・線＋高さ）かで、図形から取るべき長さが違うことを区別していなかった。
- 電線管→塗装の組み合わせが表に無かった。RC の部材の種類の判定が「長さ×幅×深さ」に対応していなかった。
- 試験が連動の種類だけを見て、数値を確かめていなかった。

## 作るもの・変えるもの

### 1. 連動の元は「同じ関連ルールの起点に当たる全項目」（自動の元）

- `relatedLinkRules.ts` が作る連動は、`sources: []` ＋ `auto` にする。`auto` は、そのカードの関連ルール（`suggestion.ruleIds` の各 `RelatedRule.origin.any`）の起点の条件から作る:
  - 起点の条件に `names` があれば `auto.nameIncludes = names`（完全一致の名称を含む語として使う）。`categories` だけなら `auto.categories = categories`。両方あれば両方（既存の判定は AND）。
  - `auto.kinds` は、算定に使える関連元の種別（例: 墨出し・幅木は ['area', 'length']、塗装は ['length']）。
  - **`auto` を空（{}）にしない**（空は連動の無い全項目が元になる）。条件が作れないときは今までどおり `sources: [origin]`。
- これで、面と長さ×高さの混在・複数の壁下地の項目が、すべて元として合計される。後から拾った壁も自動で入る。
- 関連ルールの起点の条件は `loadRelated()` のモデル（`RELATED_RULES`）から引く。`AnnotationStore.applyRelatedAdditions` の計画関数へ、ルールの起点の条件を渡せるようにする（`ScopedRelatedAddContext` に `originMatch` を足す）。

### 2. 図形から取る長さ: shape の出力 `baseLength` を追加（`src/core/fixtureLink.ts`）

- `FixtureLink.shape.output` に `'baseLength'` を足す（検証・保存・複製・説明文の既存の箇所も）。
- 各元の印について: polyline・lengthHeight・lengthWidthDepth は **線の平面長**（立上り・余長を含めない）、polygon・polygonDepth は **底辺**（ほぼ水平〈傾き10°以内〉な辺のうち最も長い辺。無ければ警告して外周の半分を使わず、その印は 0 として警告）。
- `shape.deductDoorWidths?: boolean`（true のとき、その印の開口のうち、開口の項目の名称に「扉」「ドア」「戸」「出入口」を含むものの 幅×個数 を、印ごとに引く。引いた結果が負になる印は、その印の値を 0 として警告を出す）。
- 数量 = Σ（各印の長さ − 扉の幅）× link.factor（面数）。

### 3. 関連元と提案先の組み合わせごとの連動（`relatedLinkRules.ts` を作り直し）

関連元の「部位」を、起点の項目から判定する: 名称・分類に「壁」「間仕切」を含む＝壁、「床」＝床、「天井」＝天井、「管」「ケーブル」「ダクト」「配線」＝経路（polyline の項目）、それ以外は不明。

| 提案先（ルールの classId／提案先の名称） | 関連元の部位 | 連動（すべて §1 の自動の元） | 既定の係数 |
|---|---|---|---|
| 墨出し（MARK）・案件区分が新築以外 | 壁 | `shape: { output: 'lengthTimesHeight', heightM: 1, lengthBasis: 'baseEdge' }`（線の長さ・底辺 × 帯幅1m。第7編 PDF49頁） | 1（両側は 2） |
| 墨出し・案件区分が新築 | 全部 | 連動しない。案内「新築の墨出しは延べ面積（各階の床を囲んだ項目）を元にします」（標準規則 floor-area を連動の画面で選べる） | — |
| 墨出し | 建具 | `factor` ＋ `factorFrom: 'openingArea'` | 1 |
| 幅木（BASEBOARD・名称に「幅木」「巾木」） | 壁 | `shape: { output: 'baseLength', deductDoorWidths: true }` | **2（両面）**。片面の壁は連動の画面で 1 に |
| 幅木 | 床 | `shape: { output: 'perimeter' }`（床の周長。出入口は既存の標準規則 baseboard と同じく、建具を元に足して「開口の幅」で引き算する案内を note に） | 1 |
| 見切り・目地（JOINT・CORNER） | 床・天井（polygon） | `shape: { output: 'perimeter' }` | 1 |
| 見切り・目地 | 壁 | `shape: { output: 'baseLength' }` | 1 |
| 防水立上り（UPSTAND） | 屋根・床（polygon） | `shape: { output: 'lengthTimesHeight' }`（高さ未設定は既存の警告で入力を促す） | 1 |
| 塗装（名称に「塗装」）・提案先の種別が面積（㎡） | 経路（電線管・配管） | `factor` ＋ 新しい `factorFrom: 'outerCircumference'`（元の項目の外径から π × 外径(m)。外径は `pipeOuterDiameterMm`） | 1 |
| 塗装・提案先の種別が長さ（m） | 経路 | `factor`（配管の長さ。原本 Excel E-020/REL-006 は「呼び径別の対象区間の長さ」） | 1 |
| 保温・被覆（名称に「保温」「ラッキング」）・長さ | 経路 | `factor` | 1 |
| 仕上げ・下地・撤去の面（SURFACE・AREA・EXIST_FACE・FLOOR・ROOF・CEILING_*・WALL_FINISH・CAVITY・INNER） | 同じ部位の面 | `factor`（同じ面の別作業。面積を使う） | 1 |
| 上記以外で、関連元から数量が決まらない分類（PROTECT・SCAFFOLD・CRACK・DEFECT_POINT・PATCH・OPENING・PLAN・PROPERTY・MATERIAL・RECORD・BRANCH・VOLUME・WASTE・CONTACT・WALL_FRAME・CEILING_FRAME） | 全部 | 連動しない（項目だけ作る）。経路に入れる・頂点に置く・構成要素は従来どおり（ffedf02 の limitNone を保つ） | — |
| それ以外 | — | 既存の動作 | — |

- **塗装の呼び径**: 提案先（塗装の項目）の略号・規格・名称に呼び径（例: C51・25A・φ50）があり、元の候補の略号・規格に同じ呼び径があるときは、`auto` に加えて元を同じ呼び径の項目だけに絞る（`auto.nameIncludes` ではなく、連動の計算で絞る新しい `auto.sizeMatch?: string`。比較は `pipeOuterDiameterMm` と同じ正規化〈NFKC・空白除去・大文字〉）。
- 案件区分は `store.getRelatedReviewsSnapshot().projectMode`。
- 係数・元の追加/除外・補正は、既存の連動の画面でそのまま変えられる（新しい入力欄は作らない）。連動の note に「何から何を計算したか」と原本の根拠（第7編 PDF49頁 等）を書く。

### 4. `factorFrom: 'outerCircumference'`（`src/core/fixtureLink.ts`）

- `FixtureLinkSource.factorFrom` に `'outerCircumference'` を足す。元の項目の `pipeOuterDiameterMm(fixture)` が分かれば π × 外径/1000（㎡/m）、分からなければ警告「外径が分かりません（項目の外径を入れてください）」で 0。
- 連動の説明（note）に「C51 外径 51.0mm：π×0.051 ㎡/m × 19.60 m」のように出す。

### 5. RC 部材: 「長さ×幅×深さ」を部材にできる（`FixtureDialog.tsx` の `rcKindsFor`、`src/core/rcMember.ts`・`fixtureLink.ts` の RC 計算）

- `rcKindsFor` の `lengthWidthDepth` → `['beam', 'foundationBeam', 'wall']`。
- RC の断面の幅・せい（壁は厚さ）を、部材の設定に無ければ印の `widthM`・`depthM`（又は項目の既定）から使う。既存の polyline の梁の計算と同じ型枠・コンクリート・鉄筋の出力が出ること。

## 試験

- vitest（AnnotationStore と QuantityIndex を使う既存の書き方。`tests/relatedLinkRules.store.test.ts` を拡張）: 縮尺 1/100 の図面で
  - 壁 A（長さ×高さ、線 10m、高さ 3.6m）＋ 壁 B（囲む、立面の長方形 5m×3.6m）→ 墨出し 15 ㎡（壁の面積 54 ㎡ではない）。後から壁 C（長さ×高さ 2m）を足すと 17 ㎡。
  - 同じ壁で幅木 → (10 + 5) × 2 = 30 m。壁 A に扉（幅 0.8m・1か所）の開口があれば 30 − 0.8×2 = 28.4 m。
  - 床（囲む 6m×4m）→ 幅木 20 m。
  - 薄鋼電線管 C51（線 19.6m）→ 塗装（㎡）= π × 0.051 × 19.6 ≈ 3.140 ㎡、塗装（m）= 19.6 m。C51 と C25 の電線管があるとき、C51 塗装は C51 だけを元にする。
  - 梁（長さ×幅×深さ、6m × 0.3 × 0.6）を RC 部材にでき、2つ目の梁も RC 部材にでき、型枠（地上軸部）の連動に値が出る。
  - 新築の案件区分では墨出しに連動を付けない。
- Playwright `e2e/related-scope-quantities.annotate.spec.ts`（既存の `e2e/area-exclusions.annotate.spec.ts` の縮尺設定・描き方の helpers と同じ操作で、図面に実際に描く）: 壁を「長さ×高さ」と「囲む」で1つずつ描き、墨出し・幅木を関連の候補から追加 → 集計の数値が上の期待どおり。
- 既存の関連候補・連動・RC の試験が通ること。

## 守ること

- 関連元の面積を、表で認めた組み合わせ以外へ写さない。固定倍率・既定値で補わない（帯幅1m・幅木の両面は根拠付きの既定値として note に明記し、連動の画面で変えられる）。
- 新しい画面・保存キー・自由記入欄を作らない。既存の保存形式に足すのは省略可能なフィールドだけ（旧データを壊さない）。
