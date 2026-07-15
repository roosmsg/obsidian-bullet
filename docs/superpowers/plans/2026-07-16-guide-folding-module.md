# Guide Folding Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Move native guide interaction, outer guide behavior, and scroll-preserving fold dispatch behind one deep CodeMirror module.

**Architecture:** GuideFoldingPluginValue owns the complete ViewPlugin lifecycle and its internal guide implementation. VerticalLines only registers extensions and body classes, while MyEditor keeps only general editor operations.

**Tech Stack:** TypeScript 5.9, CodeMirror 6, Obsidian 1.12.7, Jest 30.

## Global Constraints

- Preserve native cm-indent rendering and all existing CSS geometry.
- Never add overlays, coordinate caches, delayed refolding, or manual scrollTop restoration.
- Dispatch scroll snapshot, fold effects, and selection fallback in one transaction.
- Keep scrollPastEnd activation in the VerticalLines feature.
- Use the semantic Obsidian test driver for the final integration regression.

---

### Task 1: Extract the ViewPlugin implementation

**Files:**
- Create: src/features/GuideFolding.ts
- Modify: src/features/VerticalLines.ts
- Modify: src/features/__tests__/VerticalLines.test.ts
- Create: src/features/__tests__/GuideFolding.test.ts

**Interfaces:**
- Produces: GUIDE_FOLDING_SCROLL_PAST_END_EXTENSION: Extension
- Produces: GuideFoldingPluginValue implements PluginValue
- Consumes: Settings, Parser, EditorView

- [ ] **Step 1: Add a failing feature ownership test**

Update VerticalLines tests to mock GuideFoldingPluginValue and assert the registered ViewPlugin constructs it.

~~~ts
expect(guideFoldingFactory).toHaveBeenCalledWith(settings, parser, view);
~~~

The test must not import target resolvers or hover helpers from VerticalLines.

- [ ] **Step 2: Run the feature test and confirm RED**

Run: SKIP_OBSIDIAN=1 npx jest src/features/__tests__/VerticalLines.test.ts --runInBand

Expected: FAIL because GuideFoldingPluginValue does not exist.

- [ ] **Step 3: Move the complete plugin value**

Move VerticalLinesPluginValue, guide constants, persistent-guide synchronization, target resolution, hover measurement, and event listeners into GuideFolding.ts.

Expose only the class and scrollPastEnd extension to production callers.

~~~ts
export class GuideFoldingPluginValue implements PluginValue {
  decorations: DecorationSet;

  constructor(
    private settings: Settings,
    private parser: Parser,
    private view: EditorView,
  ) {}
}
~~~

Keep VerticalLines as the Feature implementation that owns body classes and the mutable extension array.

- [ ] **Step 4: Move interaction tests to GuideFolding.test.ts**

Move plugin-value interaction, hover, persistent guide, and decoration tests from VerticalLines.test.ts.

Leave only load, unload, body class, and extension activation tests in VerticalLines.test.ts.

- [ ] **Step 5: Run both test files and confirm GREEN**

Run: SKIP_OBSIDIAN=1 npx jest src/features/__tests__/VerticalLines.test.ts src/features/__tests__/GuideFolding.test.ts --runInBand

Expected: PASS.

- [ ] **Step 6: Commit the ViewPlugin extraction**

Commit: refactor(vertical-lines): isolate guide folding plugin

### Task 2: Absorb OuterListGuide

**Files:**
- Modify: src/features/GuideFolding.ts
- Delete: src/features/OuterListGuide.ts
- Modify: src/features/__tests__/GuideFolding.test.ts
- Delete: src/features/__tests__/OuterListGuide.test.ts

**Interfaces:**
- Consumes: Parser.parseRange, Text, Decoration, WidgetType
- Produces: outer guide behavior only through GuideFoldingPluginValue

- [ ] **Step 1: Add failing public-interface tests**

Create GuideFoldingPluginValue fixtures that assert:

~~~ts
expect(pluginValue.decorations.size).toBe(expectedSegmentCount);
expect(handleClick(outerGuide)).toBe(true);
expect(editorView.dispatch).toHaveBeenCalledTimes(1);
~~~

Cover chunk splitting, actionable metadata validation, hover grouping, and fold direction without importing OuterListGuide helpers.

- [ ] **Step 2: Run GuideFolding tests and confirm RED**

Run: SKIP_OBSIDIAN=1 npx jest src/features/__tests__/GuideFolding.test.ts --runInBand

Expected: FAIL until outer behavior is internal to GuideFoldingPluginValue.

- [ ] **Step 3: Move outer implementation behind the plugin value**

Move OuterListChunk, widget, chunk collection, actionability, decoration creation, hover synchronization, and toggle planning into GuideFolding.ts.

Remove their export modifiers.

Delete OuterListGuide.ts after all production imports are gone.

- [ ] **Step 4: Run guide tests and confirm GREEN**

Run: SKIP_OBSIDIAN=1 npx jest src/features/__tests__/GuideFolding.test.ts --runInBand

Expected: PASS.

- [ ] **Step 5: Commit the helper collapse**

Commit: refactor(vertical-lines): absorb outer guide behavior

### Task 3: Move the guide fold transaction out of MyEditor

**Files:**
- Modify: src/editor/index.ts
- Modify: src/editor/__tests__/index.test.ts
- Modify: src/features/GuideFolding.ts
- Modify: src/features/__tests__/GuideFolding.test.ts

**Interfaces:**
- Remove: MyEditor.setFoldedPreservingScroll
- Remove: MyEditorFoldTarget
- Internal: setGuideTargetsFolded(view: EditorView, targets: GuideFoldTarget[], folded: boolean): boolean

- [ ] **Step 1: Add failing transaction tests in GuideFolding.test.ts**

Move the existing scroll snapshot cases and assert one dispatch containing:

~~~ts
expect(view.dispatch).toHaveBeenCalledWith(
  expect.objectContaining({
    effects: expect.arrayContaining([scrollSnapshotEffect, foldEffectValue]),
  }),
);
~~~

Retain cases for selection fallback, documentTop offset, scaleY, scrollPastEnd padding, and devicePixelRatio rounding.

- [ ] **Step 2: Run the moved tests and confirm RED**

Run: SKIP_OBSIDIAN=1 npx jest src/features/__tests__/GuideFolding.test.ts --runInBand

Expected: FAIL because GuideFolding still delegates to MyEditor.

- [ ] **Step 3: Move the implementation**

Move foldInside, stableScrollSnapshot, correctScrollSnapshotAnchor, ensureScrollPastEndReserve, and guide target folding into GuideFolding.ts.

Resolve fallback cursor offsets directly from EditorView.state.doc.

~~~ts
interface GuideFoldTarget {
  line: number;
  fallbackCursor: MyEditorPosition;
}
~~~

Pass EditorView to inner and outer toggle planning instead of exposing the guide operation on MyEditor.

- [ ] **Step 4: Remove the MyEditor interface and old tests**

Delete setFoldedPreservingScroll and MyEditorFoldTarget from src/editor/index.ts.

Delete only the tests that moved to GuideFolding.test.ts.

- [ ] **Step 5: Run editor and guide tests and confirm GREEN**

Run: SKIP_OBSIDIAN=1 npx jest src/editor/__tests__/index.test.ts src/features/__tests__/GuideFolding.test.ts --runInBand

Expected: PASS.

- [ ] **Step 6: Commit the transaction locality change**

Commit: refactor(vertical-lines): localize anchored fold dispatch

### Task 4: Verify the deep module through real Obsidian

**Files:**
- Modify: specs/features/VerticalGuideInteraction.spec.md

**Interfaces:**
- Consumes: clickGuide semantic action
- Produces: integration coverage for indent and outer guides

- [ ] **Step 1: Add indent and outer guide scenarios**

Cover nested target selection, saved-fold reopen, outer chunk isolation, selection fallback, and repeated fold cycles.

- [ ] **Step 2: Run all unit checks**

Run: npm run test:unit -- --runInBand

Run: npm run lint

Expected: zero failures and zero lint warnings.

- [ ] **Step 3: Build and run the full integration suite**

Backup vault/test.md outside the vault and record its hash.

Run: npm run build-with-tests

Run: npm test -- --runInBand

Expected: all Markdown specs pass.

Wait for the vault renderer to exit, restore the fixture, wait, and confirm the original hash.

- [ ] **Step 4: Perform the required manual Obsidian check**

Open vault=vault with Obsidian CLI.

Before each UI action, focus the vault renderer and confirm the title is vault.

Verify top and bottom viewport behavior on a long nested list, native list-bullet restoration, and no cumulative scroll error.

- [ ] **Step 5: Commit the deep module verification**

Commit: test(vertical-lines): verify deep guide folding module
