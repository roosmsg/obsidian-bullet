import {
  App,
  Notice,
  Plugin,
  TAbstractFile,
  TFile,
  TFolder,
  WorkspaceLeaf,
  normalizePath,
} from "obsidian";

import { EditorView, PluginValue, ViewPlugin } from "@codemirror/view";

import { Feature } from "./Feature";
import { ListMarkerInteractionGuard } from "./ListMarkerInteractionGuard";

import { MyEditor, getEditorFromState, getFileFromState } from "../editor";
import { Parser } from "../services/Parser";
import { Settings } from "../services/Settings";

export const LOGSEQ_MODE_CLASS = "bullet-plugin-logseq-mode";
export const MAX_BULLET_NOTE_NAME_LENGTH = 25;

const BULLET_SELECTOR = ".list-bullet";
const LINE_SELECTOR = ".cm-line";
const BULLET_LINE_RE =
  /^([\t ]*)(?:[-+*]|\d+[.)])(?:[\t ]+|$)(?:\[(?: |x|X)\](?:[\t ]+|$))?(.*)$/;
// eslint-disable-next-line no-control-regex -- Control characters are invalid in vault file names on Windows.
const INVALID_FILE_NAME_CHARS_RE = /[<>:"/\\|?*\u0000-\u001f]/gu;
const RESERVED_WINDOWS_NAME_RE =
  /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;

interface BulletBranch {
  content: string;
  name: string;
}

interface BulletNoteOpenRequest extends BulletBranch {
  folder: string;
  leaf: WorkspaceLeaf;
}

function isElementLike(target: EventTarget | null): target is Element {
  return (
    typeof target === "object" &&
    target !== null &&
    "closest" in target &&
    typeof target.closest === "function"
  );
}

function isVaultFile(file: TAbstractFile): file is TFile {
  return "extension" in file;
}

function isVaultFolder(file: TAbstractFile): file is TFolder {
  return "children" in file;
}

export function normalizeLogseqFolder(value: string): string {
  const segments = value
    .trim()
    .replace(/\\/gu, "/")
    .split("/")
    .filter((segment) => segment.length > 0);
  if (
    segments.length === 0 ||
    segments.some((segment) => segment === "." || segment === "..")
  ) {
    return "";
  }
  return normalizePath(segments.join("/"));
}

export function isPathInLogseqFolder(
  filePath: string,
  configuredFolder: string,
): boolean {
  const folder = normalizeLogseqFolder(configuredFolder);
  return folder !== "" && filePath.startsWith(`${folder}/`);
}

export function sanitizeBulletNoteName(value: string): string {
  let name = value
    .normalize("NFC")
    .replace(INVALID_FILE_NAME_CHARS_RE, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/[. ]+$/gu, "");
  name = Array.from(name).slice(0, MAX_BULLET_NOTE_NAME_LENGTH).join("");
  name = name.trim().replace(/[. ]+$/gu, "");
  if (RESERVED_WINDOWS_NAME_RE.test(name)) {
    name = Array.from(`_${name}`)
      .slice(0, MAX_BULLET_NOTE_NAME_LENGTH)
      .join("");
  }
  return name;
}

function getWikiLinkLabel(value: string): string {
  const aliasIndex = value.lastIndexOf("|");
  if (aliasIndex >= 0) {
    return value.slice(aliasIndex + 1);
  }

  const [path, subpath] = value.split("#", 2);
  const pathSegments = path?.split("/") ?? [];
  const pageName = pathSegments[pathSegments.length - 1];
  return pageName || subpath?.replace(/^\^/u, "") || value;
}

export function getBulletNoteName(value: string): string {
  const visibleText = value
    .replace(/%%.*?%%/gu, " ")
    .replace(/!?\[\[([^\]]+)\]\]/gu, (_match, target: string) =>
      getWikiLinkLabel(target),
    )
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/\[([^\]]+)\]\[[^\]]*\]/gu, "$1")
    .replace(/<(https?:\/\/[^>]+|mailto:[^>]+)>/giu, "$1")
    .replace(/<[^>]+>/gu, " ")
    .replace(/(`+)(.*?)\1/gu, "$2")
    .replace(/(\*\*|__|~~)(.*?)\1/gu, "$2")
    .replace(/(^|[\s([{])([*_])(.+?)\2(?=$|[\s)\]},.!?:;])/gu, "$1$3")
    .replace(/\\([\\`*_[\]{}()#+\-.!>])/gu, "$1");

  return sanitizeBulletNoteName(visibleText);
}

function parseBulletLine(line: string) {
  const match = line.match(BULLET_LINE_RE);
  if (!match) {
    return null;
  }
  return {
    content: match[2] ?? "",
    indent: match[1] ?? "",
  };
}

export function extractBulletBranch(
  parser: Parser,
  editor: MyEditor,
  line: number,
): BulletBranch | null {
  const sourceLine = editor.getLine(line);
  const parsedLine = parseBulletLine(sourceLine);
  if (!parsedLine) {
    return null;
  }

  const name = getBulletNoteName(parsedLine.content);
  if (name === "") {
    return null;
  }

  const root = parser.parse(editor, { line, ch: 0 });
  const list = root?.getListUnderLine(line);
  if (!list || list.getFirstLineContentStart().line !== line) {
    return null;
  }

  const endLine = list.getContentEndIncludingChildren().line;
  const lines: string[] = [];
  for (
    let sourceLineNumber = line;
    sourceLineNumber <= endLine;
    sourceLineNumber++
  ) {
    const branchLine = editor.getLine(sourceLineNumber);
    lines.push(
      branchLine.startsWith(parsedLine.indent)
        ? branchLine.slice(parsedLine.indent.length)
        : branchLine,
    );
  }

  return {
    content: `${lines.join("\n")}\n`,
    name,
  };
}

function getEditorLeaf(app: App, view: EditorView): WorkspaceLeaf {
  const leaf = app.workspace
    .getLeavesOfType("markdown")
    .find((candidate) => candidate.view.containerEl.contains(view.dom));
  return leaf ?? app.workspace.getLeaf(false);
}

export class LogseqNoteNavigator {
  private inFlight = new Map<string, Promise<TFile>>();

  constructor(private app: App) {}

  async open(request: BulletNoteOpenRequest): Promise<void> {
    const folderPath = normalizePath(`${request.folder}/${request.name}`);
    const filePath = normalizePath(`${folderPath}/${request.name}.md`);
    const pending = this.inFlight.get(filePath);
    if (pending) {
      const file = await pending;
      await request.leaf.openFile(file);
      return;
    }

    const operation = this.openNow(folderPath, filePath, request);
    this.inFlight.set(filePath, operation);
    try {
      const file = await operation;
      await request.leaf.openFile(file);
    } finally {
      if (this.inFlight.get(filePath) === operation) {
        this.inFlight.delete(filePath);
      }
    }
  }

  private async openNow(
    folderPath: string,
    filePath: string,
    request: BulletNoteOpenRequest,
  ): Promise<TFile> {
    let folder = this.app.vault.getAbstractFileByPath(folderPath);
    if (folder && !isVaultFolder(folder)) {
      throw new Error(`A file already exists at ${folderPath}`);
    }
    if (!folder) {
      try {
        folder = await this.app.vault.createFolder(folderPath);
      } catch (error) {
        folder = this.app.vault.getAbstractFileByPath(folderPath);
        if (!folder || !isVaultFolder(folder)) {
          throw error;
        }
      }
    }

    const existingFile = this.app.vault.getAbstractFileByPath(filePath);
    let file: TFile;
    if (existingFile) {
      if (!isVaultFile(existingFile)) {
        throw new Error(`A folder already exists at ${filePath}`);
      }
      file = existingFile;
    } else {
      file = await this.app.vault.create(filePath, request.content);
    }
    return file;
  }
}

export class LogseqModePluginValue implements PluginValue {
  constructor(
    private app: App,
    private settings: Settings,
    private parser: Parser,
    private navigator: LogseqNoteNavigator,
    private interactionGuard: ListMarkerInteractionGuard,
    private view: EditorView,
  ) {
    this.view.contentDOM.addEventListener("mousedown", this.onMouseDown, true);
    this.view.contentDOM.addEventListener("click", this.onClick, true);
    this.settings.onChange(["logseqFolder"], this.updateScope);
    this.updateScope();
  }

  update(): void {
    this.updateScope();
  }

  destroy(): void {
    this.view.contentDOM.removeEventListener(
      "mousedown",
      this.onMouseDown,
      true,
    );
    this.view.contentDOM.removeEventListener("click", this.onClick, true);
    this.settings.removeCallback(this.updateScope);
    this.view.dom.classList.remove(LOGSEQ_MODE_CLASS);
  }

  private updateScope = () => {
    const file = getFileFromState(this.view.state);
    this.view.dom.classList.toggle(
      LOGSEQ_MODE_CLASS,
      file !== null &&
        isPathInLogseqFolder(file.path, this.settings.logseqFolder),
    );
  };

  private getClickedLine(target: EventTarget | null): number | null {
    if (!this.isInScope() || !isElementLike(target)) {
      return null;
    }
    const bullet = target.closest(BULLET_SELECTOR);
    if (!bullet || !this.view.contentDOM.contains(bullet)) {
      return null;
    }
    const lineElement = bullet.closest(LINE_SELECTOR);
    if (!lineElement) {
      return null;
    }

    try {
      return (
        this.view.state.doc.lineAt(this.view.posAtDOM(lineElement)).number - 1
      );
    } catch {
      return null;
    }
  }

  private isInScope(): boolean {
    const file = getFileFromState(this.view.state);
    return (
      file !== null &&
      isPathInLogseqFolder(file.path, this.settings.logseqFolder)
    );
  }

  private onMouseDown = (event: MouseEvent) => {
    if (event.button !== 0 || this.getClickedLine(event.target) === null) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  private onClick = (event: MouseEvent) => {
    if (
      event.button !== 0 ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    ) {
      return;
    }
    const line = this.getClickedLine(event.target);
    if (line === null) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    if (this.interactionGuard.consumeDragClick()) {
      return;
    }

    const editor = getEditorFromState(this.view.state);
    const sourceFile = getFileFromState(this.view.state);
    const folder = sourceFile?.parent?.path;
    if (!editor || !folder) {
      return;
    }
    const branch = extractBulletBranch(this.parser, editor, line);
    if (!branch) {
      new Notice("This bullet cannot be opened as a Logseq note.", 5000);
      return;
    }

    const leaf = getEditorLeaf(this.app, this.view);
    void this.navigator
      .open({ ...branch, folder, leaf })
      .catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : String(error);
        new Notice(`Unable to open the bullet note: ${detail}`, 5000);
      });
  };
}

export class LogseqMode implements Feature {
  private navigator: LogseqNoteNavigator;

  constructor(
    private plugin: Plugin,
    private settings: Settings,
    private parser: Parser,
    private interactionGuard: ListMarkerInteractionGuard,
  ) {
    this.navigator = new LogseqNoteNavigator(this.plugin.app);
  }

  async load(): Promise<void> {
    this.plugin.registerEditorExtension([
      ViewPlugin.define(
        (view) =>
          new LogseqModePluginValue(
            this.plugin.app,
            this.settings,
            this.parser,
            this.navigator,
            this.interactionGuard,
            view,
          ),
      ),
    ]);
  }

  async unload(): Promise<void> {}
}
