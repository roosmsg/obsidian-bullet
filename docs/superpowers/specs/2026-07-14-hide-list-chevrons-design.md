# リストChevron非表示設計

## 目的

縦線クリックがリストの折りたたみ操作を担うとき、役割が重複するbulletのchevronを非表示にする。

## 表示条件

既存の「Draw vertical indentation lines」が有効で、`Vertical lines action` が `Toggle folding` のとき、Live Preview内のすべてのlist chevronを非表示にする。

最外線の表示設定には連動しない。最外線を非表示にしていても、縦線の折りたたみ操作が有効ならlist chevronを非表示にする。

縦線表示を無効にするか、actionを `None` にしたときはlist chevronを再表示する。

Markdown見出しなど、リスト以外の折りたたみchevronは変更しない。

## CSS方式

既存の `bullet-plugin-vertical-lines-action-toggle-folding` body classを状態の判定に使う。新しい設定やDOM markerは追加しない。

Live Previewのlist line内にあるnative collapse indicatorだけを対象とし、`visibility: hidden` で隠す。`display: none` は使わず、chevronが占めるレイアウト幅を維持する。

非表示のindicatorが縦線クリックを妨げないよう、対象には `pointer-events: none` も適用する。

## テスト

自動テストでは次を検証する。

- 縦線の折りたたみaction body class配下で、list line内のchevronだけを隠すCSS selectorが存在する。
- `visibility: hidden` と `pointer-events: none` を適用する。
- `display: none` を使わない。
- 見出しを含む全collapse indicatorへ作用する無限定なselectorを使わない。
- 既存のbody classが、縦線表示または折りたたみactionの無効化時に除去される。

実Obsidianの確認ではリポジトリ内の `vault` だけを使い、子を持つbulletのchevronが消えること、縦線クリックで開閉できること、見出しのchevronが残ること、action切替でlist chevronが再表示されることを確認する。

## 完了条件

- 縦線の折りたたみ操作が有効な間、すべてのlist chevronが表示されない。
- chevron非表示によって本文やbulletの横位置が変わらない。
- 見出しのchevronは表示されたままになる。
- 縦線操作を無効にするとlist chevronが再表示される。
