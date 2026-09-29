# SPEC-01f-4: 拡大した後に鮮明にならないことがある不具合

## 実行モデル指定（必須）

- モデル: `gpt-5.6-sol`
- reasoning effort: `high`
- 選定理由: 描画の要求の中核（PageView の詳細描画の状態遷移）にある、再現が不安定な不具合の原因調査と修正のため

---

## 目的

SPEC-01f-3 で Worker を「文書用1本＋描画用3本」に分けた後、`npx playwright test --project=bench perf.spec` を5回実行したところ、**2回、400% に拡大した後で `isSharp()` が 180 秒たっても true にならなかった**。

利用者の画面では、**拡大した後、ページがぼやけたまま鮮明にならない**ことになる。

失敗したときの診断（`render-diagnostics`）の抜粋:

```
zoom-settle p1
scroll: {left: 0, top: 4190}, zoomText: "400%"
visiblePages:
  {page: 1, sharp: "false", visible: "true", zoomStable: "true", usesDetail: "true", detailStage: "none", detailKey: null}
  {page: 2, sharp: "false", visible: "true", zoomStable: "true", usesDetail: "true", detailStage: "none", detailKey: null}
requests: 低解像度とプレビュー（x=1.333333 など）の要求はあるが、detail の要求は1件も無い
```

- 見えている2ページとも、詳細描画を使う倍率なのに、**詳細（第1段）の要求そのものが出ていない**。
- SPEC-01a-2 で「倍率変更時に、第1段の要求を 0ms タイマーで設定していて、再描画の cleanup がタイマーを消す競合」を直している。しかし、同じ種類の競合が別の経路で残っていると考えられる。
- 例えば、次のような経路が考えられる。
  - `visible` と `zoomStable` と viewport の更新の順番
  - `detail` の state を消してから次の要求を出すまでの間の再描画
  - Worker の担当が変わったこと

## 対象

- 変更してよいファイル: `src/viewer/`、`src/client/`、`tests/`、`e2e/perf.spec.ts`
- 変更しないファイル: それ以外のすべて

## 変更内容

1. **原因を突き止める**
   - `perf.spec` の zoom-settle で失敗が起きる条件を、繰り返し実行して再現させる（最大 10 回）。
   - 詳細描画の状態（desired region、stage、timer の設定と解除、release）の遷移のログを取り、要求が出なかった経路を特定する。
2. **「要求が出ないまま止まる」ことが構造的に起きない形に直す**
   - 詳細の要求を、タイマーや直前の state に頼らず、**描画のたびに「見えている範囲」と「今の倍率」から求めた、あるべき要求**と比べて出し直す形（冪等な同期）にする。
   - 例: `useEffect` の依存に「望ましい第1段の key」を入れ、key が変われば want/release する。
   - 60ms の待ち（スクロール中の間引き）は残してよい。ただし、待っている間に cleanup で消えても、次の描画で必ず出し直される作りにする。
3. **安全網**
   - 見えていて、`usesDetail` なのに、500ms 以上、第1段の要求も完成した詳細も無いページがあれば、要求を出し直す。
   - 出し直した回数は、デバッグパネルとテスト用の窓口から見えるようにする。安全網が働いた場合は、原因の修正が不完全である印として扱う。
4. **回帰テスト**
   - `tests/` に、詳細描画の状態遷移を再現する単体テストを加える（倍率変更 → viewport の更新 → cleanup の順番の組み合わせ）。
   - `perf.spec` を**5回続けて**成功させる。

## 禁止事項

- 待ち時間の上限を延ばすだけの修正はしないこと。計測の条件を緩めないこと。
- 対象外のファイルを変更しないこと。git の変更操作をしないこと。
- 自分で起動したサーバーは必ず止め、一時ファイルは削除すること。

## 検証項目

- [ ] `npm run build`、`npm test`、`npm run e2e` がすべて成功する。
- [ ] `npx playwright test --project=bench perf.spec` が 5 回続けて成功する。安全網の出し直しの回数を報告する（0 回が望ましい）。

## 報告してほしいこと

- 原因（要求が出なかった経路）と、直し方
- 5 回分の結果（zoom、pan、scroll）と、安全網の出し直しの回数
- 変更したファイル
- 逸脱と残課題
