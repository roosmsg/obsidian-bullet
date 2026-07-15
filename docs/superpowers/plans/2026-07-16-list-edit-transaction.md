# List Edit Transaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Make one transaction module own operation execution, outcome evaluation, and editor diff application.

**Architecture:** Operations return an immutable outcome from perform instead of exposing mutable getters. OperationPerformer accepts nullable factories so parse-dependent guards stay inside the transaction path and common features no longer inject Parser separately.

**Tech Stack:** TypeScript 5.9, Jest 30, Obsidian editor adapter.

## Global Constraints

- Preserve every existing list-edit behavior and integration spec.
- Execute each operation exactly once.
- Apply ChangesApplicator only when shouldUpdate is true.
- Keep the existing Root and List mutation interface in this change.
- Keep drag and selection-recovery paths that intentionally reuse a parsed Root.

---

### Task 1: Define returned operation outcomes

**Files:**
- Modify: src/operations/Operation.ts
- Create: src/services/__tests__/OperationPerformer.test.ts
- Modify: src/services/OperationPerformer.ts

**Interfaces:**
- Produces: OperationOutcome
- Produces: NO_OP_OUTCOME, STOP_ONLY_OUTCOME, UPDATED_OUTCOME
- Changes: Operation.perform(): OperationOutcome

- [ ] **Step 1: Write failing transaction tests**

Test no root, nullable factory, stop-only outcome, updated outcome, and one-time execution.

~~~ts
const perform = jest.fn().mockReturnValue({
  shouldUpdate: true,
  shouldStopPropagation: true,
});
const result = performer.eval(root, { perform }, editor);
expect(perform).toHaveBeenCalledTimes(1);
expect(changesApplicator.apply).toHaveBeenCalledWith(editor, expect.anything(), root);
expect(result).toEqual({ shouldUpdate: true, shouldStopPropagation: true });
~~~

- [ ] **Step 2: Run the focused test and confirm RED**

Run: npx jest src/services/__tests__/OperationPerformer.test.ts --runInBand

Expected: FAIL because Operation.perform returns void and nullable factories are unsupported.

- [ ] **Step 3: Add the outcome interface and constants**

~~~ts
export interface OperationOutcome {
  shouldStopPropagation: boolean;
  shouldUpdate: boolean;
}

export const NO_OP_OUTCOME: OperationOutcome = {
  shouldStopPropagation: false,
  shouldUpdate: false,
};
export const STOP_ONLY_OUTCOME: OperationOutcome = {
  shouldStopPropagation: true,
  shouldUpdate: false,
};
export const UPDATED_OUTCOME: OperationOutcome = {
  shouldStopPropagation: true,
  shouldUpdate: true,
};

export interface Operation {
  perform(): OperationOutcome;
}
~~~

- [ ] **Step 4: Update OperationPerformer**

Call perform once, apply the diff from the returned outcome, and return that same object.

Allow the operation factory to return null.

~~~ts
perform(
  createOperation: (root: Root) => Operation | null,
  editor: MyEditor,
  cursor = editor.getCursor(),
): OperationOutcome
~~~

- [ ] **Step 5: Run the focused test and confirm GREEN**

Run: npx jest src/services/__tests__/OperationPerformer.test.ts --runInBand

Expected: PASS after a temporary test operation uses the new interface.

- [ ] **Step 6: Commit the transaction contract**

Commit: refactor(editor): return list operation outcomes

### Task 2: Migrate all operation implementations

**Files:**
- Modify: every src/operations/*.ts implementation except Operation.ts
- Modify: every src/operations/__tests__/*.test.ts

**Interfaces:**
- Consumes: OperationOutcome constants from Operation.ts
- Removes: shouldUpdate() and shouldStopPropagation() methods

- [ ] **Step 1: Convert one operation test to RED**

Start with MoveListUp.

~~~ts
const outcome = op.perform();
expect(outcome).toEqual(UPDATED_OUTCOME);
expect(root.print()).toBe("- item 1\n- item 3\n- item 2");
~~~

Delete assertions against mutable getters.

- [ ] **Step 2: Run MoveListUp tests and confirm RED**

Run: npx jest src/operations/__tests__/MoveListUp.test.ts --runInBand

Expected: FAIL because perform returns void.

- [ ] **Step 3: Convert MoveListUp to returned outcomes**

Return NO_OP_OUTCOME before the event is owned, STOP_ONLY_OUTCOME after ownership but before mutation, and UPDATED_OUTCOME after mutation.

Do not store updated or stopPropagation fields.

- [ ] **Step 4: Run MoveListUp tests and confirm GREEN**

Run: npx jest src/operations/__tests__/MoveListUp.test.ts --runInBand

Expected: PASS.

- [ ] **Step 5: Apply the same explicit-return pattern to remaining operations**

Migrate CreateNewItem, delete operations, IndentList, InsertNewLineWithoutBullet, cursor operations, MoveListDown, MoveListToDifferentPosition, OutdentList, OutdentListIfItsEmpty, and SelectAllContent.

For delegating operations, return the delegated operation outcome directly.

~~~ts
perform() {
  return this.delegatedOperation.perform();
}
~~~

- [ ] **Step 6: Update direct operation tests**

Capture perform results and compare explicit outcomes.

Keep all Root.print and cursor assertions unchanged.

- [ ] **Step 7: Run the entire operation test directory**

Run: npx jest src/operations --runInBand

Expected: all operation suites pass.

- [ ] **Step 8: Commit the operation migration**

Commit: refactor(editor): make operation results immutable

### Task 3: Route common features through the transaction

**Files:**
- Modify: src/features/EnterBehaviourOverride.ts
- Modify: src/features/TabBehaviourOverride.ts
- Modify: src/features/ShiftTabBehaviourOverride.ts
- Modify: src/features/VimOBehaviourOverride.ts
- Modify: src/ObsidianBulletPlugin.ts
- Modify: corresponding feature tests

**Interfaces:**
- Consumes: OperationPerformer.perform factory returning Operation or null
- Removes: Parser constructor dependency from common single-operation features

- [ ] **Step 1: Update feature tests to omit Parser**

Change Tab, Shift-Tab, Enter, and Vim O fixtures so they provide a real or mocked OperationPerformer but no Parser argument.

Assert guard conditions return NO_OP_OUTCOME through a null factory.

- [ ] **Step 2: Run the four feature suites and confirm RED**

Run: npx jest src/features/__tests__/TabBehaviourOverride.test.ts src/features/__tests__/EnterBehaviourOverride.test.ts src/features/__tests__/VimOBehaviourOverride.test.ts --runInBand

Expected: FAIL because constructors still require Parser.

- [ ] **Step 3: Move parse-dependent guards into factories**

Use this pattern in each feature:

~~~ts
return this.operationPerformer.perform((root) => {
  if (!this.shouldHandle(root)) {
    return null;
  }
  return new IndentList(root, indentChars, numericBulletsEnabled);
}, editor);
~~~

For Enter, select OutdentListIfItsEmpty, CreateNewItem, or InsertNewLineWithoutBullet inside one factory.

For Vim O, choose CreateNewItem only when the parsed Root and Vim state permit it.

- [ ] **Step 4: Remove obsolete Parser wiring**

Remove Parser parameters from the migrated feature constructors and their creation in ObsidianBulletPlugin.

Retain Parser for VerticalLines, DragAndDrop, and EditorSelectionsBehaviourOverride because those paths use parsed documents outside a single operation.

- [ ] **Step 5: Run feature and plugin tests and confirm GREEN**

Run: npx jest src/features src/__tests__/ObsidianBulletPlugin.test.ts --runInBand

Expected: PASS.

- [ ] **Step 6: Commit the feature locality change**

Commit: refactor(editor): deepen list edit transactions

### Task 4: Verify the list-edit production path

**Files:**
- Modify only if a regression test is missing: specs/features/*.spec.md

**Interfaces:**
- No new interface

- [ ] **Step 1: Run all unit tests**

Run: npm run test:unit -- --runInBand

Expected: all suites pass.

- [ ] **Step 2: Run lint**

Run: npm run lint

Expected: Prettier and ESLint pass with zero warnings.

- [ ] **Step 3: Build and run full integration tests**

Backup vault/test.md outside the vault and record its hash.

Run: npm run build-with-tests

Run: npm test -- --runInBand

Expected: all Markdown specs pass.

Wait for the vault renderer to exit, restore the fixture, wait, and confirm the original hash.

- [ ] **Step 4: Commit any added regression fixture**

Commit only when a missing regression required a spec change.

Commit: test(editor): cover list edit transaction path
