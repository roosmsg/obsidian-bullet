import { readFileSync } from "node:fs";
import { join } from "node:path";

import { getEditorFromState, getFileFromState } from "../../editor";
import { ListMarkerInteractionGuard } from "../ListMarkerInteractionGuard";
import {
  LOGSEQ_MODE_CLASS,
  LogseqModePluginValue,
  LogseqNoteNavigator,
  extractBulletBranch,
  getBulletNoteName,
  isPathInLogseqFolder,
  normalizeLogseqFolder,
  sanitizeBulletNoteName,
} from "../LogseqMode";

jest.mock(
  "obsidian",
  () => ({
    Notice: jest.fn(),
    normalizePath: (path: string) =>
      path
        .replace(/\\/gu, "/")
        .replace(/\/{2,}/gu, "/")
        .replace(/^\/+|\/+$/gu, ""),
  }),
  { virtual: true },
);

jest.mock("../../editor", () => ({
  getEditorFromState: jest.fn(),
  getFileFromState: jest.fn(),
}));

const mockedGetEditorFromState = jest.mocked(getEditorFromState);
const mockedGetFileFromState = jest.mocked(getFileFromState);

function makeEditor(lines: string[]) {
  return {
    getLine: jest.fn((line: number) => lines[line] ?? ""),
  };
}

function makeParser(endLine: number, startLine = 0) {
  return {
    parse: jest.fn(() => ({
      getListUnderLine: () => ({
        getFirstLineContentStart: () => ({ line: startLine, ch: 2 }),
        getContentEndIncludingChildren: () => ({ line: endLine, ch: 0 }),
      }),
    })),
  };
}

function makeClassList() {
  const values = new Set<string>();
  return {
    add: jest.fn((...names: string[]) =>
      names.forEach((name) => values.add(name)),
    ),
    remove: jest.fn((...names: string[]) =>
      names.forEach((name) => values.delete(name)),
    ),
    toggle: jest.fn((name: string, force?: boolean) => {
      const enabled = force ?? !values.has(name);
      if (enabled) {
        values.add(name);
      } else {
        values.delete(name);
      }
      return enabled;
    }),
    contains: (name: string) => values.has(name),
  };
}

describe("Logseq mode path and name rules", () => {
  test.each([
    [" Bulletlist/ ", "Bulletlist"],
    ["Projects\\Bulletlist", "Projects/Bulletlist"],
    ["/Projects//Bulletlist/", "Projects/Bulletlist"],
    ["", ""],
    ["../Bulletlist", ""],
  ])("normalizes %p to %p", (value, expected) => {
    expect(normalizeLogseqFolder(value)).toBe(expected);
  });

  test("matches the configured folder recursively but not sibling prefixes", () => {
    expect(isPathInLogseqFolder("Bulletlist/Bulletlist.md", "Bulletlist")).toBe(
      true,
    );
    expect(
      isPathInLogseqFolder("Bulletlist/Task Beta/Task Beta.md", "Bulletlist"),
    ).toBe(true);
    expect(isPathInLogseqFolder("Bulletlist-old/Other.md", "Bulletlist")).toBe(
      false,
    );
    expect(isPathInLogseqFolder("Bulletlist.md", "Bulletlist")).toBe(false);
    expect(isPathInLogseqFolder("Bulletlist/Note.md", "")).toBe(false);
  });

  test.each([
    ["Task Beta", "Task Beta"],
    ["  Task   Beta  ", "Task Beta"],
    ["Task: Beta / Review?", "Task Beta Review"],
    ["CON", "_CON"],
    ["123456789012345678901234567890", "1234567890123456789012345"],
    ["😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀", "😀".repeat(25)],
    ['<>:"/\\|?*', ""],
  ])("sanitizes %p to %p", (value, expected) => {
    expect(sanitizeBulletNoteName(value)).toBe(expected);
  });

  test.each([
    ["[[Task Beta]]", "Task Beta"],
    ["[[Projects/Task Beta|Better task]]", "Better task"],
    ["[Task Beta](https://example.com/task)", "Task Beta"],
    ["**Task Beta**", "Task Beta"],
    ["`Task Beta`", "Task Beta"],
  ])("uses the visible Markdown label from %p", (value, expected) => {
    expect(getBulletNoteName(value)).toBe(expected);
  });
});

describe("extractBulletBranch", () => {
  test("copies the clicked item and every child while rebasing indentation", () => {
    const editor = makeEditor([
      "- Bulletlist",
      "  - Task Beta",
      "    - Child 1",
      "  - Sibling",
    ]);
    const parser = makeParser(2, 1);

    expect(extractBulletBranch(parser as never, editor as never, 1)).toEqual({
      name: "Task Beta",
      content: "- Task Beta\n  - Child 1\n",
    });
  });

  test("uses task text for the note name while preserving task markup", () => {
    const editor = makeEditor(["\t- [ ] Task Beta", "\t\t- Child 1"]);
    const parser = makeParser(1);

    expect(extractBulletBranch(parser as never, editor as never, 0)).toEqual({
      name: "Task Beta",
      content: "- [ ] Task Beta\n\t- Child 1\n",
    });
  });

  test("rejects empty and non-list lines", () => {
    const parser = makeParser(0);

    expect(
      extractBulletBranch(parser as never, makeEditor(["- "]) as never, 0),
    ).toBeNull();
    expect(
      extractBulletBranch(
        parser as never,
        makeEditor(["plain text"]) as never,
        0,
      ),
    ).toBeNull();
  });
});

describe("LogseqNoteNavigator", () => {
  function makeFixture() {
    const entries = new Map<
      string,
      { path: string; children?: unknown[]; extension?: string }
    >();
    entries.set("Bulletlist", { path: "Bulletlist", children: [] });
    const createFolder = jest.fn(async (path: string) => {
      const folder = { path, children: [] };
      entries.set(path, folder);
      return folder;
    });
    const create = jest.fn(async (path: string, content: string) => {
      const file = { path, extension: "md", content };
      entries.set(path, file);
      return file;
    });
    const openFile = jest.fn(async () => undefined);
    const app = {
      vault: {
        create,
        createFolder,
        getAbstractFileByPath: (path: string) => entries.get(path) ?? null,
      },
    };
    const leaf = { openFile };
    return { app, create, createFolder, entries, leaf, openFile };
  }

  test("creates the named child folder and initializes its Markdown branch", async () => {
    const fixture = makeFixture();
    const navigator = new LogseqNoteNavigator(fixture.app as never);

    await navigator.open({
      folder: "Bulletlist",
      name: "Task Beta",
      content: "- Task Beta\n  - Child 1\n",
      leaf: fixture.leaf as never,
    });

    expect(fixture.createFolder).toHaveBeenCalledWith("Bulletlist/Task Beta");
    expect(fixture.create).toHaveBeenCalledWith(
      "Bulletlist/Task Beta/Task Beta.md",
      "- Task Beta\n  - Child 1\n",
    );
    expect(fixture.openFile).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "Bulletlist/Task Beta/Task Beta.md",
      }),
    );
  });

  test("creates deeper child outlines beside the current nested file", async () => {
    const fixture = makeFixture();
    fixture.entries.set("Bulletlist/Task Beta", {
      path: "Bulletlist/Task Beta",
      children: [],
    });
    const navigator = new LogseqNoteNavigator(fixture.app as never);

    await navigator.open({
      folder: "Bulletlist/Task Beta",
      name: "Child 1",
      content: "- Child 1\n",
      leaf: fixture.leaf as never,
    });

    expect(fixture.create).toHaveBeenCalledWith(
      "Bulletlist/Task Beta/Child 1/Child 1.md",
      "- Child 1\n",
    );
  });

  test("reopens an existing note without overwriting it", async () => {
    const fixture = makeFixture();
    fixture.entries.set("Bulletlist/Task Beta", {
      path: "Bulletlist/Task Beta",
      children: [],
    });
    const existing = {
      path: "Bulletlist/Task Beta/Task Beta.md",
      extension: "md",
    };
    fixture.entries.set(existing.path, existing);
    const navigator = new LogseqNoteNavigator(fixture.app as never);

    await navigator.open({
      folder: "Bulletlist",
      name: "Task Beta",
      content: "new content must not replace the note",
      leaf: fixture.leaf as never,
    });

    expect(fixture.createFolder).not.toHaveBeenCalled();
    expect(fixture.create).not.toHaveBeenCalled();
    expect(fixture.openFile).toHaveBeenCalledWith(existing);
  });

  test("deduplicates simultaneous creation while opening each requesting leaf", async () => {
    const fixture = makeFixture();
    const secondLeaf = { openFile: jest.fn(async () => undefined) };
    const navigator = new LogseqNoteNavigator(fixture.app as never);
    const request = {
      folder: "Bulletlist",
      name: "Task Beta",
      content: "- Task Beta\n",
    };

    await Promise.all([
      navigator.open({ ...request, leaf: fixture.leaf as never }),
      navigator.open({ ...request, leaf: secondLeaf as never }),
    ]);

    expect(fixture.createFolder).toHaveBeenCalledTimes(1);
    expect(fixture.create).toHaveBeenCalledTimes(1);
    expect(fixture.openFile).toHaveBeenCalledTimes(1);
    expect(secondLeaf.openFile).toHaveBeenCalledTimes(1);
  });
});

describe("LogseqModePluginValue", () => {
  function makeFixture(filePath = "Bulletlist/Bulletlist.md") {
    const listeners = new Map<string, (event: MouseEvent) => void>();
    const classList = makeClassList();
    const lineElement = {};
    const bullet: { closest: jest.Mock<unknown, [string]> } = {
      closest: jest.fn((selector: string): unknown => {
        if (selector === ".list-bullet") {
          return bullet;
        }
        if (selector === ".cm-line") {
          return lineElement;
        }
        return null;
      }),
    };
    const contentDOM = {
      addEventListener: jest.fn(
        (eventName: string, listener: (event: MouseEvent) => void) => {
          listeners.set(eventName, listener);
        },
      ),
      contains: jest.fn(() => true),
      removeEventListener: jest.fn(),
    };
    const state = {
      doc: { lineAt: jest.fn(() => ({ number: 2 })) },
    };
    const view = {
      contentDOM,
      dom: { classList },
      posAtDOM: jest.fn(() => 10),
      state,
    };
    const leaf = {
      openFile: jest.fn(),
      view: {
        containerEl: { contains: () => true },
      },
    };
    const app = {
      workspace: {
        getLeaf: jest.fn(() => leaf),
        getLeavesOfType: jest.fn(() => [leaf]),
      },
    };
    const callbacks: Array<() => void> = [];
    const settings = {
      logseqFolder: "Bulletlist",
      onChange: jest.fn((_keys: unknown, callback: () => void) =>
        callbacks.push(callback),
      ),
      removeCallback: jest.fn(),
    };
    const parser = makeParser(2, 1);
    const editor = makeEditor([
      "- Bulletlist",
      "  - Task Beta",
      "    - Child 1",
    ]);
    const navigator = { open: jest.fn(async () => undefined) };
    const guard = new ListMarkerInteractionGuard();
    const file = {
      path: filePath,
      parent: { path: filePath.slice(0, filePath.lastIndexOf("/")) },
    };
    mockedGetFileFromState.mockReturnValue(file as never);
    mockedGetEditorFromState.mockReturnValue(editor as never);
    const pluginValue = new LogseqModePluginValue(
      app as never,
      settings as never,
      parser as never,
      navigator as never,
      guard,
      view as never,
    );
    const event = {
      altKey: false,
      button: 0,
      ctrlKey: false,
      metaKey: false,
      preventDefault: jest.fn(),
      shiftKey: false,
      stopImmediatePropagation: jest.fn(),
      stopPropagation: jest.fn(),
      target: bullet,
    };
    return {
      bullet,
      callbacks,
      classList,
      contentDOM,
      event,
      file,
      guard,
      leaf,
      listeners,
      navigator,
      pluginValue,
      settings,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("scopes hover styling and click navigation to the configured folder", async () => {
    const fixture = makeFixture();

    expect(fixture.classList.contains(LOGSEQ_MODE_CLASS)).toBe(true);
    fixture.listeners.get("click")?.(fixture.event as unknown as MouseEvent);
    await Promise.resolve();

    expect(fixture.event.preventDefault).toHaveBeenCalled();
    expect(fixture.event.stopImmediatePropagation).toHaveBeenCalled();
    expect(fixture.navigator.open).toHaveBeenCalledWith({
      folder: "Bulletlist",
      name: "Task Beta",
      content: "- Task Beta\n  - Child 1\n",
      leaf: fixture.leaf,
    });
  });

  test("uses the current nested file folder for the next child outline", async () => {
    const fixture = makeFixture("Bulletlist/Task Beta/Task Beta.md");

    fixture.listeners.get("click")?.(fixture.event as unknown as MouseEvent);
    await Promise.resolve();

    expect(fixture.navigator.open).toHaveBeenCalledWith(
      expect.objectContaining({ folder: "Bulletlist/Task Beta" }),
    );
  });

  test("does nothing for a sibling folder with the same prefix", async () => {
    const fixture = makeFixture("Bulletlist-old/Note.md");

    expect(fixture.classList.contains(LOGSEQ_MODE_CLASS)).toBe(false);
    fixture.listeners.get("click")?.(fixture.event as unknown as MouseEvent);
    await Promise.resolve();

    expect(fixture.navigator.open).not.toHaveBeenCalled();
    expect(fixture.event.preventDefault).not.toHaveBeenCalled();
  });

  test("suppresses the click emitted after a real bullet drag", async () => {
    const fixture = makeFixture();
    fixture.guard.beginPointerInteraction();
    fixture.guard.markDragStarted();

    fixture.listeners.get("click")?.(fixture.event as unknown as MouseEvent);
    await Promise.resolve();

    expect(fixture.event.preventDefault).toHaveBeenCalled();
    expect(fixture.navigator.open).not.toHaveBeenCalled();
  });

  test("updates scope with settings and removes listeners on destroy", () => {
    const fixture = makeFixture();
    fixture.settings.logseqFolder = "Other";
    fixture.callbacks[0]?.();

    expect(fixture.classList.contains(LOGSEQ_MODE_CLASS)).toBe(false);
    fixture.pluginValue.destroy();

    expect(fixture.contentDOM.removeEventListener).toHaveBeenCalledWith(
      "mousedown",
      expect.any(Function),
      true,
    );
    expect(fixture.contentDOM.removeEventListener).toHaveBeenCalledWith(
      "click",
      expect.any(Function),
      true,
    );
    expect(fixture.settings.removeCallback).toHaveBeenCalledWith(
      expect.any(Function),
    );
  });
});

test("styles clickable bullets only in a scoped editor and outside drag state", () => {
  const styles = readFileSync(join(__dirname, "../../../styles.css"), "utf8");

  expect(styles).toMatch(
    /body:not\(\.bullet-plugin-dragging\)[\s\S]*?\.cm-editor\.bullet-plugin-logseq-mode[\s\S]*?\.list-bullet\s*\{[\s\S]*?cursor:\s*pointer;/,
  );
  expect(styles).toMatch(
    /\.cm-editor\.bullet-plugin-logseq-mode[\s\S]*?\.list-bullet:hover::after\s*\{[\s\S]*?background-color:\s*var\(--interactive-accent\);[\s\S]*?transform:\s*scale\(1\.35\);/,
  );
});
