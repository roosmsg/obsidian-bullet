# Deterministic Vertical Guide Scroll Anchor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make vertical-guide folding always preserve the viewport above the changed branches so content below moves upward on fold and downward on unfold.

**Architecture:** Add a vertical-guide-specific batch fold API to `MyEditor` that resolves every fold range from one state and dispatches one transaction containing one `EditorView.scrollSnapshot()`, all fold or unfold effects, and an optional safe selection. Route nested and outer guide toggles through that API while leaving native chevrons and existing single-line folding commands unchanged.

**Tech Stack:** TypeScript, CodeMirror 6 fold effects and scroll snapshots, Obsidian Live Preview, Jest 30, Rollup.

## Global Constraints

- The accepted design is `docs/superpowers/specs/2026-07-14-deterministic-vertical-guide-scroll-anchor-design.md`.
- Use normal `git` on the default branch. Do not use GitButler.
- Use TDD for each behavior change and observe every focused test fail before implementation.
- Apply stable scroll anchoring only to vertical-guide clicks: nested native indent guides and outer list guides.
- Do not change native chevrons, keyboard folding, command palette folding, or existing single-line `fold` and `unfold` behavior.
- Use one CodeMirror transaction and one scroll snapshot per vertical-guide click, including outer guides with multiple targets.
- Keep safe selection and fold effects in the same transaction.
- Do not restore `scrollTop` manually, schedule a delayed correction, or add a DOM coordinate cache.
- Run `.spec.md` integration tests only after `npm run build-with-tests`.
- Use only the repository `vault` for live Obsidian verification. Never open or modify `/Users/kodai/base`.
- Install build artifacts only into `vault/.obsidian/plugins/bullet/`; do not create another plugin directory.
- Every Obsidian CLI command must include `vault=vault`.
- Before every Computer Use action, focus with `obsidian-cli vault=vault eval code='window.focus()'`, fetch fresh app state, and stop if the title is not `vault` or contains `base`.
- `dist/main.js` is ignored; build it for verification but do not force-add it.
- Do not change version fields unless the user separately requests a release.

---

## File Map

- Modify `src/editor/index.ts`: define `MyEditorFoldTarget` and implement the single-transaction batch fold API.
- Modify `src/editor/__tests__/index.test.ts`: verify one snapshot, one dispatch, all effects, safe selection, invalid-range no-op, and unchanged single-line commands.
- Modify `src/features/VerticalLines.ts`: submit all direct children to the batch API once per nested-guide click.
- Modify `src/features/OuterListGuide.ts`: submit all top-level targets to the same batch API once per outer-guide click.
- Modify `src/features/__tests__/VerticalLines.test.ts`: replace per-child fold expectations with one batch call and preserve handler consumption rules.
- Modify `src/features/__tests__/OuterListGuide.test.ts`: verify one batch call for fold and unfold directions.
- Modify `AGENTS.md`: record the durable one-snapshot, one-transaction rule for vertical-guide folding.

---

### Task 1: Single-transaction fold batch API

**Files:**

- Modify: `src/editor/index.ts`
- Modify: `src/editor/__tests__/index.test.ts`

**Interfaces:**

- Consumes: CodeMirror `foldable`, `foldedRanges`, `foldEffect`, `unfoldEffect`, and `EditorView.scrollSnapshot()`.
- Produces:

```ts
export interface MyEditorFoldTarget {
  line: number;
  fallbackCursor: MyEditorPosition;
}

MyEditor.setFoldedPreservingScroll(
  targets: readonly MyEditorFoldTarget[],
  folded: boolean,
): boolean;
```

- [ ] **Step 1: Add failing batch tests beside the existing single-target tests**

In `src/editor/__tests__/index.test.ts`, import `foldedRanges` and `unfoldEffect` with the existing fold imports. Keep the existing `foldEnsuringCursorVisible` tests so Task 1 remains compatible with the current feature callers. Extend the CodeMirror language mock in the new batch describe block with:

```ts
const mockedFoldedRanges = jest.mocked(foldedRanges);
const mockedUnfoldEffectOf = jest.mocked(unfoldEffect.of);
const between = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockedFoldedRanges.mockReturnValue({
    iter: () => ({ value: null, from: 0, next: jest.fn() }),
    between,
  } as never);
});
```

Create a `makeBatchFoldingEditor(selectionHead)` helper with two document lines:

```ts
const lines = [
  { from: 0, to: 8 },
  { from: 21, to: 29 },
];
const view = {
  state: {
    doc: {
      line: jest.fn((number: number) => lines[number - 1]),
    },
    selection: { main: { head: selectionHead } },
  },
  lineBlockAt: jest.fn((from: number) =>
    from === lines[0].from ? lines[0] : lines[1],
  ),
  scrollSnapshot: jest.fn().mockReturnValue("scroll-snapshot"),
  dispatch: jest.fn(),
};
```

Add these tests:

```ts
test("folds every target with one scroll snapshot and a safe selection", () => {
  mockedFoldable
    .mockReturnValueOnce({ from: 8, to: 20 })
    .mockReturnValueOnce({ from: 29, to: 40 });
  mockedFoldEffectOf
    .mockReturnValueOnce("fold-8" as never)
    .mockReturnValueOnce("fold-29" as never);
  const { editor, view } = makeBatchFoldingEditor(32);

  expect(
    editor.setFoldedPreservingScroll(
      [
        { line: 0, fallbackCursor: { line: 0, ch: 2 } },
        { line: 1, fallbackCursor: { line: 1, ch: 2 } },
      ],
      true,
    ),
  ).toBe(true);

  expect(view.scrollSnapshot).toHaveBeenCalledTimes(1);
  expect(view.dispatch).toHaveBeenCalledWith({
    selection: { anchor: 23, head: 23 },
    effects: ["scroll-snapshot", "fold-8", "fold-29"],
  });
  expect(view.dispatch).toHaveBeenCalledTimes(1);
});

test("keeps an outside selection while folding every target", () => {
  mockedFoldable
    .mockReturnValueOnce({ from: 8, to: 20 })
    .mockReturnValueOnce({ from: 29, to: 40 });
  mockedFoldEffectOf
    .mockReturnValueOnce("fold-8" as never)
    .mockReturnValueOnce("fold-29" as never);
  const { editor, view } = makeBatchFoldingEditor(5);

  editor.setFoldedPreservingScroll(
    [
      { line: 0, fallbackCursor: { line: 0, ch: 2 } },
      { line: 1, fallbackCursor: { line: 1, ch: 2 } },
    ],
    true,
  );

  expect(view.dispatch).toHaveBeenCalledWith({
    effects: ["scroll-snapshot", "fold-8", "fold-29"],
  });
});

test("unfolds every target with one scroll snapshot", () => {
  between.mockImplementation((from, _to, callback) => {
    if (from === 0) callback(8, 20);
    if (from === 21) callback(29, 40);
  });
  mockedUnfoldEffectOf
    .mockReturnValueOnce("unfold-8" as never)
    .mockReturnValueOnce("unfold-29" as never);
  const { editor, view } = makeBatchFoldingEditor(5);

  expect(
    editor.setFoldedPreservingScroll(
      [
        { line: 0, fallbackCursor: { line: 0, ch: 2 } },
        { line: 1, fallbackCursor: { line: 1, ch: 2 } },
      ],
      false,
    ),
  ).toBe(true);

  expect(view.scrollSnapshot).toHaveBeenCalledTimes(1);
  expect(view.dispatch).toHaveBeenCalledWith({
    effects: ["scroll-snapshot", "unfold-8", "unfold-29"],
  });
  expect(view.dispatch).toHaveBeenCalledTimes(1);
});

test("does not snapshot or dispatch when no target has a range", () => {
  mockedFoldable.mockReturnValue(null);
  const { editor, view } = makeBatchFoldingEditor(5);

  expect(
    editor.setFoldedPreservingScroll(
      [{ line: 0, fallbackCursor: { line: 0, ch: 2 } }],
      true,
    ),
  ).toBe(false);

  expect(view.scrollSnapshot).not.toHaveBeenCalled();
  expect(view.dispatch).not.toHaveBeenCalled();
});

test("keeps single-line fold and unfold free of scroll snapshots", () => {
  mockedFoldable.mockReturnValue({ from: 8, to: 20 });
  between.mockImplementation((_from, _to, callback) => callback(8, 20));
  const { editor, view } = makeBatchFoldingEditor(5);

  editor.fold(0);
  editor.unfold(0);

  expect(view.scrollSnapshot).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the editor tests and verify RED**

Run:

```bash
SKIP_OBSIDIAN=1 npx jest src/editor/__tests__/index.test.ts --runInBand
```

Expected: FAIL because `setFoldedPreservingScroll` and the batch interface do not exist.

- [ ] **Step 3: Implement the minimal batch API**

Add `MyEditorFoldTarget` beside the existing editor position interfaces in `src/editor/index.ts`:

```ts
export interface MyEditorFoldTarget {
  line: number;
  fallbackCursor: MyEditorPosition;
}
```

Add this method beside the existing `foldEnsuringCursorVisible` method:

```ts
setFoldedPreservingScroll(
  targets: readonly MyEditorFoldTarget[],
  folded: boolean,
): boolean {
  const { view } = this;
  const resolved = targets.flatMap((target) => {
    const line = view.lineBlockAt(view.state.doc.line(target.line + 1).from);
    const range = folded
      ? foldable(view.state, line.from, line.to)
      : foldInside(view, line.from, line.to);

    return range && range.from !== range.to ? [{ range, target }] : [];
  });

  if (resolved.length === 0) {
    return false;
  }

  const effects = [
    view.scrollSnapshot(),
    ...resolved.map(({ range }) =>
      (folded ? foldEffect : unfoldEffect).of(range),
    ),
  ];
  const selectionHead = view.state.selection.main.head;
  const selectedTarget = folded
    ? resolved.find(
        ({ range }) => range.from < selectionHead && selectionHead < range.to,
      )
    : undefined;

  if (selectedTarget) {
    const fallbackOffset = this.posToDocOffset(
      selectedTarget.target.fallbackCursor,
    );
    view.dispatch({
      selection: { anchor: fallbackOffset, head: fallbackOffset },
      effects,
    });
  } else {
    view.dispatch({ effects });
  }

  return true;
}
```

Keep the existing `fold`, `foldEnsuringCursorVisible`, and `unfold` methods unchanged in Task 1. Task 2 redirects vertical guides only after the new API passes independently.

- [ ] **Step 4: Run focused tests, lint, and type checking**

Run:

```bash
SKIP_OBSIDIAN=1 npx jest src/editor/__tests__/index.test.ts --runInBand
npm run lint
npx tsc --noEmit
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit Task 1**

```bash
git add docs/superpowers/plans/2026-07-14-deterministic-vertical-guide-scroll-anchor.md src/editor/index.ts src/editor/__tests__/index.test.ts
git commit -m "feat(editor): batch anchored fold updates" -m "Why:
- Vertical guide clicks may affect multiple branches and need one stable viewport anchor.
- Per-branch transactions let CodeMirror choose different scroll anchors.

What:
- Add a batch fold API with one scroll snapshot and one transaction.
- Keep safe selection, all fold effects, and all unfold effects atomic.
- Preserve existing single-line fold and unfold behavior."
```

---

### Task 2: Route nested and outer guides through the batch API

**Files:**

- Modify: `src/features/VerticalLines.ts`
- Modify: `src/features/OuterListGuide.ts`
- Modify: `src/features/__tests__/VerticalLines.test.ts`
- Modify: `src/features/__tests__/OuterListGuide.test.ts`
- Modify: `AGENTS.md`

**Interfaces:**

- Consumes: `MyEditor.setFoldedPreservingScroll(targets, folded): boolean` from Task 1.
- Produces: one batch API call per successful nested or outer vertical-guide click.

- [ ] **Step 1: Write failing nested-guide and outer-guide batching tests**

Change `makeFoldEditor()` in `VerticalLines.test.ts` to expose the batch method:

```ts
function makeFoldEditor() {
  return {
    setFoldedPreservingScroll: jest.fn().mockReturnValue(true),
    lastLine: jest.fn().mockReturnValue(9),
  };
}
```

Replace the direct-child fold expectation with one batch call:

```ts
expect(toggleVerticalGuideTarget(editor, parent)).toBe(true);
expect(editor.setFoldedPreservingScroll).toHaveBeenCalledWith(
  [
    { line: 1, fallbackCursor: { line: 1, ch: 4 } },
    { line: 4, fallbackCursor: { line: 4, ch: 4 } },
  ],
  true,
);
expect(editor.setFoldedPreservingScroll).toHaveBeenCalledTimes(1);
```

Replace the all-folded expectation with the same targets and `false`. In the leaf test, assert that `setFoldedPreservingScroll` was not called.

Update the handler tests for outermost and inner guides to assert the same one-call shape. The inner-guide expected targets are:

```ts
[
  { line: 2, fallbackCursor: { line: 2, ch: 10 } },
  { line: 4, fallbackCursor: { line: 4, ch: 10 } },
];
```

Update `OuterListGuide.test.ts` fold and unfold stubs to expose `setFoldedPreservingScroll`. Assert one call with:

```ts
[
  { line: 0, fallbackCursor: { line: 0, ch: 2 } },
  { line: 3, fallbackCursor: { line: 3, ch: 2 } },
];
```

Use `true` for the open-state fold test and `false` for the all-folded unfold test.

Add one failure-propagation assertion to each toggle test group:

```ts
editor.setFoldedPreservingScroll.mockReturnValue(false);
expect(toggleVerticalGuideTarget(editor, parent)).toBe(false);
```

and:

```ts
foldEditor.setFoldedPreservingScroll.mockReturnValue(false);
expect(toggleOuterListChunk(foldEditor, chunk.root)).toBe(false);
```

This keeps `mousedown` consumption tied to a real transaction.

- [ ] **Step 2: Run feature tests and verify RED**

Run:

```bash
SKIP_OBSIDIAN=1 npx jest src/features/__tests__/VerticalLines.test.ts src/features/__tests__/OuterListGuide.test.ts --runInBand
```

Expected: FAIL because both toggle functions still call per-child `foldEnsuringCursorVisible` and `unfold`.

- [ ] **Step 3: Implement one-call batching in both toggle functions**

In `VerticalLines.ts`, replace the per-child loop with:

```ts
export function toggleVerticalGuideTarget(
  editor: Pick<MyEditor, "setFoldedPreservingScroll">,
  list: List,
) {
  const children = list.getChildren().filter((child) => !child.isEmpty());
  if (children.length === 0) {
    return false;
  }

  const shouldUnfold = children.every((child) => child.isFolded());
  return editor.setFoldedPreservingScroll(
    children.map((child) => {
      const fallbackCursor = child.getFirstLineContentStart();
      return { line: fallbackCursor.line, fallbackCursor };
    }),
    !shouldUnfold,
  );
}
```

In `OuterListGuide.ts`, replace the per-target loop with:

```ts
export function toggleOuterListChunk(
  editor: Pick<MyEditor, "setFoldedPreservingScroll">,
  root: Root,
) {
  const targets = root.getChildren().filter(isFoldableTopLevelList);
  if (targets.length === 0) return false;

  const shouldUnfold = targets.every((target) => target.isFolded());
  return editor.setFoldedPreservingScroll(
    targets.map((target) => {
      const fallbackCursor = target.getFirstLineContentStart();
      return { line: fallbackCursor.line, fallbackCursor };
    }),
    !shouldUnfold,
  );
}
```

After updating every handler assertion, run:

```bash
rg -n "foldEnsuringCursorVisible|editor\.unfold|foldEditor\.unfold" src/features/VerticalLines.ts src/features/OuterListGuide.ts src/features/__tests__/VerticalLines.test.ts src/features/__tests__/OuterListGuide.test.ts
```

Expected: no matches. This confirms that vertical-guide production code and its tests no longer use per-child transactions. Do not remove `MyEditor.foldEnsuringCursorVisible` in this change because it remains a tested editor primitive and removing it is unrelated cleanup.

- [ ] **Step 4: Record the durable transaction rule in AGENTS.md**

Add this rule under `縦線ガイドについて`:

```md
- 縦線クリック1回で複数branchを開閉するときは、開閉前の `EditorView.scrollSnapshot()`、全 `foldEffect` または `unfoldEffect`、必要なselection退避を1個のtransactionへまとめてください。branchごとのdispatch、手動の `scrollTop` 復元、遅延したscroll補正を使わず、viewport上側をanchorとして維持してください。native chevronと通常のfolding commandにはこの縦線専用処理を適用しないでください。
```

- [ ] **Step 5: Run focused tests, lint, and type checking**

Run:

```bash
SKIP_OBSIDIAN=1 npx jest src/editor/__tests__/index.test.ts src/features/__tests__/VerticalLines.test.ts src/features/__tests__/OuterListGuide.test.ts --runInBand
npm run lint
npx tsc --noEmit
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit Task 2**

```bash
git add AGENTS.md src/features/VerticalLines.ts src/features/OuterListGuide.ts src/features/__tests__/VerticalLines.test.ts src/features/__tests__/OuterListGuide.test.ts
git commit -m "fix(vertical-lines): keep the upper viewport anchored" -m "Why:
- CodeMirror may otherwise preserve content below a fold and move the upper viewport.
- Nested and outer guides need the same deterministic scroll rule.

What:
- Route every vertical-guide toggle through one batch fold transaction.
- Propagate no-op batches so inactive clicks are not consumed.
- Document the one-snapshot transaction invariant."
```

---

### Task 3: Full and live verification

**Files:**

- Verify only; no tracked source changes.
- Create temporarily, then delete: `vault/deep-list-scroll-anchor-test.md`

**Interfaces:**

- Consumes: the built plugin at `vault/.obsidian/plugins/bullet/` and the completed batch API.
- Produces: measured evidence that the visible line above each toggle remains at the same Y coordinate.

- [ ] **Step 1: Run the complete automated verification**

Run:

```bash
npm run build-with-tests
npm test -- --runInBand
npm run lint
npx tsc --noEmit
npm run build
git diff --check
```

Expected: all commands exit 0; all 57 test suites pass; the production `dist/main.js` is rebuilt last.

- [ ] **Step 2: Install only into the repository test vault**

Copy `dist/main.js`, `manifest.json`, and `styles.css` into `vault/.obsidian/plugins/bullet/`, verify matching SHA-256 hashes, then run:

```bash
obsidian-cli vault=vault plugin:reload id=bullet
```

Expected: the plugin reloads in the repository test vault.

- [ ] **Step 3: Create and exercise the deep frontmatter fixture**

Create the ignored test-vault fixture with `apply_patch`. It must contain:

```md
---
aliases:
  - deep-anchor
tags:
  - regression
cssclasses:
  - deep-list-test
---

- root-01
  - root-01-depth-01
    - root-01-depth-02
      - root-01-depth-03
        - root-01-depth-04
          - root-01-depth-05
            - root-01-depth-06
              - root-01-depth-07
                - root-01-depth-08
                  - root-01-depth-09
                    - root-01-depth-10
                      - root-01-depth-11
                        - root-01-depth-12
```

Repeat the same 12-level chain for `root-02` through `root-08` so the file contains 104 bullets.

Open the completed fixture and focus the test renderer:

```bash
obsidian-cli vault=vault open path=deep-list-scroll-anchor-test.md
obsidian-cli vault=vault eval code='window.focus()'
```

Expected: the window title is `deep-list-scroll-anchor-test - vault - Obsidian ...`.

For Properties collapsed and expanded, place the cursor first inside and then outside the changed branch. At viewport top, middle, and bottom:

1. Record the bounding-box Y coordinate of a visible line above the clicked guide.
2. Click a nested guide to fold and unfold the branch five times.
3. Click the outer guide to fold and unfold all top-level branches five times.
4. Record the same upper line after every click.

Expected: the upper line's Y coordinate remains constant; content below moves upward on fold and downward on unfold. The cursor moves to the branch fallback only when it starts inside a folded range. No click opens immediately after folding.

- [ ] **Step 4: Clean the test vault and verify repository state**

Open `test.md` with `vault=vault`, delete `vault/deep-list-scroll-anchor-test.md` with `apply_patch`, and confirm the saved plugin settings are unchanged.

Run:

```bash
git status --short --branch
git rev-list --left-right --count HEAD...origin/main
```

Expected before the final push: only committed local work is ahead of `origin/main`; no temporary fixture or unrelated change remains.

- [ ] **Step 5: Push the verified commits**

```bash
git push origin main
git status --short --branch
```

Expected: `main...origin/main` with no local changes.
