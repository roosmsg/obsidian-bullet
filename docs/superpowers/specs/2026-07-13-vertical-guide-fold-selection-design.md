# Vertical Guide Fold Selection Design

## Problem

In Obsidian 1.13.1, clicking a native `.cm-indent` guide can fold its represented parent for a moment and then immediately unfold it. The behavior is reproducible when the editor selection is inside the subtree being folded.

`VerticalLines` currently dispatches only a CodeMirror `foldEffect`. That transaction can temporarily create a folded range even when the existing selection is inside it. A following selection transaction from the mouse interaction still points into the hidden subtree. CodeMirror's fold state intentionally removes any folded range that covers the new selection head, so the list reopens.

## Goals

- Keep a list folded after its vertical guide is clicked.
- Preserve the existing guide-to-parent mapping and unfold behavior.
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

Dispatch a cursor selection on the represented parent and its `foldEffect` in one CodeMirror transaction when the current selection head is inside the fold range. This directly satisfies CodeMirror's invariant that the selection remain visible and creates no intermediate editor state.

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

`VerticalLines.toggleVerticalGuideTarget` will call the new method when folding and use the represented parent's first-line content start as `fallbackCursor`. Unfolding will continue to call `unfold` unchanged.

The existing capture-phase `mousedown` listener, event cancellation, guide resolution, parser behavior, and settings checks remain unchanged.

## Data Flow

1. The capture listener receives `mousedown` on `.cm-indent`.
2. `VerticalLines` resolves the containing document line and represented parent list.
3. For an open parent, it passes the parent's line and first-line content start to `foldEnsuringCursorVisible`.
4. `MyEditor` resolves the CodeMirror fold range and checks whether the current selection would be hidden.
5. CodeMirror receives one fold transaction, with a safe selection included only when necessary.
6. The fold state remains valid because no selection head is inside the folded range.

## Error Handling

The behavior remains a no-op when editor state, parsing, the represented parent, or a foldable range is unavailable. No retry or asynchronous fallback is introduced.

## Testing

- Add an editor unit test proving that an inside selection and fold effect are dispatched atomically with the fallback cursor.
- Add an editor unit test proving that an outside selection is preserved while folding.
- Update vertical-guide tests to assert that folding uses the represented parent's first-line content start as the fallback cursor.
- Keep existing tests for unfolding, empty targets, disabled settings, event capture cleanup, and guide mapping.
- Run the focused unit tests, complete unit suite, lint, `build-with-tests`, and full integration suite before completion.
- Recheck the interaction in Obsidian 1.13.1 after building the plugin.
