# Obsidian-Aware Vertical Guide Scroll Anchor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Propertiesやfile titleが表示されている場合と、Obsidianが下端余白を上書きした場合でも、縦線開閉時にviewport上側の表示位置を維持する。

**Architecture:** `MyEditor.setFoldedPreservingScroll()` の既存batch transactionを維持し、snapshotを取得する直前に二つの補正を行う。実DOMの下端余白がCodeMirror標準値より小さい場合だけ復元し、scroll containerとCodeMirror documentの実座標差からsnapshot targetのanchor行を選び直す。

**Tech Stack:** TypeScript、CodeMirror 6、Obsidian Live Preview、Jest 30、Rollup

## Global Constraints

- 縦線操作だけを変更し、native chevron、keyboard操作、command palette、既存folding commandへ適用しない。
- snapshot、全fold effects、必要なselection退避は一つのtransactionへ含める。
- dispatch後の `scrollTop` 復元、遅延補正、MutationObserverによる常時監視を追加しない。
- 実Obsidianの検証では `/Users/kodai/workspaces/github.com/kdnk/obsidian-bullet/vault` だけを使い、各UI actionの直前に `vault=vault` を指定してtitleを確認する。
- `src` の変更後に統合specを実行するときは、先に `npm run build-with-tests` を実行する。

---

### Task 1: 実viewport基準のsnapshotと下端余白復元

**Files:**
- Modify: `src/editor/index.ts`
- Test: `src/editor/__tests__/index.test.ts`

**Interfaces:**
- Consumes: `EditorView.documentTop`、`EditorView.scaleY`、`EditorView.lineBlockAtHeight(height)`、`EditorView.scrollDOM.clientHeight`、`EditorView.documentPadding.top`
- Produces: `stableScrollSnapshot(view: EditorView)` が実viewport上端に対応するsnapshot effectを返し、`ensureScrollPastEndReserve(view: EditorView): void` が不足分だけ下端余白を復元する

- [x] **Step 1: Properties offsetを表す失敗テストを書く**

`makeBatchFoldingEditor()` のview mockへ次を追加する。

```ts
const scrollSnapshot = {
  value: {
    range: EditorSelection.cursor(1570),
    yMargin: -17.34375,
  },
};
const contentDOM = { style: { paddingBottom: "1138.5px" } };
const view = {
  contentDOM,
  defaultLineHeight: 24,
  documentPadding: { top: 0, bottom: 0 },
  documentTop: -537.5625,
  scaleY: 1,
  scrollDOM: {
    clientHeight: 1163,
    scrollTop: 1400,
    getBoundingClientRect: () => ({ top: 78.75 }),
  },
  lineBlockAtHeight: jest.fn(() => ({ from: 848, top: 614.34375 })),
  // 既存mock fieldsを維持する。
};
```

次のassertionを追加する。

```ts
expect(view.lineBlockAtHeight).toHaveBeenCalledWith(624.3125);
expect(scrollSnapshot.value.range.from).toBe(848);
expect(scrollSnapshot.value.range.to).toBe(848);
expect(scrollSnapshot.value.yMargin).toBe(-786);
```

- [x] **Step 2: snapshot補正テストが失敗することを確認する**

Run: `SKIP_OBSIDIAN=1 npx jest --runInBand src/editor/__tests__/index.test.ts`

Expected: `lineBlockAtHeight` が呼ばれず、snapshot rangeが1570のままなのでFAILする。

- [x] **Step 3: 下端余白の失敗テストを書く**

`paddingBottom` が `100px` のfixtureでbatch foldを実行し、dispatchより前に標準値へ復元されることを確認する。

```ts
const { editor, view } = makeBatchFoldingEditor(5);
view.contentDOM.style.paddingBottom = "100px";
mockedFoldable.mockReturnValue({ from: 8, to: 20 });
mockedFoldEffectOf.mockReturnValue("fold-8" as never);

editor.setFoldedPreservingScroll(
  [{ line: 0, fallbackCursor: { line: 0, ch: 2 } }],
  true,
);

expect(view.contentDOM.style.paddingBottom).toBe("1138.5px");
expect(view.dispatch).toHaveBeenCalledTimes(1);
```

標準値以上の余白は変更しないテストと、有効なfold rangeがない場合は余白を変更しないテストも追加する。

- [x] **Step 4: 下端余白テストが失敗することを確認する**

Run: `SKIP_OBSIDIAN=1 npx jest --runInBand src/editor/__tests__/index.test.ts`

Expected: `paddingBottom` が `100px` のままなのでFAILする。

- [x] **Step 5: snapshot anchor補正を実装する**

`stableScrollSnapshot()` でsnapshot targetの構造と座標を検証し、実viewport上端の行へ置き換える。

```ts
function correctScrollSnapshotAnchor(view: EditorView, value: unknown): void {
  if (
    !value ||
    typeof value !== "object" ||
    !("range" in value) ||
    !("yMargin" in value) ||
    typeof value.yMargin !== "number"
  ) {
    return;
  }

  const scaleY = view.scaleY;
  const scrollTop = view.scrollDOM.scrollTop;
  const scrollViewportTop = view.scrollDOM.getBoundingClientRect().top;
  const documentTop = view.documentTop;
  if (
    !Number.isFinite(scaleY) ||
    scaleY <= 0 ||
    !Number.isFinite(scrollTop) ||
    !Number.isFinite(scrollViewportTop) ||
    !Number.isFinite(documentTop)
  ) {
    return;
  }

  const viewportDocumentTop =
    (scrollViewportTop - documentTop) / scaleY;
  const anchor = view.lineBlockAtHeight(
    Math.max(0, viewportDocumentTop + 8 / scaleY),
  );
  if (!Number.isFinite(anchor.from) || !Number.isFinite(anchor.top)) return;

  value.range = EditorSelection.cursor(anchor.from);
  value.yMargin = anchor.top - scrollTop;
}
```

`stableScrollSnapshot()` はこの補正後に既存のphysical-pixel丸めを適用する。

- [x] **Step 6: 操作時だけ下端余白を復元する**

```ts
function ensureScrollPastEndReserve(view: EditorView): void {
  const expected =
    view.scrollDOM.clientHeight -
    view.defaultLineHeight -
    view.documentPadding.top -
    0.5;
  const current = Number.parseFloat(view.contentDOM.style.paddingBottom);
  if (
    Number.isFinite(expected) &&
    expected >= 0 &&
    (!Number.isFinite(current) || current < expected)
  ) {
    view.contentDOM.style.paddingBottom = `${expected}px`;
  }
}
```

`resolved.length === 0` の早期returnより後、`stableScrollSnapshot(view)` より前に `ensureScrollPastEndReserve(view)` を1回だけ呼ぶ。

- [x] **Step 7: editor unit testsを通す**

Run: `SKIP_OBSIDIAN=1 npx jest --runInBand src/editor/__tests__/index.test.ts`

Expected: PASS。

- [x] **Step 8: lintと関連unit testsを通す**

Run: `npm run lint && SKIP_OBSIDIAN=1 npx jest --runInBand src/features/__tests__/VerticalLines.test.ts src/features/__tests__/OuterListGuide.test.ts`

Expected: すべてPASS。

- [ ] **Step 9: 実装をcommitする**

```bash
git add src/editor/index.ts src/editor/__tests__/index.test.ts docs/superpowers/plans/2026-07-15-obsidian-aware-vertical-guide-scroll-anchor.md
git commit -m "fix(vertical-lines): anchor folding to the visible document"
```

commit descriptionには、Propertiesがscroll座標へ加算される理由と、Obsidianが下端余白を上書きする理由をWhyとして記載する。

### Task 2: test vaultでの回帰検証

**Files:**
- Verify: `vault/test.md`
- Verify: `vault/scroll-fold-regression-test.md`
- Generated, untracked: `dist/main.js`
- Generated, untracked: `vault/.obsidian/plugins/bullet/main.js`

**Interfaces:**
- Consumes: Task 1の `MyEditor.setFoldedPreservingScroll()`
- Produces: Properties展開時、ノート切り替え後、document末尾でも上側が固定される検証記録

- [ ] **Step 1: test bundleをbuildする**

Run: `npm run build-with-tests`

Expected: buildがexit 0で完了する。

- [ ] **Step 2: 全自動テストを実行する**

Run: `npm test -- --runInBand`

Expected: 全test suiteがPASSする。

- [ ] **Step 3: test vaultへbundleを配置してreloadする**

```bash
cp dist/main.js vault/.obsidian/plugins/bullet/main.js
obsidian-cli vault=vault plugin:reload id=bullet
obsidian-cli vault=vault eval code='window.focus();document.title'
```

Expected: titleに `vault` が含まれ、`base` が含まれない。

- [ ] **Step 4: Properties展開時の位置を確認する**

`test.md` のPropertiesを展開し、ルートリストをviewport上部へ置く。
ネスト線を5往復し、各操作の前後でルート行の `getBoundingClientRect().top` と `scrollTop` が同じ物理pixel位置に残ることを記録する。

- [ ] **Step 5: ノート切り替え直後の最初の操作を確認する**

`scroll-fold-regression-test.md` へ移動してから `test.md` へ戻る。
`contentDOM.style.paddingBottom` が `100px` の状態を確認し、最初の縦線クリックで標準値へ復元され、ルート行のY座標が変わらないことを確認する。

- [ ] **Step 6: Properties折りたたみ、最外線、chevronを確認する**

Propertiesを折りたたんだ状態でもネスト線と最外線を5往復する。
native chevronでは縦線専用の余白復元を実行せず、既存挙動が変わらないことを確認する。

- [ ] **Step 7: 最終差分を自己レビューする**

Run: `git diff HEAD~1 --check && git status --short`

Expected: whitespace errorがなく、追跡対象の生成物がない。

### Task 3: patch release

**Files:**
- Modify through npm: `package.json`
- Modify through npm: `package-lock.json`
- Modify through npm: `manifest.json`
- Modify through npm: `versions.json`

**Interfaces:**
- Consumes: Task 2で全検証を通したdefault branch
- Produces: patch version commit、git tag、origin/mainへのpush

- [ ] **Step 1: release直前にupstreamを取り込む**

Run: `git fetch && git pull --ff-only`

Expected: fast-forwardまたは `Already up to date.`。

- [ ] **Step 2: patch versionを作成する**

Run: `npm version patch`

Expected: version filesが更新され、version commitとtagが作成される。

- [ ] **Step 3: branchとtagをpushする**

Run: `git push && git push --tags`

Expected: `main` と新しいpatch tagがoriginへpushされる。
