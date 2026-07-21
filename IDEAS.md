# Ideas

## Improve clickable bullets in Logseq mode

Some Live Preview bullets are difficult or unreliable to click. Obsidian themes
and editor DOM states may route the pointer event to the surrounding
`.cm-formatting-list` marker instead of `.list-bullet`, while the visible dot
also provides a very small hit target.

Possible follow-up:

- recognize both `.list-bullet` and `.cm-formatting-list` as marker clicks;
- enlarge the marker hit area toward the gutter without covering item text;
- preserve drag-and-drop, checkbox, and fold-control behavior;
- test direct bullet clicks, surrounding-marker clicks, and clicks after a drag;
- verify the result in Live Preview on desktop and mobile with multiple themes.
