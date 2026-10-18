# SPEC-T11: 全ルール点検（T10）で見つかった誤りの全件修正

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol` / reasoning effort: `high`
- 選定理由: 計画関数の優先順位と点検の判定を、原本 Excel の根拠に沿って同時に直す判断を伴うため。

## 点検結果（修正前）

858ルール・12,910通りのうち、ERROR 21ルール・181通り、REVIEW 74通り。Claude が原本 Excel と照合して、実装の誤りと判定の誤りに分けた。

## A. 計画関数（`src/app/relatedLinkRules.ts`）の修正

判定の順序を次のとおりにする（上から先に当たったものを使う）:

1. **数量を作らない分類**: 範囲の分類が RECORD・PLAN、又は DETAIL・PROTECT・PROTECT_ACTUAL・SCAFFOLD・CRACK・DEFECT_POINT・PATCH・OPENING・PROPERTY・MATERIAL・VOLUME・WASTE・CONTACT・WALL_FRAME・CEILING_FRAME・HANGING で、手順 2 の標準の規則が無いもの → `none`。**提案先の名称による表（幅木・塗装 等）より先に判定する**（A-floor-19 の誤り）。
2. **標準の連動規則**（`src/core/breakdown/linkRules.ts` の `linkRuleForDetail(target.name)`、無ければ提案先の内訳書の細目名）があれば、その規則の連動を使う（型枠運搬＝RC の型枠、錆止め塗装＝鉄骨の表面積、鉄筋、延べ面積 等）。規則の `auto` が空（{}）のときは、手順 3 と同じ起点の条件（originAny）を自動の元にする。規則の `auto` に rcKinds・outputKinds 等があればそのまま使う。
3. SPEC-T9 の表（墨出し・幅木・見切り・立上り・塗装・保温・同じ面の別作業）。追加・変更:
   - 墨出し（MARK）: 関連元の部位が壁でないとき（幅木の線など）は `none`。**MARK・PLAN の墨出しには経路（route）を付けない**。
   - WALL_FINISH・CAVITY で関連元が線（polyline）の壁 → `shape: lengthTimesHeight`（高さは既存の警告で入力を促す）。経路に入れない（A-wall-31）。
   - FIRE_ASSEMBLY（耐火間仕切の一括）で関連元が壁の面 → 面積を使う `factor`（原本の比較例: 片面基準の壁面積）。
   - 提案先の名称に「撤去」を含み、関連元が個数（click）で開口の寸法を持つ（建具）→ 提案先が面積なら `factorFrom: 'openingArea'`。
4. **既存の処理（relatedAdditionKind）**: route・point・component はそのまま。factor・perimeter になる場合は:
   - 関連元が個数（click）で提案先が個数以外 → `none`（個数を長さ・面積・体積へ写さない。B-018・B-028・B-161・A-ceiling-16）。
   - それ以外は、押した1項目ではなく起点の条件の自動の元（originAny）にする（W1 の解消）。

## B. 点検の判定（`src/app/relatedLinkAudit.ts`）の修正 — 原本の根拠がある判定の誤りだけ

1. BRANCH（親の分岐）は、親の分類ではなく **子の定義の算出方式** で判定する。子に F_SUBSET・F_UNIQUE があり単位が提案先と同じ（m）なら、元の経路の長さを使う連動（factor・route）を誤りにしない。子に F_EDGE があり提案先が長さなら、外周・底辺（shape: perimeter・baseLength）を誤りにしない。
2. FIRE_ASSEMBLY を「同じ面の別作業」に入れる（原本の比較例「耐火間仕切: 片面基準面 34㎡」）。
3. E6（塗装・保温の表面積）: 提案先が経路の部材として外周から面積を出す既存の仕組み（route で、提案先が `isRouteSurfaceFixture`）で、関連元がダクト・配管のときは誤りにしない。関連元が鉄骨のときは誤りのまま（鉄骨は標準規則の steel paint を使う）。
4. 判定の表と計画関数の表は、引き続き共有しない。

## C. 試験

- `tests/relatedLinkAudit.test.ts`: 実データの全件点検で **ERROR が 0** であることを確かめる。REVIEW は件数と一覧を記録し、W1（元が押した1項目だけ）が 0 であること。
- `tests/relatedLinkRules.test.ts` に、A の各変更の例を足す（A-floor-19 は none、型枠運搬は rc formwork、錆止め塗装は steel paint、幅木の線からの墨出しは none、線の壁の塗装は lengthTimesHeight、建具撤去は openingArea、杭→杭頭処理は none、既存床材撤去は originAny の自動の元）。
- 既存の試験が通ること。

## 守ること

- 判定を甘くして ERROR を消さない。B の 3項目以外の判定は変えない。
- 新しい画面・保存キー・自由記入欄を作らない。
