import { MarkdownView } from "obsidian";

import { Parser } from "../../services/Parser";
import {
  LogseqSyncService,
  buildLogseqProjection,
  collectLineEdits,
  getTrailingBlockIdOffset,
  mergeOutlineEdits,
  normalizeNoteLines,
  stripLogseqSyncId,
} from "../LogseqSync";

jest.mock(
  "obsidian",
  () => ({
    MarkdownView: class MarkdownView {},
    Notice: jest.fn(),
    normalizePath: (path: string) =>
      path
        .replace(/\\/gu, "/")
        .replace(/\/{2,}/gu, "/")
        .replace(/^\/+|\/+$/gu, ""),
  }),
  { virtual: true },
);

const getName = (value: string) =>
  value
    .replace(/[\t ]+%%bullet-sync:[a-z0-9_-]+%%/giu, "")
    .replace(/[\t ]+\^[\p{L}\p{N}_-]+[\t ]*$/u, "")
    .replace(/^\[(?: |x|X)\]\s*/u, "")
    .trim();

function makeParser() {
  return new Parser(
    { bind: () => () => undefined } as never,
    { keepCursorWithinContent: "bullet-and-checkbox" } as never,
  );
}

describe("stripLogseqSyncId", () => {
  test("removes legacy hidden markers but keeps native block IDs", () => {
    expect(stripLogseqSyncId("- Task %%bullet-sync:abc%%")).toBe("- Task");
    expect(stripLogseqSyncId("- Task %%bullet-sync:abc%% ^ref")).toBe(
      "- Task ^ref",
    );
    expect(stripLogseqSyncId("- Task ^ref")).toBe("- Task ^ref");
  });
});

describe("normalizeNoteLines", () => {
  test("adopts top-level lines as children of the note bullet", () => {
    expect(
      normalizeNoteLines(
        ["- Note ^id", "  - a", "- typed", "plain text", ""],
        "  ",
      ),
    ).toEqual(["- Note ^id", "  - a", "  - typed", "  plain text", ""]);
  });

  test("leaves already indented lines and the first line alone", () => {
    expect(
      normalizeNoteLines(["- Note ^id", "\t- child", "  detail"], "\t"),
    ).toEqual(["- Note ^id", "\t- child", "  detail"]);
  });
});

describe("getTrailingBlockIdOffset", () => {
  test("locates the concealable range of a trailing block ID", () => {
    expect(getTrailingBlockIdOffset("- Task ^abc123")).toBe(6);
    expect(getTrailingBlockIdOffset("  - Task\t^abc123  ")).toBe(8);
  });

  test("ignores lines without a trailing block ID", () => {
    expect(getTrailingBlockIdOffset("- Task")).toBeNull();
    expect(getTrailingBlockIdOffset("- Task ^abc and more")).toBeNull();
    expect(getTrailingBlockIdOffset("")).toBeNull();
  });
});

describe("mergeOutlineEdits", () => {
  const base = ["- Project", "  - Alpha", "  - Beta", "  - Gamma"];

  test("applies non-conflicting edits from every source", () => {
    const older = collectLineEdits(base, [
      "- Project",
      "  - Alpha edited",
      "  - Beta",
      "  - Gamma",
    ]);
    const newer = collectLineEdits(base, [
      "- Project",
      "  - Alpha",
      "  - Beta",
      "  - Gamma edited",
    ]);

    expect(
      mergeOutlineEdits(base, [
        { edits: older, mtime: 1 },
        { edits: newer, mtime: 2 },
      ]),
    ).toEqual({
      conflicts: 0,
      lines: ["- Project", "  - Alpha edited", "  - Beta", "  - Gamma edited"],
    });
  });

  test("keeps the newest source when both edit the same line", () => {
    const older = collectLineEdits(base, [
      "- Project",
      "  - Alpha from older",
      "  - Beta",
      "  - Gamma",
    ]);
    const newer = collectLineEdits(base, [
      "- Project",
      "  - Alpha from newer",
      "  - Beta",
      "  - Gamma",
    ]);

    const forward = mergeOutlineEdits(base, [
      { edits: older, mtime: 1 },
      { edits: newer, mtime: 2 },
    ]);
    expect(forward.conflicts).toBe(1);
    expect(forward.lines[1]).toBe("  - Alpha from newer");

    const backward = mergeOutlineEdits(base, [
      { edits: newer, mtime: 5 },
      { edits: older, mtime: 4 },
    ]);
    expect(backward.conflicts).toBe(1);
    expect(backward.lines[1]).toBe("  - Alpha from newer");
  });

  test("deduplicates identical edits without counting conflicts", () => {
    const target = ["- Project", "  - Alpha same", "  - Beta", "  - Gamma"];

    expect(
      mergeOutlineEdits(base, [
        { edits: collectLineEdits(base, target), mtime: 1 },
        { edits: collectLineEdits(base, target), mtime: 2 },
      ]),
    ).toEqual({
      conflicts: 0,
      lines: target,
    });
  });

  test("absorbs an insertion that another source already contains", () => {
    const insertOne = [{ end: 4, lines: ["  - Delta"], start: 4 }];
    const insertBoth = [
      { end: 4, lines: ["  - Delta", "  - Epsilon"], start: 4 },
    ];

    expect(
      mergeOutlineEdits(base, [
        { edits: insertOne, mtime: 1 },
        { edits: insertBoth, mtime: 2 },
      ]),
    ).toEqual({
      conflicts: 0,
      lines: [...base, "  - Delta", "  - Epsilon"],
    });
    expect(
      mergeOutlineEdits(base, [
        { edits: insertBoth, mtime: 1 },
        { edits: insertOne, mtime: 2 },
      ]),
    ).toEqual({
      conflicts: 0,
      lines: [...base, "  - Delta", "  - Epsilon"],
    });
  });
});

describe("buildLogseqProjection", () => {
  const content = [
    "- Bulletlist",
    "  - Project ^project",
    "    - [ ] Child ^child",
    "      - Grandchild ^grandchild",
    "        detail",
    "  - Loose bullet",
    "  - Reference target ^userref",
    "",
  ].join("\n");

  test("projects only connected bullets and keeps their identities", () => {
    const result = buildLogseqProjection(
      makeParser(),
      content,
      "Bulletlist",
      getName,
      new Set(["project", "child"]),
    );

    expect(result.error).toBeUndefined();
    expect(
      result.projection?.nodes.map((node) => ({
        content: node.content,
        id: node.id,
        path: node.filePath,
      })),
    ).toEqual([
      {
        content:
          "- Project ^project\n  - [ ] Child ^child\n    - Grandchild ^grandchild\n      detail\n",
        id: "project",
        path: "Bulletlist/Project/Project.md",
      },
      {
        content: "- [ ] Child ^child\n  - Grandchild ^grandchild\n    detail\n",
        id: "child",
        path: "Bulletlist/Project/Child/Child.md",
      },
    ]);
  });

  test("ignores bullets without notes and unrelated user block IDs", () => {
    const result = buildLogseqProjection(
      makeParser(),
      content,
      "Bulletlist",
      getName,
      new Set(["project"]),
    );

    expect(result.projection?.nodes).toHaveLength(1);
    expect(result.projection?.byId.has("userref")).toBe(false);
  });

  test("rejects two connected bullets that resolve to the same file", () => {
    const duplicate = [
      "- Bulletlist",
      "  - Project ^first",
      "  - Project ^second",
      "",
    ].join("\n");

    expect(
      buildLogseqProjection(
        makeParser(),
        duplicate,
        "Bulletlist",
        getName,
        new Set(["first", "second"]),
      ),
    ).toEqual({
      error:
        "Multiple connected bullets resolve to Bulletlist/Project/Project.md.",
    });
  });

  test("allows duplicate paths among unconnected bullets", () => {
    const duplicate = [
      "- Bulletlist",
      "  - Project ^first",
      "  - Project",
      "",
    ].join("\n");

    const result = buildLogseqProjection(
      makeParser(),
      duplicate,
      "Bulletlist",
      getName,
      new Set(["first"]),
    );
    expect(result.error).toBeUndefined();
    expect(result.projection?.nodes).toHaveLength(1);
  });
});

interface FakeFile {
  content: string;
  extension: string;
  path: string;
  stat: { ctime: number; mtime: number };
}

interface FakeFolder {
  children: Array<FakeFile | FakeFolder>;
  path: string;
}

function isFakeFolder(entry: FakeFile | FakeFolder): entry is FakeFolder {
  return "children" in entry;
}

function makeSyncFixture(rootContent: string) {
  const entries = new Map<string, FakeFile | FakeFolder>();
  const trashedPaths: string[] = [];
  let nextTimestamp = 1;
  let nextGeneratedId = 0;
  let syncState: unknown;

  const rebuildChildren = () => {
    for (const entry of entries.values()) {
      if (isFakeFolder(entry)) {
        entry.children = [];
      }
    }
    for (const entry of entries.values()) {
      const separator = entry.path.lastIndexOf("/");
      if (separator < 0) {
        continue;
      }
      const parent = entries.get(entry.path.slice(0, separator));
      if (parent && isFakeFolder(parent)) {
        parent.children.push(entry);
      }
    }
  };

  const addFolder = (path: string) => {
    const existing = entries.get(path);
    if (existing && isFakeFolder(existing)) {
      return existing;
    }
    const separator = path.lastIndexOf("/");
    if (separator >= 0) {
      addFolder(path.slice(0, separator));
    }
    const folder: FakeFolder = { children: [], path };
    entries.set(path, folder);
    rebuildChildren();
    return folder;
  };

  const addFile = (path: string, content: string) => {
    const separator = path.lastIndexOf("/");
    if (separator >= 0) {
      addFolder(path.slice(0, separator));
    }
    const timestamp = nextTimestamp++;
    const file: FakeFile = {
      content,
      extension: "md",
      path,
      stat: { ctime: timestamp, mtime: timestamp },
    };
    entries.set(path, file);
    rebuildChildren();
    return file;
  };

  const updateFile = (path: string, content: string) => {
    const file = entries.get(path);
    if (!file || isFakeFolder(file)) {
      throw new Error(`Expected a file at ${path}`);
    }
    file.content = content;
    file.stat.mtime = nextTimestamp++;
    return file;
  };

  const removeEntry = (path: string) => {
    for (const candidate of [...entries.keys()]) {
      if (candidate === path || candidate.startsWith(`${path}/`)) {
        entries.delete(candidate);
      }
    }
    rebuildChildren();
  };

  const rename = jest.fn(
    async (entry: FakeFile | FakeFolder, newPath: string) => {
      const oldPath = entry.path;
      const affected = [...entries.entries()].filter(
        ([path]) => path === oldPath || path.startsWith(`${oldPath}/`),
      );
      affected.forEach(([path]) => entries.delete(path));
      affected.forEach(([path, child]) => {
        child.path = `${newPath}${path.slice(oldPath.length)}`;
        entries.set(child.path, child);
      });
      rebuildChildren();
    },
  );

  const process = jest.fn(
    async (file: FakeFile, update: (data: string) => string) => {
      const content = update(file.content);
      if (content !== file.content) {
        file.content = content;
        file.stat.mtime = nextTimestamp++;
      }
      return file.content;
    },
  );
  const trash = jest.fn(async (entry: FakeFile | FakeFolder) => {
    trashedPaths.push(entry.path);
    for (const path of [...entries.keys()]) {
      if (path === entry.path || path.startsWith(`${entry.path}/`)) {
        entries.delete(path);
      }
    }
    rebuildChildren();
  });

  const openLeaves: Array<{ view: unknown }> = [];
  const openInEditor = (path: string) => {
    const file = entries.get(path);
    if (!file || isFakeFolder(file)) {
      throw new Error(`Expected a file at ${path}`);
    }
    const posToOffset = (position: { ch: number; line: number }) => {
      const lines = file.content.split("\n");
      let offset = 0;
      for (let line = 0; line < position.line; line++) {
        offset += (lines[line] ?? "").length + 1;
      }
      return offset + position.ch;
    };
    const editor = {
      getValue: () => file.content,
      offsetToPos: (offset: number) => {
        const before = file.content.slice(0, offset).split("\n");
        return {
          ch: before[before.length - 1].length,
          line: before.length - 1,
        };
      },
      replaceRange: jest.fn(
        (
          text: string,
          from: { ch: number; line: number },
          to: { ch: number; line: number },
        ) => {
          const start = posToOffset(from);
          const end = posToOffset(to);
          file.content =
            file.content.slice(0, start) + text + file.content.slice(end);
          file.stat.mtime = nextTimestamp++;
        },
      ),
    };
    openLeaves.push({
      view: Object.assign(
        Object.create(MarkdownView.prototype) as MarkdownView,
        { editor, file: { path } },
      ),
    });
    return editor;
  };

  addFile("Bulletlist/Bulletlist.md", rootContent);
  const vault = {
    createFolder: jest.fn(async (path: string) => addFolder(path)),
    getAbstractFileByPath: (path: string) => entries.get(path) ?? null,
    on: jest.fn(() => ({})),
    process,
    read: jest.fn(async (file: FakeFile) => file.content),
    trash,
  };
  const plugin = {
    app: {
      fileManager: { renameFile: rename },
      vault,
      workspace: { getLeavesOfType: jest.fn(() => openLeaves) },
    },
    registerEvent: jest.fn(),
  };
  const settings = {
    getLogseqSyncState: () => syncState,
    logseqFolder: "Bulletlist",
    onChange: jest.fn(),
    removeCallback: jest.fn(),
    saveLogseqSyncState: jest.fn(async (state: unknown) => {
      syncState = structuredClone(state);
    }),
  };
  const makeService = () =>
    new LogseqSyncService(
      plugin as never,
      settings as never,
      makeParser(),
      (folder) => folder,
      getName,
      () => `gen${(nextGeneratedId++).toString(36).padStart(3, "0")}`,
    );
  const service = makeService();

  return {
    addFile,
    entries,
    getFile: (path: string) => entries.get(path) as FakeFile | undefined,
    getState: () =>
      syncState as { notes?: Record<string, unknown> } | undefined,
    makeService,
    openInEditor,
    process,
    removeEntry,
    rename,
    service,
    trash,
    trashedPaths,
    updateFile,
    get root() {
      return entries.get("Bulletlist/Bulletlist.md") as FakeFile;
    },
    updateRoot: (content: string) =>
      updateFile("Bulletlist/Bulletlist.md", content),
  };
}

describe("LogseqSyncService", () => {
  const initialRoot = [
    "- Bulletlist",
    "  - Project ^project",
    "    - [ ] Child ^child",
    "      - Grandchild old ^grandchild",
    "",
  ].join("\n");

  beforeAll(() => {
    Object.defineProperty(global, "window", {
      configurable: true,
      value: {
        clearTimeout: jest.fn(),
        crypto: {
          getRandomValues: (bytes: Uint8Array) => bytes.fill(1),
          randomUUID: () => "00000000-0000-4000-8000-000000000001",
        },
        setTimeout: jest.fn(() => 1),
      },
    });
  });

  afterAll(() => {
    Reflect.deleteProperty(global, "window");
  });

  async function makeAdoptedFixture() {
    const fixture = makeSyncFixture(initialRoot);
    fixture.addFile(
      "Bulletlist/Project/Project.md",
      "- Project\n  - [ ] Child\n    - Grandchild old\n",
    );
    fixture.addFile(
      "Bulletlist/Project/Child/Child.md",
      "- [ ] Child\n  - Grandchild old\n",
    );
    fixture.addFile(
      "Bulletlist/Project/Child/Grandchild old/Grandchild old.md",
      "- Grandchild old\n",
    );
    await fixture.service.synchronizeNow();
    fixture.process.mockClear();
    fixture.rename.mockClear();
    return fixture;
  }

  test("adopts existing notes by path and normalizes them with identities", async () => {
    const fixture = await makeAdoptedFixture();

    expect(fixture.root.content).toBe(initialRoot);
    expect(fixture.getFile("Bulletlist/Project/Project.md")?.content).toBe(
      "- Project ^project\n  - [ ] Child ^child\n    - Grandchild old ^grandchild\n",
    );
    expect(fixture.getFile("Bulletlist/Project/Child/Child.md")?.content).toBe(
      "- [ ] Child ^child\n  - Grandchild old ^grandchild\n",
    );
    expect(
      fixture.getFile(
        "Bulletlist/Project/Child/Grandchild old/Grandchild old.md",
      )?.content,
    ).toBe("- Grandchild old ^grandchild\n");
    expect(Object.keys(fixture.getState()?.notes ?? {}).sort()).toEqual([
      "child",
      "grandchild",
      "project",
    ]);
  });

  test("strips legacy hidden markers when adopting a v2 vault", async () => {
    const fixture = makeSyncFixture(
      ["- Bulletlist", "  - Project %%bullet-sync:0123456789abcdef%%", ""].join(
        "\n",
      ),
    );
    fixture.addFile("Bulletlist/Project/Project.md", "- Project\n");

    await fixture.service.synchronizeNow();

    expect(fixture.root.content).toBe(
      ["- Bulletlist", "  - Project ^gen000", ""].join("\n"),
    );
    expect(fixture.getFile("Bulletlist/Project/Project.md")?.content).toBe(
      "- Project ^gen000\n",
    );
  });

  test("propagates a root edit into every overlapping mirror", async () => {
    const fixture = await makeAdoptedFixture();

    fixture.updateRoot(initialRoot.replace("[ ] Child", "[x] Child"));
    await fixture.service.synchronizeNow();

    expect(fixture.getFile("Bulletlist/Project/Project.md")?.content).toBe(
      "- Project ^project\n  - [x] Child ^child\n    - Grandchild old ^grandchild\n",
    );
    expect(fixture.getFile("Bulletlist/Project/Child/Child.md")?.content).toBe(
      "- [x] Child ^child\n  - Grandchild old ^grandchild\n",
    );
    expect(fixture.trash).not.toHaveBeenCalled();
  });

  test("propagates a child-note edit up to the root and across mirrors", async () => {
    const fixture = await makeAdoptedFixture();

    fixture.updateFile(
      "Bulletlist/Project/Child/Child.md",
      "- [x] Child ^child\n  - Grandchild old ^grandchild\n",
    );
    await fixture.service.synchronizeNow();

    expect(fixture.root.content).toBe(
      initialRoot.replace("[ ] Child", "[x] Child"),
    );
    expect(fixture.getFile("Bulletlist/Project/Project.md")?.content).toBe(
      "- Project ^project\n  - [x] Child ^child\n    - Grandchild old ^grandchild\n",
    );
  });

  test("keeps the ready-to-type scratch bullet out of the outline", async () => {
    const fixture = await makeAdoptedFixture();

    fixture.updateFile(
      "Bulletlist/Project/Child/Child.md",
      "- [ ] Child ^child\n  - Grandchild old ^grandchild\n  - \n",
    );
    await fixture.service.synchronizeNow();

    expect(fixture.root.content).toBe(initialRoot);
    expect(fixture.getFile("Bulletlist/Project/Project.md")?.content).toBe(
      "- Project ^project\n  - [ ] Child ^child\n    - Grandchild old ^grandchild\n",
    );
    expect(fixture.getFile("Bulletlist/Project/Child/Child.md")?.content).toBe(
      "- [ ] Child ^child\n  - Grandchild old ^grandchild\n  - \n",
    );
  });

  test("preserves a note's scratch bullet while applying root edits", async () => {
    const fixture = await makeAdoptedFixture();

    fixture.updateFile(
      "Bulletlist/Project/Child/Child.md",
      "- [ ] Child ^child\n  - Grandchild old ^grandchild\n  - \n",
    );
    await fixture.service.synchronizeNow();

    fixture.updateRoot(initialRoot.replace("[ ] Child", "[x] Child"));
    await fixture.service.synchronizeNow();

    expect(fixture.getFile("Bulletlist/Project/Child/Child.md")?.content).toBe(
      "- [x] Child ^child\n  - Grandchild old ^grandchild\n  - \n",
    );
  });

  test("synchronizes a scratch bullet once it gains content", async () => {
    const fixture = await makeAdoptedFixture();

    fixture.updateFile(
      "Bulletlist/Project/Child/Child.md",
      "- [ ] Child ^child\n  - Grandchild old ^grandchild\n  - \n",
    );
    await fixture.service.synchronizeNow();

    fixture.updateFile(
      "Bulletlist/Project/Child/Child.md",
      "- [ ] Child ^child\n  - Grandchild old ^grandchild\n  - Now real\n",
    );
    await fixture.service.synchronizeNow();

    expect(fixture.root.content).toBe(
      [
        "- Bulletlist",
        "  - Project ^project",
        "    - [ ] Child ^child",
        "      - Grandchild old ^grandchild",
        "      - Now real",
        "",
      ].join("\n"),
    );
  });

  test("keeps the root file's own scratch bullet out of the mirrors", async () => {
    const fixture = await makeAdoptedFixture();

    fixture.updateRoot(`${initialRoot.slice(0, -1)}      - \n`);
    await fixture.service.synchronizeNow();

    expect(
      fixture.getFile(
        "Bulletlist/Project/Child/Grandchild old/Grandchild old.md",
      )?.content,
    ).toBe("- Grandchild old ^grandchild\n");
    expect(fixture.root.content).toBe(`${initialRoot.slice(0, -1)}      - \n`);
  });

  test("adopts a same-level bullet typed in a child note as a child of its bullet", async () => {
    const fixture = await makeAdoptedFixture();

    fixture.updateFile(
      "Bulletlist/Project/Child/Child.md",
      "- [ ] Child ^child\n  - Grandchild old ^grandchild\n- Just edited\n",
    );
    await fixture.service.synchronizeNow();

    expect(fixture.root.content).toBe(
      [
        "- Bulletlist",
        "  - Project ^project",
        "    - [ ] Child ^child",
        "      - Grandchild old ^grandchild",
        "      - Just edited",
        "",
      ].join("\n"),
    );
    expect(fixture.getFile("Bulletlist/Project/Child/Child.md")?.content).toBe(
      "- [ ] Child ^child\n  - Grandchild old ^grandchild\n  - Just edited\n",
    );
    expect(fixture.getFile("Bulletlist/Project/Project.md")?.content).toBe(
      "- Project ^project\n  - [ ] Child ^child\n    - Grandchild old ^grandchild\n    - Just edited\n",
    );
    expect(fixture.entries.has("Bulletlist/Project/Just edited")).toBe(false);
    expect(fixture.trash).not.toHaveBeenCalled();
  });

  test("adopts a top-level line in a leaf note as its first child", async () => {
    const fixture = await makeAdoptedFixture();

    fixture.updateFile(
      "Bulletlist/Project/Child/Grandchild old/Grandchild old.md",
      "- Grandchild old ^grandchild\n- New under\n",
    );
    await fixture.service.synchronizeNow();

    expect(fixture.root.content).toBe(
      [
        "- Bulletlist",
        "  - Project ^project",
        "    - [ ] Child ^child",
        "      - Grandchild old ^grandchild",
        "        - New under",
        "",
      ].join("\n"),
    );
    expect(
      fixture.getFile(
        "Bulletlist/Project/Child/Grandchild old/Grandchild old.md",
      )?.content,
    ).toBe("- Grandchild old ^grandchild\n  - New under\n");
  });

  test("updates an open note through its editor instead of the vault", async () => {
    const fixture = await makeAdoptedFixture();
    const editor = fixture.openInEditor("Bulletlist/Project/Child/Child.md");
    fixture.process.mockClear();

    fixture.updateRoot(initialRoot.replace("[ ] Child", "[x] Child"));
    await fixture.service.synchronizeNow();

    expect(fixture.getFile("Bulletlist/Project/Child/Child.md")?.content).toBe(
      "- [x] Child ^child\n  - Grandchild old ^grandchild\n",
    );
    expect(editor.replaceRange).toHaveBeenCalledTimes(1);
    expect(
      fixture.process.mock.calls.some(
        ([target]) =>
          (target as { path?: string }).path ===
          "Bulletlist/Project/Child/Child.md",
      ),
    ).toBe(false);
  });

  test("adds a bullet typed inside a child note to the root as a plain bullet", async () => {
    const fixture = await makeAdoptedFixture();

    fixture.updateFile(
      "Bulletlist/Project/Project.md",
      "- Project ^project\n  - [ ] Child ^child\n    - Grandchild old ^grandchild\n  - New idea\n",
    );
    await fixture.service.synchronizeNow();

    expect(fixture.root.content).toBe(
      [
        "- Bulletlist",
        "  - Project ^project",
        "    - [ ] Child ^child",
        "      - Grandchild old ^grandchild",
        "    - New idea",
        "",
      ].join("\n"),
    );
  });

  test("renaming a bullet inside a child note moves the connected note", async () => {
    const fixture = await makeAdoptedFixture();

    fixture.updateFile(
      "Bulletlist/Project/Child/Child.md",
      "- [ ] Child ^child\n  - Grandchild new ^grandchild\n",
    );
    await fixture.service.synchronizeNow();

    expect(fixture.root.content).toBe(
      initialRoot.replace("Grandchild old", "Grandchild new"),
    );
    expect(
      fixture.getFile(
        "Bulletlist/Project/Child/Grandchild new/Grandchild new.md",
      )?.content,
    ).toBe("- Grandchild new ^grandchild\n");
    expect(
      fixture.entries.has(
        "Bulletlist/Project/Child/Grandchild old/Grandchild old.md",
      ),
    ).toBe(false);
    expect(fixture.trash).not.toHaveBeenCalled();
  });

  test("keeps the newest side when the root and a note edit the same line", async () => {
    const fixture = await makeAdoptedFixture();

    fixture.updateRoot(
      initialRoot.replace("Grandchild old", "Grandchild from root"),
    );
    fixture.updateFile(
      "Bulletlist/Project/Child/Child.md",
      "- [ ] Child ^child\n  - Grandchild from note ^grandchild\n",
    );
    await fixture.service.synchronizeNow();

    expect(fixture.root.content).toBe(
      initialRoot.replace("Grandchild old", "Grandchild from note"),
    );
    expect(fixture.trash).not.toHaveBeenCalled();
  });

  test("lets a newer root edit win over an older note edit", async () => {
    const fixture = await makeAdoptedFixture();

    fixture.updateFile(
      "Bulletlist/Project/Child/Child.md",
      "- [ ] Child ^child\n  - Grandchild from note ^grandchild\n",
    );
    fixture.updateRoot(
      initialRoot.replace("Grandchild old", "Grandchild from root"),
    );
    await fixture.service.synchronizeNow();

    expect(fixture.root.content).toBe(
      initialRoot.replace("Grandchild old", "Grandchild from root"),
    );
    expect(fixture.getFile("Bulletlist/Project/Child/Child.md")?.content).toBe(
      "- [ ] Child ^child\n  - Grandchild from root ^grandchild\n",
    );
  });

  test("moves connected notes when their bullets are cut and pasted elsewhere", async () => {
    const fixture = await makeAdoptedFixture();

    fixture.updateRoot(
      [
        "- Bulletlist",
        "  - Project ^project",
        "  - Other",
        "    - [ ] Child ^child",
        "      - Grandchild old ^grandchild",
        "",
      ].join("\n"),
    );
    await fixture.service.synchronizeNow();

    expect(fixture.getFile("Bulletlist/Other/Child/Child.md")?.content).toBe(
      "- [ ] Child ^child\n  - Grandchild old ^grandchild\n",
    );
    expect(fixture.entries.has("Bulletlist/Project/Child/Child.md")).toBe(
      false,
    );
    expect(fixture.getFile("Bulletlist/Project/Project.md")?.content).toBe(
      "- Project ^project\n",
    );
    expect(fixture.trash).not.toHaveBeenCalled();
  });

  test("connects a freshly created note by stamping its bullet", async () => {
    const fixture = makeSyncFixture(
      ["- Bulletlist", "  - Task Beta", ""].join("\n"),
    );
    await fixture.service.synchronizeNow();

    fixture.addFile("Bulletlist/Task Beta/Task Beta.md", "- Task Beta\n");
    await fixture.service.synchronizeNow();

    expect(fixture.root.content).toBe(
      ["- Bulletlist", "  - Task Beta ^gen000", ""].join("\n"),
    );
    expect(fixture.getFile("Bulletlist/Task Beta/Task Beta.md")?.content).toBe(
      "- Task Beta ^gen000\n",
    );
    expect(Object.keys(fixture.getState()?.notes ?? {})).toEqual(["gen000"]);
  });

  test("releases a copied identity instead of pausing synchronization", async () => {
    const fixture = await makeAdoptedFixture();

    fixture.updateRoot(
      [
        "- Bulletlist",
        "  - Project ^project",
        "    - [ ] Child ^child",
        "      - Grandchild old ^grandchild",
        "  - Project copy ^project",
        "",
      ].join("\n"),
    );
    await fixture.service.synchronizeNow();

    expect(fixture.root.content).toBe(
      [
        "- Bulletlist",
        "  - Project ^project",
        "    - [ ] Child ^child",
        "      - Grandchild old ^grandchild",
        "  - Project copy",
        "",
      ].join("\n"),
    );
    expect(fixture.getFile("Bulletlist/Project/Project.md")?.content).toBe(
      "- Project ^project\n  - [ ] Child ^child\n    - Grandchild old ^grandchild\n",
    );
  });

  test("restores an identity whose marker was deleted while the bullet stayed", async () => {
    const fixture = await makeAdoptedFixture();

    fixture.updateRoot(initialRoot.replace(" ^child", ""));
    await fixture.service.synchronizeNow();

    expect(fixture.root.content).toBe(initialRoot);
    expect(fixture.getState()?.notes).toHaveProperty(["child"]);
    expect(fixture.trash).not.toHaveBeenCalled();
  });

  test("follows a user-replaced block ID instead of deleting the note", async () => {
    const fixture = await makeAdoptedFixture();

    fixture.updateRoot(initialRoot.replace(" ^child", " ^myref"));
    await fixture.service.synchronizeNow();

    expect(fixture.root.content).toBe(
      initialRoot.replace(" ^child", " ^myref"),
    );
    expect(fixture.getState()?.notes).toHaveProperty(["myref"]);
    expect(fixture.getState()?.notes).not.toHaveProperty(["child"]);
    expect(fixture.getFile("Bulletlist/Project/Child/Child.md")?.content).toBe(
      "- [ ] Child ^myref\n  - Grandchild old ^grandchild\n",
    );
    expect(fixture.trash).not.toHaveBeenCalled();
  });

  test("trashes the notes of a branch deleted inside a child note", async () => {
    const fixture = await makeAdoptedFixture();
    const now = Date.now();
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(now);

    try {
      fixture.updateFile(
        "Bulletlist/Project/Child/Child.md",
        "- [ ] Child ^child\n",
      );
      await fixture.service.synchronizeNow();

      expect(fixture.root.content).toBe(
        [
          "- Bulletlist",
          "  - Project ^project",
          "    - [ ] Child ^child",
          "",
        ].join("\n"),
      );
      expect(
        fixture.entries.has(
          "Bulletlist/Project/Child/Grandchild old/Grandchild old.md",
        ),
      ).toBe(true);

      nowSpy.mockReturnValue(now + 30_001);
      await fixture.service.confirmPendingDeletionsNow();

      expect(fixture.trashedPaths).toContain(
        "Bulletlist/Project/Child/Grandchild old/Grandchild old.md",
      );
      expect(
        fixture.entries.has("Bulletlist/Project/Child/Grandchild old"),
      ).toBe(false);
      expect(fixture.getState()?.notes).not.toHaveProperty(["grandchild"]);
    } finally {
      nowSpy.mockRestore();
    }
  });

  test("keeps a note whose bullet reappears within the grace period", async () => {
    const fixture = await makeAdoptedFixture();
    const now = Date.now();
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(now);

    try {
      fixture.updateRoot(
        [
          "- Bulletlist",
          "  - Project ^project",
          "    - [ ] Child ^child",
          "",
        ].join("\n"),
      );
      await fixture.service.synchronizeNow();

      fixture.updateRoot(initialRoot);
      await fixture.service.synchronizeNow();

      nowSpy.mockReturnValue(now + 30_001);
      await fixture.service.confirmPendingDeletionsNow();

      expect(fixture.trash).not.toHaveBeenCalled();
      expect(
        fixture.entries.has(
          "Bulletlist/Project/Child/Grandchild old/Grandchild old.md",
        ),
      ).toBe(true);
    } finally {
      nowSpy.mockRestore();
    }
  });

  test("disconnects a mirror that was deleted by hand without touching the bullet", async () => {
    const fixture = await makeAdoptedFixture();

    fixture.removeEntry(
      "Bulletlist/Project/Child/Grandchild old/Grandchild old.md",
    );
    await fixture.service.synchronizeNow();

    expect(fixture.getState()?.notes).not.toHaveProperty(["grandchild"]);
    expect(fixture.root.content).toBe(initialRoot);
    expect(fixture.trash).not.toHaveBeenCalled();
  });

  test("keeps synchronizing while an unnamed bullet exists in the outline", async () => {
    const fixture = await makeAdoptedFixture();

    const withEmptyBullet = [
      "- Bulletlist",
      "  - Project ^project",
      "    - [x] Child ^child",
      "      - Grandchild old ^grandchild",
      "  - ",
      "",
    ].join("\n");
    fixture.updateRoot(withEmptyBullet);
    await fixture.service.synchronizeNow();

    expect(fixture.root.content).toBe(withEmptyBullet);
    expect(fixture.getFile("Bulletlist/Project/Child/Child.md")?.content).toBe(
      "- [x] Child ^child\n  - Grandchild old ^grandchild\n",
    );
    expect(fixture.trash).not.toHaveBeenCalled();
  });

  test("preserves the root file's CRLF style across merges", async () => {
    const fixture = await makeAdoptedFixture();

    fixture.updateRoot(
      initialRoot.replace("[ ] Child", "[x] Child").replace(/\n/gu, "\r\n"),
    );
    await fixture.service.synchronizeNow();

    fixture.updateFile(
      "Bulletlist/Project/Child/Child.md",
      "- [x] Child ^child\n  - Grandchild renamed ^grandchild\n",
    );
    await fixture.service.synchronizeNow();

    expect(fixture.root.content).toContain("\r\n");
    expect(fixture.root.content).toContain("Grandchild renamed");
  });

  test("survives a restart and keeps synchronizing from the saved ledger", async () => {
    const fixture = await makeAdoptedFixture();

    const restarted = fixture.makeService();
    fixture.updateFile(
      "Bulletlist/Project/Child/Child.md",
      "- [x] Child ^child\n  - Grandchild old ^grandchild\n",
    );
    await restarted.synchronizeNow();

    expect(fixture.root.content).toBe(
      initialRoot.replace("[ ] Child", "[x] Child"),
    );
  });
});
