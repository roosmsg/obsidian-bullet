# Hide List Chevrons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide every Live Preview list chevron while vertical guides provide toggle-folding interaction, without hiding heading chevrons or shifting list layout.

**Architecture:** Reuse the existing `bullet-plugin-vertical-lines-action-toggle-folding` body class as the single source of truth. Add one narrowly scoped CSS rule for native collapse indicators inside CodeMirror list lines; preserve their layout with `visibility` and remove their hit target with `pointer-events`.

**Tech Stack:** Obsidian Live Preview DOM, CSS, Jest 30, Rollup, TypeScript.

## Global Constraints

- The accepted design is `docs/superpowers/specs/2026-07-14-hide-list-chevrons-design.md`.
- Use normal `git` on the default branch. Do not use GitButler.
- Use TDD and observe the focused test fail before changing production CSS.
- Hide list chevrons whenever vertical lines are enabled and `Vertical lines action` is `Toggle folding`, independent of the outer-guide visibility setting.
- Do not hide heading or other non-list collapse indicators.
- Preserve the native indicator's layout width; do not use `display: none`.
- Run `.spec.md` integration tests only after `npm run build-with-tests`.
- Use only the repository `vault` for live Obsidian verification. Never open or modify `/Users/kodai/base`.
- Every Obsidian CLI command must include `vault=vault`.
- Before every Computer Use action, focus the test renderer with `obsidian-cli vault=vault eval code='window.focus()'`, fetch fresh app state, and stop if the title is not `vault` or contains `base`.
- Do not change version fields unless the user separately requests a release.

---

## File Map

- Modify `src/features/__tests__/VerticalLines.test.ts`: lock the list-only selector and non-layout-changing declarations.
- Modify `styles.css`: hide native chevrons only inside Live Preview list lines while the existing action body class is active.

---

### Task 1: Hide native list chevrons under vertical-line folding

**Files:**

- Modify: `src/features/__tests__/VerticalLines.test.ts`
- Modify: `styles.css`

**Interfaces:**

- Consumes: existing `bullet-plugin-vertical-lines-action-toggle-folding` body class maintained by `VerticalLines`.
- Produces: a CSS rule scoped to `.markdown-source-view.mod-cm6 .HyperMD-list-line .cm-fold-indicator .collapse-indicator`.

- [x] **Step 1: Write the failing CSS contract test**

Add this test beside the existing vertical-guide CSS tests in `src/features/__tests__/VerticalLines.test.ts`:

```ts
test("hides list chevrons while vertical guides toggle folding", () => {
  const styles = readFileSync(join(__dirname, "../../../styles.css"), "utf8");
  const declarations = styles.match(
    /\.bullet-plugin-vertical-lines-action-toggle-folding\s+\.markdown-source-view\.mod-cm6\s+\.HyperMD-list-line\s+\.cm-fold-indicator\s+\.collapse-indicator\s*\{([^}]*)\}/,
  )?.[1];

  expect(declarations?.replace(/\s+/g, " ").trim()).toBe(
    "visibility: hidden; pointer-events: none;",
  );
  expect(declarations).not.toContain("display:");
  expect(styles).not.toMatch(
    /\.bullet-plugin-vertical-lines-action-toggle-folding\s+\.markdown-source-view\.mod-cm6\s+\.cm-fold-indicator\s+\.collapse-indicator\s*\{/,
  );
});
```

- [x] **Step 2: Run the focused test and verify RED**

Run:

```bash
SKIP_OBSIDIAN=1 npx jest src/features/__tests__/VerticalLines.test.ts --runInBand
```

Expected: FAIL because the list-chevron rule is absent and `declarations` is `undefined`.

- [x] **Step 3: Add the minimal scoped CSS rule**

Add this rule after the existing action-enabled guide styles in `styles.css`:

```css
.bullet-plugin-vertical-lines-action-toggle-folding
  .markdown-source-view.mod-cm6
  .HyperMD-list-line
  .cm-fold-indicator
  .collapse-indicator {
  visibility: hidden;
  pointer-events: none;
}
```

- [x] **Step 4: Run focused and static verification**

Run:

```bash
SKIP_OBSIDIAN=1 npx jest src/features/__tests__/VerticalLines.test.ts --runInBand
npx prettier --check styles.css src/features/__tests__/VerticalLines.test.ts
npm run lint
npx tsc --noEmit
```

Expected: every command exits 0.

- [x] **Step 5: Build and run the complete automated suite**

Run:

```bash
npm run build-with-tests
npm test -- --runInBand
npm run build
```

Expected: every command exits 0 and the production `dist/main.js` is rebuilt.

- [x] **Step 6: Verify in the repository test vault**

Install the freshly built plugin artifacts only into `vault/.obsidian/plugins/bullet/`. Open and reload with Obsidian CLI commands that explicitly include `vault=vault`.

Using a fixture containing a foldable bullet and a foldable Markdown heading, verify:

1. With vertical lines enabled and action set to `Toggle folding`, list chevrons are absent, heading chevrons remain visible, and vertical-line clicks still close and reopen the list branch.
2. With action set to `None`, list chevrons reappear.
3. Switching the outer-guide setting does not change list-chevron visibility.
4. Bullet text and markers do not move horizontally when the action changes.

Before every Computer Use action, run `obsidian-cli vault=vault eval code='window.focus()'` and inspect fresh state to confirm the title is `vault` and not `base`.

- [ ] **Step 7: Commit and push the verified change**

```bash
git add AGENTS.md docs/superpowers/specs/2026-07-14-hide-list-chevrons-design.md docs/superpowers/plans/2026-07-14-hide-list-chevrons.md src/features/__tests__/VerticalLines.test.ts styles.css
git commit -m "feat(vertical-lines): hide redundant list chevrons" -m "Why:
- Vertical guides replace native list chevrons when they provide folding interaction.
- Showing both controls adds visual noise and overlapping affordances.

What:
- Hide only Live Preview list chevrons while vertical-line folding is enabled.
- Preserve indicator layout and heading chevrons.
- Add a CSS contract test for selector scope and interaction behavior."
git push origin main
```

Expected: the commit succeeds on `main`, and `git status --short --branch` reports `main...origin/main` with no local changes.
