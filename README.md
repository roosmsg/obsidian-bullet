# Bullet

Turn Markdown lists into a fast, keyboard-driven outliner.

Bullet makes nested lists feel closer to Workflowy or Roam Research without giving up the plain-text structure of an Obsidian note. Type, move, indent, select, fold, and drag entire branches while Bullet keeps their hierarchy intact.

[Latest release](https://github.com/kdnk/obsidian-bullet/releases/latest) · [Report an issue](https://github.com/kdnk/obsidian-bullet/issues)

Requires Obsidian 1.12.7 or later. Bullet supports desktop and mobile.

## What Bullet changes

- **List-aware editing:** `Enter`, `Shift`+`Enter`, `Tab`, `Shift`+`Tab`, and repeated `Command`+`A` or `Ctrl`+`A` operate on list structure instead of raw Markdown prefixes.
- **Whole-branch movement:** move or drag an item together with every nested child.
- **Focused navigation:** keep the caret in editable content and away from hidden bullet or checkbox markup.
- **Visible structure:** connect nested items with indentation guides, add guides beside root list chunks, and fold branches from the guides themselves.
- **Mobile-friendly folding:** move native list and heading fold controls to the right edge in Live Preview.
- **File-backed outlines:** optionally Shift+click bullets in one vault folder to create nested Markdown notes that preserve the selected branch.

Automatic editing, appearance, folding, and drag-and-drop behavior can be adjusted from **Settings → Bullet**.

## Install

### Community Plugins

1. Open **Settings → Community plugins** in Obsidian.
2. Turn on community plugins if Obsidian asks you to leave Restricted Mode.
3. Select **Browse**, search for **Bullet**, and select **Install**.
4. Select **Enable** after installation.

Obsidian also documents this flow in [Community plugins](https://help.obsidian.md/community-plugins).

### Manual installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/kdnk/obsidian-bullet/releases/latest).
2. Put the three files in `<vault>/.obsidian/plugins/bullet/`.
3. Reload Obsidian, then enable **Bullet** under **Settings → Community plugins**.

## Start with these controls

Create a nested list, place the caret in one of its items, and try the following controls. A branch means the current item and all of its nested children.

| Action                                   | macOS                                            | Windows / Linux                               |
| ---------------------------------------- | ------------------------------------------------ | --------------------------------------------- |
| Move a branch up                         | <kbd>Command</kbd>+<kbd>Shift</kbd>+<kbd>↑</kbd> | <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>↑</kbd> |
| Move a branch down                       | <kbd>Command</kbd>+<kbd>Shift</kbd>+<kbd>↓</kbd> | <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>↓</kbd> |
| Indent a branch                          | <kbd>Tab</kbd>                                   | <kbd>Tab</kbd>                                |
| Outdent a branch                         | <kbd>Shift</kbd>+<kbd>Tab</kbd>                  | <kbd>Shift</kbd>+<kbd>Tab</kbd>               |
| Create the next list item                | <kbd>Enter</kbd>                                 | <kbd>Enter</kbd>                              |
| Add a continuation line without a bullet | <kbd>Shift</kbd>+<kbd>Enter</kbd>                | <kbd>Shift</kbd>+<kbd>Enter</kbd>             |
| Expand the selection by list scope       | <kbd>Command</kbd>+<kbd>A</kbd> repeatedly       | <kbd>Ctrl</kbd>+<kbd>A</kbd> repeatedly       |

The movement shortcuts are registered by Bullet. The other controls replace Obsidian's behavior only while their corresponding Bullet settings are enabled and the caret is in a list.

## Features

### Keep editing inside the outline

With **Keep typed text in lists** enabled, directly typed body text stays in a list item or one of its continuation lines. Headings, block quotes, horizontal rules, fenced code blocks, and frontmatter remain available as document-level Markdown structures.

On a completely empty line, press <kbd>Space</kbd> to create an empty list item immediately. Indented continuation lines remain plain note lines.

The rule applies to direct typing and deletion. Pasted text, dropped text, and changes made by other plugins are left unchanged.

Enhanced `Enter` creates a new item at the appropriate level and outdents an empty nested item. `Shift`+`Enter` adds a continuation line to the current item without creating another bullet.

### Move, indent, and select branches

Movement commands carry the complete branch, so rearranging a parent never separates it from its descendants. `Tab` and `Shift`+`Tab` apply the same rule when changing indentation.

Repeated `Command`+`A` or `Ctrl`+`A` expands selection from the current item's content to its subtree and then to the surrounding list scope. The **Select list content** command exposes the same behavior to the Command Palette and mobile toolbar.

### Keep the caret in editable content

Bullet can keep the caret outside the Markdown prefix for bullets, numbered items, and checkboxes. Choose one of three modes under **Keep cursor out of list markers**:

- **Allow cursor in markers:** allow the caret inside all Markdown prefixes.
- **Keep out of bullets:** protect bullet and number prefixes, but allow checkbox editing.
- **Keep out of bullets and checkboxes:** keep the caret in item content.

Hold <kbd>Alt</kbd> or <kbd>Option</kbd> while navigating or clicking to place the caret inside protected markup temporarily.

### Fold from indentation guides

Bullet can draw native-looking guides between nested items and beside each root-level list chunk. With guide actions enabled, click a guide to fold or unfold the child branches it connects.

The separate **Fold the list** and **Unfold the list** commands operate on the item at the caret. These commands do not have default shortcuts, so you can assign your own under **Settings → Hotkeys**.

### Drag branches on desktop

Drag a bullet, fold indicator, or checkbox to move its complete branch. Drag-and-drop is a desktop feature; the keyboard and Command Palette movement actions remain available on mobile.

### Use Vim and mobile controls

When Obsidian's Vim mode is enabled, `o` and `O` create list items while the caret is inside a list and fall back to ordinary lines outside one.

On mobile, Bullet can move the native fold controls for list items and headings to the right edge of Live Preview. List editing commands can also be added to Obsidian's mobile toolbar.

## Commands

Bullet registers these actions in Obsidian's Command Palette. You can assign custom shortcuts under **Settings → Hotkeys**; editor commands can also be added to the mobile toolbar.

| Command                           | What it does                                         |
| --------------------------------- | ---------------------------------------------------- |
| **Move list and sublists up**     | Move the current branch before its previous sibling. |
| **Move list and sublists down**   | Move the current branch after its next sibling.      |
| **Indent the list and sublists**  | Nest the current branch one level deeper.            |
| **Outdent the list and sublists** | Move the current branch one level outward.           |
| **Fold the list**                 | Fold the item at the caret.                          |
| **Unfold the list**               | Unfold the item at the caret.                        |
| **Insert note line**              | Add a continuation line without a bullet.            |
| **Select list content**           | Expand selection through the current list scopes.    |
| **Show System Info**              | Display environment details for a bug report.        |

## Settings

All settings are under **Settings → Bullet**.

### Editing

| Setting                                  |                 Default                 | Effect                                                               |
| ---------------------------------------- | :-------------------------------------: | -------------------------------------------------------------------- |
| **Keep typed text in lists**             |                   On                    | Add list markers when directly typed body text would sit outside one. |
| **Keep cursor out of list markers**      | Keep out of bullets and checkboxes      | Move the caret outside bullet, number, and checkbox prefixes.         |
| **Enhance the Tab key**                  |                   On                    | Indent and outdent complete branches.                                 |
| **Enhance the Enter key**                |                   On                    | Create and outdent items with outliner-style behavior.                |
| **Vim-mode o/O inserts bullets**         |                   On                    | Create list items from Vim's `o` and `O` actions.                     |
| **Enhance the Ctrl+A or Cmd+A behavior** |                   On                    | Expand selection through list scopes.                                 |
| **Drag-and-Drop**                        |                   On                    | Move branches by dragging on desktop.                                 |

### Appearance

| Setting                    | Default | Effect                                                                                             |
| -------------------------- | :-----: | -------------------------------------------------------------------------------------------------- |
| **Style list bullets**     |   On    | Use Bullet's marker spacing, larger dots, and parent hover feedback with active theme colors.      |
| **Enhance vertical lines** |   On    | Strengthen indentation guides and use a continuous rounded hover.                                  |
| **Show bullet threading**  |   Off   | Highlight the nested path to the hovered item in the editor and reading view.                      |

### Folding

| Setting                                        | Default | Effect                                                                     |
| ---------------------------------------------- | :-----: | -------------------------------------------------------------------------- |
| **Draw outer list lines**                      |   On    | Draw a guide beside each contiguous root list chunk.                       |
| **Fold lists from vertical indentation lines** |   On    | Make visible guides clickable for folding.                                 |
| **Show fold controls on the right on mobile**  |   On    | Move native list and heading controls to the right in mobile Live Preview. |

### Logseq mode

Set **Folder for Logseq mode** to a vault-relative folder such as `Bulletlist` to make Live Preview bullets in that folder and all of its subfolders navigable with Shift+click. The setting is empty by default, so the mode is opt-in.

Shift+clicking `Task Beta` in `Bulletlist/Bulletlist.md` creates `Bulletlist/Task Beta/Task Beta.md` and initializes it with the clicked item and all of its children. Shift+clicking it again opens the existing file. A normal click keeps Obsidian's native fold/unfold behavior. Bullets in the new file behave the same way, creating the next level inside `Bulletlist/Task Beta/`. When a note opens in an editable view, the cursor lands inside a fresh empty child bullet below the last item — as if Enter and Tab were pressed there — or inside an empty bullet the note already ends with, so it is immediately ready for input. When you leave the note (it is no longer open in any pane) and that bullet is still empty, it is removed again. The ready bullet is local to the file it lives in: trailing empty bullets are never synchronized into the root outline or into other notes, and only become part of the outline once they gain content.

The single Markdown file directly inside the configured folder is the root outline, and every connected child note mirrors its branch of that outline. Synchronization is bidirectional: edit a subtree in the root file or in any connected note and the change is merged into every other copy. When both sides change the same line between syncs, the most recently saved file wins and Bullet reports how many older edits were overridden. New bullets stay lazy: typed in the root or inside a note, they appear as plain text everywhere their branch is mirrored and only get a file of their own when you Shift+click them.

A child note always owns exactly one branch: its first line is the connected bullet and everything below belongs underneath it. A line added at the top level of a note is therefore adopted as a direct child of its bullet rather than escaping into the root as a sibling. When a note or the root file is open in an editor, synchronization writes through that editor instead of the vault, so Obsidian shows no "modified externally" notices and your cursor, undo history, and unsaved changes stay intact.

Bullets with a connected note carry a short native block ID (for example `^k3v9q2`) as their stable sync identity. Only connected bullets are marked; plain bullets stay untouched. The IDs are invisible in Reading view, Live Preview, and Source mode alike — only the line the cursor is on shows its marker, rendered small and faint. The cursor always stops at the end of the line's content, in front of the marker: clicking past the end of a line or pressing End lands before the identity, so typing extends the content and the marker stays at the line end. Pressing Enter there is safe too — the line break is placed behind the marker, so the identity stays on its bullet while the new line opens below. To edit or remove a marker deliberately, select it with the mouse. Hiding is purely visual: the marker always remains in the text, so block links to it keep resolving. The markers remain in the underlying text, which means copying or cutting a bullet carries its identity along. A renamed or moved bullet — including one cut from a note and pasted into the root — keeps its folder and file when the destination is unambiguous; colliding moves leave the note in place. A copy-pasted bullet releases its duplicated identity and becomes a plain bullet, a deleted identity marker is restored as long as its bullet still exists, and replacing a marker with your own `^block-id` makes the note follow the new identity. When a connected bullet disappears from the outline and stays gone for 30 seconds, its verified note and the notes of deleted descendants are moved to Obsidian's local trash and empty generated folders are cleaned up. Moving a bullet never triggers deletion.

The 0-level item in the master root file does nothing when Shift+clicked. Its 1-level children and every deeper item remain navigable: Live Preview opens or creates their file-backed notes, while Reading view opens existing notes only. The first bullet inside every 1-level item note navigates to the single root Markdown file directly inside the configured folder, regardless of the item or subfolder name. Deeper notes continue to navigate to their immediate generated parent.

In Reading view, Shift+click only navigates to notes that already exist; it never creates folders or files. Existing destinations receive the same bullet hover highlight as Live Preview. If the expected child note is absent, nothing happens and no navigation highlight is shown. Plain clicks retain Reading view's native fold/unfold behavior.

Nested items keep their complete outline path even when opened directly from the root note. For example, Shift+clicking `Child 1` under `Beta test` creates `Bulletlist/Beta test/Child 1/Child 1.md`. Every intermediate list level becomes a folder; the top-level item represents the current page and is not duplicated.

In a generated note, its first bullet links back to the parent note. Shift+clicking `- Child 1` inside `Child 1.md` opens `Beta test/Beta test.md`. Opening a deeply nested item directly also creates any missing intermediate parent notes, preserving each ancestor branch and its Markdown syntax.

Generated folder and file names use the first 25 valid characters of the bullet's visible text. Markdown syntax such as heading markers and emphasis is omitted from the name while the new note keeps the original list-item syntax.

### Advanced

| Setting        | Default | Effect                                                      |
| -------------- | :-----: | ----------------------------------------------------------- |
| **Debug mode** |   Off   | Write detailed Bullet logs to Obsidian's developer console. |

## Compatibility

- Bullet requires Obsidian 1.12.7 or later and is available on desktop and mobile.
- The editing enhancements work in Obsidian's Markdown editor. Logseq mode, vertical-line folding, outer guides, and right-side mobile fold controls are designed for Live Preview.
- The fold and unfold commands require Obsidian's **Fold indent** editor setting to be enabled.

## Support and credits

If something behaves unexpectedly, run **Bullet: Show System Info** from the Command Palette and include the displayed details in a [bug report](https://github.com/kdnk/obsidian-bullet/issues). For deeper diagnostics, enable **Debug mode** and copy the Bullet logs from Obsidian's developer console.

Bullet is a fork of [vslinko/obsidian-outliner](https://github.com/vslinko/obsidian-outliner). The original project was created by Viacheslav Slinko.

## License

[MIT](LICENSE)
