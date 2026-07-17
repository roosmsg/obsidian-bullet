# バレット所属本文入力設計

## 目的

通常の本文を、必ずバレット項目またはその継続行として入力する。

見出し、引用、水平線、コードブロック、frontmatterは文書構造として許可する。

Live Previewとは別のeditor modeを追加しない。

貼り付け、drop、外部pluginによる変更、既存文書の一括変換は対象にしない。

## ユーザー向け設定

Editing groupへ`Keep body text in bullets`というtoggleを追加する。

保存keyは`keepBodyTextInBullets`とし、既存利用者の編集挙動を変えないため初期値は`false`にする。

設定を有効にすると、直接入力と削除だけに次の規則を適用する。

既存の`Stick the cursor to the content`とは依存関係を持たせない。

`Stick the cursor to the content`は単一カーソルをMarkdown prefixの外へ戻す操作を担当し、新設定は文書変更の結果を担当する。

## 本文の所属規則

通常の本文として許可するのは、次の二種類である。

- `- item`、`* item`、`+ item`、番号付きリストなどのリスト項目。
- リスト項目へ必要なindentで所属する継続行。

Shift+Enterで作る次の行は、物理行の先頭にバレットがなくても同じリスト項目へ所属するため許可する。

```md
- first line
  second line
```

空行は常に許可する。

空行または既存の非バレット本文行へ直接文字を入力した結果が通常本文になる場合は、行頭へ`- `を補う。

貼り付けられた非バレット本文はそのまま残すが、後からその行を直接編集した時点では、編集された行だけを規則の対象にする。

## 空バレットの操作

### Enter

ルート階層の空バレットでEnterを押した場合は、現在の空バレットを残し、その下へ同じ種類の新しいルートバレットを作ってカーソルを移す。

```md
- |
```

Enter後は次の状態になる。

```md
- 
- |
```

ネストされた空バレットでEnterを押した場合は、現在の項目とそのsubtreeを一段アウトデントする。

```md
- parent
  - |
```

Enter後は次の状態になる。

```md
- parent
- |
```

空のtask itemには、既存のcheckbox継承規則を適用する。

### Backspace

内容、継続行、子項目を持たない空バレットでBackspaceを押した場合は、indentの深さにかかわらず項目の行全体を削除する。

```md
- parent
  - |
```

Backspace後は次の状態になる。

```md
- parent|
```

前の行がない場合は次の行の先頭へ、前の行がある場合は前の表示項目の本文末尾へカーソルを置く。

子項目を持つ空バレットは、この破壊的な規則の対象にしない。

空バレットのspaceだけを削除し、生の`-`を残す結果は作らない。

前方Deleteは現在の「次の内容を現在項目へ結合する」挙動を維持し、Backspaceによる空項目削除とは区別する。

## 構造行への変換

ルート階層にある通常の空バレットへ構造prefixを直接入力した場合は、indent、バレット、バレット後のspaceを同じtransaction内で外す。

対象は次のprefixである。

- `#`：ATX見出し。
- `>`：引用。
- backtick：fenced code blockの入力途中または開始行。
- `-`：水平線または新しいリストmarkerの入力途中。

たとえば、空バレットへ`#`を入力すると次のように変換する。

```md
- |
```

```md
#|
```

構造prefixは入力途中の形も一時的に許可する。

`#`の直後に空白または別の`#`を入力すれば見出し入力を継続する。

`#text`のように有効な見出しにも見出しの入力途中にもならなくなった場合は、`- #text`へ補正する。

一つまたは二つのbacktickと、一つまたは二つの`-`も入力途中として許可する。

timerやfocus状態は使わず、現在行の文字列だけから入力途中かどうかを判定する。

ネストされた空バレットでは自動変換しない。

構造行を作る場合は、Enterで必要な回数だけアウトデントしてルートへ移動してからprefixを入力する。

空のtask item、継続行や子項目を持つ項目、複数selectionでは自動変換しない。

## 許可するMarkdown構造

直接編集後の行が次の構造に所属する場合は、`- `を補わない。

- 文書先頭の`---`から終端delimiterまでのfrontmatter。
- ATX見出し。
- `>`で始まる引用行。
- 三つ以上の`-`による水平線。
- 三つ以上のbacktickで囲まれたfenced code block。
- 構造prefixの入力途中。

構造blockの開始delimiterを削除した結果、変更していない別行の分類まで変わっても、その別行は補正しない。

この機能は直接変更された行だけを扱い、文書全体のvalidatorにはしない。

setext見出し、indentだけで表すcode block、table、HTML blockなど、ここにない構造は最初の実装へ追加しない。

## transaction補正module

新しい`BulletTypingPolicy` moduleは、CodeMirror transactionを受け取り、次の三種類のdecisionを返す小さなinterfaceを公開する。

```ts
type BulletTypingDecision =
  | { kind: "pass" }
  | { kind: "correct"; changes: readonly ChangeSpec[] }
  | { kind: "reject" };

decide(transaction: Transaction): BulletTypingDecision;
```

moduleのimplementationは、編集元の判定、変更行の抽出、Markdown構造の分類、list prefixの保護、空バレット削除、構造行への変換、補正changeの生成を所有する。

feature adapterはdecisionだけを解釈する。

`correct`の場合は、元のtransactionと補正specを`sequential: true`で同じtransactionへまとめる。

元のselection、effects、annotations、scroll requestを再構築しない。

補正は元の変更後文書を基準に記述し、CodeMirrorにselectionとeffectのmappingを任せる。

この構造により、VimのVisual selection、register、dot repeat、undo単位を独自実装しない。

既知のlist prefixを壊す変更を安全に補正できない場合は`reject`を返し、本文だけを残す変更を適用しない。

予期しない解析errorではdebug logを残して元のtransactionを通し、editor自体を操作不能にしない。

## 対象transaction

次のuser eventだけを補正対象にする。

- `input.type`と、そのcomposition系subtype。
- `delete.backward`。
- `delete.forward`。
- `delete.selection`。
- `delete.cut`。

次の変更は常に通す。

- `input.paste`。
- `input.drop`と`move.drop`。
- `input.complete`。
- `undo`と`redo`。
- remote transaction。
- user eventを持たないpluginまたはprogrammatic transaction。
- selectionだけを変更するtransaction。

Vim commandが生成するuser eventは実Obsidianでcharacterization testを行う。

必要なannotationが付かないVim操作だけが見つかった場合は、選択範囲を変更せず、その操作を生成するadapter側へ最小限のannotationを加える。

## IME

日本語IMEのcompositionを壊さないことを必須条件にする。

通常のtransaction補正でcomposition rangeと候補表示が維持される場合は、ほかの`input.type`と同じ経路を使う。

実Obsidianで維持できない場合だけ、composition開始前に必要な`- `を挿入するinput adapterを追加し、composition transaction自体は通す。

compositionの確定、取り消し、再変換をそれぞれ検証する。

## 既存featureとの関係

`Enhance the Enter key`が無効でも、`Keep body text in bullets`が有効な間は、この設計で定めたEnterとShift+Enterを適用する。

新設定を無効にすると、`Enhance the Enter key`の現在の挙動へ戻る。

`Stick the cursor to the content`は維持し、Visual modeを含む非empty selectionには現在どおり介入しない。

新機能はVimの`V`、`j`、`k`が作るselectionを補正しない。

行全体を対象にした`d`はバレット項目ごとの削除として許可する。

行全体を対象にした`c`は行を削除した後、最初の通常文字入力時に`- `を補う。

既存のShift+Enterによる継続行は維持する。

## テスト

### pure transaction test

- 空行への通常文字入力が一つのhistory eventで`- text`になる。
- 既存の非バレット本文を直接編集すると、変更行だけへ`- `を補う。
- paste、drop、completion、undo、redo、remote、programmatic transactionを通す。
- list markerの一部を削除しても、本文だけの行を残さない。
- 行全体の削除はmarkerを復元しない。
- 空のleaf itemでBackspaceを押すと、rootとnestedの両方で行全体を削除する。
- 前方Deleteの結合挙動を維持する。
- rootの空バレットへ構造prefixを入力すると構造行へ変換する。
- 構造prefixが無効な本文になった時点で`- `を補う。
- nested item、task item、子項目付きitem、複数selectionは自動変換しない。
- frontmatter、見出し、引用、水平線、fenced code block、継続行を通す。
- correction後のselection方向とmain selectionを維持する。
- correctionと元の変更が一回のundoで戻る。

### operationとfeature test

- rootの空バレットでEnterを押すと、現在行を残して新しいroot itemを作る。
- nestedの空バレットでEnterを押すとsubtreeごと一段アウトデントする。
- 新設定と既存Enter設定の組み合わせをすべて確認する。
- `Stick the cursor to the content`の有効、無効にかかわらず文書補正結果が同じになる。
- Visual selection中にselection adjustmentが走らないことを維持する。

### 実Obsidian

- Normal modeの`x`、`dd`、`cc`、Visual modeの`d`と`c`を確認する。
- Visual Line selectionを`j`と`k`で両方向へ伸縮できることを確認する。
- Insert modeの通常入力、Backspace、Delete、undo、redo、dot repeatを確認する。
- 日本語IMEのcomposition、確定、取り消し、再変換を確認する。
- Live PreviewとSource modeで同じMarkdown結果になることを確認する。
- pasteが一切変換されないことを確認する。

## 完了条件

- 通常の直接入力で、変更対象の本文行がリスト項目または継続行へ所属する。
- 空バレットのBackspaceで生の`-`を残さない。
- rootとnestedの空バレットで、指定されたEnter挙動になる。
- rootの空バレットから見出し、引用、水平線、fenced code blockを入力できる。
- pasteと外部変更を変換しない。
- Vim selectionの範囲を変更しない。
- correctionが元の編集と同じundo単位に入る。
- IME、Vim、既存list editingに回帰がない。
