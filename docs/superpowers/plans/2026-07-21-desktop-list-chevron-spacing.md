# Desktop List Chevron Spacing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** デスクトップの全リスト階層でシェブロンとbulletの中心間距離を約14pxへ揃え、outer guideを標準の18pxインデントグリッドへ配置する。

**Architecture:** 変更はCSSと既存のCSS contract testへ限定する。native `.collapse-indicator`の操作領域をfold indicator基準で配置し、outer guide widgetは動かさず、desktop限定overrideで`::before`の線だけをwidgetのinline startへ移す。

**Tech Stack:** CSS、TypeScript、Jest、Obsidian 1.13.2 Live Preview、GitButler CLI

## Global Constraints

- ローカル検証commandには`n exec 22.23.1`をprefixとして付け、Node.js 22.23.1で実行する。
- `src`配下のJestを直接実行するときは`SKIP_OBSIDIAN=1`を付ける。
- `.spec.md`を含むfull testの前に`npm run build-with-tests`を実行する。
- 対象は`body:not(.is-mobile)`配下のLive Previewにあるリスト行のnative `.collapse-indicator`だけとする。
- rootと入れ子のシェブロン中心からbullet中心までの距離は13.5px以上14.5px以下とする。
- 既定テーマではouter guideと最初のinner guideを18px離す。
- outer guide widgetのDOM、位置、`--list-indent`による幅、pointer target、chunk単位の操作は変更しない。
- SVG単体の`transform`、背景マスク、独立overlay、画面座標cache、独自DOM、遅延した位置補正を追加しない。
- native inner guide、見出し、Reading View、モバイルの右端折りたたみコントロールは変更しない。
- 実Obsidianの検証にはリポジトリの`vault`だけを使い、`/Users/kodai/base`へartifactやtest noteを配置しない。
- version controlの書き込みにはGitButler CLIを使い、実装commitは`codex/desktop-chevron-spacing`へ追加する。
- 共有worktreeにある今回の対象外の変更は編集せず、commitには`but diff`が返す対象ファイルIDだけを`--changes`で明示する。
- Appleスキルは使わない。

---

### Task 1: Desktop Chevron Placement

**Files:**

- Modify: `src/features/__tests__/GuideFolding.test.ts:801`
- Modify: `styles.css:64`

**Interfaces:**

- Consumes: Obsidianが各list marker直前へ置くzero-width `.cm-fold-indicator`と、10pxのnative `svg.svg-icon`
- Produces: fold indicatorのinline startから2px内側に中心を持つ14px幅のnative control

- [ ] **Step 1: 14px配置を要求する失敗テストを書く**

既存の`shows desktop list chevrons only on row hover between guides`を`shows desktop list chevrons only on row hover at the Logseq spacing`へ改名し、配置の期待値を次へ置き換える。

```ts
expect(hiddenDeclarations).toContain("display: flex;");
expect(hiddenDeclarations).toContain("box-sizing: border-box;");
expect(hiddenDeclarations).toContain("align-items: center;");
expect(hiddenDeclarations).toContain("justify-content: center;");
expect(hiddenDeclarations).toContain("inset-inline-start: -5px;");
expect(hiddenDeclarations).toContain("inset-inline-end: auto;");
expect(hiddenDeclarations).toContain("width: 14px;");
expect(hiddenDeclarations).toContain("padding-inline: 0;");
expect(hiddenDeclarations).not.toContain("transform:");
expect(hiddenDeclarations).not.toContain(
  "inset-inline-start: calc(-1 * var(--list-indent, 18px));",
);
expect(hiddenDeclarations).not.toContain("width: var(--list-indent, 18px);");
```

既存の非表示、行ホバー、`z-index`、guide action中のSVGだけのpointer target、mobileとheaderの分離に関する期待値は残す。

- [ ] **Step 2: 対象テストが旧配置で失敗することを確認する**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/GuideFolding.test.ts --runInBand
```

Expected: `inset-inline-start: -5px;`または`width: 14px;`の期待値でFAILし、既存CSSの18px lane配置が表示される。

- [ ] **Step 3: native controlを14px間隔へ配置する最小CSSを書く**

desktop list chevronのbase ruleで、次の宣言だけを変更する。

```css
body:not(.is-mobile)
  .markdown-source-view.mod-cm6.is-live-preview
  .cm-line.HyperMD-list-line:has(.cm-fold-indicator)
  .cm-fold-indicator
  .collapse-indicator {
  display: flex;
  box-sizing: border-box;
  align-items: center;
  justify-content: center;
  inset-inline-start: -5px;
  inset-inline-end: auto;
  width: 14px;
  padding-inline: 0;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
}
```

14px幅を`-5px`から開始するとcontrol中心はfold indicatorの2px内側になり、既定テーマのbullet中心との実測差は13.617pxになる。

- [ ] **Step 4: 対象テストが通ることを確認する**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/GuideFolding.test.ts --runInBand
```

Expected: `GuideFolding.test.ts`の全testがPASSする。

- [ ] **Step 5: chevron配置をcommitする**

Run:

```bash
but diff
```

outputに表示された`styles.css`と`src/features/__tests__/GuideFolding.test.ts`のfile IDだけをcomma-separated valueとして`--changes`へ渡し、次のmessageで`codex/desktop-chevron-spacing`へcommitする。

```text
fix: align desktop list chevrons with bullets

Why:
Desktop list chevrons are currently centered in a full indentation lane, leaving every nesting depth about 24.6px from its bullet instead of the intended Logseq-like spacing.

What:
- position the native control from the fold-indicator origin
- keep the 10px SVG centered in a 14px hit area
- preserve row-hover visibility and guide-action pointer routing
```

Expected: 今回の2ファイルだけがcommitされ、対象外のuncommitted changesは変更前のまま残る。

### Task 2: Desktop Outer Guide Grid Alignment

**Files:**

- Modify: `src/features/__tests__/GuideFolding.test.ts:859`
- Modify: `styles.css:25`

**Interfaces:**

- Consumes: `--list-indent`幅でlist行の1インデント外側へ置かれる`.bullet-plugin-outer-list-guide` widget
- Produces: desktopだけでwidgetのinline startへ描かれ、最初のnative inner guideから1インデント離れた`::before`線

- [ ] **Step 1: desktop outer lineの位置を要求する失敗テストを書く**

`GuideFolding outer guide styles`へ次のtestを追加する。

```ts
test("moves only the desktop outer line to the widget inline start", () => {
  const baseDeclarations = styles.match(
    /\.markdown-source-view\.mod-cm6\s+\.bullet-plugin-outer-list-guide::before\s*\{([^}]*)\}/,
  )?.[1];
  const desktopDeclarations = styles.match(
    /body:not\(\.is-mobile\)\s+\.markdown-source-view\.mod-cm6\s+\.bullet-plugin-outer-list-guide::before\s*\{([^}]*)\}/,
  )?.[1];

  expect(baseDeclarations).toContain("inset-inline-end: 0;");
  expect(desktopDeclarations?.replace(/\s+/g, " ").trim()).toBe(
    "inset-inline-start: 0; inset-inline-end: auto;",
  );
});
```

既存のwidget geometry、theme変数、actionable pointer target、custom paint禁止のtestは変更しない。

- [ ] **Step 2: desktop overrideがないため失敗することを確認する**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/GuideFolding.test.ts --runInBand
```

Expected: `desktopDeclarations`が`undefined`になり、新しいtestだけがFAILする。

- [ ] **Step 3: widgetを動かさずdesktopの線だけをinline startへ移す**

base `.bullet-plugin-outer-list-guide::before` ruleの直後へ、次のoverrideを追加する。

```css
body:not(.is-mobile)
  .markdown-source-view.mod-cm6
  .bullet-plugin-outer-list-guide::before {
  inset-inline-start: 0;
  inset-inline-end: auto;
}
```

base ruleの`inset-inline-end: 0`は残し、mobileでは現在の位置を維持する。

- [ ] **Step 4: outer guideとchevronのCSS contractが通ることを確認する**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/GuideFolding.test.ts --runInBand
```

Expected: `GuideFolding.test.ts`の全testがPASSする。

- [ ] **Step 5: outer guide配置をcommitする**

Run:

```bash
but diff
```

outputに表示された`styles.css`と`src/features/__tests__/GuideFolding.test.ts`のfile IDだけをcomma-separated valueとして`--changes`へ渡し、次のmessageで`codex/desktop-chevron-spacing`へcommitする。

```text
fix: align the desktop outer guide to the indent grid

Why:
The outer guide widget already occupies one list-indent lane, but its line is painted at the lane end and appears almost adjacent to the first native guide.

What:
- paint the desktop outer line at the widget inline start
- preserve the widget geometry and pointer target
- leave mobile and native inner-guide geometry unchanged
```

Expected: 今回の2ファイルだけが新しいcommitへ入り、対象外のuncommitted changesは変更前のまま残る。

### Task 3: Automated and Real-Obsidian Verification

**Files:**

- Verify: `styles.css`
- Verify: `src/features/__tests__/GuideFolding.test.ts`
- Generated, untracked: `dist/main.js`
- Runtime artifacts only: `vault/.obsidian/plugins/bullet/main.js`, `vault/.obsidian/plugins/bullet/manifest.json`, `vault/.obsidian/plugins/bullet/styles.css`
- Create for manual verification, then Trash: `vault/chevron-spacing-manual.md`

**Interfaces:**

- Consumes: Task 1の14px chevron配置とTask 2の18px outer-guide配置
- Produces: CI相当の自動検証結果と、test vaultにおける実座標・pointer target・fold操作の確認結果

- [ ] **Step 1: focused test、lint、test buildを実行する**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/GuideFolding.test.ts --runInBand
n exec 22.23.1 npm run lint
n exec 22.23.1 npm run build-with-tests
```

Expected: 3commandすべてがexit 0になる。

- [ ] **Step 2: fixtureをbackupし、ObsidianのLevelDB lock ownerを確認する**

Run:

```bash
chevron_spacing_backup_dir=$(mktemp -d /tmp/obsidian-bullet-chevron-spacing.XXXXXX)
cp vault/test.md "$chevron_spacing_backup_dir/test.md"
shasum -a 256 "$chevron_spacing_backup_dir/test.md"
lsof '/Users/kodai/Library/Application Support/obsidian/Local Storage/leveldb/LOCK' || true
```

`lsof`が小文字の`obsidian` processを返した場合は、`ps`で正確なPIDとcommandを確認し、そのowner processだけを終了してlock解放を再確認する。

- [ ] **Step 3: full testとproduction buildを実行する**

Run:

```bash
n exec 22.23.1 npm test -- --runInBand
n exec 22.23.1 npm run build
```

Expected: 全Jest suiteとproduction buildがexit 0になり、`setTimeout is not defined`やtest renderer timeoutが発生しない。

- [ ] **Step 4: fixtureをrestoreしてhashを二度確認する**

`vault=vault`のtest rendererが終了したことを確認してから実行する。

```bash
cp "$chevron_spacing_backup_dir/test.md" vault/test.md
expected_fixture_hash=$(shasum -a 256 "$chevron_spacing_backup_dir/test.md" | awk '{print $1}')
actual_fixture_hash=$(shasum -a 256 vault/test.md | awk '{print $1}')
test "$expected_fixture_hash" = "$actual_fixture_hash"
sleep 2
test "$expected_fixture_hash" = "$(shasum -a 256 vault/test.md | awk '{print $1}')"
```

Expected: restore直後と2秒後のhash比較がexit 0になる。

- [ ] **Step 5: production artifactと専用fixtureをtest vaultへ配置する**

`apply_patch`で`vault/chevron-spacing-manual.md`を次の内容で作成する。

```markdown
- outer parent
  - nested parent
    - nested leaf
- second outer parent
  - second child
```

Run:

```bash
mkdir -p vault/.obsidian/plugins/bullet
cp dist/main.js manifest.json styles.css vault/.obsidian/plugins/bullet/
shasum -a 256 dist/main.js manifest.json styles.css vault/.obsidian/plugins/bullet/main.js vault/.obsidian/plugins/bullet/manifest.json vault/.obsidian/plugins/bullet/styles.css
obsidian-cli vault=vault open path=chevron-spacing-manual.md
obsidian-cli vault=vault plugin:reload id=bullet
```

Expected: source artifactと対応するtest-vault artifactのhashが一致し、専用fixtureが`vault`で開き、plugin `bullet`がreloadされる。

- [ ] **Step 6: desktopの実座標と表示条件を確認する**

各Computer Use action直前に`obsidian-cli vault=vault eval code='window.focus()'`を実行する。

`eval`が使えない場合は、`obsidian-cli vault=vault dev:cdp method=Runtime.evaluate params='{"expression":"window.focus(); document.title","returnByValue":true}'`を使い、返値に`vault`が含まれ`base`が含まれないことを確認する。

`chevron-spacing-manual.md`のrootと入れ子のfoldable行について、各action前にfresh DOM queryでline、native control、SVG、bullet、outer guide、inner guideのrectを取得する。

次を確認する。

- 行外ではcontrolの`opacity`が`0`、`visibility`が`hidden`、`pointer-events`が`none`になる。
- editor selectionだけでは表示されず、対象行の本文へpointerを置いたときだけ表示される。
- rootと入れ子の両方でSVG中心とbullet中心の差が13.5px以上14.5px以下になる。
- 既定テーマでouter guideと最初のinner guideのX座標差が18pxになる。
- SVG boundsがouter guideおよび対応するinner guideの線と交差しない。
- 本文からSVGへpointerを移動しても行ホバーが途切れない。

- [ ] **Step 7: pointer target、fold操作、mobile isolationを確認する**

freshな座標で`elementFromPoint()`を使い、SVG中央がnative control、outer guide上が`.bullet-plugin-outer-list-guide`を返すことを確認する。

native chevronとouter guideのそれぞれへ`mousedown`→`mouseup`→`click`の完全なsequenceを送り、foldとunfoldが動作することを確認する。

outer guideではchunk単位のhover強調とトップレベルbranchの一括開閉が維持されることを確認する。

`app.emulateMobile(true)`とDevice Toolbar相当のviewport、DPR、touch emulationを使う。

mode切替後はDeveloper commandの再接続を待ち、`obsidian-cli vault=vault open path=chevron-spacing-manual.md`と`obsidian-cli vault=vault plugin:reload id=bullet`を再実行する。

mobileのlistとheading controlが既存の右端位置に常時表示されることを確認し、`app.emulateMobile(false)`でdesktopへ戻した後も同じ再接続、note再open、plugin reloadを行う。

- [ ] **Step 8: temporary backupを安全にTrashへ移す**

fixture hashが二度一致した後だけ実行する。

```bash
test -f vault/chevron-spacing-manual.md
/usr/bin/trash vault/chevron-spacing-manual.md
test -d "$chevron_spacing_backup_dir"
case "$chevron_spacing_backup_dir" in
  /tmp/obsidian-bullet-chevron-spacing.*) /usr/bin/trash "$chevron_spacing_backup_dir" ;;
  *) exit 1 ;;
esac
```

Expected: agentが作成した専用fixtureと正確な`/tmp/obsidian-bullet-chevron-spacing.*`だけがTrashへ移る。

- [ ] **Step 9: 最終diffを確認する**

Run:

```bash
but diff
```

Expected: 今回のuncommitted changesがなく、`dist/main.js`やtest-vault runtime artifactがGitButlerの変更へ含まれず、対象外の既存変更はそのまま残る。
