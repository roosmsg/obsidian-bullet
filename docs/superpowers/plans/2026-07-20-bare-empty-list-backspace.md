# Bare Empty List Backspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete a nested empty list item whose marker ends the physical line and move the cursor to its parent content end.

**Architecture:** Teach both the list transaction parser and the transaction-policy classifier that a supported marker at end of line is an empty list item. Preserve structural typing by allowing empty-item promotion only when the original marker has a space or tab separator.

**Tech Stack:** TypeScript 5.9, CodeMirror 6, Jest 30, semantic Markdown specs, Obsidian 1.13 test runtime.

## Global Constraints

- Run all local verification with Node.js 22.23.1.
- Keep `- ` to `---` horizontal-rule typing unchanged.
- Preserve the physical marker form when parsing and printing.
- Use GitButler for every version-control write.
- Do not track `dist/main.js`.

---

### Task 1: Characterize the bare-marker deletion

**Files:**

- Modify: `specs/features/BackspaceBehaviourOverride.spec.md`
- Modify: `src/operations/__tests__/DeleteTillPreviousLineContentEnd.test.ts`

**Interfaces:**

- Consumes: `BackspaceBehaviourOverride` keymap behavior.
- Verifies: `DeleteTillPreviousLineContentEnd.perform()` returns `UPDATED_OUTCOME` for `- parent\n  -`.

- [x] **Step 1: Add the failing Obsidian regression spec**

~~~~md
# backspace should remove a nested empty item without trailing marker space

- setting: `keepBodyTextInBullets=true`
- applyState:

```md
- parent
  -|
```

- keydown: `Backspace`
- assertState:

```md
- parent|
```
~~~~

- [x] **Step 2: Run the spec and confirm RED**

Run:

```bash
n exec 22.23.1 npm test -- specs/features/BackspaceBehaviourOverride.spec.md --runInBand
```

Expected: FAIL with received state `- parent\n  |`.

- [x] **Step 3: Add the operation-level regression**

```ts
const root = makeRoot({
  editor: makeEditor({
    text: "- parent\n  -",
    cursor: { line: 1, ch: 3 },
  }),
});

const outcome = new DeleteTillPreviousLineContentEnd(root, true, true).perform();

expect(outcome).toEqual(UPDATED_OUTCOME);
expect(root.print()).toBe("- parent");
expect(root.getCursor()).toEqual({ line: 0, ch: 8 });
```

### Task 2: Recognize list markers at physical line end

**Files:**

- Modify: `src/services/Parser.ts`
- Modify: `src/services/__tests__/Parser.test.ts`
- Modify: `src/root/index.ts`
- Modify: `src/services/MarkdownLineClassifier.ts`
- Modify: `src/services/__tests__/MarkdownLineClassifier.test.ts`

**Interfaces:**

- Changes: Parser list-item separator becomes optional only when the marker ends the line.
- Changes: `List.getContentStartCh()` uses `spaceAfterBullet.length`.
- Changes: `MarkdownLineClassifier.inspect()` reports a bare marker as a plain empty list item.

- [x] **Step 1: Add Parser and classifier tests for `- parent\n  -`**

```ts
expect(root!.getChildren()[0].getChildren()).toHaveLength(1);
expect(root!.print()).toBe("- parent\n  -");

expect(inspect("- parent\n  -", 2).listItem).toMatchObject({
  prefix: "  -",
  contentStart: 3,
  isRoot: false,
  isPlainEmpty: true,
  hasOwnedFollowingLine: false,
});
```

- [x] **Step 2: Accept an empty separator only at end of line**

```ts
const listItemRe = new RegExp(`^[ \\t]*${bulletSignRe}(?:[ \\t]|$)`);
const parseListItemRe = new RegExp(
  `^([ \\t]*)(${bulletSignRe})(?:( |\\t)(${optionalCheckboxRe})(.*))?$`,
);
```

- [x] **Step 3: Calculate content start from the preserved separator**

```ts
private getContentStartCh() {
  return this.indent.length + this.bullet.length + this.spaceAfterBullet.length;
}
```

- [x] **Step 4: Apply the same end-of-line rule to lightweight classification**

```ts
const listItemRe = /^([ \t]*)([-*+]|\d+\.)(?:([ \t]+)(.*))?$/;
```

### Task 3: Preserve structural typing while protecting native deletion

**Files:**

- Modify: `src/services/BulletTypingPolicy.ts`
- Modify: `src/services/__tests__/BulletTypingPolicy.test.ts`

**Interfaces:**

- Preserves: native deletion of a bare empty marker removes its row.
- Preserves: the second hyphen after promotion grows `-` into `--`.

- [x] **Step 1: Add bare-marker deletion coverage**

```ts
{
  description: "nested leaf without trailing marker space",
  doc: "- parent\n  -",
  from: 11,
  to: 12,
  expected: "- parent",
}
```

- [x] **Step 2: Add a horizontal-rule transition test and confirm RED**

```ts
const transaction = makeTransaction(
  "-",
  { from: 1, insert: "-" },
  "input.type",
  1,
);

expect(applyCorrection(transaction, policy.decide(transaction))).toBe("--");
```

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/services/__tests__/BulletTypingPolicy.test.ts --runInBand
```

Expected: FAIL with received text `-` before the promotion guard.

- [x] **Step 3: Require marker spacing for structural promotion**

```ts
if (
  !listItem?.isRoot ||
  !listItem.isPlainEmpty ||
  listItem.hasOwnedFollowingLine ||
  !/[ \t]$/.test(listItem.prefix) ||
  trigger.fromBefore !== before.from + listItem.contentStart
) {
  return null;
}
```

- [x] **Step 4: Run focused unit tests and confirm GREEN**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/services/__tests__/BulletTypingPolicy.test.ts src/services/__tests__/Parser.test.ts src/services/__tests__/MarkdownLineClassifier.test.ts src/operations/__tests__/DeleteTillPreviousLineContentEnd.test.ts src/features/__tests__/BulletTypingGuard.test.ts --runInBand
```

Expected: 5 suites and 161 tests pass.

### Task 4: Verify and commit

**Files:**

- Modify: `AGENTS.md`
- Modify: `docs/superpowers/specs/2026-07-20-bare-empty-list-backspace-design.md`
- Modify: `docs/superpowers/plans/2026-07-20-bare-empty-list-backspace.md`

**Interfaces:**

- Records: the durable bare-marker and horizontal-rule regression rule.
- Produces: one verified GitButler commit on `codex/fix-empty-child-backspace`.

- [x] **Step 1: Record the durable agent rule**

Add the bare-marker recognition and horizontal-rule transition constraints to `AGENTS.md`.

- [x] **Step 2: Run final verification**

Run:

```bash
n exec 22.23.1 npm run test:unit -- --runInBand
n exec 22.23.1 npm run lint
n exec 22.23.1 npm run build-with-tests
n exec 22.23.1 npm test -- --runInBand
```

Expected: unit, lint, build, and every Obsidian integration spec exit zero.

- [x] **Step 3: Review the final diff**

Confirm the exact symptom, Parser/classifier agreement, cursor position, structural typing, and absence of debug instrumentation.

- [x] **Step 4: Commit with GitButler**

```text
fix(editor): remove bare empty child items on Backspace

Why:
- Obsidian renders a marker at physical line end as an empty list item.
- Bullet previously fell through to native marker deletion and left a blank row.

What:
- Recognize list markers without a trailing separator in both parser paths.
- Preserve exact content offsets and horizontal-rule typing.
- Cover the failure in unit and real Obsidian tests.
```
