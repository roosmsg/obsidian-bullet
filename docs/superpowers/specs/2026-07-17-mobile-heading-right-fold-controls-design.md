# モバイル見出し折りたたみコントロールの右端配置

## 現在の不一致

`Show fold controls on the right on mobile`を有効にすると、リストのnative fold controlは右端へ移るが、見出しのnative fold controlは左側に残る。

同じLive Previewの折りたたみ操作が、行の種類によって左右へ分かれている。

モバイルでは見出しも右端から操作できる状態へ揃える。

## 適用範囲

変更対象は、設定が有効なモバイルのLive Previewにある`.cm-line.HyperMD-header`とする。

リスト側の配置、デスクトップ、Reading view、Properties、設定が無効なeditorは変更しない。

既存の`bullet-plugin-mobile-right-fold-controls` body classを利用し、新しい設定やDOMは追加しない。

## 配置

見出しのnative `.cm-fold-indicator`を`position: static`へ変更し、内側の`.collapse-indicator`を見出し行の右端へ配置する。

controlはリスト側と同じ15px幅のborder boxとし、`inset-inline-end: -15px`で本文領域の外側へ置く。

10pxのSVGと本文の間には5pxを確保するため、`padding-inline-start: 5px`、`padding-inline-end: 0`、`justify-content: flex-start`を適用する。

controlの高さは`1lh`とし、長い見出しが折り返されてもシェブロンとタップ領域を1行目へ揃える。

本文の幅を変えるpaddingは見出し行へ追加しない。

## 向きと操作

展開中のシェブロンは下向きとする。

折りたたみ中は`rotate(90deg)`で左向きにし、右端から本文の方向を指す。

SVGだけを移動せず、15px幅のnative `.collapse-indicator`全体を移動する。

native pointer eventとfold transactionは置き換えず、独自のclick handlerやタップ領域を追加しない。

## overflow

controlの右端は、現在のリストcontrolと同じく390px viewport内の約381pxへ収める。

`.cm-scroller`と`.cm-content`へoverflow指定を追加せず、横幅をclipしない。

## テスト

CSS contract testでは、見出し専用selectorが次の条件を満たすことを確認する。

- parent indicatorが`position: static`である。
- controlが15px幅、`inset-inline-end: -15px`、`padding-inline-start: 5px`である。
- controlの高さが`1lh`であり、`height: 100%`を使わない。
- controlが表示され、nativeのpointer targetとして有効である。
- 折りたたみ中のSVGが`rotate(90deg)`で左を向く。
- Reading viewとデスクトップへ適用するselectorを追加していない。

実Obsidianでは`app.emulateMobile(true)`、390×844px、DPR 3、touch emulationを使い、見出しのcontrolとSVGの実座標、横スクロールの不在、折り返した見出しの1行目への配置を確認する。

`pointerType="touch"`のtapで見出しをfoldして再度unfoldし、native操作が維持されることを確認する。

## 完了条件

- モバイルのLive Previewで、見出しとリストのシェブロンが同じ右端に並ぶ。
- 見出しの15pxのnative control全体が、見えているシェブロンと一緒に右へ移る。
- 長い見出しでは、シェブロンとタップ領域が1行目へ揃う。
- 見出し本文の幅とeditorの横幅が変わらない。
- デスクトップ、Reading view、リストの既存動作に回帰がない。
