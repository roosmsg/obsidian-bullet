# About this fork

This repository is a fork of
[kdnk/obsidian-bullet](https://github.com/kdnk/obsidian-bullet). It retains the
original plugin's functionality while adding features for connected outlines
and clearer navigation through deeply nested lists.

## Changes from upstream

This fork adds two features to the original plugin.

### Logseq mode

Logseq mode makes bullets inside a configured vault folder navigable. Shift+clicking
a bullet creates or opens a nested Markdown note based on that bullet, making
it possible to navigate an outline as a hierarchy of files.

When a note is created, the selected bullet and its child items are used as its
initial content. From then on the note and the root outline stay synchronized
in both directions: edits made in either file are merged into the other, and
when both sides touch the same line the most recently saved file wins.
Connected bullets carry short native block IDs (`^abc123`) as stable
identities, so renames and moves follow the bullet instead of deleting
anything. Verified notes whose bullets stay deleted for 30 seconds are sent to
Obsidian's recoverable local trash; ambiguous files are left alone.

Logseq mode is opt-in. Set **Folder for Logseq mode** under
**Settings → Bullet** to enable it for that folder and its subfolders.

### Bullet threading

Bullet threading highlights the nested path of the currently hovered list item.
This makes the hierarchy of deeply nested outlines easier to follow in the
editor, Reading view, and Obsidian's Outline view.

Enable it with **Show bullet threading** under **Settings → Bullet**.

## Upstream synchronization

The original Bullet repository remains the upstream source for the plugin's
core behavior. Upstream changes should be reviewed for compatibility with
Logseq mode and bullet threading before they are incorporated into this fork.

There is no guaranteed synchronization schedule. Features and fixes may differ
from upstream over time.

## Issues and contributions

Report problems involving Logseq mode, bullet threading, or their interaction
with the rest of the plugin in this repository's issue tracker.

For a problem that also occurs in the unmodified upstream plugin, check the
[original repository](https://github.com/kdnk/obsidian-bullet) before reporting
it here.

Contributions should preserve existing upstream behavior unless a change is
explicitly intended to alter it. Changes to either fork-specific feature should
include relevant automated tests where practical.

## License and attribution

This fork remains available under the [MIT License](LICENSE). Copyright and
attribution from the original project remain in the license and repository
history.
