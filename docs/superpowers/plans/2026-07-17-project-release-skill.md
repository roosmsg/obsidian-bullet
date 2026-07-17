# Project Release Skill Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** このリポジトリ固有のversion releaseを、安全に完了または再開できるrepo-local skillとして実装し、そのskillで次のpatch releaseを公開する。

**Architecture:** `.agents/skills/release/`へ自己完結した手順型skillを置く。
`AGENTS.md`をrelease policyのsource of truthとし、skillは状態判定、実行順序、停止条件、完了条件を固定する。
既存の`npm version` lifecycle、GitButler、`gh` CLI、GitHub Actionsを使い、新しいrelease runnerは追加しない。

**Tech Stack:** Markdown skill、GitButler CLI、npm、Node.js 22.23.1以上の22系、GitHub CLI、GitHub Actions

---

### Task 1: Capture the pre-skill baseline

**Files:**

- Read: `AGENTS.md`
- Read: `package.json`
- Read: `.npmrc`
- Read: `release.mjs`
- Read: `.github/workflows/release.yml`

**Step 1: Run the normal-release scenario without the skill**

別agentへ、read-onlyで「新しいpatch versionをreleaseして」と依頼する。

変更を禁止し、実行順序、停止条件、完了条件だけを回答させる。

**Step 2: Run the interrupted-release scenario without the skill**

default branchのmetadataだけが先行し、tagまたはGitHub Releaseが欠け、無関係なGitButler branchも適用中というscenarioを別agentへ渡す。

追加bumpの有無、test失敗時の停止、branch ownershipの扱いを回答させる。

**Step 3: Record the baseline gaps**

両回答を比較し、順序の欠落、曖昧な停止条件、重複bumpの危険、Git write commandの混入を列挙する。

少なくとも一つの再現可能なgapをskill本文で解消できたら完了とする。

### Task 2: Commit this implementation plan

**Files:**

- Create: `docs/superpowers/plans/2026-07-17-project-release-skill.md`

**Step 1: Inspect the plan diff**

Run: `but diff`

Expected: このplan fileだけがuncommitted changeとして表示される。

**Step 2: Commit the plan to the existing skill branch**

`but diff`からchange IDを取得し、次のConventional Commitを`codex/project-release-skill`へ作成する。

```text
docs(release): plan the project release skill

Why:
- The approved release-skill design needs an executable, testable sequence.

What:
- Define baseline scenarios, skill implementation, validation, landing, and live patch-release checks.
```

**Step 3: Verify branch ownership**

Run: `but status -fv`

Expected: planは`pr` branchにあり、`gi` branchの既存変更は移動していない。

### Task 3: Initialize and implement the repo-local skill

**Files:**

- Create: `.agents/skills/release/SKILL.md`
- Create: `.agents/skills/release/agents/openai.yaml`

**Step 1: Generate the standard scaffold**

Run:

```bash
python3 /Users/kodai/.codex/home/skills/.system/skill-creator/scripts/init_skill.py release \
  --path .agents/skills \
  --interface 'display_name=Release' \
  --interface 'short_description=Safely publish this plugin version' \
  --interface 'default_prompt=Use $release to publish the next project version.'
```

Expected: `release/SKILL.md`と`release/agents/openai.yaml`が作成され、resource directoryやexampleは作成されない。

**Step 2: Replace the template with the minimal procedural contract**

`SKILL.md`のfrontmatterを次にする。

```yaml
---
name: release
description: Use when releasing, publishing, version-bumping, or resuming an interrupted version of the obsidian-bullet repository, including major, minor, patch, tag, workflow, and GitHub Release requests.
---
```

本文は次の責務を、この順番で持つ。

1. repo rootの`AGENTS.md`を全文読み、矛盾時はそちらを優先する。
2. release種別が未指定の場合だけ、`1. major`、`2. minor`、`3. patch`を確認する。
3. `but pull --check`と`but pull`、Node.js 22.23.1以上の22系、`gh auth status -h github.com`をpreflight gateにする。
4. local metadata、default branch metadata、remote tag、GitHub Releaseを照合し、通常releaseか中断復旧かを決める。
5. 通常releaseではversion算出後に`codex/release-<version>` branchを先に作り、`AGENTS.md`指定の`npm version` flowを実行する。
6. `package.json`、`package-lock.json`、`manifest.json`、`versions.json`だけが揃ったことを確認する。
7. `AGENTS.md`のvault backup/restore規則を含むfull verificationを完了し、失敗時はlandしない。
8. 四fileだけをGitButlerでcommitし、`but land <branch-id> --yes`でdefault branchへ反映する。
9. land先commitを指すannotated tagを`gh api`で作り、tag-triggered workflowと同versionのGitHub Release公開を`gh` CLIで確認する。
10. 中断復旧ではversionを増やさず、完了済み段階を再実行しない。

各段階にcheck可能な完了条件を置く。

`git add`、`git commit`、`git tag`、`git push`を代替手段として提示しない。

無関係なGitButler branchがrelease metadataを所有する場合は、そのbranchを暗黙にlandせず停止する。

**Step 3: Remove every placeholder**

Run:

```bash
rg -n 'TODO|\[TODO|Example Skill|Replace with' .agents/skills/release
```

Expected: matchなし。

### Task 4: Validate and forward-test the skill

**Files:**

- Verify: `.agents/skills/release/SKILL.md`
- Verify: `.agents/skills/release/agents/openai.yaml`

**Step 1: Validate skill structure**

Run:

```bash
uv run --with pyyaml python \
  /Users/kodai/.codex/home/skills/.system/skill-creator/scripts/quick_validate.py \
  .agents/skills/release
```

Expected: `Skill is valid!`

**Step 2: Check size and UI metadata**

Run:

```bash
wc -l -w .agents/skills/release/SKILL.md
sed -n '1,80p' .agents/skills/release/agents/openai.yaml
```

Expected: `SKILL.md`は500行未満で、`default_prompt`が`$release`を明示する。

**Step 3: Forward-test the normal-release scenario**

fresh agentへskill pathと通常のpatch release依頼を渡し、read-onlyで回答させる。

Expected: release種別を再確認せず、branch-first、metadata gate、full tests、land、annotated tag、workflow、GitHub Releaseまで順番どおりに含む。

**Step 4: Forward-test recovery and failure scenarios**

fresh agentへ、tag欠落、test失敗、無関係branch ownership、GitHub認証失敗を含むread-only scenarioを渡す。

Expected: 追加bumpをせず、失敗点より後へ進まず、無関係branchをlandしない。

**Step 5: Refactor only observed gaps**

baselineまたはforward testで再現したgapだけを本文へ反映し、Step 1から再実行する。

### Task 5: Commit and land the skill

**Files:**

- Commit: `.agents/skills/release/SKILL.md`
- Commit: `.agents/skills/release/agents/openai.yaml`

**Step 1: Review the exact diff**

Run: `but diff`

Expected: skillの二fileだけがuncommittedで、`gi` branchの既存変更は含まれない。

**Step 2: Commit the skill**

次のConventional Commitを`codex/project-release-skill`へ作成する。

```text
feat(release): add the project release skill

Why:
- Agents need one deterministic entry point for complete and interrupted releases.

What:
- Add a repository-local release skill with preflight, verification, stop, recovery, tagging, workflow, and publication gates.
```

**Step 3: Recheck upstream and land**

Run:

```bash
but pull --check
but pull
but land pr --yes
```

Expected: skill branchだけがdefault branchへ反映され、`gi` branchは未landのまま残る。

### Task 6: Use the new skill for the patch release

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `manifest.json`
- Modify: `versions.json`

**Step 1: Load the landed skill and run its state audit**

`.agents/skills/release/SKILL.md`を全文読み、以後はそのcompletion gateに従う。

default branch version、remote tag、GitHub Releaseを照合する。

Expected: 未完了の5.9.4がなければnext versionは5.9.4、あれば追加bumpなしで復旧flowへ入る。

**Step 2: Resolve release metadata ownership before mutation**

Run: `but status -fv`

Expected: release対象の四fileを所有する無関係branchがない。

`gi` branchの未land変更が安全なversion lifecycleの前提であり、release branchをそのdependencyなしに作れない場合は、`gi`を暗黙にlandしない。

その場合だけ、releaseを停止してユーザーへ`gi`のland権限を確認する。

**Step 3: Execute the normal or recovery flow**

通常flowでは、Node.js 22.23.1以上の22系を使い、release branch作成後に`npm version patch`を実行する。

recovery flowではversion commandを実行しない。

**Step 4: Run the complete verification gate**

`vault/test.md`をvault外へbackupし、CI相当のlint、`npm run build-with-tests`、full testを実行する。

test renderer終了後にfixtureをrestoreし、hash一致を再確認する。

Expected: すべて成功し、release branchの変更は四metadata fileだけである。

**Step 5: Commit, land, tag, and observe publication**

GitButlerで四fileだけをcommitしてlandする。

`gh api`でland先commitを指すannotated tagを作る。

`gh run watch`相当でrelease workflowを監視し、同versionのGitHub Releaseが公開されたことを確認する。

Expected: default branch metadata、annotated tag、successful workflow、published GitHub Releaseのversionがすべて一致する。
