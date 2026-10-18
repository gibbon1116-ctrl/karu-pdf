# SPEC-T12: 関連の「追加する」の連動を、原本 Excel の「元指定」どおりに全面見直し（SPEC-T11 を置き換える）

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol` / reasoning effort: `high`
- 選定理由: 858ルールの連動を、原本の算定方法の表に沿って作り直し、点検の判定も同じ厳しさに直す設計判断を伴うため。

## 経緯（利用者の指示 2026-10-18）

「誤りが10項目だけとは思えない。もう一度厳密に全体を点検し、数量拾い方法に誤りがないか確認すること」。

Claude が点検をやり直した結果、T10 の点検には次の抜けがあった:

1. **経路に入れる（route）・部品として数える（component）・頂点に置く（point）を、数量の写しとして判定していなかった**。実際には次のように数量が出ていた:
   - 確認の記録だけの規則（RECORD、原本「承認前に数量は生成しない」）233件で、起点の個数がそのまま個数になる（component）。
   - 親の分岐（BRANCH、原本「方式決定前は拾う面・線・単位を固定しない」）85件で同じ。
   - `isRouteSurfaceFixture` が「連動の無い面積の項目すべて」を真にするため、床・壁・天井の品目に含まれる線（ビニル幅木など）を起点にすると、壁紙・床シート・撤去・養生などの面積の項目が「経路の部材」になり、線の長さ × 外周で面積が出る（WALL_FINISH・FLOOR・CEILING_FINISH・EXIST_FACE・PROTECT・RECORD 等で約90ルール）。
2. **面積の写しを、原本が「独立して拾う」とする規則にも付けていた**。既存材の撤去（EXIST_FACE、原本「既存材の撤去範囲を新設範囲から独立し、材種・層別に拾う」）29ルール、「対象工事独自の施工面を別途拾う」ルール。
3. **辺の長さを、施工辺でない線に使っていた**。伸縮目地・ジョイナー・コーナービード・床見切縁・下がり壁見切り縁・シーリングに、壁の底辺や床の外周を使っていた。個数（click）の起点から shape を作る組み合わせもあった。
4. 機器ごとに1つと決まっていない品目（冷凍機→ポンプ、制御盤→センサー、カメラ→PoEスイッチ 等）に、起点の個数を写していた。

## 方針

**許可した組み合わせだけ連動・配置を付け、それ以外は「連動しない（項目だけ作る。配置もしない）」にする（許可の一覧方式）**。今までの「当たらなければ既存の処理（relatedAdditionKind）」をやめる。

## A. 原本の元指定ごとの正しい拾い方（期待の表）

記号:
- `NONE` 連動も配置も付けない。項目だけ作り、note に「原本: 〜を別に拾う」を出す。
- `SAME_FACE` 同じ部位の面の面積。起点が polygon・lengthHeight の面で、起点の部位（壁・床・天井・屋根）が提案先の部位と同じとき `factor`（控除後の面積）。起点が線の壁（polyline、部位が壁）なら `shape: lengthTimesHeight, lengthBasis: 'baseEdge'`（高さは未設定で警告）。それ以外（線・個数・別の部位）は `NONE`。
- `BASE_EDGE` 幅木: 起点が壁（polyline・lengthHeight・polygon）なら `shape: baseLength, deductDoorWidths: true`・係数2。起点が床の polygon なら `shape: perimeter`（標準規則 baseboard）。それ以外は `NONE`。
- `CEIL_PERIM` 起点が天井の polygon なら `shape: perimeter`。それ以外は `NONE`。
- `UPSTAND_H` 起点が屋根・床の polygon なら `shape: lengthTimesHeight`（外周 × 高さ、高さ未設定は警告）。それ以外は `NONE`。
- `ROUTE_LEN` 起点が経路（polyline で、部位が経路＝名称・分類に 管・ケーブル・ダクト・配線・ラック）で、提案先が線（polyline）なら `route`（同じ経路に入れる）。提案先が長さ（polyline 以外）なら `factor`（自動の元・長さ）。それ以外は `NONE`。
- `ROUTE_SURF` 起点が経路で、提案先が面積: ダクトは `route`（既存の経路の表面積）、管・電線管は `factor` + `factorFrom: 'outerCircumference'`（T9）。提案先が長さなら `ROUTE_LEN`。
- `PER_ORIGIN` 起点が個数（click）で提案先が個数なら `component`（起点1つに1つ）。それ以外は `NONE`。
- `ENDPOINT` 起点が経路で提案先が個数なら `point`（経路の端点）。それ以外は `NONE`。
- `MARK` T9 の墨出し（改修: 起点が壁なら `shape: lengthTimesHeight, heightM: 1, lengthBasis: 'baseEdge'`、建具なら `factor` + `openingArea`、それ以外 `NONE`。新築は `NONE`）。
- `STD(規則id)` 標準の連動規則（`src/core/breakdown/linkRules.ts`）の連動。`auto` に条件があればそれを使う。規則の `auto` が `{}`（元を手で選ぶ規則）なら `NONE` にして、note に「連動の画面で標準の規則『〇〇』を選んでください」と出す。

| 分類（classId） | 元指定（原本 `excelTarget` の「元指定：」の後） | 期待 |
|---|---|---|
| RECORD | （全部）承認前に数量は生成しない | NONE |
| BRANCH | 下の例外以外すべて | NONE |
| BRANCH 例外 | M-043・M-090・M-104（子の定義が F_SUBSET m） | ROUTE_LEN（提案先が長さのときだけ。面積は NONE） |
| BRANCH 例外 | B-170（子の定義が F_EDGE m） | BASE_EDGE（床の polygon の外周のみ） |
| PLAN・PROTECT・SCAFFOLD・OPEN_REINF・VOLUME・WALL_FRAME・CEILING_FRAME・HANGING・EXIST_FACE・EXIST_POINT・LINE | （全部） | NONE |
| DETAIL | B-043 型枠運搬 | STD(formwork-transport) |
| DETAIL | それ以外 | NONE |
| CONTACT | B-037 型枠 | STD（提案先の名称の規則: formwork-foundation／formwork-body。決まらなければ NONE） |
| MATERIAL | B-038・B-044・B-045 鉄筋 | STD（提案先の名称の規則: rebar-required／rebar-assembly） |
| WASTE | 提案先の名称が標準規則 waste の細目 | STD(waste)。それ以外 NONE |
| OPENING | E-003・E-015・E-024（同一開口に複数回路が通っても開口1件） | NONE（note: 標準の「区画の線との交差」は回路ごとに数えるため使わない。貫通口ごとに点で拾う） |
| OPENING | M-055・M-103（壁床・開口・工法で個別） | STD(fire-penetration) |
| OPENING | A-door-18〜26（建具詳細の対象枠辺） | NONE |
| SURFACE | B-054 錆止め塗装 | STD(steel-paint) |
| SURFACE | B-055 耐火被覆 | STD(steel-fireproof) |
| SURFACE | A-door-27 | NONE |
| MARK | A-ceiling-01・A-wall-01・A-floor-01 | MARK（起点が壁のときだけ連動。天井・床・幅木の線は NONE） |
| MARK | A-roof-waterproof-05 | NONE |
| FILTER_ROUTE | E-020・M-010・M-011 | ROUTE_SURF（E-020 の面積は外周、長さは ROUTE_LEN）。起点が個数なら NONE |
| ROUTE・UNIQUE_ROUTE | E-001・E-002・E-121（経路から経路） | ROUTE_LEN |
| ROUTE | E-033・E-070・M-028・M-039（起点が機器・器具） | NONE |
| ENDPOINT | E-009 | ENDPOINT |
| POINT | E-034・E-039・M-013・B-028（起点1つに対象が1つと決まる） | PER_ORIGIN |
| POINT | それ以外（図示の設置点・系統図の位置・機器表の現物・撤去機器・埋設箇所・点検口 等） | NONE |
| BASEBOARD | B-111・A-wall-21・A-floor-29 | BASE_EDGE |
| BASEBOARD | A-floor-18（詳細図に示す対象線を別途拾う） | NONE |
| JOINT | B-134 壁際見切縁・廻り縁、A-ceiling-19 天井廻り縁 | CEIL_PERIM |
| JOINT | それ以外（伸縮目地・目地シール・ジョイナー・見切縁・下がり壁見切り縁・シーリング・カッター入れ・耐震スリット・手すり・棟包み・笠木・とい 等） | NONE |
| CORNER | A-wall-19 コーナービード | NONE |
| UPSTAND | A-roof-waterproof-27 | UPSTAND_H |
| BACKFILL | B-018 埋戻し | NONE（note: 標準の規則「埋戻し」で根切りを＋、基礎等を−の元にする） |
| FLOOR・CEILING_FINISH・ROOF・AREA・WALL_FINISH | 元施工面のうち同一部位・同一面側の対象範囲だけ | SAME_FACE |
| FLOOR | B-118 表面仕上げ対象面 | SAME_FACE |
| WALL_FINISH・FIRE_ASSEMBLY | 壁の対象面側ごとに施工線長×対象高さ（A-wall-22〜31・A-wall-25） | SAME_FACE（部位は壁。既定は片面。両面・仕上高さの違いは連動の係数・高さで直す旨を note に） |
| AREA | B-096 ガラス（建具内ガラスの実寸法） | STD(glass) が条件付きなら STD、`{}` なら NONE |
| FLOOR・ROOF・AREA・WALL_FINISH・CEILING_FRAME・WALL_FRAME | 対象工事独自の施工面を別途拾う／フィルム施工面だけ | NONE |
| 上に無い分類・元指定 | — | NONE |

- 起点が連動の項目（`origin.link`）のときは NONE（今までどおり）。
- 提案先の項目が既に連動を持っている（標準マスタから作られ、標準の規則が付いた）ときは、その連動を変えない（`existing-link`）。
- 複数のルールで期待が違うときは NONE（今までどおり）。

## B. 計画関数（`src/app/relatedLinkRules.ts`）

1. A の表を実装する。判定の入力は、ルールの `classId`・ルールID（例外の一覧）・起点と提案先の項目（部位・拾い方・種別）・案件区分。**原本の元指定の文字列は使わない**（点検で使うため）。例外のルールIDの一覧は、定数として `relatedLinkRules.ts` に持つ（コメントに原本の元指定を書く）。
2. `ScopeLinkPlan` に `{ kind: 'placement'; placement: 'route' | 'component' | 'point' }` を足し、`{ kind: 'existing' }` は廃止する（許可した配置だけ返す）。`limitNone` は廃止。
3. `AnnotationStore.applyRelatedAdditions` は、計画が `placement` のときだけ、その配置を行う（relatedAdditionKind が同じ配置を返すことを確かめ、違えば配置しない）。計画が `none` のときは配置もしない（項目だけ作る）。**ルール由来でない追加（scopeLink の無い追加）は今までどおり**。
4. 標準の規則から連動を作る処理（`FixtureDialog.tsx` の `linkFromRule`・`defaultRcLink`）を `src/core/breakdown/linkFromRule.ts` へ移して共有する（FixtureDialog の動作は変えない）。
5. 部位の判定 `partOf` に、経路の語「ラック」を足す。線（polyline）の項目のうち、名称・分類に 幅木・巾木・見切・目地・シール を含むものは、部位を「線の部材」として壁・床・天井と扱わない。

## C. 点検（`src/app/relatedLinkAudit.ts`）を厳密にする

1. 判定は「期待の表」との一致で行う。点検側の期待の表は **原本の分類と元指定の文字列**（`scopes.rules[id]` の classId と excelTarget の「元指定：」以降）とルールIDの例外から求める（計画関数のコードを呼ばない・定数を共有しない）。
2. 実際の結果は、計画が返す連動・配置を「何の数量が出るか」に直して比べる: `NONE`／`factor(area)`／`factor(length)`／`factor(openingArea)`／`factor(outerCircumference)`／`shape:<output>`／`route`／`component`／`point`／`rc:<output>`／`steel:<output>`／`crossing`／`mass`。
3. 期待と違えば ERROR（理由に、原本の分類・元指定・期待・実際を書く）。期待が連動なのに起点の拾い方で作れない（例: SAME_FACE で起点が線）ときの NONE は OK。
4. 既存の E1〜E8・W1 の判定は残してよいが、C-1〜3 を主にする。
5. `tests/relatedLinkAudit.test.ts`: 実データの全件点検で **ERROR が 0**。件数の要約を `console.log` する。期待の表の各行について、当たる例と当たらない例の単体試験。

## D. 試験

- `tests/relatedLinkRules.test.ts`: A の表の各行の例（RECORD の component が NONE、ビニル幅木の線 → 壁紙張りが NONE、壁の面 → 壁紙張りが factor、既存床材撤去が NONE、伸縮目地が NONE、天井 → 廻り縁が perimeter、冷凍機 → ポンプが NONE、照明器具 → 器具用ボックスが component、電線 → 電線管が route、型枠運搬が rc formwork、錆止め塗装が steel paint、防火区画貫通処理 E-003 が NONE、M-055 が crossing、新築の墨出しが NONE）。
- `tests/relatedLinkRules.store.test.ts`（T9 の数値の試験）が通ること。
- 既存の関連候補の試験（`tests/related*.test.ts`）・e2e のうち、今回の変更で期待が変わるものは、A の表に合わせて直す（どの試験をなぜ直したかを最後に一覧で書く）。

## 守ること

- 判定を甘くして ERROR を消さない。期待の表を変えない（表に疑問があれば最後に書く）。
- 新しい画面・保存キー・自由記入欄を作らない。保存形式を変えない。
