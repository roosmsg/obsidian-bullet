# Mobile Heading Selection Transaction Scroll Anchor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** モバイルのnative見出しchevronで、click captureとfoldの間にselection transactionが入っても、操作した見出しのY位置を固定する。

**Architecture:** `MobileNativeFoldScroll`のpending snapshotを単一の`EditorState`へ固定せず、一つのpending objectとして同じevent turn内の後続stateへ引き継ぐ。最初の`foldEffect`、`unfoldEffect`、またはfolded rangeの実内容を変更するtransactionでsnapshotを消費し、timeout後はobject identityを確認して無効化する。

**Tech Stack:** TypeScript、CodeMirror 6 (`@codemirror/state`, `@codemirror/language`, `@codemirror/view`)、Jest、Obsidian 1.13.2、GitButler CLI

## Global Constraints

- version controlの書き込み操作には`but`だけを使い、`git add`、`git commit`、`git push`は使わない。
- local verificationはNode.js 22.23.1以上の22系で実行する。
- `src`配下のunit testは`SKIP_OBSIDIAN=1`を付ける。
- native pointer sequenceとnative fold transactionを維持し、eventをpreventまたはstopしない。
- control DOM、CSS geometry、見出しcontrolの位置・幅・高さ・向きは変更しない。
- fold後の手動`scrollTop`復元、遅延したscroll補正、次のevent loopまで残るsnapshotは追加しない。
- 実Obsidian検証はリポジトリ内の`vault`、plugin ID `bullet`だけを使う。
- モバイル検証は`app.emulateMobile(true)`、390×844px、DPR 3、5点touch emulation、native touch gestureで行う。

---

### Task 1: 中間selection transactionを通過するpending snapshot

**Files:**

- Modify: `src/features/__tests__/MobileRightFoldControls.test.ts`
- Modify: `src/features/MobileRightFoldControls.ts`
- Modify: `AGENTS.md`

**Interfaces:**

- Consumes: `MobileNativeFoldScroll.prepare(view: EditorView): void`、`MobileNativeFoldScroll.extension: Extension`
- Produces: `PendingFoldScrollSnapshot`、同じevent turn内の非fold transactionを通過し、最初の明示的またはimplicitなfold/unfoldで消費されるsnapshot lifecycle

- [x] **Step 1: 中間selection transactionの回帰testを書く**

`src/features/__tests__/MobileRightFoldControls.test.ts`の既存`MobileNativeFoldScroll` table testの後へ、実際の`EditorState.update()`を連結するtestを追加する。

```ts
test.each([
  ["fold", foldEffect],
  ["unfold", unfoldEffect],
])(
  "carries a corrected scroll snapshot across an intermediate selection transaction before native %s",
  (_name, nativeEffect) => {
    const snapshotType = StateEffect.define<string>();
    const snapshot = snapshotType.of("viewport");
    const nativeFoldScroll = new MobileNativeFoldScroll(
      jest.fn().mockReturnValue(snapshot),
    );
    const state = EditorState.create({
      doc: "- parent\n  - child",
      extensions: [nativeFoldScroll.extension],
    });
    const view = {
      dom: {
        ownerDocument: {
          defaultView: { setTimeout: jest.fn() },
        },
      },
      state,
    };

    nativeFoldScroll.prepare(view as never);
    const selectionTransaction = state.update({
      selection: { anchor: 2 },
    });
    const nativeTransaction = selectionTransaction.state.update({
      effects: nativeEffect.of({ from: 8, to: 17 }),
    });

    expect(nativeTransaction.effects).toHaveLength(2);
    expect(nativeTransaction.effects).toContain(snapshot);
    expect(
      nativeTransaction.effects.some((effect) => effect.is(nativeEffect)),
    ).toBe(true);
  },
);
```

- [x] **Step 2: testがstate-key不一致で失敗することを確認する**

Run:

```bash
npx -y -p node@22.23.1 -c 'node --version && SKIP_OBSIDIAN=1 ./node_modules/.bin/jest src/features/__tests__/MobileRightFoldControls.test.ts --runInBand'
```

Expected: 新しいfold/unfoldの2 caseが`Expected length: 2, Received length: 1`でFAILし、既存testはPASSする。

- [x] **Step 3: pending objectを後続stateへ引き継ぐ最小実装を書く**

`src/features/MobileRightFoldControls.ts`でsnapshotのvalue型を次のobjectへ変更する。

`foldedRanges()`の実内容比較には、次のimportを使う。

```ts
import { foldEffect, foldedRanges, unfoldEffect } from "@codemirror/language";
import { EditorState, Extension, RangeSet } from "@codemirror/state";
```

```ts
interface PendingFoldScrollSnapshot {
  active: boolean;
  snapshot: FoldScrollSnapshot;
  state: EditorState;
}
```

`MobileNativeFoldScroll`を次のlifecycleへ変更する。

```ts
export class MobileNativeFoldScroll {
  private pendingSnapshots = new WeakMap<
    EditorState,
    PendingFoldScrollSnapshot
  >();

  readonly extension: Extension = EditorState.transactionExtender.of(
    (transaction) => {
      const pending = this.pendingSnapshots.get(transaction.startState);
      if (!pending || !pending.active) {
        return null;
      }

      this.pendingSnapshots.delete(transaction.startState);
      if (
        transaction.effects.some(
          (effect) => effect.is(foldEffect) || effect.is(unfoldEffect),
        ) ||
        !RangeSet.eq(
          [foldedRanges(transaction.startState)],
          [foldedRanges(transaction.state)],
        )
      ) {
        pending.active = false;
        return { effects: pending.snapshot };
      }

      pending.state = transaction.state;
      this.pendingSnapshots.set(pending.state, pending);
      return null;
    },
  );

  constructor(
    private createSnapshot: FoldScrollSnapshotFactory = stableFoldScrollSnapshot,
  ) {}

  prepare(view: EditorView): void {
    const pending: PendingFoldScrollSnapshot = {
      active: true,
      snapshot: this.createSnapshot(view),
      state: view.state,
    };
    this.pendingSnapshots.set(pending.state, pending);
    view.dom.ownerDocument.defaultView?.setTimeout(
      () => this.expire(pending),
      0,
    );
  }

  private expire(pending: PendingFoldScrollSnapshot): void {
    pending.active = false;
    if (this.pendingSnapshots.get(pending.state) === pending) {
      this.pendingSnapshots.delete(pending.state);
    }
  }
}
```

- [x] **Step 4: targeted testが通ることを確認する**

Run:

```bash
npx -y -p node@22.23.1 -c 'node --version && SKIP_OBSIDIAN=1 ./node_modules/.bin/jest src/features/__tests__/MobileRightFoldControls.test.ts --runInBand'
```

Expected: `MobileRightFoldControls.test.ts`の全testがPASSする。

- [x] **Step 5: 同一selection transactionによるimplicit unfoldの回帰testを書く**

`codeFolding()`でカーソルをfold内に残したstateを作り、同一selectionの再設定だけでfolded rangeが解除されるcaseを追加する。

```ts
test("keeps a corrected scroll snapshot when moving the selection implicitly unfolds its range", () => {
  const snapshotType = StateEffect.define<string>();
  const snapshot = snapshotType.of("viewport");
  const nativeFoldScroll = new MobileNativeFoldScroll(
    jest.fn().mockReturnValue(snapshot),
  );
  const state = EditorState.create({
    doc: "- parent\n  - child",
    extensions: [codeFolding(), nativeFoldScroll.extension],
    selection: { anchor: 10 },
  });
  const foldedState = state.update({
    effects: foldEffect.of({ from: 8, to: 17 }),
  }).state;
  const view = {
    dom: {
      ownerDocument: {
        defaultView: { setTimeout: jest.fn() },
      },
    },
    state: foldedState,
  };

  expect(foldedRanges(foldedState).size).toBe(1);
  nativeFoldScroll.prepare(view as never);
  const selectionTransaction = foldedState.update({
    selection: { anchor: 10 },
  });

  expect(foldedRanges(selectionTransaction.state).size).toBe(0);
  expect(selectionTransaction.effects).toContain(snapshot);
});
```

Expected: 明示的な`unfoldEffect`がないselection transactionへsnapshotが追加される。

- [x] **Step 6: timeout後にsnapshotが流用されない回帰testを書く**

同じtest fileへ、timeout callbackを明示的に実行するtestを追加する。

```ts
test.each([
  ["fold", foldEffect],
  ["unfold", unfoldEffect],
])(
  "expires a corrected scroll snapshot after an intermediate selection before later %s",
  (_name, nativeEffect) => {
    const snapshotType = StateEffect.define<string>();
    const snapshot = snapshotType.of("viewport");
    const timeoutCallbacks: Array<() => void> = [];
    const nativeFoldScroll = new MobileNativeFoldScroll(
      jest.fn().mockReturnValue(snapshot),
    );
    const state = EditorState.create({
      doc: "- parent\n  - child",
      extensions: [nativeFoldScroll.extension],
    });
    const view = {
      dom: {
        ownerDocument: {
          defaultView: {
            setTimeout: jest.fn((callback: () => void) => {
              timeoutCallbacks.push(callback);
              return 1;
            }),
          },
        },
      },
      state,
    };

    nativeFoldScroll.prepare(view as never);
    const selectionTransaction = state.update({
      selection: { anchor: 2 },
    });
    timeoutCallbacks[0]?.();
    const nativeTransaction = selectionTransaction.state.update({
      effects: nativeEffect.of({ from: 8, to: 17 }),
    });

    expect(nativeTransaction.effects).toHaveLength(1);
    expect(nativeTransaction.effects).not.toContain(snapshot);
    expect(
      nativeTransaction.effects.some((effect) => effect.is(nativeEffect)),
    ).toBe(true);
  },
);
```

- [x] **Step 7: lifecycle testと関連unit testを実行する**

Run:

```bash
npx -y -p node@22.23.1 -c 'node --version && SKIP_OBSIDIAN=1 ./node_modules/.bin/jest src/features/__tests__/MobileRightFoldControls.test.ts src/features/__tests__/GuideFolding.test.ts --runInBand'
```

Expected: 両test suiteがPASSし、console errorまたはwarningが出ない。

- [x] **Step 8: durableなtransaction順序をAGENTS.mdへ記録する**

`AGENTS.md`の「モバイルの右端折りたたみコントロールについて」へ次を追加する。

```markdown
- mobile native chevronの`click` captureとnative fold transactionの間には、カーソル由来のselection-only transactionが入る場合があります。pending scroll snapshotをclick時点の`EditorState`へ固定せず、同じevent turnの後続`EditorState`へ引き継いでください。カーソルがfold内にある場合、そのselection transaction自体が明示的な`unfoldEffect`なしでfolded rangeを解除するため、最初の`foldEffect`、`unfoldEffect`、または`foldedRanges(startState)`と`foldedRanges(state)`の実内容が変わるtransactionでsnapshotを消費してください。`setTimeout(..., 0)`後は無効化し、`prepare()`→selection transaction→native fold/unfoldの順序をunit testと実Obsidianで確認してください。
```

- [x] **Step 9: format、型検査、lintを実行する**

Run:

```bash
npx -y -p node@22.23.1 -c 'node --version && ./node_modules/.bin/prettier --write src/features/MobileRightFoldControls.ts src/features/__tests__/MobileRightFoldControls.test.ts AGENTS.md && ./node_modules/.bin/tsc --noEmit --pretty false && npm run lint'
```

Expected: Node.jsは22.23.1、Prettier変更後にtypecheckとlintがexit 0。

- [x] **Step 10: 実装差分だけをGitButler branchへcommitする**

Run:

```bash
but diff
but commit codex/fix-mobile-heading-selection-jank --message 'fix(mobile): preserve heading scroll across selection updates

Why:
- Mobile cursor handling can insert a selection transaction between click capture and the native fold, leaving the scroll snapshot keyed to a stale EditorState.

What:
- Carry the pending snapshot across same-turn non-fold transactions.
- Expire or consume snapshots without leaking them to unrelated folds.
- Cover the intermediate-selection sequence and document the contract.'
```

Expected: GitButlerの`codex/fix-mobile-heading-selection-jank`上にsource、test、`AGENTS.md`だけのcommitが作られる。

### Task 2: 実Obsidianでのframe単位回帰検証

**Files:**

- Build output only: `dist/main.js`
- Temporary runtime artifact only: `vault/.obsidian/plugins/bullet/`
- Temporary fixture only: `vault/mobile-heading-cursor-jank-repro.md`

**Interfaces:**

- Consumes: Task 1の`MobileNativeFoldScroll` lifecycle
- Produces: 中間selection transactionあり・なしのnative touch fold/unfold計測結果

- [x] **Step 1: test bundleをbuildしてtest vaultへ配置する**

Run:

```bash
npx -y -p node@22.23.1 -c 'node --version && npm run build-with-tests'
mkdir -p vault/.obsidian/plugins/bullet
cp dist/main.js manifest.json styles.css vault/.obsidian/plugins/bullet/
```

Expected: buildがexit 0になり、`dist/main.js`、`manifest.json`、`styles.css`がplugin ID `bullet`へ配置される。

- [x] **Step 2: test vaultを開いて対象windowを確認する**

Obsidian CLIで`vault=vault`を明示してtest vaultを開き、各UI action直前に次を実行する。

```bash
obsidian-cli vault=vault eval code='window.focus()'
```

Expected: window titleが`vault`を示す。`base`が表示された場合は操作を止める。

- [x] **Step 3: 最小fixtureとモバイル環境を準備する**

`vault/mobile-heading-cursor-jank-repro.md`へ、対象見出し、一つの子段落、次の見出しを置く。DevTools Console相当から`app.emulateMobile(true)`を実行し、viewport 390×844px、DPR 3、5点touch emulationを設定する。対象見出しをviewport上端から160pxへ置き、子段落内へカーソルを置く。

Expected: tap直前の`elementFromPoint()`が対象のnative heading controlを返す。

- [x] **Step 4: 中間selection transactionありでfoldとunfoldを計測する**

pluginのcapture listenerより後、native handlerより前に同一selectionをdispatchする診断用capture listenerを追加する。CDPのnative touch gestureで`pointerdown`→`pointerup`→`click`を発生させ、各animation frameの見出しY座標、`scrollTop`、fold状態、selection headを記録する。

Expected:

- foldの見出しY座標spanが0px、`scrollTop` spanが0px。
- unfoldの見出しY座標spanが0px、`scrollTop` spanが0px。
- fold状態が各gestureで反転する。
- selection headがgesture前後で一致する。

実績: foldとunfoldを各36 frame計測し、両spanが0px、selection headが344のまま、fold状態が反転した。

- [x] **Step 5: 診断用listenerなしの対照を計測する**

診断用listenerを解除し、同じviewport、target offset、cursor位置、native touch sequenceでfoldとunfoldを再計測する。

Expected: foldとunfoldの見出しY座標span、`scrollTop` spanがすべて0px。

実績: foldとunfoldを各36 frame計測し、両spanが0px、selection headが344のまま、fold状態が反転した。

- [x] **Step 6: 実Obsidianの一時状態をcleanupする**

診断用listener、一時fixture、mobile emulation、device metrics、touch emulation、window上の一時変数を削除し、`test.md`を再度開く。

Expected: titleが`test - vault - Obsidian 1.13.2`、mobile emulationはfalse、一時fixtureは存在しない。

### Task 3: 全検証とdefault branchへの反映

**Files:**

- Verify: repository tracked files
- Preserve: `vault/test.md`

**Interfaces:**

- Consumes: Task 1のcommit、Task 2の実Obsidian計測結果
- Produces: 全test通過済みでdefault branchへlandされた修正

- [x] **Step 1: upstream更新可能性を確認する**

Run:

```bash
but pull --check
but pull
```

Expected: conflictなく最新upstreamを取り込める。競合がある場合は実装を進めず状態を診断する。

- [x] **Step 2: full test前にfixtureをvault外へbackupする**

`vault/test.md`をvault外の一時pathへcopyし、SHA-256 hashを記録する。Obsidianのtest vault rendererを終了し、LevelDB lockが解放されたことを確認する。

Expected: backup fileが存在し、元fileとhashが一致し、test rendererが終了している。

- [x] **Step 3: CI相当の全testをNode.js 22.23.1で実行する**

Run:

```bash
npx -y -p node@22.23.1 -c 'node --version && npm test'
```

Expected: Node.js 22.23.1で全test suiteがPASSする。

- [x] **Step 4: `vault/test.md`をrestoreして遅延保存後もhashを確認する**

`vault=vault`のrendererが終了した状態を再確認してbackupをrestoreする。少し待ってからSHA-256を再計算する。

Expected: restore直後と待機後のhashがbackupのhashと一致する。

- [x] **Step 5: 最終差分とbranch状態を確認する**

Run:

```bash
but status -fv
but diff
```

Expected: uncommitted changeがなく、`dist/main.js`やfixtureが追跡されず、設計・計画・実装commitだけが`codex/fix-mobile-heading-selection-jank`にある。

- [x] **Step 6: implementation planを完了状態へ更新してcommitする**

このfileのcheckboxを実績に合わせて`[x]`へ変更し、format後にGitButlerでplan fileだけをcommitする。

Run:

```bash
npx -y -p node@22.23.1 -c './node_modules/.bin/prettier --write docs/superpowers/plans/2026-07-17-mobile-heading-selection-transaction-scroll-anchor.md'
but diff
but commit codex/fix-mobile-heading-selection-jank --message 'docs(mobile): record heading scroll anchor implementation

Why:
- The cursor-sensitive regression requires a reproducible transaction sequence and real Obsidian verification record.

What:
- Capture the TDD, lifecycle, mobile touch validation, and integration steps used for the fix.'
```

Expected: completed planがbranch上の独立commitになる。

- [ ] **Step 7: branchをdefault branchへlandする**

Run:

```bash
but land co --yes
```

Expected: `codex/fix-mobile-heading-selection-jank`のcommitがdefault branchへ反映される。

- [ ] **Step 8: land後の状態を確認する**

Run:

```bash
but status -fv
git status --short
git log -5 --oneline --decorate
```

Expected: worktreeがcleanで、default branch履歴に設計・実装・計画commitが含まれる。`git`はread-only確認だけに使う。
