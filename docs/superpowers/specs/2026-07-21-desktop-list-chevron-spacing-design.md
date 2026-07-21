# デスクトップのリストシェブロン間隔設計

## 目的

デスクトップの Live Preview では、すべての折りたたみ可能なリスト行で、シェブロンの中心と bullet の中心の距離を約14pxへ統一する。

最外層でも同じ距離を使えるように、outer guide の線を標準のリストインデント位置へ移す。

シェブロンは、従来どおり対象行へマウスポインタを重ねたときだけ表示する。

本設計は、`2026-07-21-desktop-list-chevron-hover-design.md`の表示条件を維持し、シェブロンと縦線の配置に関する決定だけを置き換える。

## 実測した現状

Obsidian 1.13.2のテスト用vaultでは、最外層のbullet中心がX座標91.617px、現在のシェブロン中心が67pxにあり、中心間距離は24.617pxだった。

一段内側の折りたたみ可能な行でも、bullet中心が109.617px、シェブロン中心が85pxにあり、同じく中心間距離は24.617pxだった。

現在のouter guide widgetはX座標58pxから76pxまでの18px幅を持ち、線はwidgetの右端であるX座標75pxから76pxへ描かれている。

最初のnative inner guideはX座標76px付近に描かれるため、outer guideとinner guideがほぼ隣接して見える。

ローカルのLogseq 2.0.1では、行ホバー中のシェブロン中心とbullet中心の距離が約14pxだった。

## シェブロンの配置

対象は、`body:not(.is-mobile)`配下のLive Previewにあるリスト行のnative `.collapse-indicator`だけとする。

最外層と入れ子の行を別の距離へ分けず、表示された10pxのシェブロンSVG中心をbullet中心の約14px外側へ配置する。

実座標では、テーマやsub-pixel layoutを考慮し、中心間距離が13.5px以上14.5px以下であることを合格条件とする。

シェブロンの位置はnative `.collapse-indicator`の操作領域によって調整し、SVG単体の`transform`は追加しない。

操作領域と表示されたSVGの中心は一致させる。

シェブロンの大きさ、向き、native fold transactionは変更しない。

## outer guideの配置

デスクトップでは、`.bullet-plugin-outer-list-guide`の位置と`--list-indent`によるwidget幅を維持する。

outer guideの`::before`だけをwidgetのinline endからinline startへ移す。

既定の`--list-indent: 18px`では、outer guideと最初のnative inner guideの距離が18pxになり、ほかのインデントガイドと同じグリッドへ揃う。

固定の5px offsetは追加せず、テーマが提供する`--list-indent`へ追従させる。

線の太さと色には、現在と同じObsidianのindentation guide変数を使う。

outer guide widgetのDOM、文書位置、幅、pointer target、chunk単位のhover同期と折りたたみ処理は変更しない。

native inner guideの位置、太さ、色は変更しない。

モバイルではouter guideの位置を変更しない。

## 表示と操作

通常時は、デスクトップのリストシェブロンへ`visibility: hidden`、`opacity: 0`、`pointer-events: none`を適用する。

対象のリスト行自体が`:hover`のときだけ、同じnativeシェブロンを表示してクリック可能にする。

editor selection、`.cm-active`、キーボードフォーカスは表示条件に使わない。

縦線の折りたたみ操作が有効な場合は、行ホバー中だけfold indicatorをouter guideのpointer targetより前面へ出す。

outer guideのpointer targetとシェブロンの操作領域が一部重なる場合でも、SVG上ではnative foldingを使い、SVG外ではouter guideの操作を維持する。

本文からシェブロンへポインタを移動する途中で行ホバーが途切れないよう、操作領域を本文側へ連続させる。

背景マスク、独立overlay、画面座標cache、独自DOM、遅延した位置補正は追加しない。

## 対象外

見出しのシェブロン、Reading View、モバイルの右端折りたたみコントロールは変更しない。

リスト本文、bullet、インデント幅は移動しない。

縦線クリックとnativeシェブロンが実行するfold transactionは変更しない。

## 自動テスト

CSS contract testでは、次の条件を検証する。

- デスクトップのLive Previewにあるリスト行だけを対象にする。
- 通常時はシェブロンを非表示かつpointer target外にし、行ホバー時だけ復元する。
- SVG単体の`transform`を使わず、native操作領域とSVGの中心を一致させる。
- デスクトップのouter guideだけで、線をwidgetのinline startへ配置する。
- outer guide widgetの位置、幅、pointer targetを維持する。
- native inner guideのgeometryを上書きしない。
- モバイル、見出し、Reading Viewへ作用する無限定なselectorを追加しない。
- 背景マスク、独立overlay、固定色、画面座標cacheを追加しない。

## 実Obsidianでの検証

リポジトリ内の`vault`を使い、rootと入れ子のfoldable行で次を確認する。

- 行外ではシェブロンが表示されず、行ホバー中だけ表示される。
- シェブロン中心とbullet中心の距離が13.5px以上14.5px以下になる。
- 既定テーマではouter guideと最初のinner guideの距離が18pxになる。
- シェブロンのSVG boundsがouter guideおよび対応するinner guideの線と交差しない。
- `elementFromPoint()`がSVG中央ではnative controlを返し、outer guide上ではouter guide widgetを返す。
- 本文からSVGへポインタを移動してもシェブロンが消えない。
- nativeシェブロンとouter guideの両方でfoldとunfoldが動作する。
- outer guideのchunk単位hover強調と一括開閉が維持される。
- モバイルのリストと見出しでは、既存の右端コントロール配置が変わらない。

## 完了条件

デスクトップのすべてのリストシェブロンは、行ホバー時だけ表示され、bulletから約14pxの位置に揃う。

outer guideと最初のinner guideは標準のリストインデント幅で離れ、どのシェブロンとも重ならない。

シェブロン、outer guide、inner guideの既存の折りたたみ操作に回帰がない。
