# Vertical Guide Fold Selection Design

## Problem

In Obsidian 1.13.1, clicking a native `.cm-indent` guide can fold one of the represented parent's direct child branches for a moment and then immediately unfold it. The behavior is reproducible when the editor selection is inside that child branch.

`VerticalLines` dispatches a CodeMirror `foldEffect` for each direct non-empty child. A transaction can temporarily create a folded range even when the existing selection is inside it. A following selection transaction from the mouse interaction still points into the hidden subtree. CodeMirror's fold state intentionally removes any folded range that covers the new selection head, so the branch reopens.

## Goals

- Keep each direct child branch folded after its vertical guide is clicked.
- Preserve the existing guide-to-parent mapping and unfold behavior.
- Preserve the legacy behavior that leaves the represented parent and its direct leaves visible.
- Move the cursor only when folding would hide it.
- Keep the cursor relocation and fold effect atomic.
- Add a regression test for folding while the cursor is inside the target subtree.

## Non-goals

- Change which list ancestor a native guide represents.
- Change folding commands outside the vertical-guide interaction.
- Reintroduce plugin-owned guide DOM or geometry.
- Add timing-based retries or delayed refolding.

## Approaches Considered

### Atomic cursor relocation and fold

Dispatch a cursor selection on the child branch root and its `foldEffect` in one CodeMirror transaction when the current selection head is inside the fold range. This directly satisfies CodeMirror's invariant that the selection remain visible and creates no intermediate editor state.

This is the chosen approach.

### Sequential cursor relocation and fold

Dispatch a selection transaction first and a fold transaction second. This is simpler to express with existing methods, but it exposes an intermediate state and invokes selection-adjustment behavior separately.

### Event suppression or delayed refolding

Strengthen mouse propagation control, delay the fold until `click`, or fold again after selection settles. These approaches depend on browser and Obsidian event timing. They also do not address a cursor that was already inside the target subtree before the guide was pressed.

## Chosen Design

Add `MyEditor.foldEnsuringCursorVisible(line, fallbackCursor)`. The method will resolve the foldable range exactly as `fold` does and inspect the current main selection head.

- If the selection head is strictly inside the range, dispatch one transaction containing both a collapsed selection at `fallbackCursor` and the `foldEffect`.
- If the selection head is outside the range, dispatch only the `foldEffect` and preserve the selection.
- If no foldable range exists, do nothing.

`VerticalLines.toggleVerticalGuideTarget` will select the represented parent's direct non-empty children. When any child is open, it will call the new method for every child and use that child's first-line content start as `fallbackCursor`. When every child is folded, it will call `unfold` for every child.

The existing capture-phase `mousedown` listener, event cancellation, guide resolution, parser behavior, and settings checks remain unchanged.

## Data Flow

1. The capture listener receives `mousedown` on `.cm-indent`.
2. `VerticalLines` resolves the containing document line and represented parent list.
3. If every direct non-empty child is folded, it unfolds every child and stops.
4. Otherwise, it passes each child's line and first-line content start to `foldEnsuringCursorVisible`.
5. `MyEditor` resolves each CodeMirror fold range and checks whether the current selection would be hidden.
6. CodeMirror receives one fold transaction per child, with a safe selection included only when necessary.
7. The fold state remains valid because no selection head is inside a folded range.

## Error Handling

The behavior remains a no-op when editor state, parsing, the represented parent, or a foldable range is unavailable. A target with no direct non-empty children also remains a no-op. No retry or asynchronous fallback is introduced.

## Testing

- Add an editor unit test proving that an inside selection and fold effect are dispatched atomically with the fallback cursor.
- Add an editor unit test proving that an outside selection is preserved while folding.
- Update vertical-guide tests to assert that each direct non-empty child is folded with its own first-line content start as the fallback cursor.
- Keep tests for unfolding all children, empty targets, disabled settings, event capture cleanup, and guide mapping.
- Run the focused unit tests, complete unit suite, lint, `build-with-tests`, and full integration suite before completion.
- Recheck the interaction in Obsidian 1.13.1 after building the plugin.
