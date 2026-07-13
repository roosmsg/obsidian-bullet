# Vertical Guide Hover Feedback Design

## Context

Vertical indentation guides are clickable when the vertical-lines feature is enabled and its action is set to toggle folding. The plugin already uses a pointer cursor, but the native guide itself does not change appearance on hover. The interaction is therefore easy to miss, especially when the normal guide color is faint.

The existing `.bullet-plugin-vertical-lines` body class represents only whether guides are enabled. It remains present when `verticalLinesAction` is `"none"`, even though the handler correctly ignores guide presses in that state. Reusing that class for hover feedback would falsely advertise an unavailable action. The interaction needs a separate action-state class while the existing class continues to own guide display and persistent-guide layout.

Obsidian 1.13.1 exposes native indentation-guide variables for both normal and active states:

- `--indentation-guide-color`
- `--indentation-guide-width`
- `--indentation-guide-color-active`
- `--indentation-guide-width-active`

The plugin should reuse the active-state variables instead of inventing fixed colors or geometry.

## Goals

- Make a clickable vertical guide visibly react when the pointer is over it.
- Highlight only the guide segment on the hovered editor row.
- Use Obsidian's active indentation-guide color and width so themes remain in control.
- Apply the feedback to both native guides and plugin-promoted persistent native guides.
- Show the pointer cursor and hover feedback only while toggle folding is actually enabled.
- Preserve guide targeting, folding behavior, layout, scrolling, and cleanup.

## Non-goals

- Do not highlight the complete logical guide across multiple rows.
- Do not add DOM elements, hover state in TypeScript, geometry measurement, overlays, or coordinate caches.
- Do not use a fixed plugin accent color or add a background highlight around the hit area.
- Do not change the guide's normal, non-hovered appearance.
- Do not change touch, keyboard, folding, or target-resolution behavior.
- Do not change package versions or create a release unless separately requested.

## Considered Approaches

### Reuse Obsidian's active-guide variables

Style the hovered native `::before` guide with `--indentation-guide-color-active` and `--indentation-guide-width-active`.

This is the selected appearance. It makes the line itself respond, respects theme-provided values, and uses only CSS for the visual effect. A separate settings-derived body class prevents that effect from appearing when the click action is unavailable, without adding pointer-tracking state.

### Use the plugin or application accent color

Changing the line to `--interactive-accent` would be more conspicuous. It would also make the plugin override the theme's intended indentation-guide hierarchy and could be visually excessive in themes with a strong accent.

### Highlight the guide hit area

A translucent background around the guide would make the clickable region explicit. It would add visual noise to list indentation and alter more than the line the user identified, so it is not selected.

## Selected Hover Style

Add a body class named `.bullet-plugin-vertical-lines-action-toggle-folding`. A second `DocumentBodyClass` owned by `VerticalLines` will apply it to the main document and Obsidian pop-out documents only when both conditions are true:

- `settings.verticalLines` is enabled;
- `settings.verticalLinesAction` is `"toggle-folding"`.

The existing settings callback will update both the display-state and action-state body classes. Load, unload, window-open, and window-close handling will continue through `DocumentBodyClass`, so the action class cannot remain behind after the feature unloads or a settings change. The existing `.bullet-plugin-vertical-lines` class and persistent-guide synchronization remain unchanged.

Move the existing `cursor: pointer` rule under the action-state class, then add a hover rule scoped by all of the following conditions:

- the document has `.bullet-plugin-vertical-lines-action-toggle-folding`, meaning the guide action is available;
- the guide is inside `.markdown-source-view.mod-cm6`;
- the element is a `.cm-indent` inside `.cm-hmd-list-indent`;
- that exact `.cm-indent` element is hovered.

The rule targets only the hovered element's `::before` pseudo-element and applies:

```css
border-inline-end: var(--indentation-guide-width-active) solid
  var(--indentation-guide-color-active);
```

Using the same logical border property as Obsidian's native guide rule preserves right-to-left compatibility. The pseudo-element is already the guide-rendering source, so changing its border does not change indentation layout or add a second line. No transition is added; feedback appears and clears immediately with hover.

The existing pointer behavior remains unchanged while the action is available and is removed when the action is unavailable. Because plugin-promoted persistent guides also carry `.cm-indent`, the same hover rule covers them without marker-specific duplication.

## Behavior and Failure Handling

Only the segment under the pointer changes. Other `.cm-indent` elements on the same row and corresponding guide segments on adjacent rows keep their current appearance.

When the feature or toggle action is disabled, `DocumentBodyClass` removes the action-state class; the selector no longer matches and no pointer or hover override remains. If a theme gives active and normal variables identical values, the plugin accepts that theme choice rather than substituting a fixed fallback.

The hover rule does not decide whether a guide resolves to a list ancestor. An unmatched guide can still receive visual hover feedback because it uses the same native hit target, while the existing handler safely ignores an unmatched click. No event path or error handling changes.

## Automated Verification

Tests will be written before the production stylesheet change. A focused stylesheet contract test in `src/features/__tests__/VerticalLines.test.ts` will first fail, then require that:

- the hover selector is scoped to `.bullet-plugin-vertical-lines-action-toggle-folding`, the CM6 source view, the list-indent container, and `.cm-indent:hover::before`;
- the declaration uses both active indentation-guide variables through `border-inline-end`;
- no plugin-owned fixed hover color, background, or geometry is introduced.

Feature lifecycle tests will also require the action-state body class to be present in main and pop-out documents only while both the guide feature and toggle action are enabled, and to be removed on unload. The stylesheet contract will require the pointer and hover selectors to use that action-state class rather than the broader display-state class.

Existing persistent-guide layout and stacking tests must remain green. Focused tests, lint, TypeScript checks, `build-with-tests`, the complete Jest suite, and the production build must pass before live verification.

## Obsidian Verification

Manual verification must use only `/Users/kodai/workspaces/github.com/kdnk/obsidian-bullet/vault`. Every vault-affecting Obsidian CLI command must explicitly include `vault=vault`, and every Computer Use action must follow the existing fresh-window-title guard.

In a nested-list fixture, verification will confirm:

1. The normal guide appearance remains unchanged before hover.
2. Hovering an outer guide changes only that row segment to the active guide style.
3. Hovering an inner guide changes only that inner segment, not the outer segment beside it.
4. Moving the pointer away restores the normal guide style.
5. The hovered guide still performs its existing level-specific toggle action.
6. A persistent guide left after folding receives the same hover feedback and can reopen the branch.
7. Setting the vertical-line action to `none` removes the pointer and hover feedback without hiding the guides.
8. No overlay is present and guide alignment remains stable.

Temporary fixtures and diagnostic metadata must be removed afterward.

## Durable Agent Guidance

The existing instruction to preserve native guide color and width remains correct for the normal state and for persistent-guide layout fixes. Agent guidance should clarify that interaction feedback may switch the existing native `::before` border to Obsidian's own active-guide variables, while fixed plugin colors, custom geometry, and normal-state overrides remain prohibited.
