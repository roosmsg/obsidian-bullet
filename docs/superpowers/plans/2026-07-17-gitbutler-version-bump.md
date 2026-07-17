# GitButler Version Bump Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `npm version` update all release metadata without Git writes, so a tested GitButler release branch can be committed and landed explicitly.

**Architecture:** Disable npm's built-in Git commit and tag behavior in repository configuration, and keep the npm `version` lifecycle limited to `release.mjs`. Protect the boundary with a repository-policy test and an end-to-end temporary fixture that runs the real npm version lifecycle without a Git repository.

**Tech Stack:** Node.js 22.23.1 or newer in the 22.x line, npm, TypeScript 5.9, Jest 30, GitButler CLI 0.21.

## Global Constraints

- Do not change the current package version `5.9.3` while implementing this workflow.
- Do not run Git write commands or create a local Git tag.
- Use `but` for every version-control write.
- Keep `release.mjs` as the single synchronizer for `manifest.json` and `versions.json`.
- Create future release work on `codex/release-<version>` before running `npm version`.
- Land a future release branch only after the full release verification passes.
- Preserve the existing post-land annotated-tag and GitHub release workflow.

---

### Task 1: Move version bumping onto the GitButler release boundary

**Files:**

- Create: `src/__tests__/releaseWorkflow.test.ts`
- Modify: `.npmrc`
- Modify: `package.json`
- Modify: `AGENTS.md`

**Interfaces:**

- Consumes: npm's repository-local `git-tag-version` configuration.
- Consumes: the existing `node release.mjs` metadata synchronizer.
- Produces: a Git-free `npm version <major|minor|patch>` operation that updates `package.json`, `package-lock.json`, `manifest.json`, and `versions.json`.
- Produces: an explicit release sequence of `but branch new`, `npm version`, verification, `but commit`, and `but land`.

- [ ] **Step 1: Write the failing release-workflow tests**

Create `src/__tests__/releaseWorkflow.test.ts`:

```ts
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const projectRoot = join(__dirname, "../..");

type PackageFile = {
  version: string;
  scripts: { version: string };
};

type PackageLockFile = {
  version: string;
  packages: { "": { version: string } };
};

type ManifestFile = {
  version: string;
  minAppVersion: string;
};

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function runNpmVersion(cwd: string) {
  const npmCli = process.env.npm_execpath;
  const command = npmCli ? process.execPath : "npm";
  const args = npmCli ? [npmCli, "version", "patch"] : ["version", "patch"];

  return spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_git_tag_version: undefined,
      npm_config_ignore_scripts: undefined,
      npm_config_update_notifier: "false",
    },
  });
}

describe("release version workflow", () => {
  test("disables npm Git commit and tag creation", () => {
    const npmConfig = readFileSync(join(projectRoot, ".npmrc"), "utf8");

    expect(npmConfig).toMatch(/^git-tag-version=false$/m);
  });

  test("limits the version lifecycle to metadata synchronization", () => {
    const packageFile = readJson<PackageFile>(
      join(projectRoot, "package.json"),
    );

    expect(packageFile.scripts.version).toBe("node release.mjs");
  });

  test("synchronizes release metadata without a Git repository", () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "bullet-version-"));
    const fixtureFiles = [
      ".npmrc",
      "package.json",
      "package-lock.json",
      "manifest.json",
      "versions.json",
      "release.mjs",
    ];

    try {
      for (const file of fixtureFiles) {
        copyFileSync(join(projectRoot, file), join(fixtureRoot, file));
      }

      const previousVersion = readJson<PackageFile>(
        join(fixtureRoot, "package.json"),
      ).version;
      const result = runNpmVersion(fixtureRoot);

      expect({
        status: result.status,
        stdout: result.stdout,
        stderr: result.stderr,
      }).toMatchObject({ status: 0 });
      expect(existsSync(join(fixtureRoot, ".git"))).toBe(false);

      const packageFile = readJson<PackageFile>(
        join(fixtureRoot, "package.json"),
      );
      const packageLockFile = readJson<PackageLockFile>(
        join(fixtureRoot, "package-lock.json"),
      );
      const manifestFile = readJson<ManifestFile>(
        join(fixtureRoot, "manifest.json"),
      );
      const versionsFile = readJson<Record<string, string>>(
        join(fixtureRoot, "versions.json"),
      );

      expect(packageFile.version).not.toBe(previousVersion);
      expect(packageLockFile.version).toBe(packageFile.version);
      expect(packageLockFile.packages[""].version).toBe(packageFile.version);
      expect(manifestFile.version).toBe(packageFile.version);
      expect(Object.keys(versionsFile)[0]).toBe(packageFile.version);
      expect(versionsFile[packageFile.version]).toBe(
        manifestFile.minAppVersion,
      );
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --version
npm run test:unit -- --runInBand src/__tests__/releaseWorkflow.test.ts
```

Expected: Node reports 22.23.1 or newer in the 22.x line, and Jest fails because `.npmrc` does not disable Git versioning, the lifecycle still contains `git add`, and the temporary lifecycle exits nonzero outside a Git repository.

- [ ] **Step 3: Disable npm Git writes**

Change `.npmrc` to:

```ini
tag-version-prefix=""
git-tag-version=false
```

Change the `package.json` lifecycle to:

```json
"version": "node release.mjs"
```

Do not change the top-level package version or run `npm install`.

- [ ] **Step 4: Record the GitButler release sequence**

Replace the release branch and version-update instructions in `AGENTS.md` with:

```markdown
- リリース種別の回答を受けたら、次versionを算出し、`but branch new codex/release-<version>`でGitButler上にrelease branchを作成してください。pull requestの作成は不要です。
- `.npmrc`の`git-tag-version=false`により、`npm version <major|minor|patch>`はGit commitやtagを作成しません。このcommandでpackage metadataを更新し、`version` lifecycleの`node release.mjs`で`manifest.json`と`versions.json`も同期してください。`--ignore-scripts`は付けず、lifecycleを実行してください。
- release branchをdefault branchへ取り込む前に全テストを実行し、すべて通ることを確認してください。全テストが通らない状態では取り込まないでください。
- version変更の四つのmetadata fileだけをGitButlerでrelease branchへcommitした後、`but land <branch-id> --yes`でdefault branchへ反映してください。
```

Keep the following annotated-tag, workflow-monitoring, and interrupted-release recovery instructions unchanged.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run:

```bash
npm run test:unit -- --runInBand src/__tests__/releaseWorkflow.test.ts
```

Expected: all three tests pass, and the temporary `npm version patch` updates every metadata file without creating `.git`.

- [ ] **Step 6: Run repository verification**

Run:

```bash
node --version
npm run lint
npm run test:unit -- --runInBand
```

Expected: Node is 22.23.1 or newer in the 22.x line, Prettier and ESLint report no errors, and all source unit tests pass.

Confirm that the repository package version remains `5.9.3`:

```bash
node -p "require('./package.json').version"
```

Expected: `5.9.3`.

- [ ] **Step 7: Commit the tested workflow to the existing GitButler branch**

Inspect the exact file IDs with:

```bash
but diff
```

Commit only `.npmrc`, `package.json`, `AGENTS.md`, `src/__tests__/releaseWorkflow.test.ts`, and this plan to `codex/gitbutler-version-bump` with this message:

```text
chore(release): move version bumps to GitButler

Why:
- npm version still performed Git staging, commits, and tags outside the repository's GitButler workflow.

What:
- Disable npm Git versioning and keep the lifecycle focused on metadata synchronization.
- Document branch-first release landing and cover it with an end-to-end regression test.
```

Expected: the returned GitButler workspace state shows the commit on `codex/gitbutler-version-bump` and no unrelated changes assigned to it.
