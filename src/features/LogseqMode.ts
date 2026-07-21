import {
  App,
  MarkdownRenderChild,
  MarkdownView,
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
import type { List } from "../root";
import { Parser } from "../services/Parser";
import { Settings } from "../services/Settings";

export const LOGSEQ_MODE_CLASS = "bullet-plugin-logseq-mode";
export const MAX_BULLET_NOTE_NAME_LENGTH = 25;

const LOGSEQ_READING_NAVIGABLE_CLASS = "bullet-plugin-logseq-reading-navigable";
const LIST_MARKER_SELECTOR =
  ".list-bullet, .cm-formatting-list, .cm-fold-indicator, .collapse-indicator";
const READING_MARKER_SELECTOR = ".list-bullet, .list-collapse-indicator";
const READING_NON_LABEL_SELECTOR =
  "ol, ul, .list-bullet, .list-collapse-indicator, input[type='checkbox']";
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
  ancestors?: BulletBranch[];
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

export function getLogseqParentNotePath(
  filePath: string,
  configuredFolder: string,
): string | null {
  const logseqFolder = normalizeLogseqFolder(configuredFolder);
  const normalizedFilePath = normalizePath(filePath);
  const fileSeparator = normalizedFilePath.lastIndexOf("/");
  if (logseqFolder === "" || fileSeparator < 0) {
    return null;
  }

  const currentFolder = normalizedFilePath.slice(0, fileSeparator);
  if (
    currentFolder === logseqFolder ||
    !currentFolder.startsWith(`${logseqFolder}/`)
  ) {
    return null;
  }

  const currentFolderName = currentFolder.slice(
    currentFolder.lastIndexOf("/") + 1,
  );
  const currentFileName = normalizedFilePath.slice(fileSeparator + 1);
  if (currentFileName !== `${currentFolderName}.md`) {
    return null;
  }

  const parentSeparator = currentFolder.lastIndexOf("/");
  if (parentSeparator < 0) {
    return null;
  }
  const parentFolder = currentFolder.slice(0, parentSeparator);
  const parentName = parentFolder.slice(parentFolder.lastIndexOf("/") + 1);
  return parentName === ""
    ? null
    : normalizePath(`${parentFolder}/${parentName}.md`);
}

function getExistingLogseqParentFile(
  app: App,
  filePath: string,
  configuredFolder: string,
): TFile | null {
  const logseqFolder = normalizeLogseqFolder(configuredFolder);
  const normalizedFilePath = normalizePath(filePath);
  const expectedParentPath = getLogseqParentNotePath(
    normalizedFilePath,
    configuredFolder,
  );
  if (logseqFolder === "" || !expectedParentPath) {
    return null;
  }

  const fileSeparator = normalizedFilePath.lastIndexOf("/");
  const currentFolder = normalizedFilePath.slice(0, fileSeparator);
  const parentSeparator = currentFolder.lastIndexOf("/");
  const parentFolder = currentFolder.slice(0, parentSeparator);
  if (parentFolder === logseqFolder) {
    const rootFolder = app.vault.getAbstractFileByPath(logseqFolder);
    if (!rootFolder || !isVaultFolder(rootFolder)) {
      return null;
    }
    const rootFiles = rootFolder.children.filter(
      (child): child is TFile =>
        isVaultFile(child) && child.extension.toLowerCase() === "md",
    );
    return rootFiles.length === 1 ? rootFiles[0] : null;
  }

  const expectedParent = app.vault.getAbstractFileByPath(expectedParentPath);
  return expectedParent && isVaultFile(expectedParent) ? expectedParent : null;
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

function stripLeadingMarkdownSyntax(value: string): string {
  let plainText = value;
  let previousValue: string;

  do {
    previousValue = plainText;
    plainText = plainText
      .replace(/^\s{0,3}>\s*/u, "")
      .replace(/^\s*#{1,6}\s*/u, "")
      .replace(/^\s*\[![^\]\r\n]+\][+-]?\s*/iu, "")
      .replace(/^\s*(?:[-+*]|\d+[.)])\s+/u, "")
      .replace(/^\s*\[(?: |x|X)\]\s+/u, "");
  } while (plainText !== previousValue);

  return plainText.replace(/\s+#{1,6}\s*$/u, "");
}

export function getBulletNoteName(value: string): string {
  const visibleText = stripLeadingMarkdownSyntax(value)
    .replace(/%%.*?%%/gu, " ")
    .replace(/!?\[\[([^\]]+)\]\]/gu, (_match, target: string) =>
      getWikiLinkLabel(target),
    )
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/\[([^\]]+)\]\[[^\]]*\]/gu, "$1")
    .replace(/\[\^[^\]]+\]/gu, " ")
    .replace(/<(https?:\/\/[^>]+|mailto:[^>]+)>/giu, "$1")
    .replace(/<[^>]+>/gu, " ")
    .replace(/(`+)(.*?)\1/gu, "$2")
    .replace(/\$\$([^\r\n]*?)\$\$/gu, "$1")
    .replace(/\$([^$\r\n]+?)\$/gu, "$1")
    .replace(/(\*\*|__|~~|==)(.*?)\1/gu, "$2")
    .replace(/(^|[\s([{])([*_])(.+?)\2(?=$|[\s)\]},.!?:;])/gu, "$1$3")
    .replace(/(^|[\s([{])#(?=[\p{L}\p{N}_/-])/gu, "$1")
    .replace(/\s+\^[\p{L}\p{N}_-]+\s*$/u, "")
    .replace(/\\([\\`*_[\]{}()#+\-.!>])/gu, "$1");

  return sanitizeBulletNoteName(visibleText);
}

function getNestedBulletAncestors(list: List): List[] {
  const ancestors: List[] = [];
  let ancestor = list.getParent();

  while (ancestor?.getParent()) {
    ancestors.unshift(ancestor);
    ancestor = ancestor.getParent();
  }

  // The top-level item represents the current page, whose folder is already
  // supplied by the source file. Only nested ancestors add destination levels.
  return ancestors.slice(1);
}

export function getBulletAncestorNames(list: List): string[] | null {
  const nestedNames = getNestedBulletAncestors(list).map((ancestor) =>
    getBulletNoteName(ancestor.getLines()[0] ?? ""),
  );
  return nestedNames.some((name) => name === "") ? null : nestedNames;
}

function isTopLevelList(list: List): boolean {
  const parent = list.getParent();
  return parent !== null && parent.getParent() === null;
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

  return extractBulletBranchFromList(editor, list);
}

function extractBulletBranchFromList(
  editor: MyEditor,
  list: List,
): BulletBranch | null {
  const line = list.getFirstLineContentStart().line;
  const sourceLine = editor.getLine(line);
  const parsedLine = parseBulletLine(sourceLine);
  if (!parsedLine) {
    return null;
  }

  const name = getBulletNoteName(parsedLine.content);
  if (name === "") {
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

function extractBulletAncestorBranches(
  editor: MyEditor,
  list: List,
): BulletBranch[] | null {
  const branches = getNestedBulletAncestors(list).map((ancestor) =>
    extractBulletBranchFromList(editor, ancestor),
  );
  return branches.some((branch) => branch === null)
    ? null
    : (branches as BulletBranch[]);
}

function getEditorLeaf(app: App, view: EditorView): WorkspaceLeaf {
  const leaf = app.workspace
    .getLeavesOfType("markdown")
    .find((candidate) => candidate.view.containerEl.contains(view.dom));
  return leaf ?? app.workspace.getLeaf(false);
}

function getReadingLeaf(
  app: App,
  element: Element,
  sourcePath: string,
): WorkspaceLeaf | null {
  return (
    app.workspace
      .getLeavesOfType("markdown")
      .find(
        (candidate) =>
          candidate.view instanceof MarkdownView &&
          candidate.view.file?.path === sourcePath &&
          candidate.view.containerEl.contains(element),
      ) ?? null
  );
}

async function openLogseqFile(leaf: WorkspaceLeaf, file: TFile): Promise<void> {
  await leaf.openFile(file);

  const view = leaf.view;
  if (!(view instanceof MarkdownView) || view.file?.path !== file.path) {
    return;
  }

  const editor = view.editor;
  if (editor.getCursor().line !== 0) {
    return;
  }

  for (let line = 1; line < editor.lineCount(); line++) {
    if (editor.getLine(line).trim() === "") {
      editor.setCursor({ line, ch: 0 });
      return;
    }
  }
}

function isNavigationClick(event: MouseEvent): boolean {
  return (
    event.button === 0 &&
    event.shiftKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey
  );
}

function stopNavigationEvent(event: MouseEvent): void {
  event.preventDefault();
  event.stopImmediatePropagation();
}

function getReadingListItem(
  containerEl: HTMLElement,
  target: EventTarget | null,
): HTMLElement | null {
  if (!isElementLike(target)) {
    return null;
  }

  const marker = target.closest(READING_MARKER_SELECTOR);
  const listItem = (marker ?? target).closest("li");
  if (!listItem || !containerEl.contains(listItem)) {
    return null;
  }

  // CSS ::marker clicks target the list item itself. Content clicks normally
  // target a child element and should keep their standard Shift-click action.
  return marker || target === listItem ? (listItem as HTMLElement) : null;
}

function getReadingListItemName(listItem: HTMLElement): string {
  const label = listItem.cloneNode(true) as HTMLElement;
  label
    .querySelectorAll(READING_NON_LABEL_SELECTOR)
    .forEach((element) => element.remove());
  return getBulletNoteName(label.textContent ?? "");
}

function getReadingListAncestors(
  containerEl: HTMLElement,
  listItem: HTMLElement,
): HTMLElement[] {
  const ancestors: HTMLElement[] = [];
  let ancestor = listItem.parentElement?.closest("li") as HTMLElement | null;
  while (ancestor && containerEl.contains(ancestor)) {
    ancestors.unshift(ancestor);
    ancestor = ancestor.parentElement?.closest("li") as HTMLElement | null;
  }
  return ancestors;
}

class LogseqReadingNavigation extends MarkdownRenderChild {
  constructor(
    containerEl: HTMLElement,
    private app: App,
    private settings: Settings,
    private sourcePath: string,
  ) {
    super(containerEl);
  }

  onload(): void {
    this.updateNavigationTargets();
    this.settings.onChange(["logseqFolder"], this.updateNavigationTargets);
    this.registerDomEvent(
      this.containerEl,
      "mousedown",
      this.onMouseDown,
      true,
    );
    this.registerDomEvent(this.containerEl, "click", this.onClick, true);
    this.registerDomEvent(
      this.containerEl,
      "mouseover",
      this.onMouseOver,
      true,
    );
  }

  onunload(): void {
    this.settings.removeCallback(this.updateNavigationTargets);
    this.getListItems().forEach((listItem) =>
      listItem.classList.remove(LOGSEQ_READING_NAVIGABLE_CLASS),
    );
  }

  private getListItems(): HTMLElement[] {
    const listItems = Array.from(
      this.containerEl.querySelectorAll<HTMLElement>("li"),
    );
    if (this.containerEl.matches("li")) {
      listItems.unshift(this.containerEl);
    }
    return listItems;
  }

  private updateNavigationTargets = () => {
    const inScope = isPathInLogseqFolder(
      this.sourcePath,
      this.settings.logseqFolder,
    );
    this.getListItems().forEach((listItem) => {
      listItem.classList.toggle(
        LOGSEQ_READING_NAVIGABLE_CLASS,
        inScope && this.getExistingDestination(listItem) !== null,
      );
    });
  };

  private onMouseOver = (event: MouseEvent) => {
    if (!isPathInLogseqFolder(this.sourcePath, this.settings.logseqFolder)) {
      return;
    }
    const listItem = getReadingListItem(this.containerEl, event.target);
    if (!listItem) {
      return;
    }
    listItem.classList.toggle(
      LOGSEQ_READING_NAVIGABLE_CLASS,
      this.getExistingDestination(listItem) !== null,
    );
  };

  private onMouseDown = (event: MouseEvent) => {
    if (!this.getNavigationTarget(event)) {
      return;
    }
    stopNavigationEvent(event);
  };

  private onClick = (event: MouseEvent) => {
    const listItem = this.getNavigationTarget(event);
    if (!listItem) {
      return;
    }
    stopNavigationEvent(event);
    void this.openExistingDestination(listItem).catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error);
      new Notice(`Unable to open the outline note: ${detail}`, 5000);
    });
  };

  private getNavigationTarget(event: MouseEvent): HTMLElement | null {
    if (
      !isNavigationClick(event) ||
      !isPathInLogseqFolder(this.sourcePath, this.settings.logseqFolder)
    ) {
      return null;
    }
    return getReadingListItem(this.containerEl, event.target);
  }

  private async openExistingDestination(listItem: HTMLElement): Promise<void> {
    const destination = this.getExistingDestination(listItem);
    if (!destination) {
      return;
    }

    const leaf = getReadingLeaf(this.app, this.containerEl, this.sourcePath);
    if (!leaf) {
      return;
    }

    await openLogseqFile(leaf, destination);
  }

  private getExistingDestination(listItem: HTMLElement): TFile | null {
    const sourceFile = this.app.vault.getAbstractFileByPath(this.sourcePath);
    if (!sourceFile || !isVaultFile(sourceFile) || !sourceFile.parent) {
      return null;
    }

    const ancestors = getReadingListAncestors(this.containerEl, listItem);
    if (
      ancestors.length === 0 &&
      sourceFile.parent.path ===
        normalizeLogseqFolder(this.settings.logseqFolder)
    ) {
      return null;
    }
    let destinationPath: string | null = null;
    if (ancestors.length === 0) {
      const parentNotePath = getLogseqParentNotePath(
        sourceFile.path,
        this.settings.logseqFolder,
      );
      if (parentNotePath) {
        return getExistingLogseqParentFile(
          this.app,
          sourceFile.path,
          this.settings.logseqFolder,
        );
      }
    }

    if (!destinationPath) {
      const ancestorNames = ancestors
        .slice(1)
        .map((ancestor) => getReadingListItemName(ancestor));
      const name = getReadingListItemName(listItem);
      if (name === "" || ancestorNames.some((ancestor) => ancestor === "")) {
        return null;
      }
      destinationPath = normalizePath(
        [sourceFile.parent.path, ...ancestorNames, name, `${name}.md`].join(
          "/",
        ),
      );
    }

    const destination = this.app.vault.getAbstractFileByPath(destinationPath);
    if (!destination || !isVaultFile(destination)) {
      return null;
    }
    return destination;
  }
}

export class LogseqNoteNavigator {
  private inFlight = new Map<string, Promise<TFile>>();

  constructor(private app: App) {}

  async open(request: BulletNoteOpenRequest): Promise<void> {
    const folderPath = normalizePath(
      [
        request.folder,
        ...(request.ancestors ?? []).map((ancestor) => ancestor.name),
        request.name,
      ].join("/"),
    );
    const filePath = normalizePath(`${folderPath}/${request.name}.md`);
    const pending = this.inFlight.get(filePath);
    if (pending) {
      const file = await pending;
      await openLogseqFile(request.leaf, file);
      return;
    }

    const operation = this.openNow(filePath, request);
    this.inFlight.set(filePath, operation);
    try {
      const file = await operation;
      await openLogseqFile(request.leaf, file);
    } finally {
      if (this.inFlight.get(filePath) === operation) {
        this.inFlight.delete(filePath);
      }
    }
  }

  private async openNow(
    filePath: string,
    request: BulletNoteOpenRequest,
  ): Promise<TFile> {
    let currentFolder = request.folder;
    for (const ancestor of request.ancestors ?? []) {
      currentFolder = normalizePath(`${currentFolder}/${ancestor.name}`);
      await this.ensureFolder(currentFolder);
      await this.ensureFile(
        normalizePath(`${currentFolder}/${ancestor.name}.md`),
        ancestor.content,
      );
    }

    currentFolder = normalizePath(`${currentFolder}/${request.name}`);
    await this.ensureFolder(currentFolder);
    return this.ensureFile(filePath, request.content);
  }

  private async ensureFolder(folderPath: string): Promise<void> {
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
  }

  private async ensureFile(filePath: string, content: string): Promise<TFile> {
    let file = this.app.vault.getAbstractFileByPath(filePath);
    if (file && !isVaultFile(file)) {
      throw new Error(`A folder already exists at ${filePath}`);
    }
    if (!file) {
      try {
        file = await this.app.vault.create(filePath, content);
      } catch (error) {
        file = this.app.vault.getAbstractFileByPath(filePath);
        if (!file || !isVaultFile(file)) {
          throw error;
        }
      }
    }
    if (!file || !isVaultFile(file)) {
      throw new Error(`Unable to create or open ${filePath}`);
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
    const marker = target.closest(LIST_MARKER_SELECTOR);
    if (!marker || !this.view.contentDOM.contains(marker)) {
      return null;
    }
    const lineElement = marker.closest(LINE_SELECTOR);
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
    if (
      event.button !== 0 ||
      !event.shiftKey ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      this.getClickedLine(event.target) === null
    ) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  private onClick = (event: MouseEvent) => {
    if (
      event.button !== 0 ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      !event.shiftKey
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
    const root = this.parser.parse(editor, { line, ch: 0 });
    const list = root?.getListUnderLine(line);
    if (!list || list.getFirstLineContentStart().line !== line) {
      new Notice("This bullet cannot be opened as a Logseq note.", 5000);
      return;
    }

    const leaf = getEditorLeaf(this.app, this.view);
    if (isTopLevelList(list)) {
      const parentNotePath = getLogseqParentNotePath(
        sourceFile.path,
        this.settings.logseqFolder,
      );
      if (parentNotePath) {
        const parentFile = getExistingLogseqParentFile(
          this.app,
          sourceFile.path,
          this.settings.logseqFolder,
        );
        if (!parentFile) {
          new Notice(`Parent note not found: ${parentNotePath}`, 5000);
          return;
        }
        void openLogseqFile(leaf, parentFile).catch((error: unknown) => {
          const detail = error instanceof Error ? error.message : String(error);
          new Notice(`Unable to open the parent note: ${detail}`, 5000);
        });
        return;
      }
    }

    const branch = extractBulletBranchFromList(editor, list);
    if (!branch) {
      new Notice("This bullet cannot be opened as a Logseq note.", 5000);
      return;
    }
    const ancestors = extractBulletAncestorBranches(editor, list);
    if (!ancestors) {
      new Notice("An ancestor bullet cannot be used as a folder name.", 5000);
      return;
    }
    if (
      isTopLevelList(list) &&
      folder === normalizeLogseqFolder(this.settings.logseqFolder)
    ) {
      return;
    }

    void this.navigator
      .open({
        ...branch,
        ...(ancestors.length > 0 ? { ancestors } : {}),
        folder,
        leaf,
      })
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
    this.plugin.registerMarkdownPostProcessor((element, context) => {
      context.addChild(
        new LogseqReadingNavigation(
          element,
          this.plugin.app,
          this.settings,
          context.sourcePath,
        ),
      );
    });
  }

  async unload(): Promise<void> {}
}
