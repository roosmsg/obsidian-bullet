# Restore Vertical Guide Folding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore legacy vertical-guide clicks so they batch-toggle direct child branches without folding the represented parent or reopening a branch that contains the cursor.

**Architecture:** Keep the native `.cm-indent::before` rendering and capture-phase guide handler unchanged. Replace only `toggleVerticalGuideTarget`'s parent-self fold with the legacy direct-child batch algorithm, routing child folds through `MyEditor.foldEnsuringCursorVisible`.

**Tech Stack:** TypeScript 5.9, Obsidian 1.13.1, CodeMirror 6, Jest 30, Rollup 4.

## Global Constraints

- Use normal `git` on `main`; do not use GitButler.
- Do not reintroduce overlay DOM, measurements, coordinate caches, or scroll synchronization.
- Keep `.cm-indent::before` as the only vertical-guide rendering source.
- Keep `contentDOM` capture-phase `mousedown` handling and listener cleanup unchanged.
- Keep the current native guide-to-immediate-parent mapping unchanged.
- Never fold or unfold the represented parent itself from a vertical-guide click.
- Ignore direct leaves and batch-toggle only direct children for which `isEmpty()` is false.
- If any collected child is open, fold every collected child; if all are folded, unfold every collected child.
- Use each child branch's own first-line content start as the fallback cursor when folding.
- Build with `npm run build-with-tests` before running the full Jest suite because Markdown integration specs execute `dist/main.js`.
- Use English Conventional Commits with detailed `Why` and `What` sections.
- Do not release or change the package version unless the user separately requests a release.
- Use the repository's `/Users/kodai/workspaces/github.com/kdnk/obsidian-bullet/vault` for manual Obsidian verification; never copy test artifacts or notes into `/Users/kodai/base`.

---

## File Structure

- Modify: `src/features/VerticalLines.ts` — implement direct-child batch folding and unfolding.
- Modify: `src/features/__tests__/VerticalLines.test.ts` — restore the legacy helper contract and handler-level regression coverage.
- Modify: `docs/superpowers/plans/2026-07-13-restore-vertical-guide-folding.md` — record completed steps and final verification evidence.
- Temporary manual-test fixture: `vault/vertical-guide-regression-test.md` — exercise the built plugin in the repository's test vault, then remove it after verification.

### Task 1: Restore the Direct-Child Batch Contract

**Files:**
- Modify: `src/features/__tests__/VerticalLines.test.ts:217-415`
- Modify: `src/features/VerticalLines.ts:22-38`

**Interfaces:**
- Consumes: `List.getChildren(): List[]`, `List.isEmpty(): boolean`, `List.isFolded(): boolean`, and `List.getFirstLineContentStart(): MyEditorPosition`.
- Consumes: `MyEditor.foldEnsuringCursorVisible(line: number, fallbackCursor: MyEditorPosition): void` and `MyEditor.unfold(line: number): void`.
- Produces: `toggleVerticalGuideTarget(editor, list): boolean`, where `true` means a direct-child batch action was selected and `false` means the target has no foldable direct child branches.

- [ ] **Step 1: Replace the parent-self helper tests with the legacy batch expectations**

Replace the first two tests in `describe("toggleVerticalGuideTarget")` with:

```ts
test("folds each direct non-empty child when any branch is open", () => {
  const root = makeRoot({
    editor: makeEditor({
      text,
      cursor: { line: 0, ch: 0 },
      getAllFoldedLines: () => [1],
    }),
  });
  const parent = root.getListUnderLine(0);
  if (!parent) {
    throw new Error("Expected a parent list");
  }
  const editor = makeFoldEditor();

  expect(toggleVerticalGuideTarget(editor, parent)).toBe(true);
  expect(editor.foldEnsuringCursorVisible).toHaveBeenNthCalledWith(1, 1, {
    line: 1,
    ch: 4,
  });
  expect(editor.foldEnsuringCursorVisible).toHaveBeenNthCalledWith(2, 4, {
    line: 4,
    ch: 4,
  });
  expect(editor.foldEnsuringCursorVisible).toHaveBeenCalledTimes(2);
  expect(editor.unfold).not.toHaveBeenCalled();
});

test("unfolds each direct non-empty child when every branch is folded", () => {
  const root = makeRoot({
    editor: makeEditor({
      text,
      cursor: { line: 0, ch: 0 },
      getAllFoldedLines: () => [1, 4],
    }),
  });
  const parent = root.getListUnderLine(0);
  if (!parent) {
    throw new Error("Expected a parent list");
  }
  const editor = makeFoldEditor();

  expect(toggleVerticalGuideTarget(editor, parent)).toBe(true);
  expect(editor.unfold).toHaveBeenNthCalledWith(1, 1);
  expect(editor.unfold).toHaveBeenNthCalledWith(2, 4);
  expect(editor.unfold).toHaveBeenCalledTimes(2);
  expect(editor.foldEnsuringCursorVisible).not.toHaveBeenCalled();
});
```

These expectations prove that the represented parent at line `0` and the direct leaf at line `3` are untouched.

- [ ] **Step 2: Update the handler regression expectation**

In `test("folds the ancestor represented by a native indentation guide")`, replace the parent-self expectation with:

```ts
expect(editor.foldEnsuringCursorVisible).toHaveBeenCalledWith(1, {
  line: 1,
  ch: 4,
});
expect(editor.foldEnsuringCursorVisible).toHaveBeenCalledTimes(1);
expect(editor.unfold).not.toHaveBeenCalled();
```

Keep the existing assertions for `handleMouseDown`, `posAtDOM`, parser input, and `preventDefault`.

- [ ] **Step 3: Run the focused tests and verify the regression tests fail**

Run:

```bash
SKIP_OBSIDIAN=1 npx jest --forceExit --runInBand src/features/__tests__/VerticalLines.test.ts
```

Expected: FAIL. The current implementation calls `foldEnsuringCursorVisible(0, { line: 0, ch: 2 })` once for the represented parent, rather than lines `1` and `4` for its child branches; the fully folded case also unfolds line `0` rather than lines `1` and `4`.

- [ ] **Step 4: Implement the minimal direct-child batch algorithm**

Replace `toggleVerticalGuideTarget`'s body with:

```ts
const children = list.getChildren().filter((child) => !child.isEmpty());
if (children.length === 0) {
  return false;
}

const shouldUnfold = children.every((child) => child.isFolded());
for (const child of children) {
  const fallbackCursor = child.getFirstLineContentStart();
  if (shouldUnfold) {
    editor.unfold(fallbackCursor.line);
  } else {
    editor.foldEnsuringCursorVisible(fallbackCursor.line, fallbackCursor);
  }
}

return true;
```

Do not change `resolveVerticalGuideTarget`, the event listener, or `MyEditor.foldEnsuringCursorVisible`.

- [ ] **Step 5: Run the focused tests and verify they pass**

Run:

```bash
SKIP_OBSIDIAN=1 npx jest --forceExit --runInBand src/features/__tests__/VerticalLines.test.ts src/editor/__tests__/index.test.ts
```

Expected: both suites PASS. The vertical-guide suite proves legacy batch targeting, and the editor suite continues to prove atomic selection relocation.

- [ ] **Step 6: Run static checks**

Run:

```bash
npm run lint
```

Expected: Prettier reports all matched files use its style and ESLint exits with status `0` and no warnings.

- [ ] **Step 7: Commit the implementation**

Run:

```bash
git add src/features/VerticalLines.ts src/features/__tests__/VerticalLines.test.ts
git commit -m "fix(vertical-lines): restore child branch toggling" \
  -m "Why:
- Native guide clicks currently fold the represented parent itself, hiding direct items that the legacy interaction kept visible.
- Selection-safe folding must remain in place so a cursor inside a child branch does not reopen the fold.

What:
- Batch-toggle the represented parent's direct non-empty children.
- Fold each child with its own visible fallback cursor and unfold all children only when every branch is folded.
- Restore helper and handler regression coverage for the legacy contract."
```

Expected: the commit succeeds and its hooks pass.

### Task 2: Complete Automated and Obsidian Verification

**Files:**
- Create temporarily: `vault/vertical-guide-regression-test.md`
- Delete after verification: `vault/vertical-guide-regression-test.md`

**Interfaces:**
- Consumes: production `dist/main.js`, `manifest.json`, and `styles.css`.
- Produces: evidence that the restored interaction works in Obsidian 1.13.1 and that all automated checks pass.

- [ ] **Step 1: Build the test-enabled bundle before the full suite**

Run:

```bash
npm run build-with-tests
```

Expected: Rollup completes successfully and produces a test-enabled `dist/main.js`.

- [ ] **Step 2: Run the complete Jest suite**

Run:

```bash
npm test -- --runInBand
```

Expected: all test suites pass. Jest may print the repository's existing `--forceExit` advisory, but there must be no failed suite or failed test.

- [ ] **Step 3: Build the production bundle**

Run:

```bash
npm run build
```

Expected: Rollup completes successfully and replaces `dist/main.js` with the production bundle.

- [ ] **Step 4: Install the production artifacts into the repository test vault**

Run:

```bash
cp dist/main.js manifest.json styles.css vault/.obsidian/plugins/bullet/
shasum -a 256 dist/main.js manifest.json styles.css vault/.obsidian/plugins/bullet/main.js vault/.obsidian/plugins/bullet/manifest.json vault/.obsidian/plugins/bullet/styles.css
```

Expected: each repository artifact has the same SHA-256 hash as its installed counterpart.

- [ ] **Step 5: Create an isolated manual-test note**

Use `apply_patch` to create `vault/vertical-guide-regression-test.md` with exactly:

```md
- parent
  - branch one
    - leaf one
  - leaf sibling
  - branch two
    - leaf two
- scroll filler 01
- scroll filler 02
- scroll filler 03
- scroll filler 04
- scroll filler 05
- scroll filler 06
- scroll filler 07
- scroll filler 08
- scroll filler 09
- scroll filler 10
- scroll filler 11
- scroll filler 12
- scroll filler 13
- scroll filler 14
- scroll filler 15
- scroll filler 16
- scroll filler 17
- scroll filler 18
- scroll filler 19
- scroll filler 20
- scroll filler 21
- scroll filler 22
- scroll filler 23
- scroll filler 24
- scroll filler 25
- scroll filler 26
- scroll filler 27
- scroll filler 28
- scroll filler 29
- scroll filler 30
```

- [ ] **Step 6: Verify the interaction in Obsidian 1.13.1**

Reload the `bullet` plugin, open `vertical-guide-regression-test.md` in Live Preview, and verify:

1. Place the cursor in `leaf one` and click the vertical guide represented by `parent`.
2. Confirm `parent`, `branch one`, `leaf sibling`, and `branch two` remain visible.
3. Confirm `leaf one` and `leaf two` become hidden and remain hidden after the mouse interaction completes.
4. Click the same guide again and confirm both leaves return.
5. Fold only `branch one`, click the guide, and confirm both branch roots end folded.
6. Scroll the note and confirm the native guide remains attached to the list; no overlay or drift appears.

Expected: every check passes, including the inside-selection case that previously reopened immediately.

- [ ] **Step 7: Remove the isolated manual-test note**

Use `apply_patch` to delete `vault/vertical-guide-regression-test.md` after the Obsidian checks pass.

- [ ] **Step 8: Confirm the repository is clean except for the plan record**

Run:

```bash
git status --short
git diff --check
```

Expected: only this implementation plan is modified to record completed checkboxes and verification results; `git diff --check` exits successfully.

### Task 3: Record Verification and Push `main`

**Files:**
- Modify: `docs/superpowers/plans/2026-07-13-restore-vertical-guide-folding.md`

**Interfaces:**
- Consumes: focused-test, lint, full-suite, production-build, artifact-hash, and Obsidian verification results from Tasks 1 and 2.
- Produces: a durable execution record on `main` and an updated `origin/main`.

- [ ] **Step 1: Record the completed verification results**

Mark every completed checkbox in this plan as `[x]` and append a `## Verification Results` section containing:

```md
## Verification Results

- Focused vertical-guide and editor tests: PASS
- Lint: PASS
- Test-enabled build: PASS
- Complete Jest suite: PASS (55 suites, 323 passed, 14 skipped)
- Production build: PASS
- Installed artifact hashes: MATCH
- Obsidian 1.13.1 legacy batch folding: PASS
- Obsidian 1.13.1 inside-selection fold persistence: PASS
- Native guide scrolling/alignment: PASS
```

If the exact Jest summary values printed in Task 2 differ from these expected counts, replace this line with the observed values before committing the record.

- [ ] **Step 2: Review the final diff and history**

Run:

```bash
git diff --check
git diff -- docs/superpowers/plans/2026-07-13-restore-vertical-guide-folding.md
git log --oneline --decorate -5
```

Expected: the plan contains only accurate execution evidence, the implementation commit follows the design commit, and no unrelated files are changed.

- [ ] **Step 3: Commit the execution record**

Run:

```bash
git add docs/superpowers/plans/2026-07-13-restore-vertical-guide-folding.md
git commit -m "docs: record restored vertical guide folding" \
  -m "Why:
- The compatibility fix needs a durable record of its TDD cycle and real Obsidian verification.

What:
- Mark the implementation plan complete.
- Record automated checks, installed artifact hashes, and legacy interaction results."
```

Expected: the commit succeeds and its hooks pass.

- [ ] **Step 4: Recheck upstream and push the verified commits**

Run:

```bash
git fetch
git pull --ff-only
git push origin main
```

Expected: the pull is fast-forward-only or already up to date, and `origin/main` advances to the verification-record commit without a pull request.

- [ ] **Step 5: Confirm the final repository state**

Run:

```bash
git status --short
git log --oneline --decorate -5
```

Expected: the worktree is clean and `HEAD`, `main`, and `origin/main` point to the same final commit. No package version or release tag is created.
