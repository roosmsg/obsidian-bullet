# Select-All Cycle Design

## Context

Obsidian Bullet currently enhances `Ctrl+A` / `Cmd+A` inside lists so the first press selects the current list item's content and the second press expands to a larger list-aware range. Once the root list is selected, the next press falls through instead of continuing a predictable outliner-specific cycle.

The improvement is to keep repeated select-all presses useful inside the current outline without selecting the entire file.

## Goal

When the user presses `Ctrl+A` / `Cmd+A` repeatedly inside a list, selection should cycle through list-aware scopes:

1. Current item content.
2. Current item subtree, when the item has children.
3. Root list.
4. Back to current item content.

Whole-file selection is intentionally excluded from this enhanced behavior.

## Behavior

### Content Scope

The first enhanced select-all press selects the current list item's editable content.

For checkbox items, the checkbox marker remains outside the selected range. For example, `- [ ] task` selects `task`, not `- [ ] `.

For items with note lines, the existing content behavior remains intact: note lines that belong to the item are selected together with the item's content.

### Subtree Scope

If the current item has child list items, the next press expands the selection to the current item plus its children.

If the current item has no children, this scope is skipped and the cycle advances directly to the root list scope.

### Root List Scope

The next press selects the current root list, not the whole file.

When the root list is already selected, the next press returns to the content scope for the item that started the cycle.

## Implementation Approach

Extend `SelectAllContent` so it treats an already selected root list as a handled state instead of returning `false`.

Because a root-list selection only stores the root start and root end positions, it cannot identify the item that started the cycle by itself. `CtrlAAndCmdABehaviourOverride` should keep a small in-memory cycle cursor and pass it into `SelectAllContent` on the next invocation. The operation should expose the next cycle cursor after a handled step so the feature can keep the cycle anchored to the same item. The parser should still use the editor's current cursor so moving to a different list item starts a fresh cycle naturally.

The operation should:

- Continue to require a single selection.
- Continue to avoid handling selections outside the parsed root content range.
- Detect the current selection scope by comparing normalized selection endpoints with known content, subtree, and root list ranges.
- Keep `stopPropagation` and `updated` set to `true` for every successful cycle step, including root-list-to-content.
- Preserve existing behavior for partial selections by expanding them to the content scope.
- Use the feature-provided cycle cursor only when the current selection already covers the root list.

The implementation should stay within the existing operation and feature boundary:

- `CtrlAAndCmdABehaviourOverride` remains responsible for key binding, command registration, and remembering the last handled cycle cursor.
- `SelectAllContent` remains responsible for deciding and applying the next selection scope.
- Parser and root/list model changes should be avoided unless the existing APIs cannot identify the required ranges.

## Testing

Add focused tests to `src/operations/__tests__/SelectAllContent.test.ts`:

- Parent item cycles `content -> subtree -> root list -> content`.
- Leaf item cycles `content -> root list -> content`.
- Checkbox item returns to content without selecting checkbox markup.
- Note-line item keeps the existing note-line content behavior after cycling back.
- Root-list selection is handled by the plugin and does not fall through to native whole-file selection.

Run the relevant unit tests after implementation:

```sh
npm test -- --runTestsByPath src/operations/__tests__/SelectAllContent.test.ts
```
