# Outer List Lines Folding Group Design

## 背景

`Draw outer list lines` は現在 `Appearance` にある。
しかし、outer list guide は表示要素にとどまらず、vertical-line folding が有効なときのクリック対象にもなる。
設定を探す目的に合わせるなら、folding に関係する設定の近くへ置くほうが自然である。

## 設計

`Draw outer list lines` を `Appearance` から `Folding` へ移す。
`Folding` 内では、表示する guide、guide の folding action、mobile の fold control の順に並べる。

1. `Draw outer list lines`
2. `Fold lists from vertical indentation lines`
3. `Show fold controls on the right on mobile`

`Enhance vertical line hover` は見た目だけを変えるため、`Appearance` に残す。
設定名、説明、保存 key、既定値、runtime behavior は変更しない。

## 実装範囲

共有の declarative setting group 定義で一項目を移動する。
この定義は Obsidian 1.13 系の設定表示と pre-1.13 fallback の両方が使うため、表示経路ごとの分岐は追加しない。
保存処理と `Settings` service は変更しない。

## エラー処理

新しい入力や永続化処理は増えないため、エラー処理は現状を維持する。
unknown control と不正な boolean value の検証にも変更を加えない。

## テスト

設定グループの declarative definition が新しい所属と順序を返すことを確認する。
fallback display が同じ見出しと設定順序を描画することを確認する。
設定値の読込、更新、保存が従来どおりであることは既存テストで維持する。
