# モバイル見出し開閉時のスクロール固定

## 背景

モバイルの Live Preview では、右端へ移した Markdown 見出しの native chevron を開閉すると、見出しの画面上の Y 座標と editor の `scrollTop` が変化する。

実 Obsidian 1.13.2 を 390×844px、DPR 3、5点 touch emulation にして見出しを viewport 上端から160pxへ置いたところ、fold では見出しが47px下へ動き、`scrollTop`が47px減った。

unfold では見出しが72px上へ動き、`scrollTop`が72px増えた。

同じ位置に置いたリスト項目は、fold と unfold の両方で見出し相当の行位置と `scrollTop` が変化しなかった。

## 原因

`MobileRightFoldControlsPluginValue` は、native fold control の `pointerdown` と `click` を capture phase で受け取る。

しかし、event target の判定に使う selector は `.HyperMD-list-line` だけを対象とし、`.HyperMD-header` を含んでいない。

このため、見出し操作では下端余白の復元も、補正済み `scrollSnapshot()` の準備も実行されない。

見出しの右端配置を追加した変更は CSS とその contract test だけを追加しており、scroll 保持処理の対象は広げていなかった。

なお、見出しを最大 `scrollTop` から1800px以上離しても再現したため、document 末尾での scroll clamp は原因ではない。

## 目標

モバイル右端 fold control が有効な Live Preview では、Markdown 見出しの native chevron もリスト項目と同じ scroll 保持処理を通す。

見出しを viewport 上端から100px、160px、400pxに置いて fold または unfold したとき、操作した見出しの画面上の Y 座標差と editor の `scrollTop` 差をともに0にする。

native の fold transaction、event sequence、DOM、control geometry は維持する。

## 対象外

見出し control の CSS、幅、位置、向きは変更しない。

native click を独自 handler へ置き換えない。

event の `preventDefault()` または `stopPropagation()` を追加しない。

fold 後に `scrollTop` を手動で戻す処理や、遅延した scroll 補正は追加しない。

desktop、Reading View、通常の folding command の動作は変更しない。

## 設計

event target の selector を、リスト項目と Markdown 見出しの native control を含む一つの selector へ広げる。

対象は、`.HyperMD-list-line .cm-fold-indicator .collapse-indicator` と `.HyperMD-header .cm-fold-indicator .collapse-indicator` の和集合とする。

listener は引き続き `contentDOM` の capture phase に一組だけ登録し、見出し専用 listener は追加しない。

`pointerdown` では `ensureFoldScrollReserve()` を実行し、`scrollHeight` を読んで復元した余白を layout に反映する。

`click` では同じ処理に加えて `MobileNativeFoldScroll.prepare()` を呼び、実 viewport 上端へ補正した `scrollSnapshot()` を pending state に保存する。

次の native `foldEffect` または `unfoldEffect` を含む transaction に対し、既存の transaction extender が pending snapshot を同じ transaction の effect として追加する。

transaction extender、snapshot の物理 pixel 正規化、pending state の破棄 timing は変更しない。

## 無効時と対象外 event

body に `bullet-plugin-mobile-right-fold-controls` class がない場合は何もしない。

event target がリストまたは見出しの native control に一致しない場合も何もしない。

この条件により、設定無効時、desktop、本文クリック、ほかの CodeMirror control には scroll 保持処理を適用しない。

## 自動テスト

既存の native list control test を、リストと見出しの両 target で同じ期待値を検証できる table test にする。

回帰テストは実装前に見出し target で失敗させ、`pointerdown` で下端余白と layout read が実行され、`click` で `MobileNativeFoldScroll.prepare()` が一度呼ばれることを確認する。

対象外 target と body class 無効時に何もしない既存 test は維持する。

非同期 native fold と unfold の transaction に補正済み snapshot が入る既存 test も維持する。

## 実 Obsidian 検証

リポジトリ内の `vault` だけを使い、`app.emulateMobile(true)` を実行する。

viewport を390×844px、DPR 3、最大 touch point 5に設定し、CDP の native touch gesture で見出し control を操作する。

操作する見出しを viewport 上端から100px、160px、400pxへ置き、fold と unfold の全6操作で次を確認する。

- 操作した見出しの画面上の Y 座標差が0である。
- editor の `scrollTop` 差が0である。
- native control が fold 状態を切り替える。
- list control の既存 scroll 固定が変わらない。

検証後は mobile emulation、device metrics、touch emulation、一時 fixture を削除し、test vault を通常状態へ戻す。

## 継続的な指示

`AGENTS.md` には、モバイルの scroll 保持対象 selector がリストと見出しの両 native control を含む必要があることを記録する。

これにより、control の配置対象を増やす変更と scroll 保持対象を広げる変更が分離しないようにする。
