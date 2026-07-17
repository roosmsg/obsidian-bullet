# モバイル見出し開閉時のselection transactionをまたぐスクロール固定

## 背景

モバイルのLive PreviewでMarkdown見出しのnative chevronを操作すると、カーソル状態によって見出しがY方向へ動く場合がある。

前回の修正では、`click` capture時に補正済み`scrollSnapshot()`を準備し、次のnative `foldEffect`または`unfoldEffect`を含むtransactionへ追加した。

実Obsidian 1.13.2を390×844px、DPR 3、5点touch emulationにし、見出しをviewport上端から160pxへ置いた対照実験では、foldとunfoldの全frameで見出しY座標と`scrollTop`の振れ幅は0pxだった。

しかし、pluginの`click` capture後、native fold処理の前に同一selectionを設定するtransactionを1回だけ挟むと、foldでは見出しが47px下へ動いて`scrollTop`が47px減り、unfoldでは見出しが72px上へ動いて`scrollTop`が72px増えた。

配下を1段落だけに縮めても同じ47pxと72pxが再現したため、長いsectionやdocument末尾のclampは必要条件ではない。

## 原因

`MobileNativeFoldScroll`はpending snapshotを`WeakMap<EditorState, FoldScrollSnapshot>`へ保存し、`click`時点の`EditorState`だけをkeyにしている。

native foldまでにselection transactionが入ると、fold transactionの`startState`は新しい`EditorState`になる。

snapshotは古いstateに残るためtransaction extenderから見つからず、native foldへ追加されない。

同一selectionを再設定するだけでも`EditorState`は更新されるため、カーソルの内容が変わらなくてもこの不一致は起こりうる。

## 目標

`click` capture後、native foldより前にselectionを含む中間transactionが入っても、補正済みsnapshotを最初のnative foldまたはunfold transactionへ追加する。

中間transactionを挟んだ実Obsidianのfoldとunfoldで、操作した見出しのframe単位のY座標振れ幅と`scrollTop`振れ幅をともに0pxにする。

native pointer sequence、native fold transaction、control DOM、CSS geometryは維持する。

## 対象外

見出しcontrolの位置、幅、高さ、向きは変更しない。

native clickを独自handlerへ置き換えない。

eventの`preventDefault()`または`stopPropagation()`を追加しない。

fold後に`scrollTop`を手動で戻す処理や、遅延したscroll補正は追加しない。

pending snapshotを次のevent loopまで保持し続けない。

desktop、Reading View、通常のfolding commandの動作は変更しない。

## 設計

pending snapshotを、snapshot本体、現在対応する`EditorState`、有効状態を持つ一つのpending objectとして表現する。

`WeakMap`は引き続き`EditorState`をkeyにするが、valueにはpending objectを保存する。

transaction extenderがpending objectを見つけた場合、transactionの種類に応じて次のように扱う。

- `foldEffect`または`unfoldEffect`を含む場合は、snapshotを同じtransactionへ追加してpending objectを消費する。
- foldまたはunfoldを含まない場合は、mappingを`transaction.startState`から`transaction.state`へ移し、同じpending objectを後続stateへ引き継ぐ。

これにより、selection transactionが0回でも複数回でも、同じstate系列の最初のnative foldまたはunfoldまでsnapshotが届く。

別editorのtransactionは別の`EditorState`系列を使うため、pending snapshotを共有しない。

## lifecycle

`prepare()`を呼ぶたびに新しいpending objectを作り、補正済みsnapshotと現在のstateを保存する。

既存どおり`setTimeout(..., 0)`で有効期限を区切る。

timeout時はpending objectを無効化し、その時点で対応しているstateのmappingが同じobjectを指す場合だけ削除する。

foldまたはunfoldで消費するときもpending objectを無効化し、現在のmappingを削除する。

古い`prepare()`のtimeoutが、同じstateへ後から保存された新しいpending objectを削除しないよう、削除前にobject identityを確認する。

このlifecycleにより、同じevent turn内の中間transactionは通過させるが、後続の無関係なfoldへsnapshotを流用しない。

## 自動テスト

既存のfoldとunfoldのtable testへ、中間selection transactionを挟む回帰caseを追加する。

testは次の順序を実行する。

1. state Aで`prepare()`を呼ぶ。
2. state Aからselection transactionを作り、state Bへ進める。
3. state Bからnative foldまたはunfold transactionを作る。
4. native effectと補正済みsnapshotの両方がtransactionへ含まれることを確認する。

実装前の現在のコードでは、state Bにmappingがないためsnapshotの期待値で失敗する必要がある。

timeout callbackを実行した後は、後続のfoldまたはunfoldへsnapshotが追加されないことも確認する。

既存の中間transactionなし、対象control判定、scroll reserve、CSS contractのtestは維持する。

## 実Obsidian検証

リポジトリ内の`vault`だけを使い、`app.emulateMobile(true)`と390×844px、DPR 3、5点touch emulationを設定する。

一つの子段落を持つ見出しをviewport上端から160pxへ置き、子段落内へカーソルを置く。

診断用listenerは、pluginの`click` capture後かつnative fold前に、同一selectionのtransactionを1回dispatchする。

native touch gestureによるfoldとunfoldを毎frame計測し、次を確認する。

- 見出しY座標の振れ幅が0pxである。
- `scrollTop`の振れ幅が0pxである。
- native controlのfold状態が反転する。
- selectionが意図せず変更されない。

診断用listenerを外した対照でも同じ期待値を確認する。

検証後はlistener、mobile emulation、device metrics、touch emulation、一時fixtureを削除し、test vaultを通常状態へ戻す。

## 継続的な指示

`AGENTS.md`には、mobile native chevronのsnapshotが`click`時点のstateへ固定されず、同じevent turnの中間selection transactionを通過する必要があることを記録する。

今後pending snapshotのlifecycleを変更するときは、`prepare()`、selection transaction、native foldまたはunfoldの順序をunit testと実Obsidianの両方で維持する。
