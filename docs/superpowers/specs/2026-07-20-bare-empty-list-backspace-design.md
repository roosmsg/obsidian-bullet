# 行末markerだけの空子項目を削除する設計

## 症状

子項目が `  - ` として保存されている場合、Backspaceは行全体を削除し、カーソルを親項目の本文末尾へ移動する。

同じ見た目でも末尾spaceのない `  -` の場合、現状はhyphenだけが消え、子項目があった位置に空行とカーソルが残る。

実Obsidianのsemantic specでは、この入力で症状が毎回再現する。

## 原因

Obsidianは行末のunordered markerを空のlist itemとして表示するが、`Parser`と`MarkdownLineClassifier`はmarker後のspaceまたはtabを必須としている。

このため、`Parser`は `  -` を親項目の継続行として扱い、意味的なBackspace operationはno-opになる。

続いてObsidianのnative Backspaceがhyphenを削除するが、transaction policyも変更前の行をlist itemとして認識できず、そのtransactionを通す。

## 修正境界

`Parser`と`MarkdownLineClassifier`は、対応済みmarkerが物理行末にある場合も、separatorが空のlist itemとして認識する。

`List`のcontent startは固定の1文字ではなく、実際のmarker separator長から計算する。

`BulletTypingPolicy`は裸の `-` を削除対象の空項目として扱う一方、空のroot itemから構造prefixへ変換する条件にはmarker後のspaceまたはtabを要求する。

後者の条件により、`- ` から `---` へ入力する途中の裸markerを再度promotionせず、水平線入力を維持する。

## 検討した案

Parserだけを直す案は変更量が少ないが、Vimやnative deletion transactionがkeymapを通らない場合に同じ空行を残す。

Backspace featureで裸markerだけを直接削除する案は、list markerの構文判定をParserの外へ重複させる。

Parserと行分類を揃え、構造promotionを明示的に狭める案は、通常keymapとtransaction fallbackを同じ意味へ収束させられるため採用する。

## テスト

実Obsidian specで、`- parent\n  -|` へのBackspaceが `- parent|` になることを検証する。

Parser、行分類、Backspace operation、deletion policyのunit testで裸markerの解釈と削除を固定する。

空itemから水平線を入力する既存integration specに加え、promotion後の裸markerへ2文字目のhyphenを入力するunit testを置く。

最終確認ではNode.js 22.23.1でunit test、lint、test build、全integration specを実行する。
