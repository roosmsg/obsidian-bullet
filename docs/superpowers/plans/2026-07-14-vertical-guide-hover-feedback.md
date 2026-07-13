# Vertical Guide Hover Feedback Implementation Plan

> [!WARNING]
> **Superseded:** Do not implement this row-local hover plan. Use the accepted [Logical Vertical Guide Hover Feedback Implementation Plan](./2026-07-14-logical-vertical-guide-hover-feedback.md), which highlights the complete logical guide.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each actionable native vertical-guide segment adopt Obsidian's active guide style while hovered, without advertising an unavailable folding action.

**Architecture:** Keep `.cm-indent::before` as the only guide-rendering source. Add a settings-derived document body class for the `toggle-folding` action, scope both pointer and hover CSS to that class, and switch only the hovered pseudo-element's logical border to Obsidian's active indentation-guide variables. Preserve the existing display body class, persistent-guide promotion, guide targeting, and folding behavior.

**Tech Stack:** TypeScript 5.9, CSS, Obsidian 1.13.1, CodeMirror 6, Jest 30, Rollup 4.

## Global Constraints

- Use normal `git` on `main`; do not use GitButler.
- Start from version `5.6.3`, but do not change package versions or create a release unless the user separately requests one.
- Use only `/Users/kodai/workspaces/github.com/kdnk/obsidian-bullet/vault` for manual Obsidian verification; never target another vault.
- Every vault-affecting Obsidian CLI command must explicitly include `vault=vault`.
- Before every Computer Use action, focus the test renderer with `obsidian-cli vault=vault eval code='window.focus()'`, obtain fresh state, require a title containing `vertical-guide-hover-feedback-test - vault` and not `base`, and never reuse an element index or coordinate.
- Highlight only the `.cm-indent` segment under the pointer; do not highlight a complete logical guide across rows.
- Use `--indentation-guide-width-active` and `--indentation-guide-color-active`; do not introduce fixed hover colors, background highlights, custom geometry, transitions, overlays, measurements, or pointer-tracking state.
- Keep `.cm-indent::before` as the only guide-rendering source and preserve normal-state guide appearance.
- Preserve exact pressed-boundary targeting, direct-child batch folding, selection-safe folding, persistent-guide ownership, layout correction, z-index stacking, capture-phase event handling, and cleanup.
- Build with `npm run build-with-tests` before the complete Jest suite because Markdown integration specs execute `dist/main.js`.
- Use English Conventional Commits with detailed `Why` and `What` sections.

---

## File Structure

- Modify: `src/features/VerticalLines.ts` — manage the display body class and a separate folding-action body class through the existing `DocumentBodyClass` lifecycle.
- Modify: `src/features/__tests__/VerticalLines.test.ts` — prove action-class lifecycle in main/pop-out documents and enforce the pointer/hover stylesheet contract.
- Modify: `styles.css` — scope the pointer cursor to actionable guides and apply the native active border to the hovered segment.
- Modify: `AGENTS.md` — clarify that persistent-guide normal styling stays native while hover feedback may use Obsidian's active guide variables.
- Modify: `docs/superpowers/plans/2026-07-14-vertical-guide-hover-feedback.md` — track execution and final evidence.
- Create temporarily, then delete: `vault/vertical-guide-hover-feedback-test.md` — verify row-local hover feedback and existing folding in the repository test vault.

### Task 1: Track Whether Vertical Guides Are Actionable

**Files:**
- Modify: `src/features/__tests__/VerticalLines.test.ts:90-114,154-231`
- Modify: `src/features/VerticalLines.ts:13,221-260`

**Interfaces:**
- Consumes: `DocumentBodyClass(plugin, className, shouldApply)`, `Settings.verticalLines`, and `Settings.verticalLinesAction`.
- Produces: document class `bullet-plugin-vertical-lines-action-toggle-folding`, present exactly when `verticalLines === true && verticalLinesAction === "toggle-folding"`.
- Preserves: document class `bullet-plugin-vertical-lines`, whose predicate remains `settings.verticalLines`.

- [ ] **Step 1: Synchronize with upstream and confirm the execution baseline**

Run:

```bash
git status --short --branch
git fetch origin
git pull --ff-only
git log -2 --oneline
```

Expected: `main` is clean except for the committed design/plan history, the pull is fast-forward-only or already current, and the latest committed documents describe this feature.

- [ ] **Step 2: Make the workspace-event test helper retain both body-class listeners**

Replace `makePlugin()` in `src/features/__tests__/VerticalLines.test.ts` with:

```ts
function makePlugin() {
  type WorkspaceHandler = (...args: never[]) => void;
  const eventHandlers = new Map<string, WorkspaceHandler[]>();
  const workspace = {
    on: jest.fn((eventName: string, handler: WorkspaceHandler) => {
      const handlers = eventHandlers.get(eventName) ?? [];
      handlers.push(handler);
      eventHandlers.set(eventName, handlers);
      return { eventName, handler };
    }),
  };

  return {
    eventHandlers,
    plugin: {
      app: { workspace },
      registerEditorExtension: jest.fn(),
      registerEvent: jest.fn(),
    },
    workspace,
  };
}
```

This models the two `DocumentBodyClass` instances registering independent `window-open` and `window-close` callbacks.

- [ ] **Step 3: Replace the lifecycle test with action-state expectations**

Replace the existing `"manages the body class for pop-out windows"` test with:

```ts
test("manages display and folding-action classes across documents", async () => {
  const mainDocument = makeDocument();
  const popoutDocument = makeDocument();
  Object.defineProperty(global, "activeDocument", {
    configurable: true,
    value: mainDocument,
  });

  const { eventHandlers, plugin, workspace } = makePlugin();
  const settingsCallbacks: Array<() => void> = [];
  const settings = {
    verticalLines: true,
    verticalLinesAction: "toggle-folding",
    onChange: jest.fn((callback: () => void) => {
      settingsCallbacks.push(callback);
    }),
    removeCallback: jest.fn(),
  };

  const feature = new VerticalLines(
    plugin as never,
    settings as never,
    {} as never,
  );

  await feature.load();

  expect(plugin.registerEditorExtension).toHaveBeenCalled();
  expect(workspace.on).toHaveBeenCalledWith(
    "window-open",
    expect.any(Function),
  );
  expect(workspace.on).toHaveBeenCalledWith(
    "window-close",
    expect.any(Function),
  );
  expect(
    mainDocument.body.classList.contains("bullet-plugin-vertical-lines"),
  ).toBe(true);
  expect(
    mainDocument.body.classList.contains(
      "bullet-plugin-vertical-lines-action-toggle-folding",
    ),
  ).toBe(true);

  for (const handler of eventHandlers.get("window-open") ?? []) {
    handler({} as never, { document: popoutDocument } as never);
  }
  expect(
    popoutDocument.body.classList.contains("bullet-plugin-vertical-lines"),
  ).toBe(true);
  expect(
    popoutDocument.body.classList.contains(
      "bullet-plugin-vertical-lines-action-toggle-folding",
    ),
  ).toBe(true);

  const settingsCallback = settingsCallbacks[0];
  if (!settingsCallback) {
    throw new Error("Expected a settings callback to be registered");
  }

  settings.verticalLinesAction = "none";
  settingsCallback();

  expect(
    mainDocument.body.classList.contains("bullet-plugin-vertical-lines"),
  ).toBe(true);
  expect(
    mainDocument.body.classList.contains(
      "bullet-plugin-vertical-lines-action-toggle-folding",
    ),
  ).toBe(false);
  expect(
    popoutDocument.body.classList.contains("bullet-plugin-vertical-lines"),
  ).toBe(true);
  expect(
    popoutDocument.body.classList.contains(
      "bullet-plugin-vertical-lines-action-toggle-folding",
    ),
  ).toBe(false);

  settings.verticalLinesAction = "toggle-folding";
  settings.verticalLines = false;
  settingsCallback();

  expect(
    mainDocument.body.classList.contains("bullet-plugin-vertical-lines"),
  ).toBe(false);
  expect(
    mainDocument.body.classList.contains(
      "bullet-plugin-vertical-lines-action-toggle-folding",
    ),
  ).toBe(false);

  settings.verticalLines = true;
  settingsCallback();
  await feature.unload();

  expect(
    mainDocument.body.classList.contains("bullet-plugin-vertical-lines"),
  ).toBe(false);
  expect(
    mainDocument.body.classList.contains(
      "bullet-plugin-vertical-lines-action-toggle-folding",
    ),
  ).toBe(false);
  expect(
    popoutDocument.body.classList.contains("bullet-plugin-vertical-lines"),
  ).toBe(false);
  expect(
    popoutDocument.body.classList.contains(
      "bullet-plugin-vertical-lines-action-toggle-folding",
    ),
  ).toBe(false);
  expect(settings.removeCallback).toHaveBeenCalledWith(expect.any(Function));
});
```

- [ ] **Step 4: Run the focused test and capture the RED result**

Run:

```bash
SKIP_OBSIDIAN=1 npx jest --forceExit --runInBand \
  src/features/__tests__/VerticalLines.test.ts
```

Expected: FAIL because `mainDocument` does not yet receive `bullet-plugin-vertical-lines-action-toggle-folding`.

- [ ] **Step 5: Add the action-state body class**

Add beside `VERTICAL_LINES_BODY_CLASS` in `src/features/VerticalLines.ts`:

```ts
const VERTICAL_LINES_ACTION_BODY_CLASS =
  "bullet-plugin-vertical-lines-action-toggle-folding";
```

Replace the `VerticalLines` class with:

```ts
export class VerticalLines implements Feature {
  private bodyClass: DocumentBodyClass;
  private actionBodyClass: DocumentBodyClass;

  constructor(
    private plugin: Plugin,
    private settings: Settings,
    private parser: Parser,
  ) {
    this.bodyClass = new DocumentBodyClass(
      this.plugin,
      VERTICAL_LINES_BODY_CLASS,
      this.shouldApplyBodyClass,
    );
    this.actionBodyClass = new DocumentBodyClass(
      this.plugin,
      VERTICAL_LINES_ACTION_BODY_CLASS,
      this.shouldApplyActionBodyClass,
    );
  }

  async load() {
    this.settings.onChange(this.updateBodyClasses);
    this.bodyClass.load();
    this.actionBodyClass.load();

    this.plugin.registerEditorExtension(
      ViewPlugin.define(
        (view) =>
          new VerticalLinesPluginValue(this.settings, this.parser, view),
      ),
    );
  }

  async unload() {
    this.settings.removeCallback(this.updateBodyClasses);
    this.actionBodyClass.unload();
    this.bodyClass.unload();
  }

  private updateBodyClasses = () => {
    this.bodyClass.update();
    this.actionBodyClass.update();
  };

  private shouldApplyBodyClass = () => {
    return this.settings.verticalLines;
  };

  private shouldApplyActionBodyClass = () => {
    return (
      this.settings.verticalLines &&
      this.settings.verticalLinesAction === "toggle-folding"
    );
  };
}
```

- [ ] **Step 6: Run focused verification and static checks**

Run:

```bash
SKIP_OBSIDIAN=1 npx jest --forceExit --runInBand \
  src/features/__tests__/VerticalLines.test.ts
npm run lint
npx tsc --noEmit
git diff --check
```

Expected: the VerticalLines suite passes; lint, TypeScript, and diff checks exit 0.

- [ ] **Step 7: Commit the action-state lifecycle**

```bash
git add src/features/VerticalLines.ts src/features/__tests__/VerticalLines.test.ts
git commit \
  -m "feat(vertical-lines): track folding action state" \
  -m $'Why:\n- Hover feedback must not advertise guide clicks while the folding action is disabled.\n- The existing display class intentionally remains active whenever guides are shown.' \
  -m $'What:\n- Add a separate document body class for actionable folding guides.\n- Keep it synchronized across settings changes, pop-out windows, and unload.\n- Cover both display and action classes with lifecycle tests.'
```

### Task 2: Style Only the Hovered Actionable Guide Segment

**Files:**
- Modify: `src/features/__tests__/VerticalLines.test.ts:456-474`
- Modify: `styles.css:16-35`
- Modify: `AGENTS.md:24-26`

**Interfaces:**
- Consumes: body class `.bullet-plugin-vertical-lines-action-toggle-folding` from Task 1 and Obsidian variables `--indentation-guide-width-active` / `--indentation-guide-color-active`.
- Produces: pointer and hover selectors scoped to actionable CM6 `.cm-indent` elements.
- Preserves: the persistent-guide layout and stacking selectors under `.bullet-plugin-vertical-lines`.

- [ ] **Step 1: Add failing stylesheet contract tests**

Add these tests after the existing persistent-guide stacking test in `src/features/__tests__/VerticalLines.test.ts`:

```ts
test("shows a pointer only for actionable vertical guides", () => {
  const styles = readFileSync(join(__dirname, "../../../styles.css"), "utf8");
  const declarations = styles.match(
    /\.bullet-plugin-vertical-lines-action-toggle-folding\s+\.markdown-source-view\.mod-cm6\s+\.cm-hmd-list-indent\s+\.cm-indent\s*\{([^}]*)\}/,
  )?.[1];

  expect(declarations?.trim()).toBe("cursor: pointer;");
  expect(styles).not.toMatch(
    /\.bullet-plugin-vertical-lines\s+\.markdown-source-view\.mod-cm6\s+\.cm-hmd-list-indent\s+\.cm-indent\s*\{[^}]*cursor:\s*pointer/,
  );
});

test("uses the native active guide style on only the hovered segment", () => {
  const styles = readFileSync(join(__dirname, "../../../styles.css"), "utf8");
  const declarations = styles.match(
    /\.bullet-plugin-vertical-lines-action-toggle-folding\s+\.markdown-source-view\.mod-cm6\s+\.cm-hmd-list-indent\s+\.cm-indent:hover::before\s*\{([^}]*)\}/,
  )?.[1];

  expect(declarations?.replace(/\s+/g, " ").trim()).toBe(
    "border-inline-end: var(--indentation-guide-width-active) solid var(--indentation-guide-color-active);",
  );
});
```

- [ ] **Step 2: Run the focused test and capture the RED result**

Run:

```bash
SKIP_OBSIDIAN=1 npx jest --forceExit --runInBand \
  src/features/__tests__/VerticalLines.test.ts
```

Expected: FAIL because the current pointer selector uses `.bullet-plugin-vertical-lines` and no hover selector exists.

- [ ] **Step 3: Scope the pointer and add the native hover border**

Replace the first pointer block in `styles.css` with:

```css
.bullet-plugin-vertical-lines-action-toggle-folding
  .markdown-source-view.mod-cm6
  .cm-hmd-list-indent
  .cm-indent {
  cursor: pointer;
}

.bullet-plugin-vertical-lines-action-toggle-folding
  .markdown-source-view.mod-cm6
  .cm-hmd-list-indent
  .cm-indent:hover::before {
  border-inline-end: var(--indentation-guide-width-active) solid
    var(--indentation-guide-color-active);
}
```

Do not change the two existing `.bullet-plugin-vertical-lines` rules for persistent spacing layout and folded-indicator stacking.

- [ ] **Step 4: Clarify the durable native-style rule**

In `AGENTS.md`, replace the final sentence of the persistent layout bullet so the complete bullet reads:

```md
- `.cm-indent` は `min-width` と `inline-block` も適用するため、spacing span へ付与するだけでは nesting の横位置が変わります。plugin marker に限定して `min-width: 0` と `display: inline` を適用し、元の spacing 幅を維持してください。persistent guide の通常表示では、線の offset・太さ・色を上書きしないでください。
```

Immediately after it, add:

```md
- クリック可能な guide の hover feedback は、toggle folding action が有効なときだけ付く body class に限定し、既存の native `.cm-indent::before` へ Obsidian の `--indentation-guide-width-active` と `--indentation-guide-color-active` を適用してください。固定色、独自 geometry、背景 highlight、通常時の見た目変更は追加しないでください。
```

- [ ] **Step 5: Run focused verification and static checks**

Run:

```bash
SKIP_OBSIDIAN=1 npx jest --forceExit --runInBand \
  src/features/__tests__/VerticalLines.test.ts
npm run lint
npx tsc --noEmit
git diff --check
```

Expected: the VerticalLines suite passes, including both new stylesheet contracts; all static checks exit 0.

- [ ] **Step 6: Commit hover feedback and agent guidance**

```bash
git add styles.css src/features/__tests__/VerticalLines.test.ts AGENTS.md
git commit \
  -m "feat(vertical-lines): highlight hoverable guides" \
  -m $'Why:\n- A pointer cursor alone does not make the guide folding action sufficiently visible.\n- Hover styling must follow Obsidian themes and disappear when the action is unavailable.' \
  -m $'What:\n- Apply Obsidian active guide width and color to only the hovered native segment.\n- Scope pointer and hover feedback to the folding-action body class.\n- Document the durable native-style constraints and cover the CSS contract.'
```

### Task 3: Verify in Automation and the Repository Test Vault

**Files:**
- Create temporarily, then delete: `vault/vertical-guide-hover-feedback-test.md`
- Modify: `docs/superpowers/plans/2026-07-14-vertical-guide-hover-feedback.md`

**Interfaces:**
- Consumes: the Task 1 action-state lifecycle and Task 2 stylesheet rules.
- Produces: complete automated evidence, guarded Obsidian 1.13.1 evidence, a clean repository, and synchronized `origin/main`.

- [ ] **Step 1: Run the complete automated pipeline in the required order**

Run:

```bash
npm run lint
npx tsc --noEmit
npm run build-with-tests
npm test -- --runInBand
npm run build
```

Expected: lint and TypeScript exit 0; Rollup creates both test-enabled and production bundles; every Jest suite and test passes. The existing Jest `--forceExit` advisory may appear, but no suite or test may fail.

- [ ] **Step 2: Install only production artifacts into the repository test vault**

Run after the production build:

```bash
cp dist/main.js manifest.json styles.css vault/.obsidian/plugins/bullet/
shasum -a 256 \
  dist/main.js manifest.json styles.css \
  vault/.obsidian/plugins/bullet/main.js \
  vault/.obsidian/plugins/bullet/manifest.json \
  vault/.obsidian/plugins/bullet/styles.css
```

Expected: every source artifact hash matches its installed test-vault counterpart. If any later command runs `npm run build-with-tests`, rebuild production and reinstall `dist/main.js` before completion.

- [ ] **Step 3: Create the isolated hover fixture**

Use `apply_patch` to create `vault/vertical-guide-hover-feedback-test.md` with:

```md
- parent
    - child
        - branch alpha
            - leaf alpha
        - branch beta
            - leaf beta
    - outer sibling
        - outer leaf
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
```

- [ ] **Step 4: Start, open, and reload only the repository test vault**

If Obsidian is not running, bootstrap the exact vault and fixture:

```bash
open 'obsidian://open?vault=vault&file=vertical-guide-hover-feedback-test'
```

Then run:

```bash
/Applications/Obsidian.app/Contents/MacOS/obsidian-cli \
  vault=vault open path=vertical-guide-hover-feedback-test.md
/Applications/Obsidian.app/Contents/MacOS/obsidian-cli \
  vault=vault plugin:reload id=bullet
/Applications/Obsidian.app/Contents/MacOS/obsidian-cli \
  vault=vault eval code='document.title'
```

Expected: the title is `vertical-guide-hover-feedback-test - vault - Obsidian 1.13.1`. Stop without any Computer Use action if the title contains `base` or does not identify the fixture and `vault`.

- [ ] **Step 5: Verify normal, outer, and inner hover styles**

Before each Computer Use action, run:

```bash
/Applications/Obsidian.app/Contents/MacOS/obsidian-cli \
  vault=vault eval code='window.focus()'
```

Obtain fresh Computer Use state and confirm the exact fixture-vault title. Rediscover the guide element and coordinate for each action.

Verify in order:

1. Locate the `.cm-line` containing `branch alpha`, mark its first and last `.cm-indent` elements with `data-bullet-hover-test="outer"` and `data-bullet-hover-test="inner"`, and record both pseudo-elements' computed `borderInlineEndColor` / `borderInlineEndWidth` before hover.
2. Hover the marked outer segment. Confirm only that element matches `:hover` and its computed border differs from the recorded normal border according to the active theme style.
3. Move away, reacquire fresh state, and confirm the segment returns to the normal computed border.
4. Hover the marked inner segment on the same row. Confirm that segment uses the active border while the adjacent outer segment retains its recorded normal border.

Create the temporary markers and capture the fresh geometry with this vault-scoped command immediately before rediscovering each Computer Use target:

```bash
/Applications/Obsidian.app/Contents/MacOS/obsidian-cli vault=vault eval code='(() => { const line = Array.from(document.querySelectorAll(".markdown-source-view.mod-cm6 .cm-line")).find((element) => element.textContent?.includes("branch alpha")); const guides = Array.from(line?.querySelectorAll(".cm-indent") ?? []); const outer = guides[0]; const inner = guides[guides.length - 1]; if (!outer || !inner) return { error: "guides-not-found" }; outer.setAttribute("data-bullet-hover-test", "outer"); inner.setAttribute("data-bullet-hover-test", "inner"); const describe = (element) => { const rect = element.getBoundingClientRect(); const pseudo = getComputedStyle(element, "::before"); return { hovered: element.matches(":hover"), left: rect.left, top: rect.top, width: rect.width, height: rect.height, borderColor: pseudo.borderInlineEndColor, borderWidth: pseudo.borderInlineEndWidth }; }; return { outer: describe(outer), inner: describe(inner) }; })()'
```

After each pointer move, record the live state with:

```bash
/Applications/Obsidian.app/Contents/MacOS/obsidian-cli vault=vault eval code='(() => { const describe = (name) => { const element = document.querySelector(`[data-bullet-hover-test="${name}"]`); if (!element) return null; const pseudo = getComputedStyle(element, "::before"); return { hovered: element.matches(":hover"), borderColor: pseudo.borderInlineEndColor, borderWidth: pseudo.borderInlineEndWidth }; }; return { outer: describe("outer"), inner: describe("inner") }; })()'
```

Expected: feedback is row-local and segment-local, uses the native active style, and clears immediately without layout movement.

- [ ] **Step 6: Verify action gating and persistent-guide behavior**

With a fresh title guard before every action:

1. Click the hovered inner child guide and confirm only `leaf alpha` / `leaf beta` hide; `outer sibling` remains expanded.
2. Hover a surviving promoted guide and confirm the same active border appears.
3. Click it and confirm the hidden leaves reopen.
4. Set the in-memory plugin setting to `"none"` with the exact vault-scoped command below. Confirm the display class remains, the action class disappears, and the marked guide's computed cursor is no longer `pointer`:

```bash
/Applications/Obsidian.app/Contents/MacOS/obsidian-cli vault=vault eval code='(() => { const plugin = app.plugins.plugins.bullet; if (!plugin) return { error: "plugin-not-found" }; plugin.settings.verticalLinesAction = "none"; const guide = document.querySelector("[data-bullet-hover-test=inner]"); return { displayClass: document.body.classList.contains("bullet-plugin-vertical-lines"), actionClass: document.body.classList.contains("bullet-plugin-vertical-lines-action-toggle-folding"), cursor: guide ? getComputedStyle(guide).cursor : null }; })()'
```

5. Restore the in-memory setting with the exact vault-scoped command below and confirm the action class and pointer cursor return:

```bash
/Applications/Obsidian.app/Contents/MacOS/obsidian-cli vault=vault eval code='(() => { const plugin = app.plugins.plugins.bullet; if (!plugin) return { error: "plugin-not-found" }; plugin.settings.verticalLinesAction = "toggle-folding"; const guide = document.querySelector("[data-bullet-hover-test=inner]"); return { displayClass: document.body.classList.contains("bullet-plugin-vertical-lines"), actionClass: document.body.classList.contains("bullet-plugin-vertical-lines-action-toggle-folding"), cursor: guide ? getComputedStyle(guide).cursor : null }; })()'
```

6. Confirm no `.bullet-plugin-list-lines-scroller`, `.bullet-plugin-list-lines-content-container`, or `.bullet-plugin-list-line` exists.

Expected: existing nested toggle behavior is unchanged, persistent guides share the hover feedback, unavailable actions have no affordance, and no overlay is introduced.

- [ ] **Step 7: Remove temporary state and restore production artifacts**

Restore the action setting to `"toggle-folding"`, remove test-only DOM markers, and use `apply_patch` to delete `vault/vertical-guide-hover-feedback-test.md`. Remove the markers with:

```bash
/Applications/Obsidian.app/Contents/MacOS/obsidian-cli vault=vault eval code='(() => { const plugin = app.plugins.plugins.bullet; if (plugin) plugin.settings.verticalLinesAction = "toggle-folding"; document.querySelectorAll("[data-bullet-hover-test]").forEach((element) => element.removeAttribute("data-bullet-hover-test")); return { remainingMarkers: document.querySelectorAll("[data-bullet-hover-test]").length, actionClass: document.body.classList.contains("bullet-plugin-vertical-lines-action-toggle-folding") }; })()'
```

Then run:

```bash
npm run build
cp dist/main.js manifest.json styles.css vault/.obsidian/plugins/bullet/
test ! -e vault/vertical-guide-hover-feedback-test.md
shasum -a 256 \
  dist/main.js manifest.json styles.css \
  vault/.obsidian/plugins/bullet/main.js \
  vault/.obsidian/plugins/bullet/manifest.json \
  vault/.obsidian/plugins/bullet/styles.css
git diff --check
git status --short --branch
```

Expected: the fixture is absent; source/install artifact hashes match; only the plan execution record, if edited, remains uncommitted; diff check passes.

- [ ] **Step 8: Review, record evidence, and push `main`**

Review the complete range from design commit `e9c694c` through the implementation commits. Confirm action gating, theme-native row-local hover, unchanged guide targeting/folding, test-vault isolation, and cleanup.

Record exact test counts, artifact hashes, guarded window titles, hover computed values, action-gating results, and cleanup status in this plan. Then run fresh final verification:

```bash
SKIP_OBSIDIAN=1 npx jest --forceExit --runInBand \
  src/features/__tests__/VerticalLines.test.ts
npm run lint
npx tsc --noEmit
git diff --check
```

Commit the execution record:

```bash
git add docs/superpowers/plans/2026-07-14-vertical-guide-hover-feedback.md
git commit \
  -m "docs: record vertical guide hover verification" \
  -m $'Why:\n- Hover feedback changes visible interaction affordance and needs reproducible automated and test-vault evidence.\n- The final repository and installed-artifact state must remain auditable.' \
  -m $'What:\n- Record automated test counts, native hover values, action gating, and persistent-guide checks.\n- Record test-vault isolation, artifact hashes, cleanup, and final review.'
```

Synchronize and push directly to the default branch:

```bash
git fetch origin
git pull --ff-only
git push origin main
git status --short --branch
git rev-parse HEAD main origin/main
```

Expected: push succeeds, the worktree is clean, and `HEAD`, `main`, and `origin/main` resolve to the same commit. Do not create a release or pull request.
