# SPEC-06e: 経路構成 — 右欄の作り直し、線要素の追加、追加直後の強調、条数の増減、図面上の複合経路の印、よく使う構成

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: 経路の編集（`AnnotationStore` の履歴を含む）、右欄・拾いバー・図面の描画・ブラウザーへの保存にまたがる新機能のため（判定表「新規機能の実装」「複数ファイルにまたがる改修」）

---

## 目的

利用者の指示（要約）:

- 右の設定欄を、単なる入力欄ではなく「**この経路に何が載っているかを見る画面**」にする。主の線要素・同じ経路に足した線要素・名称・略号・規格・条数・範囲・計上する長さ・経路全体の種類と条数が一目でわかること。理解の順は ① 何が積まれているか ② 何条か ③ 細かい数量の計算。
- 「線要素を選ぶ → この経路に足す」の操作を、項目が増えても使いやすくする（検索・最近・分類・追加済みの見分け）。クリックを減らす。足した直後に何が足されたかがわかる一時的な強調。
- 条数をマウスでもすばやく増減できる。直接の数値入力も残す。
- 複数の線要素を持つ経路が、PDF 上でもそうとわかる（図面の読みやすさを損なわない）。選んだときに含まれる線要素・条数・構成を PDF の近くで確かめられる。
- 幹線などでよく使う組合せ（ケーブル・接地線・電線管など）を登録し、別の経路・新しい経路に使えるようにする。既存の「別の組合せを提案」（線の色・線種・線幅の見た目の組合せ）との関係を整理する。

## 現状（Claude Code が確認したこと）

- 右欄: `src/app/FormatPanel.tsx` の `target === 'count'` の部分。経路を1つ選ぶと「平面の長さ」、`RouteItems`（`src/app/RouteItems.tsx`: 各項目の見本・名前・範囲の select・条数の input・式・外す、下に「長さの項目を選ぶ」select と「この経路に足す」）、「立上り・立下り」「余長・その他」（`QuantityValueInput`）、「この拾い」の式。右欄の幅は約 210px で、すべて縦に積んでいる。
- 経路の保存の形: `QuantityMark`（`src/core/quantity.ts`）の `itemId`（主）・`count`・`scope`・`extra: Array<{ itemId, count, scope? }>`（最大 10）。長さは `routeLength(planM, q, scope)`。
- 経路の変更: `store.updateRoute(id, count, extra, scope)`（主の項目は変えられない）。項目の付け替え: `store.reassignCounts`。項目の見た目の反映: `applyFixtureToQuantity`。
- 図面の描画: `src/editor/AnnotationLayer.tsx` → `MeasurementShape`（`src/editor/MeasurementOverlay.tsx`）。
- 拾いバー: SPEC-06d の `src/app/PickupBar.tsx`（この SPEC の前に入っている）。
- 標準マスタ: SPEC-06c の `src/core/quantityMaster.ts`（`searchQuantityMaster`、動的 import で読む）。
- 「別の組合せを提案」: 項目の画面（`FixtureDialog`）の、線の色・線種・線幅を提案するボタン（SPEC-05e）。

## 対象

- 対象フォルダ: `C:\Users\gibbo\Desktop\PDF編集アプリ\.claude\worktrees\karupdf-quantity-ui-8301e6`
- 変更してよいファイル:
  - `src/app/RouteItems.tsx`（作り直してよい。ファイル名は変えない）
  - 新規 `src/app/LinePicker.tsx` — 線要素を足す小さな画面
  - 新規 `src/app/routeSets.ts` — よく使う構成の保存と照合
  - `src/app/FormatPanel.tsx`（経路の部分だけ）、`src/app/PickupBar.tsx`、`src/app/FixturePanel.tsx`（よく使う構成の欄だけ）
  - `src/editor/AnnotationStore.ts`（経路の項目の設定、項目の追加と同時の設定、新しい経路の構成の雛形）
  - `src/editor/MeasurementOverlay.tsx`（複合経路の印、新しい経路に雛形を付ける）、`src/editor/AnnotationLayer.tsx`（印に渡す値だけ）
  - `src/app/FixtureDialog.tsx`（「別の組合せを提案」の説明の文言だけ）、`src/app/HelpDialog.tsx`、`src/styles.css`
  - `tests/`、`e2e/`（新規 `e2e/route-composition.annotate.spec.ts` と、既存の e2e の調整）
- 変更しないファイル: 上以外。保存の形（`QuantityMark`・`KaruCountFixtures`）は変えない。`docs/`、設定ファイル、`scripts/`

## 変更内容

### 1. 経路の項目の設定（`AnnotationStore`）

```ts
// 経路の主と追加の項目をまとめて置き換える（1回の Ctrl+Z で戻る）。items[0] が主。
setRouteItems(id: string, items: ReadonlyArray<{ itemId: string; count: number; scope?: RouteScope }>): void
// 項目一覧に newFixtures を足し、続けて setRouteItems を行う。2つを1つの履歴にまとめる（1回の Ctrl+Z で両方戻る）。
addFixturesAndSetRouteItems(newFixtures: readonly CountFixture[], id: string, items: ReadonlyArray<{ itemId: string; count: number; scope?: RouteScope }>): void
```

- 検査は `updateRoute` と同じ（長さの項目だけ、重複なし、条数 1〜99、範囲、合計 11 項目まで）。主が変わったら `applyFixtureToQuantity` で線の色・線種・太さを新しい主に合わせる。
- 変化が無ければ何もしない（履歴に積まない）。
- 新しい経路の雛形: `routeTemplate: { itemId: string; extra: Array<{ itemId: string; count: number; scope?: RouteScope }>; count: number; scope?: RouteScope; name: string } | null`（メモリだけ）。`setRouteTemplate(t)`。`selectFixture(id)` で `id` が雛形の `itemId` と違えば雛形を消す。数量拾いで新しい経路を作るとき（`MeasurementOverlay` の `quantityMark`）、今の項目が雛形の `itemId` なら `count`・`scope`・`extra` を雛形から付ける（雛形の項目が削除されていたら、その項目は付けない）。

### 2. 右欄の経路構成（`RouteItems.tsx`）

経路を1つ選んだときの右欄の経路の部分を、次の順に作り直す（`FormatPanel.tsx` の「平面の長さ」「立上り・立下り」「余長・その他」「この拾い」の行も、この部品の中に取り込んでよい）。

1. 見出し: `経路構成` と要約 `2種類・3条`（項目の数・条数の合計）。右端に「よく使う構成」ボタン（下の 6.）。
2. 長さの1行: `平面 9.35 m ＋ 立上り [3.00] m ＋ 余長 [1.00] m`（立上り・余長は今の `QuantityValueInput`。accessible name `立上り・立下り`・`余長・その他` は今のまま）。その下に小さく `全長 13.35 m`。
3. 項目のカード（主 → 追加の順）。各カードは2行:
   - 1行目: 役割の札（`主` / `追加`）・線の見本（`QuantitySwatch`）・`fixtureCode`（太字）・名称（小さく、省略表示、`title` に全文）。追加のカードには右端に「外す」（`aria-label="〈fixtureCode〉を外す"`）と「主にする」（`aria-label="〈fixtureCode〉を主にする"`）。
   - 2行目: 範囲の select（`aria-label="〈fixtureCode〉の範囲"`、選択肢の表示は短く `全長`・`平面＋立上り`・`立上りのみ`、`title` に今の長い説明）・条数の増減（下の 4.）・`= 26.70 m`（その項目の計上の長さ。式 `13.35×2` は `title` に）。
4. 「＋ 線要素を追加」ボタン（`aria-label="線要素を追加"`）→ 下の 3. の画面。
- 主の項目は、経路の線の色の札（主）で示す。カードの境界は細い線、主のカードの左に線の色の帯。
- 今の「長さの項目を選ぶ」select と「この経路に足す」ボタンは無くす。

### 3. 線要素を足す画面（`LinePicker.tsx`）

- 「線要素を追加」を押すと、ボタンのすぐ下に開く小さな画面（`role="dialog"`、`aria-label="線要素を追加"`）。Esc・外側のクリックで閉じる。
- 上に検索欄（`aria-label="線要素を検索"`、開いたらフォーカス）。その下に:
  - 「最近使った」: 最近使った項目（SPEC-06d の `recentFixtureIds`）のうち長さの項目
  - 「この PDF の項目」: 長さの項目を分類ごとに（一覧と同じ順）
  - 検索欄に文字があるときだけ「標準マスタ」: `searchQuantityMaster(query)` の結果のうち長さで、今の PDF に無いもの（最大 30。`import('../core/quantityMaster')` で読む）
- 経路にすでに入っている項目は「追加済み」と出して押せなくする。
- 1回のクリック（か ↑↓ と Enter）で足して閉じる:
  - PDF の項目 → `setRouteItems`（今の項目に足す。条数 1、範囲はその項目の `routeScope`）
  - 標準マスタの候補 → 項目を作って（`addMany` と同じ見た目の割り当て。`nextQuantityLineStyle`）`addFixturesAndSetRouteItems`（1回の Ctrl+Z で両方戻る）
- 項目が 11 個に達していたら「これ以上足せません（最大 11 項目）」と出して押せなくする。

### 4. 条数の増減

- 条数の欄を `[−] [ 2 ] [+]` にする（`−` は `aria-label="〈fixtureCode〉の条数を減らす"`、`+` は `…を増やす"`、数値の欄の accessible name は今の `〈fixtureCode〉の条数`）。1 で `−` を、99 で `+` を無効。押すたびに1つの履歴。数値の欄は直接入力でき、Enter かフォーカスが外れたときに確定（今と同じ）。数値の欄の上でホイールを回しても値を変えない（誤操作を防ぐ）。

### 5. 足した・変えたことがわかる表示

- 足した直後、そのカードに 2.5 秒の強調（背景を薄い黄色から元へ戻す CSS のアニメーション、`.route-item-added`）。`aria-live="polite"` の欄に `PF28 を足しました（1条・立上りのみ）`。外したとき `PF28 を外しました（Ctrl+Z で戻せます）`、条数を変えたとき `CV 38sq-3C を 2条にしました`。
- 拾いバー（下の 7.）の同じ項目の札も同じ時間だけ強調する。

### 6. よく使う構成（`routeSets.ts`）

- 経路に載せる項目の組合せを、名前を付けてブラウザーに保存する（`localStorage` の `karu-pdf:route-sets`、読み書きは try/catch、最大 50 件）。別の PDF でも使える。
```ts
export interface RouteSetItem { code: string; spec?: string; name: string; category: string; count: number; scope?: RouteScope }
export interface RouteSet { id: string; name: string; items: RouteSetItem[] }  // items[0] が主
export function loadRouteSets(): RouteSet[]
export function saveRouteSets(sets: readonly RouteSet[]): void
// 今の PDF の項目と照合する。略号・規格・名称が同じ長さの項目を使い、無ければ作る項目（見た目は nextQuantityLineStyle で割り当て）を返す。
export function resolveRouteSet(set: RouteSet, fixtures: readonly CountFixture[]): { items: Array<{ itemId: string; count: number; scope?: RouteScope }>; newFixtures: CountFixture[] }
```
- 右欄の「よく使う構成」ボタンで小さな一覧（`role="dialog"`、`aria-label="よく使う構成"`）を開く:
  - 登録した構成（名前と `CV 38sq-3C×2＋IV 14sq＋PF28（立上り）` のような要約）。押すと選んだ経路の項目をその構成に置き換える（`resolveRouteSet` → `addFixturesAndSetRouteItems`、1回の Ctrl+Z で戻る）。
  - 「この経路の構成を登録」: 名前の欄（既定は要約の文字列、40 文字まで）と「登録」。
  - 各構成に「名前を変える」「削除」。
- 左の数量タブ（「拾う」のとき）に「よく使う構成」の欄（構成が1件以上あるときだけ、最大 5 件）。押すと、構成の項目を照合・作成して（足す項目があれば `setCountFixtures`）、主の項目を選び（`selectFixture` + `ui.select()`）、`setRouteTemplate` で雛形にする。以後その項目で拾う新しい経路は、構成の項目と条数・範囲で作られる。拾いバーに `構成: 〈名前〉` と、雛形を外す「×」（`aria-label="構成を外す"`）を出す。
- 「別の組合せを提案」との関係: 「別の組合せを提案」は**項目の線の見た目**（色・線種・線幅）の組合せ、「よく使う構成」は**経路に載せる項目**の組合せ。`FixtureDialog` の「別の組合せを提案」ボタンに `title="線の色・線種・線幅の組合せを提案します（経路に載せる項目の組合せは「よく使う構成」）"` を付け、ヘルプにも書く。

### 7. 拾いバーの経路構成（`PickupBar.tsx`）

- 長さの経路を1つ選んでいるとき、拾いバーの下に2行目を出す: `2種類・3条` と、項目ごとの札（線の見本 + `fixtureCode` + `×2` + 範囲が全長以外なら `（立上り）` などの短い表示）と、その条数の `−`・`+`（右欄と同じ動作、accessible name に `拾いバーの` を前置き: `拾いバーのCV 38sq-3Cの条数を増やす`）、最後に「＋」（`aria-label="拾いバーで線要素を追加"`、上の 3. と同じ画面をバーの近くに開く）。
- 2行目も1行に収め、収まらない札は省略して `ほか N` とする。

### 8. 図面上の複合経路の印（`MeasurementShape`）

- 追加の項目を持つ経路（`quantity.extra` が1つ以上）は、経路の**始点**に小さな札を描く: 角の丸い四角に、項目の数（例 `3`）を白い文字で。塗りは経路の線の色、大きさは経路の文字の大きさ（`fontSize`）の 1.2 倍の高さ。`<title>` に項目の一覧（`CV 38sq-3C×2、PF28（立上り）`）。
- 単独の経路には描かない。数値の表示（`showQuantityValues`）を消していても描く（数値ではないため）。PDF の外観（保存する見た目）は変えない（今の SVG の描画だけ）。
- 札は当たり判定を持たない（`pointer-events: none`）。

## テスト

### 単体（`tests/`）

- `setRouteItems`: 主の入れ替え（線の色が新しい主に変わる）、検査（重複・12 項目・条数 0）、変化なしで履歴が増えない、1回の undo で戻る。
- `addFixturesAndSetRouteItems`: 項目と経路が1回の undo で両方戻り、redo で両方進む。
- `routeSets`: 保存と読み込み（壊れた JSON は空として扱う）、`resolveRouteSet` の照合（同じ略号・規格・名称の項目を使う、無いものは作る、作る項目の見た目が既存と重ならない）。
- 雛形: 雛形の項目を選んで拾うと `extra`・`count` が付く。別の項目を選ぶと雛形が消える。

### 画面（新規 `e2e/route-composition.annotate.spec.ts`）

白紙1ページ、縮尺 1/100。長さの項目 `EM-CE 5.5sq-3C`、`IV 5.5sq`、`PF22` を作る（標準マスタから足してよい）。

1. EM-CE で経路を1本なぞる → 右欄に `経路構成` と `1種類・1条`、主のカード。
2. 「線要素を追加」→ 検索欄に `iv` → `IV 5.5sq` を1回クリック → 画面が閉じ、カードが2枚、`2種類・2条`、追加のカードに `.route-item-added`、状態の欄に `IV 5.5sq を足しました`。もう一度開くと `IV 5.5sq` は「追加済み」で押せない。
3. 「線要素を追加」→ `pf2` → 「標準マスタ」の `PF28`（PDF に無い）を押す → 項目一覧に `PF28` が増え、経路に3枚目。Ctrl+Z を1回 → `PF28` が項目一覧と経路の両方から消える。Ctrl+Y で戻る。
4. EM-CE の `+` を押す → 条数 2、`3種類・4条`、数量タブの全図面の値が増える。`−` で戻る。1 で `−` が無効。
5. 拾いバーの2行目に3つの札が見え、`拾いバーのEM-CE 5.5sq-3Cの条数を増やす` で右欄の条数も 2 になる。
6. 図面の経路の始点に札（`3`）があり、`title` に項目の一覧。追加の項目を全部外すと札が消える。
7. `IV 5.5sq を主にする` → 経路の線の色が IV の色になり、主のカードが IV。Ctrl+Z で戻る。
8. よく使う構成: 「この経路の構成を登録」→ 名前 `幹線A` → 登録。新しい経路を EM-CE でなぞり、「よく使う構成」→ `幹線A` → 構成が同じになる。左の数量タブの「よく使う構成」の `幹線A` を押してから新しい経路をなぞると、最初から3項目で作られ、拾いバーに `構成: 幹線A`。「構成を外す」の後は1項目で作られる。`page.reload()` 後も `幹線A` が残る。
9. 保存して開き直すと、経路の `/KaruQuantity` が画面の構成と同じ（`extra` の項目・条数・範囲）。

### 既存の e2e

「長さの項目を選ぶ」select と「この経路に足す」を使う既存の e2e（`e2e/quantity-location-route.annotate.spec.ts` など、`grep -rn "この経路に足す\|長さの項目を選ぶ" e2e` で探す）を、新しい「線要素を追加」→ 検索 → クリックに書き換える。範囲の select の値（`all`・`noSlack`・`rise`）は今のままなので `selectOption('rise')` などは変えなくてよい。試験の意図・確かめる値は変えない。

## 禁止事項

- 保存の形（`QuantityMark`・`KaruCountFixtures`）を変えないこと。古い PDF の経路はそのまま読めること。
- 名称の文字列で項目の種類を決めないこと（照合は略号・規格・名称の一致だけ）。
- 経路の印のために PDF の外観・保存する内容を変えないこと。
- 標準マスタを静的に import しないこと。
- 試験から `work/` など Git の管理外のフォルダへ書き込まないこと。
- 対象外のファイルを変更しないこと。git の操作をしないこと。python・pytest は使わない。
- 試験の実行はしなくてよい（Claude Code が実行する）。書くだけでよい。`npx tsc --noEmit` は実行してよい。

- 同じ作業フォルダで、別の作業（同じ記号を探す: `src/core/symbolSearch.ts`・`src/worker/*`・`src/client/*`・`App.tsx` の試験用フック）が同時に進んでいる。対象外のファイルに型エラーや変更があっても触らず、報告だけすること。

## 検証項目

- [ ] `npx tsc --noEmit` が通る。
- [ ] 上の単体試験・e2e を書き、既存の e2e の調整を済ませた。

## 報告してほしいこと

- 変更したファイルと要点、調整した既存の e2e の一覧
- 右欄の経路構成の寸法（幅 210px で何行になるか）
- SPEC から逸脱した箇所と理由、残課題
