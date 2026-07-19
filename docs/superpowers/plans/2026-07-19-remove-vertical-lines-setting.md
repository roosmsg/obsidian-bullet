# Remove Vertical-Line Setting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the misleading native-guide display toggle and make folding actions and outer guides obey their own settings directly.

**Architecture:** `Settings` strips and migrates the legacy `listLines` value at the storage boundary. `VerticalLines` manages only the folding-action document class and editor extension, while `GuideFoldingPluginValue` derives persistent nested guides from `listLineAction` and outer decorations from `outerListLines`.

**Tech Stack:** TypeScript 5.9, Obsidian API, CodeMirror 6, Jest 30, CSS, GitButler CLI, Node.js 22.23.1

## Global Constraints

- Use `but` for every version-control write; ordinary `git` is read-only.
- Use Node.js 22.23.1 or newer in the Node.js 22 line for local verification.
- Add `SKIP_OBSIDIAN=1` whenever Jest runs only tests under `src`.
- Obsidian's `.cm-indent::before` remains the only nested-guide paint source.
- Persistent nested guides are enabled exactly when `listLineAction === "toggle-folding"`.
- Outer guide visibility is controlled exactly by `outerListLines`; outer guide interaction additionally requires `listLineAction === "toggle-folding"`.
- A stored legacy `listLines: false` migrates `outerListLines` to `false` and `listLineAction` to `"none"`.
- Do not add overlay DOM, coordinate caches, custom nested-guide geometry, or manual scroll restoration.

---

### Task 1: Remove the setting from storage, test commands, and settings UI

**Files:**

- Modify: `src/services/Settings.ts`
- Modify: `src/services/__tests__/Settings.test.ts`
- Modify: `src/features/SettingsTab.ts`
- Modify: `src/features/__tests__/SettingsTab.test.ts`
- Modify: `src/ObsidianBulletPluginWithTests.ts`
- Modify: `src/__tests__/ObsidianBulletPluginWithTests.test.ts`
- Modify: `jest/test-globals.type-test.ts`

**Interfaces:**

- Consumes: stored settings may contain the removed legacy property `listLines?: boolean`.
- Produces: `SettingsObject` without `listLines`, and the existing `outerVerticalLines` and `verticalLinesAction` accessors as the only vertical-line settings.

- [ ] **Step 1: Write failing storage migration tests**

Add tests to `src/services/__tests__/Settings.test.ts` that load a legacy object with `listLines: false`, `outerListLines: true`, and `listLineAction: "toggle-folding"`.
Assert that `outerVerticalLines` is `false`, `verticalLinesAction` is `"none"`, and `getValues()` has no own `listLines` property.
Call `save()` and assert that `saveData` receives an object without `listLines`.

Also adapt notification and reset tests so they subscribe to `outerListLines` and `listLineAction`, with no reference to the removed key or accessor.

- [ ] **Step 2: Write failing settings-surface tests**

Update `src/features/__tests__/SettingsTab.test.ts` so the Appearance group contains only:

```ts
[
  "Improve the style of your lists",
  "Draw outer list lines",
]
```

Remove `verticalLines` from `makeSettings()` and require both declarative definitions and the imperative fallback to omit `Draw vertical indentation lines`.

Update `src/__tests__/ObsidianBulletPluginWithTests.test.ts` and `jest/test-globals.type-test.ts` so `listLines` is rejected as an unknown setting key, while malformed boolean coverage uses `outerListLines`.

- [ ] **Step 3: Run the targeted tests and verify RED**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest \
  src/services/__tests__/Settings.test.ts \
  src/features/__tests__/SettingsTab.test.ts \
  src/__tests__/ObsidianBulletPluginWithTests.test.ts \
  --runInBand
```

Expected: FAIL because `listLines` still exists, the legacy value is retained, and the settings UI still exposes the removed control.

- [ ] **Step 4: Implement the storage migration**

Remove `listLines` from `SettingsObject`, `DEFAULT_SETTINGS`, and the `verticalLines` getter and setter.
Introduce a storage-only input type:

```ts
type StoredSettingsObject = Partial<SettingsObject> & {
  listLines?: boolean;
};
```

Change `Storage.loadData()` to return `Promise<StoredSettingsObject | null>`.
At load time, default nullish storage to `{}`, remove `listLines` by destructuring, merge the remaining values into `DEFAULT_SETTINGS`, and apply this migration:

```ts
if (listLines === false) {
  this.values.outerListLines = false;
  this.values.listLineAction = "none";
}
```

- [ ] **Step 5: Remove the UI and test-command controls**

Delete `verticalLines` from `SettingsControlKey`, `SETTING_GROUPS`, `getControlValue()`, and `setControlValue()`.
Delete the `listLines` decoder from `settingCommandDecoders`.
Keep `outerListLines` and `listLineAction` unchanged.

- [ ] **Step 6: Run the targeted tests and verify GREEN**

Run the Step 3 command again.
Expected: PASS with no test failures.

- [ ] **Step 7: Commit Task 1 with GitButler**

Run `but diff`, select only the seven Task 1 files, and commit to `codex/remove-vertical-lines-setting` with an English Conventional Commit message containing explicit `Why:` and `What:` sections.

---

### Task 2: Reassign runtime guide responsibilities

**Files:**

- Modify: `src/features/VerticalLines.ts`
- Modify: `src/features/__tests__/VerticalLines.test.ts`
- Modify: `src/features/GuideFolding.ts`
- Modify: `src/features/__tests__/GuideFolding.test.ts`
- Modify: `src/ObsidianBulletPlugin.ts`
- Modify: `styles.css`

**Interfaces:**

- Consumes: `Settings.verticalLinesAction` and `Settings.outerVerticalLines` from Task 1.
- Produces: action body class based only on `verticalLinesAction`, persistent native guides based only on the action, and outer decorations based only on `outerVerticalLines`.

- [ ] **Step 1: Write failing `VerticalLines` behavior tests**

Change `src/features/__tests__/VerticalLines.test.ts` to require subscription to only `listLineAction` at the feature level.
Require `bullet-plugin-vertical-lines-action-toggle-folding` and `GUIDE_FOLDING_SCROLL_PAST_END_EXTENSION` to follow `verticalLinesAction` without a `verticalLines` field.
Remove every assertion for the obsolete `bullet-plugin-vertical-lines` body class.

- [ ] **Step 2: Write failing `GuideFolding` ownership tests**

Change fixtures in `src/features/__tests__/GuideFolding.test.ts` to remove `verticalLines`.
Require:

```ts
settings.onChange(
  ["outerListLines", "listLineAction"],
  expect.any(Function),
);
```

Test that `outerVerticalLines: true` builds outer decorations even when `verticalLinesAction: "none"`.
Test that `outerVerticalLines: false` builds none even when folding is enabled.
Test that persistent `.cm-indent` promotion occurs for `verticalLinesAction: "toggle-folding"` and is removed for `"none"`.
Retain ignored-interaction coverage using `verticalLinesAction: "none"` as the disabled state.

Update CSS assertions so normal outer styles and persistent marker styles do not require `.bullet-plugin-vertical-lines`, while action-only styles continue to require `.bullet-plugin-vertical-lines-action-toggle-folding`.

- [ ] **Step 3: Run runtime tests and verify RED**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest \
  src/features/__tests__/VerticalLines.test.ts \
  src/features/__tests__/GuideFolding.test.ts \
  --runInBand
```

Expected: FAIL because production code still reads `settings.verticalLines`, subscribes to `listLines`, and scopes normal styles under the removed body class.

- [ ] **Step 4: Simplify `VerticalLines`**

Remove `VERTICAL_LINES_BODY_CLASS` and the display `DocumentBodyClass` instance.
Keep only the action body class and return:

```ts
private shouldApplyActionBodyClass = () => {
  return this.settings.verticalLinesAction === "toggle-folding";
};
```

Subscribe the feature-level callback only to `listLineAction`.
Keep the CodeMirror view plugin registered at all times because it owns outer decorations as well as folding interaction.

- [ ] **Step 5: Simplify `GuideFoldingPluginValue`**

Subscribe to `outerListLines` and `listLineAction` only.
Make `interactionEnabled()` return whether `verticalLinesAction` is `"toggle-folding"`.
Make outer visibility a single boolean derived from `outerVerticalLines`.
Build outer decorations whenever `outerVerticalLines` is true, independent of folding action.
Pass `interactionEnabled()` to `synchronizePersistentIndentGuides()`.

Keep `outerInteractionEnabled()` as the conjunction of outer visibility and folding action.

- [ ] **Step 6: Remove the obsolete normal-display CSS scope**

Change the normal selectors to:

```css
.markdown-source-view.mod-cm6 .bullet-plugin-outer-list-guide
.markdown-source-view.mod-cm6 .bullet-plugin-outer-list-guide::before
.markdown-source-view.mod-cm6
  .cm-indent-spacing.bullet-plugin-persistent-indent-guide
.markdown-source-view.mod-cm6
  .cm-indent-spacing.bullet-plugin-persistent-indent-guide::before
```

Do not add nested-guide color, width, offset, or geometry declarations.
Update the comment in `src/ObsidianBulletPlugin.ts` to describe vertical-line folding and outer-guide settings rather than `settings.verticalLines`.

- [ ] **Step 7: Run runtime tests and verify GREEN**

Run the Step 3 command again.
Expected: PASS with no test failures.

- [ ] **Step 8: Commit Task 2 with GitButler**

Run `but diff`, select only the six Task 2 files, and commit to `codex/remove-vertical-lines-setting` with an English Conventional Commit message containing explicit `Why:` and `What:` sections.

---

### Task 3: Update documentation and verify the complete change

**Files:**

- Modify: `README.md`
- Verify: `docs/superpowers/specs/2026-07-19-remove-vertical-lines-setting-design.md`
- Verify: `docs/superpowers/plans/2026-07-19-remove-vertical-lines-setting.md`

**Interfaces:**

- Consumes: the settings and behavior shipped by Tasks 1 and 2.
- Produces: user documentation that exposes only independently functioning controls.

- [ ] **Step 1: Update the README settings table**

Delete the `Draw vertical indentation lines` row from Appearance.
Keep `Draw outer list lines` in Appearance and `Fold lists from vertical indentation lines` in Folding.
Rewrite the compatibility sentence so it identifies `vertical-line folding and outer guides` as Live Preview behavior rather than attributing native indentation-guide drawing to Bullet.

- [ ] **Step 2: Check for stale implementation references**

Run:

```bash
rg -n '\blistLines\b|\bverticalLines\b|bullet-plugin-vertical-lines(?!-action)' \
  src styles.css README.md jest --pcre2
```

Expected: only the legacy migration test and the compile-time unknown-key assertion contain `listLines`.
No production accessor, current decoder, CSS body class, README label, or `verticalLines` reference remains.
Historical specs and plans are intentionally unchanged.

- [ ] **Step 3: Run formatting and lint verification**

Run:

```bash
n exec 22.23.1 npm run lint
```

Expected: Prettier and ESLint both exit 0 with no warnings.

- [ ] **Step 4: Run the full unit-test suite**

Run:

```bash
n exec 22.23.1 npm run test:unit -- --runInBand
```

Expected: all `src` test suites pass and Jest reports zero failed tests.

- [ ] **Step 5: Build the test bundle**

Run:

```bash
n exec 22.23.1 npm run build-with-tests
```

Expected: Rollup exits 0 and generates the ignored `dist/main.js` test bundle without adding it to version control.

- [ ] **Step 6: Review the complete diff against the spec**

Check that old `listLines: false` migration is covered, outer visibility is independent, persistent guides require folding action, and native nested-guide paint remains untouched.
Address all Critical and Important review findings, then rerun the covering tests.

- [ ] **Step 7: Commit Task 3 with GitButler**

Run `but diff`, select `README.md` and this plan file if still uncommitted, and commit to `codex/remove-vertical-lines-setting` with an English Conventional Commit message containing explicit `Why:` and `What:` sections.
