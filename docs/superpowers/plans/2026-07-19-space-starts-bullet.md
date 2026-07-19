# Space Starts Bullet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make one ASCII Space typed on a completely empty line create an empty root bullet immediately.

**Architecture:** Extend `BulletTypingPolicy` with one exact typed-character correction before the existing structural-promotion and body-correction paths. Keep `BulletTypingGuard` unchanged so the original Space transaction and the `-` correction remain one CodeMirror transaction with native selection, effect, annotation, and history mapping.

**Tech Stack:** TypeScript 5.9, CodeMirror 6 transactions, Jest 30, Obsidian Markdown integration specs.

## Global Constraints

- Apply the shortcut only while `Keep body text in bullets` is enabled.
- Require exact user event `input.type`; do not match `input.type.compose`.
- Require one empty selection and one ASCII Space insertion into a physical line whose text is exactly empty.
- Do not convert whitespace-only lines or `Shift+Enter` continuation lines.
- Preserve existing policy results for all inputs outside the new shortcut.
- Keep the original Space transaction and insert only `-` as the sequential correction.
- Use Node.js 22.23.1 for every local verification command.
- Use `but` for branch and commit writes; use `git` only for read-only inspection.

---

### Task 1: Add the empty-line Space correction

**Files:**

- Modify: `src/services/__tests__/BulletTypingPolicy.test.ts`
- Modify: `src/services/BulletTypingPolicy.ts`

**Interfaces:**

- Consumes: `Transaction.annotation(Transaction.userEvent): string | undefined`
- Changes: `TypedTrigger` gains `value: string`
- Produces: `BulletTypingPolicy.getEmptyLineBulletStart(transaction): ChangeSpec | null`
- Preserves: `BulletTypingDecision` and the `BulletTypingGuard` adapter contract

- [x] **Step 1: Write failing policy tests for the exact shortcut boundary**

Add tests that require the correction to insert only `-` before the typed Space.

```ts
test("starts a bullet when Space is typed on a completely empty line", () => {
  const transaction = makeTransaction(
    "",
    { from: 0, insert: " " },
    "input.type",
  );

  const decision = policy.decide(transaction);

  expect(decision).toEqual({
    kind: "correct",
    changes: [{ from: 0, insert: "-" }],
  });
  expect(applyCorrection(transaction, decision)).toBe("- ");
});
```

Add table-driven exclusions for whitespace-only lines and list continuations.

```ts
test.each([
  { description: "whitespace-only line", doc: "  ", from: 2 },
  {
    description: "empty list continuation",
    doc: "- parent\n  ",
    from: 11,
  },
])("does not start a bullet on a $description", ({ doc, from }) => {
  const transaction = makeTransaction(
    doc,
    { from, insert: " " },
    "input.type",
    from,
  );

  expect(policy.decide(transaction)).toEqual({ kind: "pass" });
});
```

Add an exact-event regression proving composition input remains outside the shortcut.

```ts
test("does not start a bullet from composition Space input", () => {
  const transaction = makeTransaction(
    "",
    { from: 0, insert: " " },
    "input.type.compose",
  );

  expect(policy.decide(transaction)).toEqual({ kind: "pass" });
});
```

Add a regression for an existing pasted body line so the Space shortcut does not add a second correction.

```ts
test("keeps the existing body correction for Space before pasted text", () => {
  const transaction = makeTransaction(
    "plain",
    { from: 0, insert: " " },
    "input.type",
    0,
  );

  expect(policy.decide(transaction)).toEqual({
    kind: "correct",
    changes: [{ from: 0, insert: "- " }],
  });
});
```

- [x] **Step 2: Run the focused policy suite and confirm RED**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/services/__tests__/BulletTypingPolicy.test.ts --runInBand
```

Expected: the empty-line Space test fails because the current classifier treats the resulting single Space as a blank line and returns `pass`; all pre-existing tests remain green.

- [x] **Step 3: Generalize the existing single-character trigger helper**

Record the typed value without changing its selection and change-count checks.

```ts
interface TypedTrigger {
  fromBefore: number;
  fromAfter: number;
  value: string;
}
```

In `getSingleTypedTrigger`, remove the `structuralTriggers.has(value)` condition and store `value` in the result.

```ts
if (
  fromBefore === toBefore &&
  selection.main.anchor === fromBefore &&
  selection.main.head === fromBefore &&
  value.length === 1
) {
  trigger = { fromBefore, fromAfter, value };
}
```

Move the structural character check into `getStructuralPromotion`.

```ts
const trigger = getSingleTypedTrigger(transaction);
if (!trigger || !structuralTriggers.has(trigger.value)) {
  return null;
}
```

- [x] **Step 4: Implement the empty-line correction before structural promotion**

Add this policy method.

```ts
private getEmptyLineBulletStart(
  transaction: Transaction,
): ChangeSpec | null {
  if (transaction.annotation(Transaction.userEvent) !== "input.type") {
    return null;
  }

  const trigger = getSingleTypedTrigger(transaction);
  if (!trigger || trigger.value !== " ") {
    return null;
  }

  const beforeLine = transaction.startState.doc.lineAt(trigger.fromBefore);
  if (beforeLine.text !== "" || trigger.fromBefore !== beforeLine.from) {
    return null;
  }

  return { from: trigger.fromAfter, insert: "-" };
}
```

Call it after deletion handling and before structural promotion.

```ts
const bulletStart = this.getEmptyLineBulletStart(transaction);
if (bulletStart) {
  return { kind: "correct", changes: [bulletStart] };
}
```

- [x] **Step 5: Run the focused policy suite and confirm GREEN**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/services/__tests__/BulletTypingPolicy.test.ts --runInBand
```

Expected: the complete `BulletTypingPolicy` suite passes, including the shortcut and exclusion cases.

- [x] **Step 6: Commit the policy behavior**

Run `but diff` and confirm only the policy and its unit test are uncommitted, then run:

```bash
but commit codex/space-starts-bullet -m $'feat(editor): start empty bullets with Space\n\nWhy:\n- Empty lines currently show no bullet until the first body character is typed.\n\nWhat:\n- Convert exact Space input on a completely empty line into an empty root bullet.\n- Preserve whitespace-only continuations, composition input, and existing corrections.'
```

Expected: GitButler creates one Conventional Commit on `codex/space-starts-bullet` and reports no remaining changes from Task 1.

### Task 2: Verify adapter behavior and document the shortcut

**Files:**

- Modify: `src/features/__tests__/BulletTypingGuard.test.ts`
- Modify: `specs/features/BulletTypingGuard.spec.md`
- Modify: `README.md`

**Interfaces:**

- Consumes: unchanged `BulletTypingDecision` interpretation in `BulletTypingGuard.filterTransaction`
- Produces: user-facing Live Preview and Source mode regression coverage
- Produces: README editing behavior for the Space shortcut

- [x] **Step 1: Add feature tests for cursor mapping, history, and disabled behavior**

Add a cursor assertion using the registered editor extension.

```ts
test("maps Space past the empty bullet correction", async () => {
  const guard = await loadGuard();
  const state = EditorState.create({ extensions: guard });

  const transaction = state.update({
    changes: { from: 0, insert: " " },
    selection: { anchor: 1 },
    userEvent: "input.type",
  });

  expect(transaction.newDoc.toString()).toBe("- ");
  expect(transaction.newSelection.main).toEqual(EditorSelection.cursor(2));
});
```

Add a history-bearing test mirroring the existing direct-body correction test, but type Space and expect `- ` with a single increment.

```ts
test("keeps Space and its empty bullet in one history event", async () => {
  const guard = await loadGuard();
  const historyEventCount = StateField.define<number>({
    create: () => 0,
    update: (count, transaction) =>
      transaction.docChanged &&
      transaction.annotation(Transaction.addToHistory) !== false
        ? count + 1
        : count,
  });
  const state = EditorState.create({
    extensions: [historyEventCount, guard],
  });

  const transaction = state.update({
    annotations: Transaction.addToHistory.of(true),
    changes: { from: 0, insert: " " },
    userEvent: "input.type",
  });

  expect(transaction.newDoc.toString()).toBe("- ");
  expect(transaction.state.field(historyEventCount)).toBe(1);
});
```

Add a disabled-setting test that types Space and expects the original document to contain exactly one Space.

```ts
test("leaves Space unchanged while body ownership is disabled", async () => {
  const guard = await loadGuard({ keepBodyTextInBullets: false });
  const state = EditorState.create({ extensions: guard });

  const transaction = state.update({
    changes: { from: 0, insert: " " },
    userEvent: "input.type",
  });

  expect(transaction.newDoc.toString()).toBe(" ");
});
```

- [x] **Step 2: Run the feature suite**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/BulletTypingGuard.test.ts --runInBand
```

Expected: all feature tests pass without changing `BulletTypingGuard.ts`.

- [x] **Step 3: Add Obsidian integration scenarios**

Add one default-editor scenario to `specs/features/BulletTypingGuard.spec.md`.

````md
# space on a completely empty line should start a bullet

- setting: `keepBodyTextInBullets=true`
- applyState:

```md
|
```

- typeText: ` `
- assertState:

```md
- |
```
````

Add this Source mode scenario.

````md
# space on a completely empty line should start a bullet in Source mode

- setting: `keepBodyTextInBullets=true`
- execute: `editor:toggle-source`
- applyState:

```md
|
```

- typeText: ` `
- assertState:

```md
- |
```

- execute: `editor:toggle-source`
````

Add this continuation scenario, whose assertion contains three spaces before the cursor and no list marker.

````text
# space on an empty continuation should remain plain indentation

- setting: `keepBodyTextInBullets=true`
- applyState:

```md
- parent
  |
```

- typeText: ` `
- assertState:

```md
- parent
   |
```
````

- [x] **Step 4: Update the README behavior description**

After the opening paragraph under `Keep editing inside the outline`, add:

```md
On a completely empty line, press <kbd>Space</kbd> to create an empty list item immediately. Indented continuation lines remain plain note lines.
```

- [x] **Step 5: Run focused unit, formatting, and test-build checks**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/services/__tests__/BulletTypingPolicy.test.ts src/features/__tests__/BulletTypingGuard.test.ts --runInBand
n exec 22.23.1 npx prettier --check src/services/BulletTypingPolicy.ts src/services/__tests__/BulletTypingPolicy.test.ts src/features/__tests__/BulletTypingGuard.test.ts README.md
n exec 22.23.1 npm run build-with-tests
```

Expected: both suites pass, Prettier reports every listed file as formatted, and the test bundle builds successfully.

- [x] **Step 6: Commit adapter coverage and documentation**

Run `but diff` and confirm the feature test, integration spec, and README are the only uncommitted files, then run:

```bash
but commit codex/space-starts-bullet -m $'test(editor): cover Space bullet creation\n\nWhy:\n- The shortcut depends on native cursor and history mapping in both editor modes.\n\nWhat:\n- Verify adapter mapping and disabled behavior.\n- Add Live Preview and Source mode scenarios and document the shortcut.'
```

Expected: GitButler creates the second implementation commit and reports no remaining changes from Task 2.

### Task 3: Run complete verification

**Files:**

- Modify only if verification reveals a missing regression: files already listed in Tasks 1 and 2

**Interfaces:**

- No new interface

- [x] **Step 1: Run all unit tests with the CI Node.js line**

Run:

```bash
n exec 22.23.1 npm run test:unit -- --runInBand
```

Expected: every `src` Jest suite passes without starting or terminating Obsidian.

- [x] **Step 2: Run lint and the production build**

Run:

```bash
n exec 22.23.1 npm run lint
n exec 22.23.1 npm run build
```

Expected: Prettier, ESLint, TypeScript, and Rollup exit zero.

- [x] **Step 3: Prepare the full Obsidian test safely**

Inspect the LevelDB lock owner without deleting the lock file.

```bash
lsof '/Users/kodai/Library/Application Support/obsidian/Local Storage/leveldb/LOCK'
```

If a lowercase `obsidian` CLI process owns the lock, terminate that exact owner process and rerun `lsof` until no owner remains.

Create a temporary directory with `mktemp -d`, copy `vault/test.md` into it, and record SHA-256 hashes for both copies.

- [x] **Step 4: Build the test bundle and run all integration specs**

Run:

```bash
n exec 22.23.1 npm run build-with-tests
n exec 22.23.1 npm test -- --runInBand
```

Expected: all Markdown integration specs pass, including Space creation in Live Preview and Source mode and preservation of the indented continuation line.

- [x] **Step 5: Restore and verify the vault fixture**

Wait until no `vault=vault` renderer remains.

Restore `vault/test.md` from the temporary backup, wait through the delayed-save window, and confirm its size and SHA-256 match the backup.

Remove only the exact temporary directory created in Step 3 after the hashes match.

- [x] **Step 6: Record verification evidence**

Append exact suite counts, test counts, build results, and the restored fixture hash under an `## Execution evidence` section in this plan.

Commit only the plan evidence with:

```bash
but commit codex/space-starts-bullet -m $'docs(space): record shortcut verification\n\nWhy:\n- The Space shortcut must be traceable to fresh unit, build, and Obsidian integration evidence.\n\nWhat:\n- Record final suite counts and vault fixture restoration proof.'
```

Expected: the branch contains the design, implementation, coverage, documentation, and fresh verification evidence with no uncommitted task changes.

## Execution evidence

- The initial policy RED run failed only the new empty-line Space case while 69 existing tests passed; the first GREEN run passed 70/70 policy tests.
- Final review exposed frontmatter and fenced-code blank lines as missing exclusions; both new regression cases failed before the classifier check and the corrected policy passed 72/72 tests.
- The focused adapter and policy run passed 83/83 tests, and `build-with-tests` completed without TypeScript warnings after correcting the test selection type.
- The final complete Node.js 22.23.1 unit run passed 54/54 suites and 633/633 tests.
- `npm run lint`, the production build, and the final test build exited zero.
- The final Obsidian run passed 74/74 suites with 779 passed and 15 skipped tests out of 794 total.
- The Obsidian integration coverage exercised empty-line Space in Live Preview and Source mode, preserved an indented continuation and structural blank lines, and reverted Space plus its generated bullet with one Command-Z.
- `vault/test.md` was restored after the `vault=vault` renderer exited and remained 4,588 bytes with SHA-256 `3b41a8cfcfc20a345fa3b2d33a909f1fb00bdd00d2302223bedefc0ed9c96f0b` after a five-second delayed-save window.
- All three exact test backup directories were moved to macOS Trash only after the restored fixture matched the backup.
- The design, plan, implementation, adapter coverage, undo integration, agent cleanup instruction, and structural-line fix were committed as `545e9d3`, `bede89d`, `7f72523`, `aa1fd2c`, `302a632`, `d2d5083`, and `336af5c`.
