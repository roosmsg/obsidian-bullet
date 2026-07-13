# Nested Native Guide Targeting Design

## Context

The vertical-guide compatibility work restored direct-child batch folding, selection-safe folds, and persistent native guides. However, the current `resolveVerticalGuideTarget` ignores which visible guide was pressed and always returns the outermost real list ancestor. On a deeply nested row, pressing an inner child guide therefore toggles the outer parent's direct branches and closes unrelated siblings.

The legacy overlay associated every rendered guide with the exact list that owned it. The current implementation must recover that guide-specific targeting without restoring overlay DOM or geometry tracking.

Guarded diagnostics in the repository test vault confirmed that Obsidian 1.13.1 can expose several `.cm-indent` elements on one row. With standard four-space nesting, their painted boundaries begin after indentation prefixes of 0, 4, and 8 characters. Obsidian can also combine several indentation units into one native `.cm-indent`, so guide-array indexes alone are not a reliable ancestor key.

## Goals

- Map an outer guide to the outer ancestor it visibly represents.
- Map an inner guide to the matching child ancestor, so only that child's direct non-empty branches toggle.
- Preserve direct-child batch fold/unfold behavior, selection-safe folding, persistent native guides, and native scrolling/alignment.
- Ignore a guide when its painted indentation boundary cannot be matched to a real ancestor.
- Verify both outer- and inner-guide behavior in automated tests and in the repository test vault.

## Non-goals

- Do not restore the plugin-owned vertical-line overlay.
- Do not add coordinate caches, measurements, observers, animation-frame scheduling, or scroll synchronization.
- Do not change native guide geometry, theme colors, line width, or indentation layout.
- Do not change package versions or create a release unless separately requested.

## Considered Approaches

### Match the clicked guide's indentation boundary to an ancestor

Compute the raw indentation prefix before the pressed `.cm-indent` inside its `.cm-hmd-list-indent` container. Match that exact prefix to the first-line indentation of the owning list's real ancestors.

This is the selected approach. It derives the target from the actual painted boundary, works when one native span combines multiple indentation units, and requires no geometry or plugin-owned rendering.

### Restore legacy guide-index mapping

Collect every `.cm-indent` on the row and map the pressed element's array index to the ancestor array.

This is smaller, but Obsidian may combine multiple indentation units into one element. The number of visible elements can then differ from the number of real ancestors, causing index alignment to select the wrong list.

### Restore the legacy overlay

Render one plugin-owned line per list and retain the list reference on that line.

This reproduces the old ownership model but also restores the measurement and scroll-synchronization architecture that previously drifted. It conflicts with the accepted native-guide design.

## Target Resolution

`resolveVerticalGuideTarget` will receive both the parsed list that owns the pressed row and the pressed guide element.

1. Require the guide to be a direct child of a `.cm-hmd-list-indent` container. If the expected container relationship is absent, return `null`.
2. Walk the container's child nodes before the pressed guide and concatenate their text content. This string is the raw indentation prefix at the guide's painted left boundary.
3. Walk from the owning list's parent toward the parser's synthetic root and collect only real ancestors.
4. Return the real ancestor whose `getFirstLineIndent()` exactly equals the boundary prefix.
5. If no ancestor has an exact match, return `null`. The handler must not fall back to the outermost ancestor.

Exact string comparison preserves tabs and mixed whitespace instead of treating all indentation as a character count or pixel distance.

For a standard four-space hierarchy, a row with three guides has boundary prefixes `""`, `"    "`, and `"        "`; these resolve to the outer parent, child, and grandchild respectively. If Obsidian combines indentation into fewer elements, only the boundaries it actually paints are actionable.

## Folding Behavior

Target resolution is the only production behavior that changes.

After resolving a target, `toggleVerticalGuideTarget` keeps the established contract:

- collect only the target's direct non-empty children;
- leave the target itself and direct leaves visible;
- fold every collected child when any collected child is open;
- unfold every collected child when all collected children are folded;
- fold through `foldEnsuringCursorVisible` with each child's own content start as the fallback cursor.

Consequently, pressing a child guide toggles only that child's descendant branches. Siblings owned by the outer parent remain unchanged.

## Persistent Guides and Event Handling

The existing persistent-guide ownership and lifecycle remain unchanged. CodeMirror-owned `.cm-indent-spacing` elements may continue to receive `.cm-indent` plus the plugin marker during measurement writes, and only plugin-owned promotions are removed on disable or destroy.

The capture-phase `mousedown` listener remains in place. It prevents default and stops propagation only after a guide resolves to a target and a batch action is performed. Unmatched guides continue through normal editor handling.

No new DOM element, measurement, or coordinate state is introduced.

## Automated Verification

Tests will be written before production changes and must first fail because the current resolver always returns the outermost ancestor.

Coverage will include:

- an outer guide resolving to the outer parent;
- an inner guide on the same deeply nested row resolving to the matching child ancestor;
- a further inner guide resolving to the matching grandchild ancestor;
- combined native indentation spans resolving by their painted boundary rather than right-aligned guide count;
- leading indentation and unmatched boundaries returning `null`;
- a handler-level regression proving that an inner child guide folds only that child's direct branches and leaves the outer sibling branch untouched;
- existing direct-child batch, selection-safety, persistent-guide lifecycle, layout, and stacking tests.

Focused tests, lint, TypeScript checks, the test-enabled build, the complete Jest suite, and the production build must pass before live verification.

## Obsidian Verification

Manual verification must use only `/Users/kodai/workspaces/github.com/kdnk/obsidian-bullet/vault`, with every Obsidian CLI command explicitly targeting `vault=vault`. Computer Use, if needed, must follow the existing fresh-title guard before every action.

The temporary fixture will contain an outer parent with multiple direct branches and a nested child with multiple descendant branches. Verification will prove:

1. Pressing the outer guide toggles the outer parent's direct non-empty branches.
2. Pressing the inner child guide toggles only the child's direct non-empty branches.
3. The outer sibling remains visible and unchanged after the child-guide action.
4. The child guide can reopen the same descendant branches.
5. A selection inside the folded child subtree is relocated atomically and does not reopen the fold.
6. Native guide alignment remains stable after scrolling and no overlay is present.

Temporary notes and accessibility metadata must be removed afterward.

## Durable Agent Guidance

The current `AGENTS.md` statement that every deeply nested native guide maps to the outermost real ancestor is incorrect for rows containing multiple visible guide boundaries. It will be replaced with the boundary-specific rule from this design: map each pressed native guide to the real ancestor whose indentation prefix begins at that guide's painted boundary, and ignore unmatched boundaries. Existing no-overlay, layout-preservation, stacking, capture-phase, direct-child batch, and selection-safety constraints remain unchanged.
