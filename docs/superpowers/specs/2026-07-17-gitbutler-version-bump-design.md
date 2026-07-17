# GitButlerを使うversion bump設計

## 目的

version bumpからnpmとrelease metadataの同期を残し、Gitによるstaging、commit、tag作成を取り除く。

release変更はGitButlerの専用branchで検証し、そのbranchをlandした後にだけdefault branchへ反映する。

## 現状

`npm version`は既定でGit commitとtagを作成する。

さらに`package.json`の`version` lifecycleは、`release.mjs`を実行した後に`git add manifest.json versions.json`を実行する。

そのため、リポジトリの運用がGitButlerへ移行した後も、通常の`npm version`はGitの書込み操作を前提としている。

現在のrelease手順は、このlifecycleを避けるために`--no-git-tag-version --ignore-scripts`を指定し、続けて`node release.mjs`を別に実行している。

この迂回はmetadata同期を二つのcommandへ分け、`version` lifecycleを使えない状態のまま残す。

## 検討した方針

### npmのGit動作だけを無効化する

`.npmrc`でnpm自身のGit commitとtagを無効化し、`version` lifecycleから`git add`を除く。

`release.mjs`によるmetadata同期は維持し、branch作成、commit、landをGitButlerへ任せる。

更新と反映の境界が分かれ、既存のmetadata同期も再利用できるため、この方針を採用する。

### GitButler操作までNode scriptへ組み込む

version bump用scriptからbranchを作成し、commitとlandまで実行する方法である。

しかし、scriptが既存の未commit変更の選別と全テストの成否まで扱う必要があり、失敗時の回復も複雑になる。

landは検証後の明示的な操作として残す。

### lifecycleを廃止する

`npm version`を`--ignore-scripts`で実行し、`release.mjs`を常に別commandとして呼ぶ方法である。

Git依存は避けられるが、package metadataとObsidian metadataの同期を忘れる経路が残るため採用しない。

## version bumpの責務

`.npmrc`へ`git-tag-version=false`を設定する。

これにより、`npm version <major|minor|patch>`は`package.json`と`package-lock.json`を更新するが、Git commitとtagを作成しない。

`package.json`の`version` lifecycleは`node release.mjs`だけを実行する。

`release.mjs`は更新後のpackage versionを`manifest.json`へ反映し、同じversionとminimum Obsidian versionを`versions.json`の先頭へ追加する。

version bumpが完了した時点では、四つのmetadata fileがGitButler workspaceの未commit変更として残る。

## GitButler release flow

release種別から次versionを決めた後、`codex/release-<version>` branchをGitButlerで作成する。

そのbranchを作成してから`npm version <major|minor|patch>`を実行する。

全テストが通った場合だけ、四つのmetadata fileをrelease branchへGitButlerでcommitする。

commit messageは英語のConventional Commitsとし、WhyとWhatをdescriptionへ含める。

最後に`but land <branch-id> --yes`でrelease branchをdefault branchへ反映する。

annotated tagの作成とrelease workflowの確認は、land後のdefault branch commitに対して`gh` CLIで行う既存手順を維持する。

## 失敗時の扱い

`npm version`またはmetadata同期が失敗した場合、release branchをlandしない。

testが一つでも失敗した場合も、release変更をcommitまたはlandしない。

別の未commit変更が存在する場合、release commitへ含めるのは四つのmetadata fileだけとする。

default branchへの反映前にupstreamが進んだ場合は、`but pull --check`と`but pull`を実行し、全検証をやり直す。

## 回帰検出

focused unit testは、repositoryの`.npmrc`が`git-tag-version=false`を設定していることを検査する。

同じtestは、`version` lifecycleが`node release.mjs`だけで構成され、Git commandを含まないことを検査する。

一時directoryへ`.npmrc`を含むrelease fixtureを作り、追加のflagを付けずに`npm version patch`を実行する。

Git repositoryがないfixtureでもpackage、lockfile、manifest、versionsのversionが揃うことを検証する。

release手順の文書は、GitButler branchの作成、`npm version`、検証、commit、landの順序を明記する。

## 完了条件

- 通常の`npm version <major|minor|patch>`がGit commit、Git staging、Git tagを実行しない。
- `npm version`一回で四つのmetadata fileが同じversionへ更新される。
- release変更は`codex/release-<version>` branchで検証してからlandされる。
- test失敗時にdefault branchへrelease変更が入らない。
- land後のannotated tagとGitHub release確認手順を維持する。
