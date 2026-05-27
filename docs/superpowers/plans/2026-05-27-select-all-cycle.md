# Select-All Cycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make repeated `Ctrl+A` / `Cmd+A` inside lists cycle through content, subtree, and root-list selections without selecting the whole file.

**Architecture:** `CtrlAAndCmdABehaviourOverride` keeps a small in-memory cycle cursor so root-list selection can return to the item that started the cycle. `SelectAllContent` remains the operation that detects the current selection scope and applies the next list-aware scope.

**Tech Stack:** TypeScript, Jest, Obsidian editor abstractions, existing `Root` and `List` model APIs.

---

## File Structure

- Modify: `src/features/CtrlAAndCmdABehaviourOverride.ts`
  - Responsibility: pass the remembered cycle cursor into `SelectAllContent` and store the next cursor returned by the operation.
- Modify: `src/operations/SelectAllContent.ts`
  - Responsibility: cycle content, subtree, and root-list scopes; use the optional cycle cursor only when cycling from root-list selection back to content.
- Modify: `src/operations/__tests__/SelectAllContent.test.ts`
  - Responsibility: cover operation-level cycle behavior with a caller-maintained cycle cursor.
- Modify: `src/features/__tests__/CtrlAAndCmdABehaviourOverride.test.ts`
  - Responsibility: cover feature-level state handling across separate keypress invocations.

## Task 1: Add Operation Cycle Tests

**Files:**
- Modify: `src/operations/__tests__/SelectAllContent.test.ts`

- [ ] **Step 1: Add a helper that mimics separate keypresses**

Add this helper near the top of `src/operations/__tests__/SelectAllContent.test.ts`, after the imports:

```ts
import { Position } from "../../root";

function performSelectAllCycle(root: ReturnType<typeof makeRoot>) {
  let cycleCursor: Position | null = null;

  return () => {
    const op = new SelectAllContent(root, cycleCursor);
    const result = op.perform();
    cycleCursor = op.getCycleCursor();
    return { op, result };
  };
}
```

- [ ] **Step 2: Add parent and leaf cycle tests**

Append these tests inside the existing `describe("SelectAllContent operation", () => { ... })` block:

```ts
  test("should cycle parent item selection from content to subtree to root list and back to content", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- item 1\n- item 2\n    - item 2.1\n    - item 2.2\n- item 3\n",
        cursor: { line: 1, ch: 2 },
      }),
      settings: makeSettings(),
    });
    const perform = performSelectAllCycle(root);

    perform();
    expect(root.getSelection().anchor).toEqual({ line: 1, ch: 2 });
    expect(root.getSelection().head).toEqual({ line: 1, ch: 8 });

    perform();
    expect(root.getSelection().anchor).toEqual({ line: 1, ch: 2 });
    expect(root.getSelection().head).toEqual({ line: 3, ch: 14 });

    perform();
    expect(root.getSelection().anchor).toEqual({ line: 0, ch: 0 });
    expect(root.getSelection().head).toEqual({ line: 4, ch: 8 });

    const { op, result } = perform();
    expect(result).toBe(true);
    expect(op.shouldStopPropagation()).toBe(true);
    expect(root.getSelection().anchor).toEqual({ line: 1, ch: 2 });
    expect(root.getSelection().head).toEqual({ line: 1, ch: 8 });
  });

  test("should cycle leaf item selection from content to root list and back to content", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- item 1\n- item 2\n    - item 2.1\n    - item 2.2\n- item 3\n",
        cursor: { line: 4, ch: 2 },
      }),
      settings: makeSettings(),
    });
    const perform = performSelectAllCycle(root);

    perform();
    expect(root.getSelection().anchor).toEqual({ line: 4, ch: 2 });
    expect(root.getSelection().head).toEqual({ line: 4, ch: 8 });

    perform();
    expect(root.getSelection().anchor).toEqual({ line: 0, ch: 0 });
    expect(root.getSelection().head).toEqual({ line: 4, ch: 8 });

    const { op, result } = perform();
    expect(result).toBe(true);
    expect(op.shouldStopPropagation()).toBe(true);
    expect(root.getSelection().anchor).toEqual({ line: 4, ch: 2 });
    expect(root.getSelection().head).toEqual({ line: 4, ch: 8 });
  });
```

- [ ] **Step 3: Update the existing root-list selection test expectation**

Find the existing test named `should not do anything if selection already spans whole document` and replace it with:

```ts
  test("should cycle root-list selection back to the current item content", () => {
    const editor = makeEditor({
      text: "- item 1\n- item 2\n",
      cursor: { line: 1, ch: 5 },
    });

    editor.listSelections = () => [
      { anchor: { line: 0, ch: 0 }, head: { line: 1, ch: 8 } },
    ];

    const root = makeRoot({
      editor,
      settings: makeSettings(),
    });

    const op = new SelectAllContent(root, { line: 1, ch: 2 });
    const result = op.perform();

    expect(result).toBe(true);
    expect(op.shouldUpdate()).toBe(true);
    expect(op.shouldStopPropagation()).toBe(true);
    expect(root.getSelection().anchor).toEqual({ line: 1, ch: 2 });
    expect(root.getSelection().head).toEqual({ line: 1, ch: 8 });
  });
```

- [ ] **Step 4: Run the focused test and verify failure**

Run:

```sh
npm test -- --runTestsByPath src/operations/__tests__/SelectAllContent.test.ts
```

Expected: FAIL because `SelectAllContent` does not accept a cycle cursor or expose `getCycleCursor()` yet.

## Task 2: Implement Operation-Level Cycling

**Files:**
- Modify: `src/operations/SelectAllContent.ts`

- [ ] **Step 1: Replace `SelectAllContent.ts` with the cycle-aware operation**

Replace `src/operations/SelectAllContent.ts` with:

```ts
import { Operation } from "./Operation";

import { Position, Root, maxPos, minPos } from "../root";

export class SelectAllContent implements Operation {
  private stopPropagation = false;
  private updated = false;
  private nextCycleCursor: Position | null = null;

  constructor(
    private root: Root,
    private cycleCursor: Position | null = null,
  ) {}

  shouldStopPropagation() {
    return this.stopPropagation;
  }

  shouldUpdate() {
    return this.updated;
  }

  getCycleCursor() {
    return this.nextCycleCursor;
  }

  perform() {
    const { root } = this;

    if (!root.hasSingleSelection()) {
      return;
    }

    const selection = root.getSelections()[0];
    const [rootStart, rootEnd] = root.getContentRange();
    const selectionFrom = minPos(selection.anchor, selection.head);
    const selectionTo = maxPos(selection.anchor, selection.head);

    if (
      selectionFrom.line < rootStart.line ||
      selectionTo.line > rootEnd.line
    ) {
      return false;
    }

    const isRootSelection = this.sameRange(
      selectionFrom,
      selectionTo,
      rootStart,
      rootEnd,
    );
    const targetCursor = isRootSelection
      ? (this.cycleCursor ?? root.getCursor())
      : root.getCursor();
    const list = root.getListUnderLine(targetCursor.line);

    if (!list) {
      return false;
    }

    const contentStart = list.getFirstLineContentStartAfterCheckbox();
    const contentEnd = list.getLastLineContentEnd();
    const subtreeEnd = list.getContentEndIncludingChildren();

    this.stopPropagation = true;
    this.updated = true;
    this.nextCycleCursor = contentStart;

    if (isRootSelection) {
      root.replaceSelections([{ anchor: contentStart, head: contentEnd }]);
    } else if (
      this.sameRange(selectionFrom, selectionTo, contentStart, contentEnd)
    ) {
      if (list.getChildren().length) {
        root.replaceSelections([{ anchor: contentStart, head: subtreeEnd }]);
      } else {
        root.replaceSelections([{ anchor: rootStart, head: rootEnd }]);
      }
    } else if (
      this.sameRange(selectionFrom, selectionTo, contentStart, subtreeEnd)
    ) {
      root.replaceSelections([{ anchor: rootStart, head: rootEnd }]);
    } else if (
      this.containsRange(selectionFrom, selectionTo, contentStart, contentEnd)
    ) {
      root.replaceSelections([{ anchor: contentStart, head: contentEnd }]);
    } else {
      this.stopPropagation = false;
      this.updated = false;
      this.nextCycleCursor = null;
      return false;
    }

    return true;
  }

  private sameRange(
    actualFrom: Position,
    actualTo: Position,
    expectedFrom: Position,
    expectedTo: Position,
  ) {
    return (
      actualFrom.line === expectedFrom.line &&
      actualFrom.ch === expectedFrom.ch &&
      actualTo.line === expectedTo.line &&
      actualTo.ch === expectedTo.ch
    );
  }

  private containsRange(
    selectionFrom: Position,
    selectionTo: Position,
    rangeFrom: Position,
    rangeTo: Position,
  ) {
    return (
      (selectionFrom.line > rangeFrom.line ||
        (selectionFrom.line === rangeFrom.line &&
          selectionFrom.ch >= rangeFrom.ch)) &&
      (selectionTo.line < rangeTo.line ||
        (selectionTo.line === rangeTo.line && selectionTo.ch <= rangeTo.ch))
    );
  }
}
```

- [ ] **Step 2: Run the operation tests**

Run:

```sh
npm test -- --runTestsByPath src/operations/__tests__/SelectAllContent.test.ts
```

Expected: PASS.

## Task 3: Add Feature-Level Cycle State Test

**Files:**
- Create: `src/features/__tests__/CtrlAAndCmdABehaviourOverride.test.ts`

- [ ] **Step 1: Add the feature test file**

Create `src/features/__tests__/CtrlAAndCmdABehaviourOverride.test.ts`:

```ts
import { CtrlAAndCmdABehaviourOverride } from "../CtrlAAndCmdABehaviourOverride";

import { makeEditor, makeRoot, makeSettings } from "../../__mocks__";

test("should keep select-all cycle anchored across separate keypresses", () => {
  const settings = makeSettings();
  const editor = makeEditor({
    text: "- item 1\n- item 2\n    - item 2.1\n    - item 2.2\n- item 3\n",
    cursor: { line: 1, ch: 2 },
  });
  const root = makeRoot({ editor, settings });
  const operationPerformer = {
    perform: jest.fn((createOperation, _editor, cursor) => {
      const operation = createOperation(root);
      operation.perform();
      return {
        shouldUpdate: operation.shouldUpdate(),
        shouldStopPropagation: operation.shouldStopPropagation(),
        cursor,
      };
    }),
  };
  const plugin = {
    registerEditorExtension: jest.fn(),
    addCommand: jest.fn(),
  };
  const imeDetector = { isOpened: () => false };
  const feature = new CtrlAAndCmdABehaviourOverride(
    plugin as any,
    settings,
    imeDetector as any,
    operationPerformer as any,
  );

  feature.load();

  expect((feature as any).run(editor).shouldStopPropagation).toBe(true);
  expect(root.getSelection().anchor).toEqual({ line: 1, ch: 2 });
  expect(root.getSelection().head).toEqual({ line: 1, ch: 8 });

  expect((feature as any).run(editor).shouldStopPropagation).toBe(true);
  expect(root.getSelection().anchor).toEqual({ line: 1, ch: 2 });
  expect(root.getSelection().head).toEqual({ line: 3, ch: 14 });

  expect((feature as any).run(editor).shouldStopPropagation).toBe(true);
  expect(root.getSelection().anchor).toEqual({ line: 0, ch: 0 });
  expect(root.getSelection().head).toEqual({ line: 4, ch: 8 });

  expect((feature as any).run(editor).shouldStopPropagation).toBe(true);
  expect(root.getSelection().anchor).toEqual({ line: 1, ch: 2 });
  expect(root.getSelection().head).toEqual({ line: 1, ch: 8 });
  expect(operationPerformer.perform.mock.calls[3][2]).toEqual({
    line: 1,
    ch: 2,
  });
});
```

- [ ] **Step 2: Run the feature test and verify failure**

Run:

```sh
npm test -- --runTestsByPath src/features/__tests__/CtrlAAndCmdABehaviourOverride.test.ts
```

Expected: FAIL until the feature stores and passes the cycle cursor.

## Task 4: Wire Cycle Cursor Through The Feature

**Files:**
- Modify: `src/features/CtrlAAndCmdABehaviourOverride.ts`

- [ ] **Step 1: Update imports and class state**

Change the root import and add a class property:

```ts
import { Position } from "../root";
```

Inside `CtrlAAndCmdABehaviourOverride`, add:

```ts
  private cycleCursor: Position | null = null;
```

- [ ] **Step 2: Replace the `run` method**

Replace the existing `private run = (editor: MyEditor) => { ... }` method with:

```ts
  private run = (editor: MyEditor) => {
    let operation: SelectAllContent | null = null;
    const result = this.operationPerformer.perform(
      (root) => {
        operation = new SelectAllContent(root, this.cycleCursor);
        return operation;
      },
      editor,
      this.cycleCursor ?? editor.getCursor(),
    );

    this.cycleCursor = operation?.getCycleCursor() ?? null;

    return result;
  };
```

- [ ] **Step 3: Run focused tests**

Run:

```sh
npm test -- --runTestsByPath src/operations/__tests__/SelectAllContent.test.ts src/features/__tests__/CtrlAAndCmdABehaviourOverride.test.ts
```

Expected: PASS.

## Task 5: Add Checkbox, Note-Line, And Propagation Regression Tests

**Files:**
- Modify: `src/operations/__tests__/SelectAllContent.test.ts`

- [ ] **Step 1: Add regression tests**

Append these tests inside the existing `describe("SelectAllContent operation", () => { ... })` block:

```ts
  test("should cycle checkbox item back to content without selecting checkbox markup", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- [ ] task 1\n- [ ] task 2 with longer text\n",
        cursor: { line: 1, ch: 10 },
      }),
      settings: makeSettings(),
    });
    const perform = performSelectAllCycle(root);

    perform();
    expect(root.getSelection().anchor).toEqual({ line: 1, ch: 6 });
    expect(root.getSelection().head).toEqual({ line: 1, ch: 29 });

    perform();
    expect(root.getSelection().anchor).toEqual({ line: 0, ch: 0 });
    expect(root.getSelection().head).toEqual({ line: 1, ch: 29 });

    const { op } = perform();
    expect(op.shouldStopPropagation()).toBe(true);
    expect(root.getSelection().anchor).toEqual({ line: 1, ch: 6 });
    expect(root.getSelection().head).toEqual({ line: 1, ch: 29 });
  });

  test("should cycle note-line item back to its content range", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- item 1\n  note for item 1\n  another note\n- item 2\n",
        cursor: { line: 0, ch: 5 },
      }),
      settings: makeSettings(),
    });
    const perform = performSelectAllCycle(root);

    perform();
    expect(root.getSelection().anchor).toEqual({ line: 0, ch: 2 });
    expect(root.getSelection().head).toEqual({ line: 2, ch: 14 });

    perform();
    expect(root.getSelection().anchor).toEqual({ line: 0, ch: 0 });
    expect(root.getSelection().head).toEqual({ line: 3, ch: 8 });

    const { op } = perform();
    expect(op.shouldStopPropagation()).toBe(true);
    expect(root.getSelection().anchor).toEqual({ line: 0, ch: 2 });
    expect(root.getSelection().head).toEqual({ line: 2, ch: 14 });
  });
```

- [ ] **Step 2: Run the focused tests**

Run:

```sh
npm test -- --runTestsByPath src/operations/__tests__/SelectAllContent.test.ts src/features/__tests__/CtrlAAndCmdABehaviourOverride.test.ts
```

Expected: PASS.

## Task 6: Final Verification And Commit

**Files:**
- Verify: `src/features/CtrlAAndCmdABehaviourOverride.ts`
- Verify: `src/features/__tests__/CtrlAAndCmdABehaviourOverride.test.ts`
- Verify: `src/operations/SelectAllContent.ts`
- Verify: `src/operations/__tests__/SelectAllContent.test.ts`

- [ ] **Step 1: Run all tests**

Run:

```sh
npm test -- --runInBand
```

Expected: PASS.

- [ ] **Step 2: Run lint**

Run:

```sh
npm run lint
```

Expected: PASS.

- [ ] **Step 3: Commit the implementation**

```sh
git add src/features/CtrlAAndCmdABehaviourOverride.ts src/features/__tests__/CtrlAAndCmdABehaviourOverride.test.ts src/operations/SelectAllContent.ts src/operations/__tests__/SelectAllContent.test.ts
git commit -m "feat: cycle list select-all scopes" -m "Why:
- Repeated Ctrl/Cmd+A presses inside lists should stay within outliner-specific selection scopes.
- Root-list selection needs a remembered cycle anchor so the next press returns to the item that started the cycle.

What:
- Add operation support for cycling content, subtree, and root-list scopes.
- Store the select-all cycle cursor in the Ctrl/Cmd+A feature between invocations.
- Cover parent, leaf, checkbox, note-line, and feature-level repeated-keypress behavior."
```

- [ ] **Step 4: Inspect final status**

Run:

```sh
git status --short
```

Expected: empty output.
