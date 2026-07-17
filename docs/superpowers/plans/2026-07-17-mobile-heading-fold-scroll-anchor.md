# Mobile Heading Fold Scroll Anchor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** モバイルの Markdown 見出しを native chevron で開閉しても、見出しの画面上の Y 座標と editor の `scrollTop` を変化させない。

**Architecture:** `MobileRightFoldControlsPluginValue` の capture listener は維持し、event target selector だけをリストと見出しの native control の和集合へ広げる。既存の下端余白復元、補正済み `scrollSnapshot()`、transaction extender を見出しにもそのまま適用し、CSS、native transaction、DOM、開閉後の scroll 補正は変更しない。

**Tech Stack:** TypeScript、Jest、CodeMirror 6、Obsidian 1.13.2、GitButler CLI、Obsidian CLI、Electron DevTools Protocol。

## Global Constraints

- local verification は Node.js 22.23.1 以上の22系で実行する。
- version control の書き込みには `but` だけを使う。
- `src` 配下の Jest を直接実行するときは `SKIP_OBSIDIAN=1` を付ける。
- 実 Obsidian 検証ではリポジトリ内の `vault` だけを使い、`base` vault には触れない。
- 各 UI action の直前に `vault=vault` を focus し、window title が `vault` を含み `base` を含まないことを確認する。
- モバイル検証は 390×844px、DPR 3、最大 touch point 5、`app.emulateMobile(true)` で実行する。
- 見出しの CSS、native click、DOM、`preventDefault()`、`stopPropagation()`、手動 `scrollTop` 復元は変更しない。

---

### Task 1: 見出し control を既存 scroll 保持処理へ接続する

**Files:**

- Modify: `src/features/__tests__/MobileRightFoldControls.test.ts`
- Modify: `src/features/MobileRightFoldControls.ts`
- Modify: `AGENTS.md`

**Interfaces:**

- Consumes: `MobileRightFoldControlsPluginValue(view, nativeFoldScroll)`、`ensureFoldScrollReserve(view)`、`MobileNativeFoldScroll.prepare(view)`。
- Produces: リストと見出しの native control に一致する `NATIVE_FOLD_CONTROL_SELECTOR`。

- [ ] **Step 1: 既存 test をリストと見出しの table test にする**

`src/features/__tests__/MobileRightFoldControls.test.ts` の `restores scroll reserve before a native list fold click` を `test.each` に変える。

```ts
test.each([
  ["list", ".HyperMD-list-line .cm-fold-indicator .collapse-indicator"],
  ["heading", ".HyperMD-header .cm-fold-indicator .collapse-indicator"],
])(
  "restores scroll reserve before a native %s fold click",
  (_name, matchingSelector) => {
    const listeners = new Map<string, (event: Event) => void>();
    const readScrollHeight = jest.fn(() => 2000);
    const scrollDOM = { clientHeight: 1163 };
    Object.defineProperty(scrollDOM, "scrollHeight", {
      get: readScrollHeight,
    });
    const contentDOM = {
      addEventListener: jest.fn(
        (eventName: string, listener: (event: Event) => void) => {
          listeners.set(eventName, listener);
        },
      ),
      removeEventListener: jest.fn(),
      style: { paddingBottom: "100px" },
    };
    const view = {
      contentDOM,
      defaultLineHeight: 24,
      documentPadding: { top: 0 },
      dom: {
        ownerDocument: {
          body: {
            classList: {
              contains: (className: string) =>
                className === "bullet-plugin-mobile-right-fold-controls",
            },
          },
        },
      },
      scrollDOM,
    };
    const nativeFoldScroll = { prepare: jest.fn() };
    const pluginValue = new MobileRightFoldControlsPluginValue(
      view as never,
      nativeFoldScroll as never,
    );
    const preventDefault = jest.fn();
    const stopPropagation = jest.fn();
    const target = {
      closest: jest.fn((selector: string) =>
        selector.includes(matchingSelector) ? {} : null,
      ),
    };

    listeners.get("pointerdown")?.({
      target,
      preventDefault,
      stopPropagation,
      type: "pointerdown",
    } as unknown as MouseEvent);

    expect(contentDOM.style.paddingBottom).toBe("1138.5px");
    expect(readScrollHeight).toHaveBeenCalledTimes(1);
    expect(nativeFoldScroll.prepare).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
    expect(stopPropagation).not.toHaveBeenCalled();

    listeners.get("click")?.({
      target,
      preventDefault,
      stopPropagation,
      type: "click",
    } as unknown as MouseEvent);

    expect(readScrollHeight).toHaveBeenCalledTimes(2);
    expect(nativeFoldScroll.prepare).toHaveBeenCalledWith(view);
    expect(nativeFoldScroll.prepare).toHaveBeenCalledTimes(1);
    pluginValue.destroy();

    expect(contentDOM.removeEventListener).toHaveBeenCalledWith(
      "click",
      expect.any(Function),
      true,
    );
    expect(contentDOM.removeEventListener).toHaveBeenCalledWith(
      "pointerdown",
      expect.any(Function),
      true,
    );
  },
);
```

- [ ] **Step 2: 回帰 test が見出し case で失敗することを確認する**

Run:

```bash
npx -y -p node@22.23.1 -c 'SKIP_OBSIDIAN=1 ./node_modules/.bin/jest src/features/__tests__/MobileRightFoldControls.test.ts --runInBand'
```

Expected: list case は PASS し、heading case は `paddingBottom` が `100px` のままであるか、`nativeFoldScroll.prepare` が呼ばれないため FAIL する。

- [ ] **Step 3: native control selector をリストと見出しの和集合へ広げる**

`src/features/MobileRightFoldControls.ts` の selector を次の形へ変更する。

```ts
const NATIVE_FOLD_CONTROL_SELECTOR = [
  ".HyperMD-list-line .cm-fold-indicator .collapse-indicator",
  ".HyperMD-header .cm-fold-indicator .collapse-indicator",
].join(", ");
```

`prepareNativeFoldScroll` の target 判定は新しい定数を使う。

```ts
!event.target.closest(NATIVE_FOLD_CONTROL_SELECTOR);
```

listener、`ensureFoldScrollReserve()`、layout read、`event.type === "click"`、`MobileNativeFoldScroll.prepare()` は変更しない。

- [ ] **Step 4: 継続的な selector contract を記録する**

`AGENTS.md` のモバイル右端折りたたみ control の節へ次の指示を追加する。

```markdown
- mobile native chevron の scroll 保持対象 selector は、右端へ配置するすべての control 種別を含めてください。現在は `.HyperMD-list-line` と `.HyperMD-header` の両方が対象です。control 種別を追加するときは CSS だけでなく capture phase の `pointerdown` と `click` の対象も同時に広げ、各 target で下端余白の復元と `MobileNativeFoldScroll.prepare()` が実行される unit test を追加してください。
```

- [ ] **Step 5: 回帰 test と関連 test を通す**

Run:

```bash
npx -y -p node@22.23.1 -c 'SKIP_OBSIDIAN=1 ./node_modules/.bin/jest src/features/__tests__/MobileRightFoldControls.test.ts src/features/__tests__/GuideFolding.test.ts --runInBand'
npx -y -p node@22.23.1 -c './node_modules/.bin/tsc --noEmit'
npx -y -p node@22.23.1 -c './node_modules/.bin/prettier --check src/features/MobileRightFoldControls.ts src/features/__tests__/MobileRightFoldControls.test.ts'
git diff --check -- AGENTS.md
```

Expected: 全 command が exit 0 になり、見出しとリストの両 target case が PASS する。

- [ ] **Step 6: 実装を GitButler branch へ commit する**

Run:

```bash
but diff
but commit codex/fix-mobile-header-fold-y-jank --message $'fix(mobile): stabilize heading fold scrolling\n\nWhy:\n- Mobile heading controls bypassed the list-only native fold scroll anchor selector.\n\nWhat:\n- Route native heading chevrons through the existing reserve and snapshot path.\n- Cover list and heading targets with the same event-path regression test.\n- Document the shared selector contract.'
```

Expected: `but diff` が source、test、`AGENTS.md` の3ファイルだけを表示した場合に commit を実行し、その3ファイルだけが implementation commit に入り、uncommitted changes がなくなる。

---

### Task 2: 実 Obsidian で native touch の scroll 固定を確認する

**Files:**

- Verify: `src/features/MobileRightFoldControls.ts`
- Verify: `vault/.obsidian/plugins/bullet/main.js`
- Temporary: `vault/mobile-heading-y-jank-repro.md`

**Interfaces:**

- Consumes: production build の `dist/main.js` と Obsidian native `.HyperMD-header .collapse-indicator`。
- Produces: viewport offset 100px、160px、400pxにおける fold と unfold の `deltaTop=0`、`deltaScroll=0` の計測結果。

- [ ] **Step 1: production plugin を test vault へ配置する**

Run:

```bash
npx -y -p node@22.23.1 -c 'node --version && npm run build'
mkdir -p vault/.obsidian/plugins/bullet
cp dist/main.js manifest.json styles.css vault/.obsidian/plugins/bullet/
obsidian-cli vault=vault plugin:reload id=bullet
obsidian-cli vault=vault eval code='window.focus(); document.title'
```

Expected: build が exit 0 になり、fresh title が `vault` を含み `base` を含まない。

- [ ] **Step 2: 見出し fixture を作成して開く**

Run:

```bash
obsidian-cli vault=vault eval code='(async()=>{const before=Array.from({length:4},(_,i)=>`before ${i+1}`).join("\n\n");const after=Array.from({length:40},(_,i)=>`after ${i+1}`).join("\n\n");const path="mobile-heading-y-jank-repro.md";await app.vault.adapter.write(path,`${before}\n\n# Target heading\n\nchild 1\n\n# Following heading\n\n- Target list\n  - child 1\n\n${after}\n`);const file=app.vault.getAbstractFileByPath(path);await app.workspace.getLeaf(false).openFile(file);window.focus();return document.title})()'
```

Expected: title が `mobile-heading-y-jank-repro - vault` を含む。

- [ ] **Step 3: mobile device と touch emulation を有効にする**

Run:

```bash
obsidian-cli vault=vault eval code='(()=>{app.emulateMobile(true);const wc=require("electron").remote.getCurrentWebContents();if(!wc.debugger.isAttached())wc.debugger.attach("1.3");void wc.debugger.sendCommand("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:3,mobile:true,screenWidth:390,screenHeight:844,positionX:0,positionY:0});return "metrics-scheduled"})()'
sleep 1
obsidian-cli vault=vault eval code='(()=>{const dbg=require("electron").remote.getCurrentWebContents().debugger;void dbg.sendCommand("Emulation.setTouchEmulationEnabled",{enabled:true,maxTouchPoints:5});return "touch-scheduled"})()'
sleep 1
obsidian-cli vault=vault eval code='(async()=>{const file=app.vault.getAbstractFileByPath("mobile-heading-y-jank-repro.md");await app.workspace.getLeaf(false).openFile(file);window.focus();return document.title})()'
obsidian-cli vault=vault eval code='window.focus(); JSON.stringify({title:document.title,width:innerWidth,height:innerHeight,dpr:devicePixelRatio,touch:navigator.maxTouchPoints,mobile:document.body.classList.contains("is-mobile")})'
```

Expected: `width=390`、`height=844`、`dpr=3`、`touch=5`、`mobile=true` になる。

- [ ] **Step 4: native control probe を runtime へ定義する**

`obsidian-cli vault=vault eval` で、次の三つの runtime helper を定義する。

```js
window.__foldProbeConfigs = {
  heading: {
    markdownLine: "# Target heading",
    lineSelector: ".cm-line.HyperMD-header",
    text: "Target heading",
  },
  list: {
    markdownLine: "- Target list",
    lineSelector: ".cm-line.HyperMD-list-line",
    text: "Target list",
  },
};
window.__foldProbeResults = [];

window.__prepareFoldProbe = async (kind, offset) => {
  window.focus();
  if (!document.title.includes("vault") || document.title.includes("base")) {
    throw new Error(`unsafe-vault:${document.title}`);
  }
  const config = window.__foldProbeConfigs[kind];
  const editor = app.workspace.activeEditor.editor;
  const index = editor
    .getValue()
    .split("\n")
    .findIndex((value) => value === config.markdownLine);
  editor.setCursor({ line: index, ch: 0 });
  editor.scrollIntoView(
    { from: { line: index, ch: 0 }, to: { line: index, ch: 0 } },
    true,
  );
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  const find = () =>
    [...document.querySelectorAll(config.lineSelector)].find((line) =>
      line.textContent.includes(config.text),
    );
  let line = find();
  const scroller = line.closest(".cm-scroller");
  scroller.scrollTop += line.getBoundingClientRect().top - offset;
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  line = find();
  const control = line.querySelector(".collapse-indicator");
  const rect = control.getBoundingClientRect();
  window.__foldProbe = {
    kind,
    offset,
    before: {
      top: line.getBoundingClientRect().top,
      scrollTop: scroller.scrollTop,
      collapsed: line
        .querySelector(".cm-fold-indicator")
        ?.classList.contains("is-collapsed"),
    },
    point: { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 },
  };
  return window.__foldProbe.before;
};

window.__tapFoldProbe = () => {
  const { x, y } = window.__foldProbe.point;
  const debuggerApi =
    require("electron").remote.getCurrentWebContents().debugger;
  window.__tapResult = "pending";
  void debuggerApi
    .sendCommand("Input.synthesizeTapGesture", {
      x,
      y,
      duration: 120,
      tapCount: 1,
      gestureSourceType: "touch",
    })
    .then(() => (window.__tapResult = "ok"))
    .catch((error) => (window.__tapResult = `error:${error}`));
};

window.__readFoldProbe = () => {
  const config = window.__foldProbeConfigs[window.__foldProbe.kind];
  const line = [...document.querySelectorAll(config.lineSelector)].find(
    (candidate) => candidate.textContent.includes(config.text),
  );
  const scroller = document.querySelector(
    ".markdown-source-view.mod-cm6.is-live-preview .cm-scroller",
  );
  const before = window.__foldProbe.before;
  const after = line
    ? {
        top: line.getBoundingClientRect().top,
        scrollTop: scroller.scrollTop,
        collapsed: line
          .querySelector(".cm-fold-indicator")
          ?.classList.contains("is-collapsed"),
      }
    : { top: null, scrollTop: scroller.scrollTop, collapsed: null };
  const result = {
    kind: window.__foldProbe.kind,
    offset: window.__foldProbe.offset,
    tapResult: window.__tapResult,
    before,
    after,
    targetMissing: !line,
    deltaTop: line ? after.top - before.top : null,
    deltaScroll: after.scrollTop - before.scrollTop,
  };
  window.__foldProbeResults.push(result);
  return result;
};
```

- [ ] **Step 5: 3位置の fold と unfold を計測する**

見出しは100、160、400の各 offset で2回ずつ操作し、リストは160で2回操作する。

```bash
for offset in 100 160 400; do
  for operation in 1 2; do
    obsidian-cli vault=vault eval code='window.focus(); document.title'
    obsidian-cli vault=vault eval code="__prepareFoldProbe(\"heading\",$offset).then(JSON.stringify)"
    sleep 1
    obsidian-cli vault=vault eval code='(()=>{const{x,y}=__foldProbe.point;const ready=!!document.elementFromPoint(x,y)?.closest?.(".HyperMD-header .collapse-indicator");if(!ready)throw new Error("heading-target-blocked");return "target-ready"})()'
    obsidian-cli vault=vault eval code='__tapFoldProbe(); "tap-scheduled"'
    sleep 2
    obsidian-cli vault=vault eval code='JSON.stringify(__readFoldProbe())'
  done
done

for operation in 1 2; do
  obsidian-cli vault=vault eval code='window.focus(); document.title'
  obsidian-cli vault=vault eval code='__prepareFoldProbe("list",160).then(JSON.stringify)'
  sleep 1
  obsidian-cli vault=vault eval code='(()=>{const{x,y}=__foldProbe.point;const ready=!!document.elementFromPoint(x,y)?.closest?.(".HyperMD-list-line .collapse-indicator");if(!ready)throw new Error("list-target-blocked");return "target-ready"})()'
  obsidian-cli vault=vault eval code='__tapFoldProbe(); "tap-scheduled"'
  sleep 2
  obsidian-cli vault=vault eval code='JSON.stringify(__readFoldProbe())'
done

obsidian-cli vault=vault eval code='(()=>{const bad=window.__foldProbeResults.some(result=>result.tapResult!=="ok"||result.targetMissing||result.before.collapsed===result.after.collapsed||Math.abs(result.deltaTop)>1/3||Math.abs(result.deltaScroll)>1/3);return `${bad?"FAIL":"PASS"} ${JSON.stringify(window.__foldProbeResults)}`})()' | tee /tmp/obsidian-bullet-heading-scroll-results.txt | rg -q '^=> PASS '
```

Expected: Obsidian の自動非表示 view header が退避した後の実 hit target が各 native control になり、見出しの全6操作とリストの2操作で `tapResult="ok"`、`targetMissing=false`、fold 状態が反転し、`deltaTop=0`、`deltaScroll=0` になり、最後の command が exit 0 になる。

- [ ] **Step 6: manual state を削除する**

Run:

```bash
obsidian-cli vault=vault eval code='(()=>{const wc=require("electron").remote.getCurrentWebContents();if(wc.debugger.isAttached()){void wc.debugger.sendCommand("Emulation.setTouchEmulationEnabled",{enabled:false,maxTouchPoints:1});void wc.debugger.sendCommand("Emulation.clearDeviceMetricsOverride")}app.emulateMobile(false);return "cleanup-scheduled"})()'
sleep 1
obsidian-cli vault=vault eval code='(async()=>{const test=app.vault.getAbstractFileByPath("test.md");if(test)await app.workspace.getLeaf(false).openFile(test);const fixture=app.vault.getAbstractFileByPath("mobile-heading-y-jank-repro.md");if(fixture)await app.vault.delete(fixture,true);const wc=require("electron").remote.getCurrentWebContents();if(wc.debugger.isAttached())wc.debugger.detach();delete window.__foldProbeConfigs;delete window.__foldProbeResults;delete window.__prepareFoldProbe;delete window.__tapFoldProbe;delete window.__readFoldProbe;window.focus();return JSON.stringify({title:document.title,mobile:document.body.classList.contains("is-mobile"),fixture:!!app.vault.getAbstractFileByPath("mobile-heading-y-jank-repro.md")})})()'
```

Expected: title が `test - vault` を含み、`mobile=false`、`fixture=false` になる。

---

### Task 3: 全検証を通して default branch へ反映する

**Files:**

- Verify: `src/features/MobileRightFoldControls.ts`
- Verify: `src/features/__tests__/MobileRightFoldControls.test.ts`
- Verify: `AGENTS.md`
- Verify: `vault/test.md`

**Interfaces:**

- Consumes: Task 1 の implementation commit と Task 2 の実 Obsidian 計測結果。
- Produces: 全 test が通り、`origin/main` へ land された GitButler branch。

- [ ] **Step 1: full test fixture と Obsidian lock を準備する**

Run:

```bash
LOCK="$HOME/Library/Application Support/obsidian/Local Storage/leveldb/LOCK"
if lsof "$LOCK"; then exit 23; fi
backup_dir=$(mktemp -d /tmp/obsidian-bullet-heading-scroll.XXXXXX)
cp vault/test.md "$backup_dir/test.md"
shasum -a 256 vault/test.md "$backup_dir/test.md"
```

Expected: lock owner が存在せず、二つの hash が一致する。

- [ ] **Step 2: Node 22.23.1 で全検証を実行する**

Run:

```bash
npx -y -p node@22.23.1 -c 'node --version && npm run lint && npm run build-with-tests && npm test && npm run build'
```

Expected: lint、build-with-tests、全 Jest suite、production build が exit 0 になる。

- [ ] **Step 3: test renderer の終了後に fixture を復元する**

Run:

```bash
LOCK="$HOME/Library/Application Support/obsidian/Local Storage/leveldb/LOCK"
while lsof "$LOCK" >/dev/null 2>&1; do sleep 1; done
cp "$backup_dir/test.md" vault/test.md
sleep 2
test "$(shasum -a 256 "$backup_dir/test.md" | awk '{print $1}')" = "$(shasum -a 256 vault/test.md | awk '{print $1}')"
```

Expected: restore 後の hash が backup と一致する。

- [ ] **Step 4: branch と upstream を最終確認する**

Run:

```bash
but status -fv
but pull --check
but pull
```

Expected: uncommitted changes がなく、upstream conflict がない。

- [ ] **Step 5: branch を default branch へ land する**

Run:

```bash
but land codex/fix-mobile-header-fold-y-jank --yes
```

Expected: branch が `origin/main` へ反映される。
