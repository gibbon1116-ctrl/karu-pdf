# SPEC-04a: リポジトリの保護（PR の検査・Pages の手動公開・Actions の固定）

## 実行モデル指定（必須）

- モデル: `gpt-6.1-sol`
- reasoning effort: `high`
- 選定理由: GitHub Actions の権限とトリガーを変える、セキュリティに関わる変更のため。書き損じると公開版が意図せず変わる、または公開できなくなる

---

## 目的

第三者・連携アプリ・AI ツール・管理者本人の誤操作で、ソースコードや GitHub Pages の公開版が意図せず変わる危険を下げる（2026-10-03 の改修指示書）。

```
作業ブランチ → Pull Request → CI（自動検査）→ main へマージ → 自動では公開しない → 管理者が手動で Pages へ公開
```

GitHub 側の設定（Ruleset など）はこの SPEC の対象外。管理者が画面で行う（`docs/セキュリティ/リポジトリの保護.md`）。

## 守ること（厳守）

- **`src/`、`scripts/`、`tests/`、`e2e/`、`public/`、`index.html`、`vite.config.ts`、`package.json`、`package-lock.json`、`.env.*` は一切変更しない。** アプリの動作・固定版・HTML 版を変えない
- 変更してよいファイルは「変更するファイル」の5つだけ
- `actions/*` の commit SHA は下の表の値を**一字一句そのまま**使う。推測で書き換えない。別の Action や Fork へ変えない
- 外部通信（解析・CDN・API など）を追加しない
- `pull_request_target` を使わない。`secrets.*` を参照しない
- git 操作をしない。テストやビルドを実行しない（Claude Code 側で行う）

## 確認済みの commit SHA（2026-10-03、`git ls-remote` と GitHub API で公式リポジトリの commit であることを確認）

| Action | 今のタグ | 固定する SHA | 対応する版 |
|---|---|---|---|
| `actions/checkout` | `v5` | `fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09` | v5.1.0 |
| `actions/setup-node` | `v5` | `a0853c24544627f65ddf259abe73b1d18a591444` | v5.0.0 |
| `actions/configure-pages` | `v5` | `983d7736d9b0ae728b81ab479565c72886d7745b` | v5.0.0 |
| `actions/upload-pages-artifact` | `v3` | `56afc609e74202658d3ffba0e8f6dda462b719fa` | v3.0.1 |
| `actions/deploy-pages` | `v4` | `d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e` | v4.0.5 |
| `actions/upload-artifact` | `v4` | `ea165f8d65b6e75b540449e92b4886f43607fa02` | v4.6.2 |

書き方は `uses: actions/checkout@<SHA> # v5.1.0`（行末コメントに版を書く。Dependabot がこのコメントも更新する）。メジャー版は今と同じものに留め、上げない。

## 変更するファイル

### 1. `.github/workflows/ci.yml`（新規）

次の内容で作る。

```yaml
name: CI

# main へ入る前の検査。外部の Fork からの PR でも、読み取り権限だけで動き、Secrets を渡さない。
on:
  pull_request:
    branches: [main]

permissions:
  contents: read

concurrency:
  group: ci-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  # Ruleset の必須チェックはこの job 名（test-build）で指定する。名前を変えるときは Ruleset も直す。
  test-build:
    name: test-build
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5.1.0
        with:
          persist-credentials: false
      - uses: actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444 # v5.0.0
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - name: 通信の監査（ソース）
        run: npm run audit:network
      - run: npm test
      - name: 公開用ビルド（型検査を含む）
        run: npm run build
      - name: 固定版のビルドと通信の監査
        run: |
          npm run build:fixed
          npm run audit:network -- --dist
      - name: HTML 版のビルドと通信の監査
        run: |
          npm run build:single
          npm run audit:network -- --single
```

### 2. `.github/workflows/deploy.yml`（変更）

変更点は次のとおり。それ以外（ワークフロー名、`concurrency`、`node-version`、`npm ci` → `npm test` → `npm run build` の順、`path: dist`、environment の名前と url）は今のまま残す。

1. `on:` から `push:` を削除し、`workflow_dispatch:` だけにする。直前にコメント `# main を更新しても公開しない。公開するときは管理者が Actions の画面から手動で実行する。` を入れる
2. ワークフロー全体の `permissions` を `contents: read` だけにする。`pages: write` と `id-token: write` は `deploy` job の `permissions` に移す（`contents: read`、`pages: write`、`id-token: write`）。`build` job にも `permissions: contents: read` を書く
3. `build` job に `if: github.ref == 'refs/heads/main'` を付ける（main 以外から実行したら何もせず終わる。github-pages 環境の「main だけ」の制限と二重の守り）
4. `build` job の最初の step（checkout の前）に、公開するコミットをログと実行結果の要約へ出す step を入れる。

   ```yaml
      - name: 公開するコミット
        env:
          DEPLOY_SHA: ${{ github.sha }}
          DEPLOY_REF: ${{ github.ref }}
          DEPLOY_ACTOR: ${{ github.actor }}
        run: |
          echo "Deploy commit: $DEPLOY_SHA"
          echo "Deploy ref: $DEPLOY_REF"
          {
            echo "### GitHub Pages へ公開するコミット"
            echo ""
            echo "- commit: \`$DEPLOY_SHA\`"
            echo "- ref: \`$DEPLOY_REF\`"
            echo "- 実行者: $DEPLOY_ACTOR"
          } >> "$GITHUB_STEP_SUMMARY"
   ```

5. checkout に `with: persist-credentials: false` を付ける
6. 全 `uses:` を上の表の SHA に置き換える

### 3. `.github/workflows/fixed-release.yml`（変更）

- `uses:` を上の表の SHA に置き換える（checkout、setup-node、upload-artifact）
- checkout に `with: persist-credentials: false` を付ける
- それ以外（`workflow_dispatch` だけのトリガー、`permissions: contents: read`、`npm run release:fixed`、`npm run release:single`、artifact 名 `karu-pdf-fixed`、`path: release/`、`if-no-files-found: error`）は変えない

### 4. `.github/dependabot.yml`（新規）

次の内容で作る。自動マージの設定は書かない（PR を作るまで。CI が通ったら人が中身を見てマージする）。

```yaml
# 依存関係の更新を Pull Request として提案させる。自動ではマージしない。
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
    open-pull-requests-limit: 5
    groups:
      npm-minor-patch:
        update-types: [minor, patch]
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
    open-pull-requests-limit: 5
```

### 5. `README.md`（1行だけ変更）

53行目の表の行

```
| 更新 | 開発版を自動公開（アプリ内で更新を案内） | 承認した版を固定し、管理者が手で更新 |
```

を

```
| 更新 | 管理者が Actions から手動で公開（アプリ内で更新を案内） | 承認した版を固定し、管理者が手で更新 |
```

に変える。README のほかの行は変えない。

## 受け入れ条件

- 変更されたファイルが上の5つだけである
- `ci.yml` の job id と `name` がどちらも `test-build`
- `deploy.yml` の `on:` に `push` が無く、`workflow_dispatch` だけ
- `deploy.yml` のワークフロー全体の権限は `contents: read` だけで、`pages: write` と `id-token: write` は `deploy` job だけにある
- 3つのワークフローのどこにも `@v` で終わるタグ指定が残っていない（全部 40 桁の SHA）
- どのワークフローにも `contents: write`、`actions: write`、`pull_request_target`、`secrets.` が無い
- YAML として正しく読める（インデントは2スペース）
