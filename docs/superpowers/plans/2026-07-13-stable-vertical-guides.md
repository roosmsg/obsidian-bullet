# Stable Vertical Guides Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the independently scrolling vertical-guide overlay with Obsidian-owned indentation guides while preserving click-to-fold behavior.

**Architecture:** Obsidian and CodeMirror remain the only owners of guide DOM and geometry. A small view-plugin event handler maps a pressed `.cm-indent` element to the corresponding parsed list ancestor and invokes existing fold/unfold operations.

**Tech Stack:** TypeScript, Obsidian API, CodeMirror 6 view plugins, Jest 30, CSS.

## Global Constraints

- Do not create plugin-owned guide DOM, scrollers, observers, animation-frame callbacks, geometry caches, or coordinate measurements.
- Preserve `listLines` and `listLineAction` persisted settings.
- Preserve per-document `bullet-plugin-vertical-lines` body-class behavior.
- Keep the documented built-in-theme compatibility scope.
- Run `npm run build-with-tests` before the full integration suite because `.spec.md` tests execute `dist/main.js`.

---

### Task 1: Define Guide Mapping And Folding Behavior

**Files:**
- Replace: `src/features/__tests__/VerticalLines.test.ts`
- Modify: `src/features/VerticalLines.ts`

**Interfaces:**
- Produces: `resolveVerticalGuideTarget(list: List): List | null`
- Produces: `toggleVerticalGuideTarget(editor: Pick<MyEditor, "fold" | "unfold">, list: List): boolean`

- [x] **Step 1: Write failing mapping tests**

Replace the overlay-oriented fixture suite with tests built from real `Root` and `List` objects using `makeRoot`. Cover these exact mappings:

```ts
const root = makeRoot({
  editor: makeEditor({
    text: "- parent\n  - child\n    - grandchild",
    cursor: { line: 2, ch: 4 },
  }),
});
const grandchild = root.getListUnderLine(2)!;
expect(
  resolveVerticalGuideTarget(grandchild)?.getFirstLineContentStart().line,
).toBe(1);
```

Also cover a list block with shared leading indentation, a note line, and a root item with leading indentation. Child and note-line guides resolve to the immediate real parent; the root item's indentation resolves to `null`.

- [x] **Step 2: Run the mapping tests and verify RED**

Run:

```bash
SKIP_OBSIDIAN=1 npx jest src/features/__tests__/VerticalLines.test.ts --runInBand --forceExit
```

Expected: FAIL because `resolveVerticalGuideTarget` is not exported.

- [x] **Step 3: Implement minimal mapping**

Return the immediate parent unless that parent is the parser's synthetic root.

```ts
export function resolveVerticalGuideTarget(
  list: List,
) {
  const parent = list.getParent();
  return parent?.getParent() ? parent : null;
}
```

- [x] **Step 4: Run the mapping tests and verify GREEN**

Run the command from Step 2. Expected: mapping tests PASS.

- [x] **Step 5: Write failing folding tests**

Use a parsed parent with children. Assert that the first invocation folds the parent line itself and that a root parsed with the parent line folded causes the next invocation to unfold that same line.

```ts
expect(toggleVerticalGuideTarget(editor, parent)).toBe(true);
expect(editor.fold).toHaveBeenCalledWith(0);
expect(editor.fold).toHaveBeenCalledTimes(1);
expect(editor.unfold).not.toHaveBeenCalled();
```

- [x] **Step 6: Run the folding tests and verify RED**

Run the command from Step 2. Expected: FAIL because `toggleVerticalGuideTarget` is not exported.

- [x] **Step 7: Implement minimal folding behavior**

Return `false` for a leaf. Otherwise unfold the target when `isFoldRoot()` is true, fold it when false, and return `true`.

- [x] **Step 8: Run the feature test and verify GREEN**

Run the command from Step 2. Expected: all Task 1 tests PASS.

- [x] **Step 9: Commit Task 1**

```bash
git add src/features/VerticalLines.ts src/features/__tests__/VerticalLines.test.ts
git commit -m "test: define vertical guide behavior" -m "Why:\n- Stable rendering needs behavior-focused contracts before the overlay is removed.\n\nWhat:\n- Define ancestor mapping for guide presses.\n- Define direct-child fold and unfold semantics."
```

### Task 2: Replace The Overlay With An Event-only View Plugin

**Files:**
- Modify: `src/features/VerticalLines.ts`
- Modify: `src/features/__tests__/VerticalLines.test.ts`

**Interfaces:**
- Produces: `VerticalLinesPluginValue.handleMouseDown(event: MouseEvent, view: EditorView): boolean`
- Consumes: `resolveVerticalGuideTarget` and `toggleVerticalGuideTarget` from Task 1.

- [x] **Step 1: Write failing event-handler tests**

Mock only the editor-state adapter boundary. Use structural DOM objects for a `.cm-indent` target and its `.cm-line`. Verify:

```ts
expect(pluginValue.handleMouseDown(event, view)).toBe(true);
expect(event.preventDefault).toHaveBeenCalledTimes(1);
expect(editor.fold).toHaveBeenCalledWith(1);
```

Add independent tests for `verticalLines === false`, `verticalLinesAction === "none"`, non-indent targets, missing editor state, parsing failure, and a guide with no foldable ancestor. Every ignored case must return `false` without preventing the event.

Add a lifecycle test proving that `mousedown` is registered on `view.contentDOM` with capture set to `true` and that destroy removes the same listener with the same capture flag.

- [x] **Step 2: Run the handler tests and verify RED**

Run:

```bash
SKIP_OBSIDIAN=1 npx jest src/features/__tests__/VerticalLines.test.ts --runInBand --forceExit
```

Expected: FAIL because `handleMouseDown` does not exist in the required form.

- [x] **Step 3: Implement the event-only plugin**

Replace `VerticalLinesPluginValue` with a class that stores `Settings`, `Parser`, and its `EditorView`. Register one capture-phase `mousedown` listener on `view.contentDOM`; call `stopPropagation` only when the handler succeeds, and remove the listener on destroy. Its handler must:

```ts
if (!this.settings.verticalLines) return false;
if (this.settings.verticalLinesAction !== "toggle-folding") return false;
if (!isElementLike(event.target) || !event.target.matches(".cm-indent")) {
  return false;
}
const lineElement = event.target.closest(".cm-line");
if (!lineElement) return false;
```

Then resolve editor state, document line, parsed list, and its immediate real parent. Prevent default only after `toggleVerticalGuideTarget` returns `true`.

Register it with `ViewPlugin.define`. Do not use the bubbling `eventHandlers` spec because Obsidian stops native-indent events first. Do not append, measure, observe, schedule, or cache DOM.

- [x] **Step 4: Run the handler tests and verify GREEN**

Run the command from Step 2. Expected: all feature tests PASS.

- [x] **Step 5: Preserve body-class tests**

Keep the existing pop-out document test and verify that load, settings changes, window close, and unload still add and remove `bullet-plugin-vertical-lines` in the correct documents.

- [x] **Step 6: Commit Task 2**

```bash
git add src/features/VerticalLines.ts src/features/__tests__/VerticalLines.test.ts
git commit -m "refactor: use native vertical guides" -m "Why:\n- Plugin-owned guide DOM cannot stay synchronized with CodeMirror virtualization.\n\nWhat:\n- Replace overlay rendering with an event-only view plugin.\n- Map native indent-guide presses to existing folding operations."
```

### Task 3: Remove Obsolete Rendering Infrastructure And Verify

**Files:**
- Delete: `src/features/verticalLinesDom.ts`
- Delete: `src/features/verticalLinesMeasurements.ts`
- Delete: `src/features/verticalLinesScheduling.ts`
- Delete: `src/features/__tests__/verticalLinesDom.test.ts`
- Delete: `src/features/__tests__/verticalLinesMeasurements.test.ts`
- Delete: `src/features/__tests__/verticalLinesScheduling.test.ts`
- Modify: `styles.css`
- Modify: `AGENTS.md` only if verification reveals a durable missing instruction.

- [x] **Step 1: Delete obsolete helpers and tests**

Remove the three overlay-only helper modules and their three test files. Remove all imports from `VerticalLines.ts`.

- [x] **Step 2: Replace overlay CSS**

Delete `.bullet-plugin-list-lines-scroller`, `.bullet-plugin-list-lines-content-container`, and `.bullet-plugin-list-line` rules, including the rule that sets native `.cm-indent::before` content to `none`. Add only a non-layout-changing cursor rule for enabled guide elements:

```css
.bullet-plugin-vertical-lines
  .markdown-source-view.mod-cm6
  .cm-hmd-list-indent
  .cm-indent {
  cursor: pointer;
}
```

- [x] **Step 3: Verify no overlay architecture remains**

Run:

```bash
rg -n "list-lines-scroller|list-lines-content-container|bullet-plugin-list-line|ResizeObserver|MutationObserver|requestAnimationFrame|guideMeasurements|coordsAtPos|lineBlockAt" src/features/VerticalLines.ts src/features/verticalLines* styles.css
```

Expected: no matches in the vertical-guide implementation.

- [x] **Step 4: Run focused and complete unit tests**

Run:

```bash
SKIP_OBSIDIAN=1 npx jest src/features/__tests__/VerticalLines.test.ts --runInBand --forceExit
npm run test:unit -- --runInBand
```

Expected: all suites and tests PASS with no warnings.

- [x] **Step 5: Run lint and builds**

Run:

```bash
npm run lint
npm run build
npm run build-with-tests
```

Expected: all commands exit 0.

- [x] **Step 6: Run full integration tests**

Run:

```bash
npm test -- --runInBand
```

Expected: all unit and `.spec.md` integration suites PASS. If no Obsidian test instance is available, report that runtime verification as incomplete rather than claiming completion.

- [x] **Step 7: Review the final diff**

Run `git diff --check`, inspect every changed file, and compare the result line by line against the design goals and non-goals.

- [x] **Step 8: Commit Task 3**

```bash
git add src/features styles.css docs/superpowers/plans/2026-07-13-stable-vertical-guides.md
git commit -m "refactor: remove vertical guide overlay" -m "Why:\n- The obsolete scheduler, observers, measurements, and CSS preserve the unstable dual-scroll architecture.\n\nWhat:\n- Remove overlay-only production and test modules.\n- Let Obsidian render indentation guides in CodeMirror-owned DOM.\n- Verify unit tests, integration tests, lint, and builds."
```
