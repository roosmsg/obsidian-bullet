# README 全面改稿設計

## 目的

Bullet を初めて知った Obsidian 利用者が、プラグインの価値を短時間で判断し、インストール後に主要な操作を迷わず試せる README にする。

既存利用者が設定名、コマンド、既定のキーボード操作を参照できることも必要である。
ただし、実装の詳細や全例外を README に移すのではなく、利用時の判断に必要な情報へ絞る。

## 読者と言語

主な読者は、Obsidian Community Plugins、リリースページ、検索結果からリポジトリへ来る利用者とする。

README は英語で統一する。
manifest と現在の配布情報が英語であり、既存利用者が参照する設定名とコマンド名も英語だからである。

## 構成

README は次の順にする。

1. プラグイン名、短い価値説明、リリースと issue への導線、必要な Obsidian version。
2. 利用者が得られる変化を示す短い feature overview。
3. Community Plugins と手動配置の installation。
4. インストール直後に試す操作をまとめた quick start。
5. 編集、構造操作、折りたたみと表示、desktop と mobile の順に整理した feature reference。現行機能を示す既存 GIF は、対応する機能の説明へ置く。
6. 実装に登録されている既定操作と command palette command の一覧。
7. 既定設定と互換性上の注意。
8. 問題報告、fork の由来、license。

## 内容上の原則

価値説明は「Workflowy や Roam Research のような操作感」という比較だけに依存させない。
Bullet が Markdown のリスト構造を保ったまま、枝の移動、インデント、入力、選択、折りたたみを扱うことを具体的に述べる。

キーボード操作と command palette command を区別する。
source で既定 keymap を登録している操作だけを既定 shortcut として記載し、fold と unfold には既定 shortcut があると主張しない。

設定は画面上の group と同じ Editing、Appearance、Folding、Advanced に分ける。
全設定の既定値は `Settings.ts` と一致させる。

`Keep body text in bullets` は直接入力と削除だけを補正し、paste、drop、外部変更を一括変換しないことを短く明記する。
appearance の追加 style は標準 theme に限られる一方、vertical guide 自体を標準 theme 限定とは書かない。

## 視覚素材

`demo3.gif` は guide と折りたたみ、`demo4.gif` は drag and drop の近くへ置く。

旧 vault 名や旧 plugin 名が window title に出る `demo1.gif` と `demo2.gif` は使わない。
新しい画像は今回の範囲では作成しない。

## 検証

README の設定名、既定値、command 名、shortcut、最低 Obsidian version を source と package metadata に照合する。

Markdown link と画像 path が repository 内または期待する release、issue URL を指すことを検査する。

Markdown の heading 階層、table 列数、code span と keyboard markup の対応を機械的に確認する。

最後に差分を読み直し、未定義の用語、重複説明、古いブランド名、根拠のない互換性主張を残さない。
