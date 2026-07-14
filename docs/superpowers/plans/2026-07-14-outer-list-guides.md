# Outer List Guides Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Draw a configurable root-level guide for every contiguous list chunk and let that guide fold or unfold all foldable top-level bullets in the same chunk.

**Architecture:** Keep chunk discovery, foldability, root-level toggling, and CodeMirror widget construction in a focused `OuterListGuide.ts` module. `VerticalLinesPluginValue` owns the per-view decoration set and routes capture-phase pointer events between existing native indent guides and the new widgets. CodeMirror positions and decorations provide scrolling, folding, and virtualization behavior without overlays or cached screen coordinates.

**Tech Stack:** TypeScript, CodeMirror 6 `Decoration` and `WidgetType`, Obsidian plugin settings, Jest 30, Rollup, CSS custom properties.

## Global Constraints

- The accepted design is `docs/superpowers/specs/2026-07-14-outer-list-guide-design.md`.
- Use normal `git` on the default branch. Do not use GitButler.
- Use TDD for every behavior change. Observe the focused test fail before changing production code.
- Run `.spec.md` integration tests only after `npm run build-with-tests`.
- Use only the repository `vault` for live Obsidian verification. Never install fixtures or bundles into `/Users/kodai/base`.
- Every Obsidian CLI command must include `vault=vault`.
- Before every Computer Use action, focus the test renderer with `obsidian-cli vault=vault eval code='window.focus()'`, fetch fresh app state, and reject any title containing `base` or lacking `vault`.
- Do not reuse stale Computer Use indices or coordinates.
- The outer guide setting defaults to `true` and remains subordinate to the existing vertical-lines master setting.
- `Vertical lines action = None` disables pointer affordance, hover feedback, and folding while leaving enabled outer guides visible.
- Blank lines, including whitespace-only lines, headings, and unindented non-list paragraphs split chunks.
- Do not change the existing raw-prefix resolver, persistent native guide behavior, or nested guide click semantics.
- Do not add a scroll overlay, geometry cache, fixed guide color, fixed active width, or background highlight.
- Do not change `manifest.json`, `versions.json`, or `package.json` version fields unless the user separately requests a release.

---

## File Map

- Create `src/features/OuterListGuide.ts`: chunk discovery, foldability, top-level toggling, widget type, decoration construction, and outer hover synchronization.
- Create `src/features/__tests__/OuterListGuide.test.ts`: focused unit tests for chunk boundaries, toggling, widget metadata, decorations, and hover grouping.
- Modify `src/services/Settings.ts`: persist the default-on `outerListLines` setting and expose `outerVerticalLines`.
- Modify `src/features/SettingsTab.ts`: render the new setting between vertical-line visibility and action settings.
- Modify `src/features/__tests__/SettingsTab.test.ts`: verify label, ordering, initial value, persistence callback, and save.
- Create `src/services/__tests__/Settings.test.ts`: verify migration from saved data without the new key.
- Modify `src/features/VerticalLines.ts`: own outer decorations, expose them through the ViewPlugin, route clicks, and coordinate nested plus outer hover lifecycle.
- Modify `src/features/__tests__/VerticalLines.test.ts`: integration tests for settings, events, decoration rebuilds, cleanup, and existing nested-guide regressions.
- Modify `styles.css`: position and style widget segments with Obsidian guide variables.
- Modify `AGENTS.md`: record durable rules for outer guide chunking and CodeMirror-managed rendering.

---

### Task 1: Default-on outer-guide setting

**Files:**
- Modify: `src/services/Settings.ts`
- Modify: `src/features/SettingsTab.ts`
- Modify: `src/features/__tests__/SettingsTab.test.ts`
- Create: `src/services/__tests__/Settings.test.ts`

**Interfaces:**
- Consumes: existing `SettingsObject`, `Settings`, and Obsidian `Setting` toggle pattern.
- Produces: persisted `SettingsObject.outerListLines: boolean` and `Settings.outerVerticalLines: boolean` getter/setter.

- [ ] **Step 1: Write failing migration and settings-tab tests**

Create `src/services/__tests__/Settings.test.ts` with a storage stub that omits the new key and assert that loading old data yields `settings.outerVerticalLines === true`:

```ts
import { Settings, SettingsObject } from "../Settings";

test("enables outer vertical lines when saved data predates the setting", async () => {
  const saved = {
    styleLists: true,
    debug: false,
    stickCursor: "bullet-and-checkbox",
    betterEnter: true,
    betterVimO: true,
    betterTab: true,
    selectAll: true,
    listLines: true,
    listLineAction: "toggle-folding",
    dnd: true,
  } as Omit<SettingsObject, "outerListLines">;
  const storage = {
    loadData: jest.fn(async () => saved as SettingsObject),
    saveData: jest.fn(async () => undefined),
  };
  const settings = new Settings(storage);

  await settings.load();

  expect(settings.outerVerticalLines).toBe(true);
});
```

Extend the settings object in `SettingsTab.test.ts` with `outerVerticalLines: true`. Add `toggleValue?: boolean` to `FakeSetting`, and make the fake `setValue` capture its argument:

```ts
addToggle(configure: (toggle: FakeToggle) => void) {
  const record = this;
  const toggle: FakeToggle = {
    callbacks: [],
    setValue(value: boolean) {
      record.toggleValue = value;
      return this;
    },
    onChange(callback) {
      this.callbacks.push(callback);
      return this;
    },
  };
  configure(toggle);
  this.toggleCallbacks = toggle.callbacks;
  return this;
}
```

Then assert the new setting appears between the two existing vertical-line settings, starts `true`, writes `false`, and calls `save()`:

```ts
const outerSettingIndex = mockSettingsRecords.findIndex(
  (setting) => setting.name === "Draw outer list lines",
);
expect(outerSettingIndex).toBe(verticalLinesSettingIndex + 1);
expect(actionSettingIndex).toBe(outerSettingIndex + 1);
expect(mockSettingsRecords[outerSettingIndex]?.toggleValue).toBe(true);

await mockSettingsRecords[outerSettingIndex]!.toggleCallbacks[0](false);
expect(settings.outerVerticalLines).toBe(false);
expect(settings.save).toHaveBeenCalled();
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
SKIP_OBSIDIAN=1 npx jest src/services/__tests__/Settings.test.ts src/features/__tests__/SettingsTab.test.ts --runInBand
```

Expected: FAIL because `SettingsObject.outerListLines`, `Settings.outerVerticalLines`, and the `Draw outer list lines` setting do not exist.

- [ ] **Step 3: Implement the setting and UI**

Add the persisted field and default in `Settings.ts`:

```ts
export interface SettingsObject {
  // existing fields
  listLines: boolean;
  outerListLines: boolean;
  listLineAction: VerticalLinesAction;
  // existing fields
}

const DEFAULT_SETTINGS: SettingsObject = {
  // existing values
  listLines: true,
  outerListLines: true,
  listLineAction: "toggle-folding",
  // existing values
};

get outerVerticalLines() {
  return this.values.outerListLines;
}

set outerVerticalLines(value: boolean) {
  this.set("outerListLines", value);
}
```

Insert this setting immediately after `Draw vertical indentation lines` in `SettingsTab.ts`:

```ts
new Setting(containerEl)
  .setName("Draw outer list lines")
  .setDesc("Show a root-level guide beside each contiguous list chunk.")
  .addToggle((toggle) => {
    toggle
      .setValue(this.settings.outerVerticalLines)
      .onChange(async (value) => {
        this.settings.outerVerticalLines = value;
        await this.settings.save();
      });
  });
```

- [ ] **Step 4: Run focused tests, lint, and type checking**

Run:

```bash
SKIP_OBSIDIAN=1 npx jest src/services/__tests__/Settings.test.ts src/features/__tests__/SettingsTab.test.ts --runInBand
npm run lint
npx tsc --noEmit
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/services/Settings.ts src/services/__tests__/Settings.test.ts src/features/SettingsTab.ts src/features/__tests__/SettingsTab.test.ts
git commit -m "feat(settings): configure outer list guides" -m "Why:
- Outer list guides need independent visibility while remaining enabled by default for existing users.

What:
- Persist the default-on outer guide setting and expose it in the settings tab.
- Cover saved-data migration, setting order, and persistence callbacks."
```

---

### Task 2: Chunk model and root-level folding

**Files:**
- Create: `src/features/OuterListGuide.ts`
- Create: `src/features/__tests__/OuterListGuide.test.ts`

**Interfaces:**
- Consumes: `Parser.parseRange(editor, fromLine, toLine)`, `Reader`, `Root`, `List`, and `MyEditor.foldEnsuringCursorVisible` / `unfold`.
- Produces:
  - `export interface OuterListChunk { root: Root; startLine: number; endLine: number; id: string; actionable: boolean }`
  - `export function collectOuterListChunks(parser: Parser, editor: Reader): OuterListChunk[]`
  - `export function isOuterListChunkActionable(root: Root): boolean`
  - `export function toggleOuterListChunk(editor: Pick<MyEditor, "foldEnsuringCursorVisible" | "unfold">, root: Root): boolean`

- [ ] **Step 1: Write failing chunk-boundary tests**

Import `makeEditor`, `makeLogger`, and `makeSettings` from `../../__mocks__`, then construct the parser with `new Parser(makeLogger(), makeSettings())`. Cover all accepted boundaries in one table:

```ts
test.each([
  ["empty line", "- a\n    - child\n\n- b\n    - child", [[0, 1], [3, 4]]],
  ["spaces-only line", "- a\n    - child\n   \n- b\n    - child", [[0, 1], [3, 4]]],
  ["heading", "- a\n    - child\n# Heading\n- b\n    - child", [[0, 1], [3, 4]]],
  ["paragraph", "- a\n    - child\ntext\n- b\n    - child", [[0, 1], [3, 4]]],
])("splits chunks at %s", (_name, text, expected) => {
  const editor = makeEditor({ text, cursor: { line: 0, ch: 0 } });

  const chunks = collectOuterListChunks(parser, editor);

  expect(chunks.map(({ startLine, endLine }) => [startLine, endLine])).toEqual(
    expected,
  );
});
```

Add a positive case proving nested bullets and a nonblank indented continuation remain in one chunk:

```ts
test("keeps nested bullets and indented continuation text in one chunk", () => {
  const editor = makeEditor({
    text: "- parent\n    continuation\n    - child\n        - leaf\n- sibling",
    cursor: { line: 0, ch: 0 },
  });

  const chunks = collectOuterListChunks(parser, editor);

  expect(chunks.map((chunk) => [chunk.startLine, chunk.endLine])).toEqual([
    [0, 4],
  ]);
});
```

- [ ] **Step 2: Run boundary tests and verify RED**

Run:

```bash
SKIP_OBSIDIAN=1 npx jest src/features/__tests__/OuterListGuide.test.ts --runInBand
```

Expected: FAIL because `OuterListGuide.ts` and `collectOuterListChunks` do not exist.

- [ ] **Step 3: Implement bounded chunk discovery**

Implement a whitespace splitter around the existing parser instead of changing nested-list parsing:

```ts
export interface OuterListChunk {
  root: Root;
  startLine: number;
  endLine: number;
  id: string;
  actionable: boolean;
}

export function collectOuterListChunks(
  parser: Parser,
  editor: Reader,
): OuterListChunk[] {
  const roots: Root[] = [];
  let segmentStart = 0;

  const appendSegment = (segmentEnd: number) => {
    if (segmentStart <= segmentEnd) {
      roots.push(...parser.parseRange(editor, segmentStart, segmentEnd));
    }
  };

  for (let line = 0; line <= editor.lastLine(); line++) {
    if (editor.getLine(line).trim().length > 0) continue;
    appendSegment(line - 1);
    segmentStart = line + 1;
  }
  appendSegment(editor.lastLine());

  return roots.map((root) => {
    const startLine = root.getContentStart().line;
    const endLine = root.getContentEnd().line;
    return {
      root,
      startLine,
      endLine,
      id: `${startLine}:${endLine}`,
      actionable: isOuterListChunkActionable(root),
    };
  });
}
```

The parser already separates headings and unindented paragraphs. The explicit `trim()` boundary prevents whitespace-only lines from joining chunks.

- [ ] **Step 4: Write failing foldability and toggle tests**

Add tests proving that a leaf-only chunk is not actionable, continuation content is actionable, and top-level lists toggle without touching another root:

```ts
test("marks leaf-only chunks as non-actionable", () => {
  const [chunk] = collectOuterListChunks(
    parser,
    makeEditor({ text: "- a\n- b", cursor: { line: 0, ch: 0 } }),
  );
  expect(chunk?.actionable).toBe(false);
});

test("folds every foldable top-level item and preserves leaf items", () => {
  const editor = makeEditor({
    text: "- parent A\n    - child A\n- leaf\n- parent B\n    - child B",
    cursor: { line: 0, ch: 0 },
  });
  const [chunk] = collectOuterListChunks(parser, editor);
  const foldEditor = {
    foldEnsuringCursorVisible: jest.fn(),
    unfold: jest.fn(),
  };

  expect(toggleOuterListChunk(foldEditor, chunk!.root)).toBe(true);
  expect(foldEditor.foldEnsuringCursorVisible).toHaveBeenCalledTimes(2);
  expect(foldEditor.foldEnsuringCursorVisible.mock.calls.map(([line]) => line)).toEqual([0, 3]);
});

test("unfolds all foldable top-level items when all are folded", () => {
  const editor = makeEditor({
    text: "- parent A\n    - child A\n- leaf\n- parent B\n    - child B",
    cursor: { line: 0, ch: 0 },
    getAllFoldedLines: () => [0, 3],
  });
  const [chunk] = collectOuterListChunks(parser, editor);
  const foldEditor = {
    foldEnsuringCursorVisible: jest.fn(),
    unfold: jest.fn(),
  };

  expect(toggleOuterListChunk(foldEditor, chunk!.root)).toBe(true);
  expect(foldEditor.unfold.mock.calls.map(([line]) => line)).toEqual([0, 3]);
  expect(foldEditor.foldEnsuringCursorVisible).not.toHaveBeenCalled();
});
```

- [ ] **Step 5: Run toggle tests and verify RED**

Run the focused file again.

Expected: boundary tests pass, while foldability and toggle tests fail because the exported functions are missing.

- [ ] **Step 6: Implement foldability and top-level toggle**

```ts
function isFoldableTopLevelList(list: List) {
  return (
    list.getLineCount() > 1 ||
    list.getChildren().some((child) => !child.isEmpty())
  );
}

export function isOuterListChunkActionable(root: Root) {
  return root.getChildren().some(isFoldableTopLevelList);
}

export function toggleOuterListChunk(
  editor: Pick<MyEditor, "foldEnsuringCursorVisible" | "unfold">,
  root: Root,
) {
  const targets = root.getChildren().filter(isFoldableTopLevelList);
  if (targets.length === 0) return false;

  const shouldUnfold = targets.every((target) => target.isFolded());
  for (const target of targets) {
    const fallbackCursor = target.getFirstLineContentStart();
    if (shouldUnfold) {
      editor.unfold(fallbackCursor.line);
    } else {
      editor.foldEnsuringCursorVisible(fallbackCursor.line, fallbackCursor);
    }
  }
  return true;
}
```

- [ ] **Step 7: Run focused tests, lint, and type checking**

```bash
SKIP_OBSIDIAN=1 npx jest src/features/__tests__/OuterListGuide.test.ts --runInBand
npm run lint
npx tsc --noEmit
```

Expected: all commands exit 0.

- [ ] **Step 8: Commit Task 2**

```bash
git add src/features/OuterListGuide.ts src/features/__tests__/OuterListGuide.test.ts
git commit -m "feat(vertical-lines): model outer list chunks" -m "Why:
- Root-level guides need stable document chunks and a separate toggle target from nested guides.

What:
- Split chunks at blank lines and existing parser boundaries.
- Identify foldable top-level bullets and toggle them without changing adjacent chunks or leaf items."
```

---

### Task 3: CodeMirror widget decorations

**Files:**
- Modify: `src/features/OuterListGuide.ts`
- Modify: `src/features/__tests__/OuterListGuide.test.ts`
- Modify: `src/features/VerticalLines.ts`
- Modify: `src/features/__tests__/VerticalLines.test.ts`

**Interfaces:**
- Consumes: Task 1 `Settings.outerVerticalLines` and Task 2 `collectOuterListChunks`.
- Produces:
  - `OUTER_LIST_GUIDE_SELECTOR = ".bullet-plugin-outer-list-guide"`
  - `OuterListGuideWidget extends WidgetType`
  - `buildOuterListGuideDecorations(doc: Text, chunks: readonly OuterListChunk[]): DecorationSet`
  - `VerticalLinesPluginValue.decorations: DecorationSet`

- [ ] **Step 1: Write failing widget and decoration tests**

Test the widget DOM contract without snapshotting unrelated markup. Install a minimal `document.createElement` fake in `beforeEach` whose returned element exposes `className`, `classList`, `dataset`, and `setAttribute`; restore the original global in `afterEach`. Then use this assertion:

```ts
test("renders a zero-content widget with chunk metadata", () => {
  const widget = new OuterListGuideWidget({
    id: "0:4",
    startLine: 0,
    endLine: 4,
    actionable: true,
  });

  const element = widget.toDOM();

  expect(element.classList.contains("bullet-plugin-outer-list-guide")).toBe(true);
  expect(element.dataset.chunkId).toBe("0:4");
  expect(element.dataset.actionable).toBe("true");
  expect(widget.ignoreEvent()).toBe(false);
});
```

Build a `Text` document and assert one widget range at the start of every line in a chunk, including nested and continuation lines, with no ranges on blank and heading lines.

- [ ] **Step 2: Run widget tests and verify RED**

```bash
SKIP_OBSIDIAN=1 npx jest src/features/__tests__/OuterListGuide.test.ts --runInBand
```

Expected: FAIL because the widget and builder do not exist.

- [ ] **Step 3: Implement the widget and decoration builder**

Add CodeMirror imports and the following public contract:

```ts
export const OUTER_LIST_GUIDE_CLASS = "bullet-plugin-outer-list-guide";
export const OUTER_LIST_GUIDE_SELECTOR = `.${OUTER_LIST_GUIDE_CLASS}`;

export class OuterListGuideWidget extends WidgetType {
  constructor(
    private chunk: Pick<
      OuterListChunk,
      "id" | "startLine" | "endLine" | "actionable"
    >,
  ) {
    super();
  }

  eq(other: WidgetType) {
    return (
      other instanceof OuterListGuideWidget &&
      this.chunk.id === other.chunk.id &&
      this.chunk.actionable === other.chunk.actionable
    );
  }

  toDOM() {
    const element = document.createElement("span");
    element.className = OUTER_LIST_GUIDE_CLASS;
    element.dataset.chunkId = this.chunk.id;
    element.dataset.chunkStart = String(this.chunk.startLine);
    element.dataset.chunkEnd = String(this.chunk.endLine);
    element.dataset.actionable = String(this.chunk.actionable);
    element.setAttribute("aria-hidden", "true");
    return element;
  }

  ignoreEvent() {
    return false;
  }
}

export function buildOuterListGuideDecorations(
  doc: Text,
  chunks: readonly OuterListChunk[],
) {
  const ranges = chunks.flatMap((chunk) => {
    return Array.from(
      { length: chunk.endLine - chunk.startLine + 1 },
      (_, index) => {
        const line = doc.line(chunk.startLine + index + 1);
        return Decoration.widget({
          widget: new OuterListGuideWidget(chunk),
          side: -1,
        }).range(line.from);
      },
    );
  });
  return Decoration.set(ranges, true);
}
```

- [ ] **Step 4: Write failing ViewPlugin decoration lifecycle tests**

Extend the `VerticalLinesPluginValue` test view with `state.doc`, `dispatch`, and a real or minimal `ViewUpdate`. Assert:

- constructor builds outer decorations when both `verticalLines` and `outerVerticalLines` are true;
- construction yields `Decoration.none` when either visibility setting is false;
- a document change rebuilds ranges using new line positions;
- changing `outerVerticalLines` to false clears decorations and dispatches an empty view update;
- changing it back to true recreates decorations;
- the ViewPlugin definition supplies `decorations: (value) => value.decorations`.

- [ ] **Step 5: Run lifecycle tests and verify RED**

```bash
SKIP_OBSIDIAN=1 npx jest src/features/__tests__/VerticalLines.test.ts --runInBand
```

Expected: FAIL because `VerticalLinesPluginValue` has no decoration property or builder integration.

- [ ] **Step 6: Integrate decorations into `VerticalLinesPluginValue`**

Import `DecorationSet` and `ViewUpdate`, add a public property, and rebuild only when the document or visibility setting changes:

```ts
decorations: DecorationSet;

private buildOuterDecorations() {
  if (!this.settings.verticalLines || !this.settings.outerVerticalLines) {
    return Decoration.none;
  }
  const editor = getEditorFromState(this.view.state);
  if (!editor) return Decoration.none;
  return buildOuterListGuideDecorations(
    this.view.state.doc,
    collectOuterListChunks(this.parser, editor),
  );
}

constructor(/* existing arguments */) {
  // existing initialization
  this.decorations = this.buildOuterDecorations();
}

update(update: ViewUpdate) {
  if (update.docChanged) {
    this.decorations = this.buildOuterDecorations();
  }
  this.scheduleGuideSynchronization();
}
```

Track the last visibility pair in `onSettingsChange`. When it changes, rebuild the set and call `view.dispatch({})` so CodeMirror re-reads the plugin decoration source. Do not dispatch on unrelated settings changes.

Expose the property:

```ts
ViewPlugin.define(
  (view) => new VerticalLinesPluginValue(this.settings, this.parser, view),
  { decorations: (value) => value.decorations },
);
```

- [ ] **Step 7: Run focused suites, lint, and type checking**

```bash
SKIP_OBSIDIAN=1 npx jest src/features/__tests__/OuterListGuide.test.ts src/features/__tests__/VerticalLines.test.ts --runInBand
npm run lint
npx tsc --noEmit
```

Expected: all commands exit 0.

- [ ] **Step 8: Commit Task 3**

```bash
git add src/features/OuterListGuide.ts src/features/__tests__/OuterListGuide.test.ts src/features/VerticalLines.ts src/features/__tests__/VerticalLines.test.ts
git commit -m "feat(vertical-lines): render outer guide widgets" -m "Why:
- Outer guides must survive folding, scrolling, and viewport DOM replacement without screen-coordinate synchronization.

What:
- Build CodeMirror widget decorations for every line in each list chunk.
- Rebuild decorations on document and visibility changes and expose them through the view plugin."
```

---

### Task 4: Root click, whole-chunk hover, and native styling

**Files:**
- Modify: `src/features/OuterListGuide.ts`
- Modify: `src/features/__tests__/OuterListGuide.test.ts`
- Modify: `src/features/VerticalLines.ts`
- Modify: `src/features/__tests__/VerticalLines.test.ts`
- Modify: `styles.css`
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: widget `data-chunk-start`, `data-chunk-end`, and `data-actionable`, Task 2 toggle helper, and existing capture-phase listener and measurement lifecycle.
- Produces:
  - `HOVERED_OUTER_LIST_GUIDE_CLASS = "bullet-plugin-hovered-outer-list-guide"`
  - `collectHoveredOuterListGuides(contentDOM: ParentNode): Element[]`
  - `synchronizeHoveredOuterListGuides(contentDOM: ParentNode, guides: Iterable<Element>): void`
  - outer click handling within `VerticalLinesPluginValue.handleMouseDown`.

- [ ] **Step 1: Write failing outer-hover helper tests**

Create three widget elements for chunk `0:4`, two for chunk `6:8`, and one non-actionable chunk. Mock `querySelector` to return one hovered actionable segment and assert only its chunk group is returned. Then assert synchronization removes stale markers and applies the marker to the selected group.

```ts
expect(
  collectHoveredOuterListGuides(contentDOM).map(
    (element) => (element as HTMLElement).dataset.chunkId,
  ),
).toEqual(["0:4", "0:4", "0:4"]);
```

Add cases for non-actionable widgets, no hovered widget, and separate editor DOM roots.

- [ ] **Step 2: Run helper tests and verify RED**

Run the focused `OuterListGuide.test.ts` file.

Expected: FAIL because outer hover helpers do not exist.

- [ ] **Step 3: Implement hover grouping and synchronization**

```ts
export const HOVERED_OUTER_LIST_GUIDE_CLASS =
  "bullet-plugin-hovered-outer-list-guide";
const HOVERED_OUTER_LIST_GUIDE_SELECTOR =
  `.${HOVERED_OUTER_LIST_GUIDE_CLASS}`;

export function collectHoveredOuterListGuides(contentDOM: ParentNode) {
  const hovered = contentDOM.querySelector<HTMLElement>(
    `${OUTER_LIST_GUIDE_SELECTOR}[data-actionable="true"]:hover`,
  );
  const chunkId = hovered?.dataset.chunkId;
  if (!chunkId) return [];
  return Array.from(
    contentDOM.querySelectorAll(
      `${OUTER_LIST_GUIDE_SELECTOR}[data-chunk-id="${CSS.escape(chunkId)}"]`,
    ),
  );
}

export function synchronizeHoveredOuterListGuides(
  contentDOM: ParentNode,
  guides: Iterable<Element>,
) {
  const next = new Set(guides);
  contentDOM
    .querySelectorAll(HOVERED_OUTER_LIST_GUIDE_SELECTOR)
    .forEach((element) => {
      if (!next.has(element)) {
        element.classList.remove(HOVERED_OUTER_LIST_GUIDE_CLASS);
      }
    });
  next.forEach((element) =>
    element.classList.add(HOVERED_OUTER_LIST_GUIDE_CLASS),
  );
}
```

If the Jest environment lacks `CSS.escape`, avoid interpolated selectors by querying all outer widgets and comparing `dataset.chunkId` directly.

- [ ] **Step 4: Write failing outer-click and integration lifecycle tests**

Add tests that dispatch capture-phase `mousedown` on an actionable widget and verify:

- the parser receives exactly `data-chunk-start` through `data-chunk-end` via `parseRange`;
- only that root reaches `toggleOuterListChunk` behavior;
- `preventDefault` and `stopPropagation` happen only when a toggle occurs;
- leaf-only widgets, malformed data, action `none`, master visibility off, and outer visibility off return `false`;
- the existing native `.cm-indent` route still resolves raw prefixes and behaves unchanged.

Extend measurement tests so `read()` returns both nested and outer groups:

```ts
type HoverMeasurement = {
  indentGuides: Element[];
  outerGuides: Element[];
};
```

Assert pointer leave, action disable, outer visibility disable, and destroy clear outer hover markers. Assert a fold/unfold view update recreates widget DOM from the decoration set and the next measurement re-groups the currently hovered chunk.

- [ ] **Step 5: Run integration tests and verify RED**

Run `VerticalLines.test.ts`.

Expected: FAIL on outer routing, measurement shape, and cleanup while existing nested tests remain green.

- [ ] **Step 6: Implement click routing and combined hover measurement**

In `handleMouseDown`, check outer widgets before the existing native-guide branch:

```ts
if (pressedGuide.matches(OUTER_LIST_GUIDE_SELECTOR)) {
  if (
    !this.settings.outerVerticalLines ||
    pressedGuide.getAttribute("data-actionable") !== "true"
  ) {
    return false;
  }
  const startLine = Number(pressedGuide.getAttribute("data-chunk-start"));
  const endLine = Number(pressedGuide.getAttribute("data-chunk-end"));
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine)) return false;
  const root = this.parser.parseRange(editor, startLine, endLine)[0];
  if (!root || !toggleOuterListChunk(editor, root)) return false;
  event.preventDefault();
  return true;
}
```

Preserve the existing native-guide branch below it. Update the shared read/write measurement to synchronize both marker groups without mutating DOM during `read()`.

Update pointer tracking so actionable outer widgets schedule synchronization, while non-actionable widgets clear markers and do not receive a pointer affordance.

- [ ] **Step 7: Write failing CSS contract tests**

Read `styles.css` in `OuterListGuide.test.ts` and assert:

- base widget segments are positioned without inline layout width;
- normal line uses `--indentation-guide-width` and `--indentation-guide-color`;
- actionable widgets receive `cursor: pointer` only under the existing action body class;
- hovered widgets use `--indentation-guide-width-active` and `--indentation-guide-color-active`;
- no `background`, hard-coded color, fixed active pixel width, transform-based scroll correction, or overlay container is introduced.

- [ ] **Step 8: Run CSS tests and verify RED**

Run `OuterListGuide.test.ts`.

Expected: FAIL because outer guide CSS is absent.

- [ ] **Step 9: Add theme-native CSS and durable agent guidance**

Add a zero-width, absolute-positioned widget segment. Use Obsidian's list-indent and indentation-guide variables so the line occupies one level outside the existing first native guide without shifting bullet text:

```css
.bullet-plugin-vertical-lines
  .markdown-source-view.mod-cm6
  .bullet-plugin-outer-list-guide {
  position: absolute;
  inset-block: 0;
  inset-inline-start: calc(-1 * var(--list-indent));
  width: var(--list-indent);
  pointer-events: none;
}

.bullet-plugin-vertical-lines
  .markdown-source-view.mod-cm6
  .bullet-plugin-outer-list-guide::before {
  content: "";
  position: absolute;
  inset-block: 0;
  inset-inline-end: 0;
  border-inline-end: var(--indentation-guide-width) solid
    var(--indentation-guide-color);
}

.bullet-plugin-vertical-lines-action-toggle-folding
  .markdown-source-view.mod-cm6
  .bullet-plugin-outer-list-guide[data-actionable="true"] {
  pointer-events: auto;
  cursor: pointer;
}

.bullet-plugin-vertical-lines-action-toggle-folding
  .markdown-source-view.mod-cm6
  .bullet-plugin-outer-list-guide[data-actionable="true"].bullet-plugin-hovered-outer-list-guide::before {
  border-inline-end: var(--indentation-guide-width-active) solid
    var(--indentation-guide-color-active);
}
```

Before finalizing the offset, inspect Obsidian 1.13's computed native guide geometry in the test vault. Adjust only the logical inset needed to align one indentation level outside the first native guide. Do not introduce runtime coordinate reads.

Add an `AGENTS.md` rule stating that outer guides are CodeMirror widget decorations keyed by document chunk ranges, blank and whitespace-only lines plus headings split chunks, and overlays or screen-coordinate caches are prohibited.

- [ ] **Step 10: Run focused suites, lint, type checking, and diff checks**

```bash
SKIP_OBSIDIAN=1 npx jest src/features/__tests__/OuterListGuide.test.ts src/features/__tests__/VerticalLines.test.ts --runInBand
npm run lint
npx tsc --noEmit
git diff --check
```

Expected: all commands exit 0 and nested-guide regression tests remain green.

- [ ] **Step 11: Commit Task 4**

```bash
git add AGENTS.md styles.css src/features/OuterListGuide.ts src/features/__tests__/OuterListGuide.test.ts src/features/VerticalLines.ts src/features/__tests__/VerticalLines.test.ts
git commit -m "feat(vertical-lines): toggle list chunks from outer guides" -m "Why:
- Users need one root-level control for each contiguous list chunk without affecting adjacent chunks.
- The control must retain native hover feedback and lifecycle behavior across folded DOM replacement.

What:
- Route outer widget clicks to bounded top-level folding.
- Synchronize whole-chunk hover markers and add theme-native guide styling.
- Document the CodeMirror-managed rendering and chunk-boundary invariants."
```

---

### Task 5: Full regression and live Obsidian verification

**Files:**
- Modify if evidence requires corrections: files changed in Tasks 1 through 4 only.
- Create temporarily, then delete: `vault/outer-list-guide-test.md`
- Record ignored execution evidence: `.superpowers/sdd/outer-list-guide-report.md`

**Interfaces:**
- Consumes: complete implementation from Tasks 1 through 4.
- Produces: fresh automated and live evidence, clean test vault, production bundle installed only in repository `vault`.

- [ ] **Step 1: Run the full automated pipeline in required order**

```bash
npm run lint
npx tsc --noEmit
npm run build-with-tests
npm test -- --runInBand
npm run build
```

Expected: every command exits 0. Record exact suite, pass, skip, and failure counts.

- [ ] **Step 2: Install the production artifacts into the test vault and compare hashes**

```bash
cp dist/main.js manifest.json styles.css vault/.obsidian/plugins/bullet/
shasum -a 256 \
  dist/main.js vault/.obsidian/plugins/bullet/main.js \
  manifest.json vault/.obsidian/plugins/bullet/manifest.json \
  styles.css vault/.obsidian/plugins/bullet/styles.css
```

Expected: each source/install pair matches.

- [ ] **Step 3: Create and open the test fixture**

Use `apply_patch` to create `vault/outer-list-guide-test.md` with:

```md
- parent A
    - child A1
        - leaf A1
    - child A2
- leaf A
- parent B
    - child B1

- separate blank chunk
    - child C1

# Heading boundary

- separate heading chunk
    - child D1

- leaf-only one
- leaf-only two
```

Open and reload only with explicit targeting:

```bash
obsidian-cli vault=vault open path=outer-list-guide-test.md
obsidian-cli vault=vault plugin:reload id=bullet
```

- [ ] **Step 4: Verify initial rendering and boundaries**

Before each UI action, focus and verify the exact fresh title includes `outer-list-guide-test - vault` and excludes `base`.

Inspect DOM and computed styles to prove:

- four independent outer-guide chunk IDs exist;
- no widget exists on blank or heading rows;
- each rendered row inside a chunk has one segment;
- leaf-only widgets are present with `data-actionable="false"`;
- text and bullet horizontal positions match with the setting toggled off and on;
- no overlay element or runtime coordinate metadata exists.

- [ ] **Step 5: Verify folding isolation and reopen behavior**

Click the first chunk's outer guide and prove parent A and parent B descendants hide while leaf A and every other chunk remain visible.

Click the same guide again and prove both top-level parents reopen, outer segments return on the re-rendered rows, and nested fold states remain unchanged.

Repeat after placing the selection inside child B1 to verify the safe selection/fold transaction remains stable.

Click the leaf-only outer guide and prove no content, selection, or fold state changes and the event is not consumed.

- [ ] **Step 6: Verify hover, settings, and virtualization**

Move the pointer onto one segment of the first actionable outer guide and prove every displayed segment with the same chunk ID uses active color and width while other chunks remain normal.

Prove the leaf-only chunk has no pointer cursor or active hover style.

Set `Vertical lines action` to `None`; prove outer lines remain but all outer and nested hover markers clear and clicks do not fold.

Restore `Toggle folding`, disable only `Draw outer list lines`, and prove outer widgets disappear while existing nested native guides remain.

Restore the outer setting, scroll a long nested extension offscreen and back, and prove segments reappear at the same logical inset with no overlay drift.

- [ ] **Step 7: Clean up the test vault and restore production state**

Delete `vault/outer-list-guide-test.md` with `apply_patch`, restore the user's persistent test-vault settings, rebuild production, recopy the three artifacts, and repeat the hash comparison.

Confirm no outer or nested hover marker remains and the active title still identifies the repository vault.

- [ ] **Step 8: Run final repository checks and commit evidence-only corrections if needed**

```bash
git diff --check
git status --short --branch
git log --oneline origin/main..HEAD
node -p "require('./manifest.json').version"
git tag --points-at HEAD
test ! -e vault/outer-list-guide-test.md
```

If live evidence required a code correction, return to RED-GREEN for that exact defect, rerun the complete pipeline, and commit with a focused Conventional Commit. Do not commit the temporary fixture or ignored execution report.

- [ ] **Step 9: Request final code review**

Review the complete range from the pre-feature base through HEAD against the accepted spec. Treat any missing chunk isolation, selection safety, lifecycle cleanup, setting gating, or live rendering evidence as blocking. Fix Critical or Important findings with a new failing test, rerun the full pipeline, and request re-review.

- [ ] **Step 10: Synchronize and push the default branch**

```bash
git fetch origin
git pull --ff-only
git push origin main
```

If upstream changed, integrate only by fast-forward as project policy requires and rerun the relevant verification before pushing. Confirm `HEAD`, `main`, and `origin/main` match after push. Do not create a release or version tag.
