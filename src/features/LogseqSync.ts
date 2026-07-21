import { MarkdownView, Notice, normalizePath } from "obsidian";
import type { Editor, Plugin, TAbstractFile, TFile, TFolder } from "obsidian";

import type { List } from "../root";
import { Parser, Reader } from "../services/Parser";
import { Settings } from "../services/Settings";

const SYNC_STATE_VERSION = 3;
const SYNC_DELAY_MS = 300;
const DELETE_GRACE_MS = 30_000;
const SYNC_ID_LENGTH = 6;
const SYNC_ID_ATTEMPTS = 32;
const LEGACY_SYNC_ID_RE =
  /[\t ]+%%bullet-sync:[a-z0-9_-]+%%(?=[\t ]*(?:\^[\p{L}\p{N}_-]+)?[\t ]*$)/iu;
const TRAILING_BLOCK_ID_RE = /[\t ]+\^([\p{L}\p{N}_-]+)[\t ]*$/u;
const RESERVED_SYNC_IDS = new Set(
  [...Object.getOwnPropertyNames(Object.prototype), "prototype"].map((id) =>
    id.toLowerCase(),
  ),
);

interface TextDocument {
  eol: "\n" | "\r\n";
  finalNewline: boolean;
  lines: string[];
}

interface LineEdit {
  end: number;
  lines: string[];
  start: number;
}

export interface OutlineEditSource {
  edits: LineEdit[];
  mtime: number;
}

export interface OutlineMergeResult {
  conflicts: number;
  lines: string[];
}

export interface LogseqProjectionNode {
  content: string;
  depth: number;
  filePath: string;
  folderPath: string;
  id: string;
  name: string;
}

export interface LogseqProjection {
  byId: Map<string, LogseqProjectionNode>;
  nodes: LogseqProjectionNode[];
}

export interface LogseqProjectionResult {
  error?: string;
  projection?: LogseqProjection;
}

interface OutlineDraft {
  filePath: string;
  folderPath: string;
  id: string | null;
  line: number;
  list: List;
  names: string[];
}

interface OutlineDraftsResult {
  collidedPaths?: Set<string>;
  drafts?: OutlineDraft[];
  error?: string;
}

interface StoredNoteState {
  base: string;
  ctime: number;
  path: string;
}

interface PendingDeletion {
  ctime: number | null;
  dueAt: number;
  path: string;
}

interface LogseqSyncStateV3 {
  folder: string;
  notes: Record<string, StoredNoteState>;
  pendingDeletions: Record<string, PendingDeletion>;
  rootContent: string;
  rootCtime: number;
  rootMtime: number;
  rootPath: string;
  version: 3;
}

type NameResolver = (value: string) => string;
type FolderNormalizer = (value: string) => string;
type IdFactory = () => string;

class StringReader implements Reader {
  constructor(private lines: string[]) {}

  getCursor() {
    return { ch: 0, line: 0 };
  }

  getLine(line: number): string {
    return this.lines[line] ?? "";
  }

  lastLine(): number {
    return Math.max(0, this.lines.length - 1);
  }

  listSelections() {
    return [{ anchor: this.getCursor(), head: this.getCursor() }];
  }

  getAllFoldedLines(): number[] {
    return [];
  }
}

function parseText(content: string): TextDocument {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const finalNewline = /\r?\n$/u.test(content);
  const normalized = content.replace(/\r\n/gu, "\n");
  const lines = normalized.split("\n");
  if (finalNewline) {
    lines.pop();
  }
  return { eol, finalNewline, lines };
}

function printText(document: TextDocument): string {
  const body = document.lines.join(document.eol);
  return document.finalNewline ? `${body}${document.eol}` : body;
}

function linesEqual(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((line, index) => line === right[index])
  );
}

function getUniqueAnchors(
  base: string[],
  target: string[],
  baseStart: number,
  baseEnd: number,
  targetStart: number,
  targetEnd: number,
): Array<[number, number]> {
  const basePositions = new Map<string, number[]>();
  const targetPositions = new Map<string, number[]>();
  for (let index = baseStart; index < baseEnd; index++) {
    const line = base[index] ?? "";
    const positions = basePositions.get(line) ?? [];
    positions.push(index);
    basePositions.set(line, positions);
  }
  for (let index = targetStart; index < targetEnd; index++) {
    const line = target[index] ?? "";
    const positions = targetPositions.get(line) ?? [];
    positions.push(index);
    targetPositions.set(line, positions);
  }

  const pairs: Array<[number, number]> = [];
  for (const [line, positions] of basePositions) {
    const targetMatches = targetPositions.get(line);
    if (positions.length === 1 && targetMatches?.length === 1) {
      pairs.push([positions[0], targetMatches[0]]);
    }
  }
  pairs.sort((left, right) => left[0] - right[0]);
  if (pairs.length < 2) {
    return pairs;
  }

  // Longest increasing subsequence by target position. These anchors cannot
  // cross and therefore split the documents into independently safe gaps.
  const tails: number[] = [];
  const tailPairIndexes: number[] = [];
  const previous = new Array<number>(pairs.length).fill(-1);
  for (let pairIndex = 0; pairIndex < pairs.length; pairIndex++) {
    const targetIndex = pairs[pairIndex][1];
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if ((tails[middle] ?? -1) < targetIndex) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    tails[low] = targetIndex;
    previous[pairIndex] = low > 0 ? (tailPairIndexes[low - 1] ?? -1) : -1;
    tailPairIndexes[low] = pairIndex;
  }

  const result: Array<[number, number]> = [];
  let pairIndex = tailPairIndexes[tails.length - 1] ?? -1;
  while (pairIndex >= 0) {
    result.unshift(pairs[pairIndex]);
    pairIndex = previous[pairIndex] ?? -1;
  }
  return result;
}

export function collectLineEdits(
  base: string[],
  target: string[],
  baseStart = 0,
  baseEnd = base.length,
  targetStart = 0,
  targetEnd = target.length,
): LineEdit[] {
  if (
    linesEqual(
      base.slice(baseStart, baseEnd),
      target.slice(targetStart, targetEnd),
    )
  ) {
    return [];
  }
  if (baseStart === baseEnd || targetStart === targetEnd) {
    return [
      {
        end: baseEnd,
        lines: target.slice(targetStart, targetEnd),
        start: baseStart,
      },
    ];
  }

  const anchors = getUniqueAnchors(
    base,
    target,
    baseStart,
    baseEnd,
    targetStart,
    targetEnd,
  );
  if (anchors.length === 0) {
    if (baseEnd - baseStart === targetEnd - targetStart) {
      const edits: LineEdit[] = [];
      for (let offset = 0; offset < baseEnd - baseStart; offset++) {
        const baseIndex = baseStart + offset;
        const targetIndex = targetStart + offset;
        if (base[baseIndex] !== target[targetIndex]) {
          edits.push({
            end: baseIndex + 1,
            lines: [target[targetIndex] ?? ""],
            start: baseIndex,
          });
        }
      }
      return edits;
    }
    return [
      {
        end: baseEnd,
        lines: target.slice(targetStart, targetEnd),
        start: baseStart,
      },
    ];
  }

  const edits: LineEdit[] = [];
  let nextBase = baseStart;
  let nextTarget = targetStart;
  for (const [baseAnchor, targetAnchor] of anchors) {
    edits.push(
      ...collectLineEdits(
        base,
        target,
        nextBase,
        baseAnchor,
        nextTarget,
        targetAnchor,
      ),
    );
    nextBase = baseAnchor + 1;
    nextTarget = targetAnchor + 1;
  }
  edits.push(
    ...collectLineEdits(base, target, nextBase, baseEnd, nextTarget, targetEnd),
  );
  return edits;
}

function containsLines(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0) {
    return true;
  }
  for (let index = 0; index <= haystack.length - needle.length; index++) {
    if (
      needle.every(
        (line, needleIndex) => haystack[index + needleIndex] === line,
      )
    ) {
      return true;
    }
  }
  return false;
}

function editsAreEquivalent(left: LineEdit, right: LineEdit): boolean {
  return (
    left.start === right.start &&
    left.end === right.end &&
    linesEqual(left.lines, right.lines)
  );
}

function editsConflict(left: LineEdit, right: LineEdit): boolean {
  if (editsAreEquivalent(left, right)) {
    return false;
  }
  const leftInsert = left.start === left.end;
  const rightInsert = right.start === right.end;
  if (leftInsert && rightInsert) {
    if (left.start !== right.start) {
      return false;
    }
    return !(
      containsLines(left.lines, right.lines) ||
      containsLines(right.lines, left.lines)
    );
  }
  if (leftInsert) {
    return right.start < left.start && left.start < right.end;
  }
  if (rightInsert) {
    return left.start < right.start && right.start < left.end;
  }
  return Math.max(left.start, right.start) < Math.min(left.end, right.end);
}

/**
 * Merges line edits from several synchronized documents over their shared
 * base. Edit sources are ordered by file modification time; when two sources
 * change the same base range, the most recently modified file wins and each
 * discarded older edit counts as one conflict.
 */
export function mergeOutlineEdits(
  base: string[],
  sources: OutlineEditSource[],
): OutlineMergeResult {
  const ordered = [...sources].sort((left, right) => left.mtime - right.mtime);
  const kept: LineEdit[] = [];
  let conflicts = 0;
  for (const source of ordered) {
    for (const edit of source.edits) {
      const absorbed = kept.some(
        (existing) =>
          editsAreEquivalent(existing, edit) ||
          (existing.start === existing.end &&
            edit.start === edit.end &&
            existing.start === edit.start &&
            containsLines(existing.lines, edit.lines)),
      );
      if (absorbed) {
        continue;
      }
      for (let index = kept.length - 1; index >= 0; index--) {
        const existing = kept[index];
        const supersededInsert =
          existing.start === existing.end &&
          edit.start === edit.end &&
          existing.start === edit.start &&
          containsLines(edit.lines, existing.lines);
        if (supersededInsert) {
          kept.splice(index, 1);
          continue;
        }
        if (editsConflict(existing, edit)) {
          kept.splice(index, 1);
          conflicts++;
        }
      }
      kept.push(edit);
    }
  }

  kept.sort((left, right) => left.start - right.start || left.end - right.end);
  const lines: string[] = [];
  let cursor = 0;
  for (const edit of kept) {
    if (edit.start < cursor) {
      continue;
    }
    lines.push(...base.slice(cursor, edit.start), ...edit.lines);
    cursor = edit.end;
  }
  lines.push(...base.slice(cursor));
  return { conflicts, lines };
}

function isVaultFile(file: TAbstractFile | null): file is TFile {
  return file !== null && "extension" in file;
}

function isVaultFolder(file: TAbstractFile | null): file is TFolder {
  return file !== null && "children" in file;
}

export function stripLogseqSyncId(line: string): string {
  return line.replace(LEGACY_SYNC_ID_RE, "");
}

/**
 * Returns the offset where a line's trailing block ID starts (including the
 * whitespace before the caret), or null when the line carries none. Editors
 * conceal the range from this offset to the end of the line.
 */
export function getTrailingBlockIdOffset(line: string): number | null {
  return line.match(TRAILING_BLOCK_ID_RE)?.index ?? null;
}

function getLineBlockId(line: string): string | null {
  return line.match(TRAILING_BLOCK_ID_RE)?.[1] ?? null;
}

function stripLineBlockId(line: string): string {
  return line.replace(TRAILING_BLOCK_ID_RE, "");
}

function addLineBlockId(line: string, id: string): string {
  return `${stripLineBlockId(line).replace(/[\t ]+$/u, "")} ^${id}`;
}

function isSafeSyncId(id: string): boolean {
  return (
    /^[\p{L}\p{N}_-]{1,64}$/u.test(id) &&
    !RESERVED_SYNC_IDS.has(id.toLowerCase())
  );
}

function getDocumentBlockIds(lines: string[]): Set<string> {
  return new Set(
    lines.flatMap((line) => {
      const id = getLineBlockId(line);
      return id ? [id] : [];
    }),
  );
}

function countDraftIds(drafts: OutlineDraft[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const draft of drafts) {
    if (draft.id) {
      counts.set(draft.id, (counts.get(draft.id) ?? 0) + 1);
    }
  }
  return counts;
}

function indentNoteLine(line: string, indent: string): string {
  return line === "" ? "" : `${indent}${line}`;
}

/**
 * A child note owns exactly one branch: its first line is the connected
 * bullet and everything below belongs underneath it. Lines added at the top
 * level are adopted as direct children of the bullet instead of escaping
 * the branch as siblings.
 */
export function normalizeNoteLines(
  lines: string[],
  indentUnit: string,
): string[] {
  return lines.map((line, index) =>
    index === 0 || line === "" || /^[\t ]/u.test(line)
      ? line
      : `${indentUnit}${line}`,
  );
}

const EMPTY_BULLET_RE =
  /^[\t ]*(?:[-+*]|\d+[.)])(?:[\t ]+\[(?: |x|X)\])?[\t ]*$/u;

export function isEmptyBulletLine(line: string): boolean {
  return EMPTY_BULLET_RE.test(line);
}

/**
 * Trailing empty bullets (with blank lines around them) are the per-file
 * ready-to-type scratch space and stay out of synchronization until they
 * gain content. Returns the number of leading lines that are real content;
 * returns lines.length when there is no trailing scratch.
 */
export function getScratchStart(lines: string[]): number {
  let end = lines.length;
  let sawBullet = false;
  while (end > 1) {
    const line = lines[end - 1];
    if (line.trim() === "") {
      end--;
      continue;
    }
    if (isEmptyBulletLine(line)) {
      end--;
      sawBullet = true;
      continue;
    }
    break;
  }
  return sawBullet ? end : lines.length;
}

function getNoteChildIndentUnit(
  lines: string[],
  baseDraft: OutlineDraft,
): string {
  let unit: string | null = null;
  for (let index = 1; index < lines.length; index++) {
    const match = lines[index].match(/^[\t ]+/u);
    if (match && (unit === null || match[0].length < unit.length)) {
      unit = match[0];
    }
  }
  if (unit !== null) {
    return unit;
  }
  const own = baseDraft.list.getFirstLineIndent();
  const parentIndent = baseDraft.list.getParent()?.getFirstLineIndent() ?? "";
  const delta = own.startsWith(parentIndent)
    ? own.slice(parentIndent.length)
    : own;
  return delta === "" ? "\t" : delta;
}

function createSyncId(): string {
  const bytes = new Uint8Array(SYNC_ID_LENGTH);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => (byte % 36).toString(36)).join("");
}

function getFirstLine(list: List): number {
  return list.getFirstLineContentStart().line;
}

function getBranchContent(lines: string[], list: List): string {
  const startLine = getFirstLine(list);
  const endLine = list.getContentEndIncludingChildren().line;
  const indent = list.getFirstLineIndent();
  const branch: string[] = [];
  for (let line = startLine; line <= endLine; line++) {
    const source = lines[line] ?? "";
    branch.push(
      source.startsWith(indent) ? source.slice(indent.length) : source,
    );
  }
  return `${branch.join("\n")}\n`;
}

function getOutlineDrafts(
  parser: Parser,
  content: string,
  folder: string,
  getName: NameResolver,
): OutlineDraftsResult {
  const lines = parseText(content).lines;
  const reader = new StringReader(lines);
  const drafts: OutlineDraft[] = [];

  const visit = (list: List, ancestors: string[]) => {
    const line = getFirstLine(list);
    const source = lines[line] ?? "";
    const contentStart = list.getFirstLineContentStart().ch;
    const name = getName(source.slice(contentStart));
    if (name === "") {
      // A bullet without usable text (for example one just created with
      // Enter) cannot own a note path yet. Leave its subtree unmapped until
      // it gets a name instead of pausing synchronization.
      return;
    }
    const names = [...ancestors, name];
    const folderPath = normalizePath([folder, ...names].join("/"));
    drafts.push({
      filePath: normalizePath(`${folderPath}/${name}.md`),
      folderPath,
      id: getLineBlockId(source),
      line,
      list,
      names,
    });
    list.getChildren().forEach((child) => visit(child, names));
  };

  try {
    for (const root of parser.parseRange(reader)) {
      for (const page of root.getChildren()) {
        page.getChildren().forEach((child) => visit(child, []));
      }
    }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const seenPaths = new Set<string>();
  const collidedPaths = new Set<string>();
  for (const draft of drafts) {
    const key = draft.filePath.toLowerCase();
    if (seenPaths.has(key)) {
      collidedPaths.add(key);
    }
    seenPaths.add(key);
  }
  return { collidedPaths, drafts };
}

export function buildLogseqProjection(
  parser: Parser,
  content: string,
  folder: string,
  getName: NameResolver,
  knownIds: Set<string>,
): LogseqProjectionResult {
  const result = getOutlineDrafts(parser, content, folder, getName);
  if (!result.drafts) {
    return { error: result.error };
  }

  const byId = new Map<string, LogseqProjectionNode>();
  const nodes: LogseqProjectionNode[] = [];
  const lines = parseText(content).lines;
  for (const draft of result.drafts) {
    if (!draft.id || !knownIds.has(draft.id)) {
      continue;
    }
    if (byId.has(draft.id)) {
      return {
        error: `The sync identity ^${draft.id} occurs more than once; synchronization will resume when the move is complete. For a permanent copy, remove one duplicate ^${draft.id} marker in Source mode.`,
      };
    }
    const node: LogseqProjectionNode = {
      content: getBranchContent(lines, draft.list),
      depth: draft.names.length,
      filePath: draft.filePath,
      folderPath: draft.folderPath,
      id: draft.id,
      name: draft.names[draft.names.length - 1],
    };
    byId.set(node.id, node);
    nodes.push(node);
  }

  const connectedPaths = new Set<string>();
  for (const node of nodes) {
    const key = node.filePath.toLowerCase();
    if (connectedPaths.has(key)) {
      return {
        error: `Multiple connected bullets resolve to ${node.filePath}.`,
      };
    }
    connectedPaths.add(key);
  }
  return { projection: { byId, nodes } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseStoredNote(value: unknown): StoredNoteState | null {
  if (
    !isRecord(value) ||
    typeof value.base !== "string" ||
    typeof value.ctime !== "number" ||
    !Number.isFinite(value.ctime) ||
    typeof value.path !== "string"
  ) {
    return null;
  }
  return { base: value.base, ctime: value.ctime, path: value.path };
}

function parsePendingDeletion(value: unknown): PendingDeletion | null {
  if (
    !isRecord(value) ||
    typeof value.dueAt !== "number" ||
    !Number.isFinite(value.dueAt) ||
    (value.ctime !== null &&
      (typeof value.ctime !== "number" || !Number.isFinite(value.ctime))) ||
    typeof value.path !== "string"
  ) {
    return null;
  }
  return {
    ctime: value.ctime,
    dueAt: value.dueAt,
    path: value.path,
  };
}

function isNormalizedManagedPath(path: string, folder: string): boolean {
  return (
    path === normalizePath(path) &&
    path.startsWith(`${folder}/`) &&
    !path.split("/").some((segment) => segment === "." || segment === "..")
  );
}

function isMarkdownPathInFolder(path: string, folder: string): boolean {
  return (
    isNormalizedManagedPath(path, folder) && path.toLowerCase().endsWith(".md")
  );
}

function isManagedNotePath(path: string, folder: string): boolean {
  const parentPath = getParentPath(path);
  return (
    isMarkdownPathInFolder(path, folder) &&
    parentPath !== folder &&
    parentPath.startsWith(`${folder}/`)
  );
}

function parseSyncState(value: unknown): LogseqSyncStateV3 | null {
  if (
    !isRecord(value) ||
    value.version !== SYNC_STATE_VERSION ||
    typeof value.folder !== "string" ||
    value.folder === "" ||
    value.folder !== normalizePath(value.folder) ||
    typeof value.rootContent !== "string" ||
    typeof value.rootCtime !== "number" ||
    !Number.isFinite(value.rootCtime) ||
    typeof value.rootMtime !== "number" ||
    !Number.isFinite(value.rootMtime) ||
    typeof value.rootPath !== "string" ||
    !isMarkdownPathInFolder(value.rootPath, value.folder) ||
    getParentPath(value.rootPath) !== value.folder ||
    !isRecord(value.notes) ||
    !isRecord(value.pendingDeletions)
  ) {
    return null;
  }
  const notes: Record<string, StoredNoteState> = {};
  for (const [id, noteValue] of Object.entries(value.notes)) {
    const note = parseStoredNote(noteValue);
    if (
      !note ||
      !isSafeSyncId(id) ||
      !isManagedNotePath(note.path, value.folder)
    ) {
      return null;
    }
    notes[id] = note;
  }
  const pendingDeletions: Record<string, PendingDeletion> = {};
  for (const [id, pendingValue] of Object.entries(value.pendingDeletions)) {
    const pending = parsePendingDeletion(pendingValue);
    if (
      !pending ||
      !notes[id] ||
      !isManagedNotePath(pending.path, value.folder) ||
      pending.path !== notes[id].path ||
      (pending.ctime !== null && pending.ctime !== notes[id].ctime)
    ) {
      return null;
    }
    pendingDeletions[id] = pending;
  }
  return {
    folder: value.folder,
    notes,
    pendingDeletions,
    rootContent: value.rootContent,
    rootCtime: value.rootCtime,
    rootMtime: value.rootMtime,
    rootPath: value.rootPath,
    version: 3,
  };
}

function getParentPath(path: string): string {
  const separator = path.lastIndexOf("/");
  return separator < 0 ? "" : path.slice(0, separator);
}

interface RecordedRename {
  newPath: string;
  oldPath: string;
}

interface NoteAdoption {
  content: string;
  file: TFile;
  id: string;
}

export class LogseqSyncService {
  private disposed = false;
  private running: Promise<void> = Promise.resolve();
  private syncTimer: number | null = null;
  private deletionTimer: number | null = null;
  private trackedFiles = new Map<string, TFile>();
  private pendingRenames: RecordedRename[] = [];

  constructor(
    private plugin: Plugin,
    private settings: Settings,
    private parser: Parser,
    private normalizeFolder: FolderNormalizer,
    private getName: NameResolver,
    private idFactory: IdFactory = createSyncId,
  ) {}

  async load(): Promise<void> {
    this.plugin.registerEvent(
      this.plugin.app.vault.on("modify", (file) => {
        if (this.isInConfiguredFolder(file.path)) {
          this.scheduleSync();
        }
      }),
    );
    this.plugin.registerEvent(
      this.plugin.app.vault.on("create", (file) => {
        if (this.isInConfiguredFolder(file.path)) {
          this.scheduleSync();
        }
      }),
    );
    this.plugin.registerEvent(
      this.plugin.app.vault.on("rename", (file, oldPath) => {
        if (
          this.isInConfiguredFolder(file.path) ||
          this.isInConfiguredFolder(oldPath)
        ) {
          this.pendingRenames.push({ newPath: file.path, oldPath });
          this.scheduleSync();
        }
      }),
    );
    this.plugin.registerEvent(
      this.plugin.app.vault.on("delete", (file) => {
        if (this.isInConfiguredFolder(file.path)) {
          this.scheduleSync();
        }
      }),
    );
    this.settings.onChange(["logseqFolder"], this.onFolderChange);
    try {
      await this.synchronizeNow();
    } catch (error) {
      this.showError("Unable to initialize outline synchronization", error);
      this.scheduleSync();
    }
  }

  async unload(): Promise<void> {
    this.disposed = true;
    this.clearTimers();
    this.trackedFiles.clear();
    this.pendingRenames = [];
    this.settings.removeCallback(this.onFolderChange);
    await this.running;
  }

  async synchronizeNow(): Promise<void> {
    this.running = this.running
      .catch(() => undefined)
      .then(() => this.synchronize());
    await this.running;
  }

  async confirmPendingDeletionsNow(): Promise<void> {
    this.running = this.running
      .catch(() => undefined)
      .then(() => this.confirmPendingDeletions());
    await this.running;
  }

  private onFolderChange = () => {
    this.clearTimers();
    this.trackedFiles.clear();
    this.pendingRenames = [];
    this.scheduleSync(0);
  };

  private isInConfiguredFolder(path: string): boolean {
    const folder = this.normalizeFolder(this.settings.logseqFolder);
    return folder !== "" && (path === folder || path.startsWith(`${folder}/`));
  }

  private getRootFile(): TFile | null {
    const folderPath = this.normalizeFolder(this.settings.logseqFolder);
    if (folderPath === "") {
      return null;
    }
    const folder = this.plugin.app.vault.getAbstractFileByPath(folderPath);
    if (!isVaultFolder(folder)) {
      return null;
    }
    const markdownFiles = folder.children.filter(
      (child): child is TFile =>
        isVaultFile(child) && child.extension.toLowerCase() === "md",
    );
    return markdownFiles.length === 1 ? markdownFiles[0] : null;
  }

  private scheduleSync(delay = SYNC_DELAY_MS): void {
    if (this.disposed) {
      return;
    }
    if (this.syncTimer !== null) {
      window.clearTimeout(this.syncTimer);
    }
    this.syncTimer = window.setTimeout(() => {
      this.syncTimer = null;
      void this.synchronizeNow().catch((error: unknown) =>
        this.showError("Unable to synchronize outline notes", error),
      );
    }, delay);
  }

  private clearTimers(): void {
    if (this.syncTimer !== null) {
      window.clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }
    if (this.deletionTimer !== null) {
      window.clearTimeout(this.deletionTimer);
      this.deletionTimer = null;
    }
  }

  private consumePendingRenames(
    state: LogseqSyncStateV3 | null,
    folder: string,
  ): void {
    const renames = this.pendingRenames;
    this.pendingRenames = [];
    if (!state) {
      return;
    }
    for (const { oldPath, newPath } of renames) {
      const moveEntry = (entry: { path: string }) => {
        const moved =
          entry.path === oldPath
            ? newPath
            : entry.path.startsWith(`${oldPath}/`)
              ? `${newPath}${entry.path.slice(oldPath.length)}`
              : null;
        if (moved !== null && isManagedNotePath(moved, folder)) {
          entry.path = moved;
        }
      };
      Object.values(state.notes).forEach(moveEntry);
      Object.values(state.pendingDeletions).forEach(moveEntry);
    }
  }

  private generateSyncId(usedIds: Set<string>): string | null {
    for (let attempt = 0; attempt < SYNC_ID_ATTEMPTS; attempt++) {
      const id = this.idFactory().toLowerCase();
      if (isSafeSyncId(id) && !usedIds.has(id)) {
        return id;
      }
    }
    return null;
  }

  private getOpenEditor(file: TFile): Editor | null {
    for (const leaf of this.plugin.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.file?.path === file.path) {
        return view.editor;
      }
    }
    return null;
  }

  private async readDocument(file: TFile): Promise<string> {
    const editor = this.getOpenEditor(file);
    return editor ? editor.getValue() : this.plugin.app.vault.read(file);
  }

  /**
   * Writes through the open editor when the file is being edited, so
   * Obsidian never reports an external modification and cursor, undo
   * history, and unsaved changes survive. Falls back to an atomic vault
   * write otherwise. Returns the resulting content; a result that differs
   * from `next` means a newer edit raced the write.
   */
  private async writeDocument(
    file: TFile,
    expected: string,
    next: string,
  ): Promise<string> {
    const editor = this.getOpenEditor(file);
    if (!editor) {
      return this.plugin.app.vault.process(file, (current) =>
        current === expected ? next : current,
      );
    }
    const current = editor.getValue();
    if (current === next || current !== expected) {
      return current;
    }
    let prefix = 0;
    const maxShared = Math.min(expected.length, next.length);
    while (prefix < maxShared && expected[prefix] === next[prefix]) {
      prefix++;
    }
    let suffix = 0;
    while (
      suffix < maxShared - prefix &&
      expected[expected.length - 1 - suffix] === next[next.length - 1 - suffix]
    ) {
      suffix++;
    }
    editor.replaceRange(
      next.slice(prefix, next.length - suffix),
      editor.offsetToPos(prefix),
      editor.offsetToPos(expected.length - suffix),
    );
    return editor.getValue();
  }

  private freshState(
    folder: string,
    root: TFile,
    content: string,
  ): LogseqSyncStateV3 {
    return {
      folder,
      notes: {},
      pendingDeletions: {},
      rootContent: content,
      rootCtime: root.stat.ctime,
      rootMtime: root.stat.mtime,
      rootPath: root.path,
      version: 3,
    };
  }

  private async synchronize(): Promise<void> {
    if (this.disposed) {
      return;
    }
    const folder = this.normalizeFolder(this.settings.logseqFolder);
    const root = this.getRootFile();
    if (folder === "" || !root) {
      return;
    }

    let state = parseSyncState(this.settings.getLogseqSyncState());
    if (
      !state ||
      state.folder !== folder ||
      state.rootCtime !== root.stat.ctime
    ) {
      state = null;
      this.trackedFiles.clear();
    }
    this.consumePendingRenames(state, folder);

    let rootContentNow: string;
    if (!state) {
      // First contact: retire the legacy hidden-comment markers, then treat
      // the current root as the shared base and re-adopt notes by path.
      const initial = await this.readDocument(root);
      const initialDocument = parseText(initial);
      const stripped = printText({
        ...initialDocument,
        lines: initialDocument.lines.map(stripLogseqSyncId),
      });
      rootContentNow =
        stripped === initial
          ? initial
          : await this.writeDocument(root, initial, stripped);
      if (rootContentNow !== stripped) {
        this.scheduleSync(0);
        return;
      }
      state = this.freshState(folder, root, rootContentNow);
    } else {
      rootContentNow = await this.readDocument(root);
    }

    const rootBase = parseText(state.rootContent);
    const baseDraftsResult = getOutlineDrafts(
      this.parser,
      state.rootContent,
      folder,
      this.getName,
    );
    if (!baseDraftsResult.drafts) {
      // The stored base no longer parses; restart from the current content.
      this.trackedFiles.clear();
      await this.settings.saveLogseqSyncState(
        this.freshState(folder, root, rootContentNow),
      );
      this.scheduleSync(0);
      return;
    }
    const baseById = new Map<string, OutlineDraft>();
    for (const draft of baseDraftsResult.drafts) {
      if (draft.id && state.notes[draft.id] && !baseById.has(draft.id)) {
        baseById.set(draft.id, draft);
      }
    }

    const currentDocument = parseText(rootContentNow);
    const sources: OutlineEditSource[] = [];
    const rootScratchStart = getScratchStart(currentDocument.lines);
    const rootKeptLines = currentDocument.lines.slice(0, rootScratchStart);
    const rootScratchLines = currentDocument.lines.slice(rootScratchStart);
    const rootEdits = collectLineEdits(rootBase.lines, rootKeptLines);
    if (rootEdits.length > 0) {
      sources.push({ edits: rootEdits, mtime: root.stat.mtime });
    }

    this.bindTrackedFiles(state);
    const noteReads = new Map<string, string>();
    for (const [id, note] of Object.entries(state.notes)) {
      const file = this.getTrackedFile(id, note);
      if (!file) {
        continue;
      }
      note.path = file.path;
      let current: string;
      try {
        current = await this.readDocument(file);
      } catch (error) {
        this.showError(`Unable to read ${file.path}`, error);
        continue;
      }
      noteReads.set(id, current);
      if (current === note.base) {
        continue;
      }
      const baseDraft = baseById.get(id);
      if (!baseDraft) {
        continue;
      }
      const branchStart = getFirstLine(baseDraft.list);
      const branchEnd = baseDraft.list.getContentEndIncludingChildren().line;
      const indent = baseDraft.list.getFirstLineIndent();
      const rawLines = parseText(current).lines;
      const keptLines = rawLines.slice(0, getScratchStart(rawLines));
      const currentLines = normalizeNoteLines(
        keptLines,
        getNoteChildIndentUnit(keptLines, baseDraft),
      );
      const baseLines = parseText(note.base).lines;
      const keptBaseLines = baseLines.slice(0, getScratchStart(baseLines));
      if (linesEqual(currentLines, keptBaseLines)) {
        continue;
      }
      const expectedBase = getBranchContent(rootBase.lines, baseDraft.list);
      let edits: LineEdit[];
      if (note.base === expectedBase) {
        edits = collectLineEdits(keptBaseLines, currentLines).map((edit) => ({
          end: edit.end + branchStart,
          lines: edit.lines.map((line) => indentNoteLine(line, indent)),
          start: edit.start + branchStart,
        }));
      } else {
        // The note missed an earlier mirror write. Without a shared base the
        // whole branch is treated as one edit and ranked by file age.
        edits = [
          {
            end: branchEnd + 1,
            lines: currentLines.map((line) => indentNoteLine(line, indent)),
            start: branchStart,
          },
        ];
      }
      if (edits.length > 0) {
        sources.push({ edits, mtime: file.stat.mtime });
      }
    }

    const merged = mergeOutlineEdits(rootBase.lines, sources);
    let conflicts = merged.conflicts;
    const mergedLines = [...merged.lines];

    const mergedProbe = getOutlineDrafts(
      this.parser,
      printText({ ...currentDocument, lines: mergedLines }),
      folder,
      this.getName,
    );
    if (!mergedProbe.drafts) {
      this.showError(
        "Outline synchronization paused",
        mergedProbe.error ?? "The root outline could not be parsed.",
      );
      return;
    }
    const collidedPaths = mergedProbe.collidedPaths ?? new Set<string>();

    // Restore identities whose marker was lost while the bullet itself
    // remains, so an accidentally deleted or edited ^id never deletes the
    // note. A bullet that gained a different, unclaimed ID re-keys the
    // ledger and the note follows the new identity.
    const mergedIds = getDocumentBlockIds(mergedLines);
    const draftIdCounts = countDraftIds(mergedProbe.drafts);
    const storedNotes = state.notes;
    for (const [id, note] of Object.entries(storedNotes)) {
      if (mergedIds.has(id)) {
        continue;
      }
      const candidate: OutlineDraft | undefined = mergedProbe.drafts.find(
        (draft) =>
          draft.filePath.toLowerCase() === note.path.toLowerCase() &&
          !collidedPaths.has(draft.filePath.toLowerCase()) &&
          (draft.id === null ||
            (isSafeSyncId(draft.id) &&
              storedNotes[draft.id] === undefined &&
              (draftIdCounts.get(draft.id) ?? 0) === 1)),
      );
      if (!candidate) {
        continue;
      }
      if (candidate.id === null) {
        mergedLines[candidate.line] = addLineBlockId(
          mergedLines[candidate.line],
          id,
        );
        candidate.id = id;
        mergedIds.add(id);
        continue;
      }
      const nextId = candidate.id;
      state.notes[nextId] = note;
      delete state.notes[id];
      const pending = state.pendingDeletions[id];
      if (pending) {
        state.pendingDeletions[nextId] = pending;
        delete state.pendingDeletions[id];
      }
      const tracked = this.trackedFiles.get(id);
      if (tracked) {
        this.trackedFiles.set(nextId, tracked);
        this.trackedFiles.delete(id);
      }
      const read = noteReads.get(id);
      if (read !== undefined) {
        noteReads.set(nextId, read);
        noteReads.delete(id);
      }
    }

    // A copied line duplicates its ^id. Keep the first occurrence connected
    // and release the copies as plain bullets, the way Logseq re-mints
    // duplicated id:: properties instead of halting.
    const knownIds = new Set(Object.keys(state.notes));
    const seenKnownIds = new Set<string>();
    for (let line = 0; line < mergedLines.length; line++) {
      const id = getLineBlockId(mergedLines[line] ?? "");
      if (!id || !knownIds.has(id)) {
        continue;
      }
      if (seenKnownIds.has(id)) {
        mergedLines[line] = stripLineBlockId(mergedLines[line]);
      } else {
        seenKnownIds.add(id);
      }
    }

    // Adopt file-backed bullets that are not connected yet: freshly created
    // notes (Shift+click promotion) and notes rediscovered after a reset.
    const claimedPaths = new Set(
      Object.values(state.notes).map((note) => note.path.toLowerCase()),
    );
    const adoptions: NoteAdoption[] = [];
    for (const draft of mergedProbe.drafts) {
      if (draft.id && knownIds.has(draft.id)) {
        continue;
      }
      const key = draft.filePath.toLowerCase();
      if (collidedPaths.has(key) || claimedPaths.has(key)) {
        continue;
      }
      const file = this.plugin.app.vault.getAbstractFileByPath(draft.filePath);
      if (!isVaultFile(file)) {
        continue;
      }
      let id: string;
      if (draft.id) {
        if (
          !isSafeSyncId(draft.id) ||
          (draftIdCounts.get(draft.id) ?? 0) > 1 ||
          knownIds.has(draft.id)
        ) {
          continue;
        }
        id = draft.id;
      } else {
        const generated = this.generateSyncId(
          new Set([...knownIds, ...mergedIds]),
        );
        if (generated === null) {
          continue;
        }
        id = generated;
        mergedLines[draft.line] = addLineBlockId(mergedLines[draft.line], id);
        draft.id = id;
      }
      let content: string;
      try {
        content = await this.readDocument(file);
      } catch (error) {
        this.showError(`Unable to read ${file.path}`, error);
        continue;
      }
      adoptions.push({ content, file, id });
      knownIds.add(id);
      mergedIds.add(id);
      claimedPaths.add(key);
    }

    // The root's own scratch bullet rides along untouched at the end of
    // every write and stays out of the projection.
    const mergedKeptContent = printText({
      ...currentDocument,
      lines: mergedLines,
    });
    const mergedFullContent = printText({
      ...currentDocument,
      lines: [...mergedLines, ...rootScratchLines],
    });
    if (mergedFullContent !== rootContentNow) {
      const written = await this.writeDocument(
        root,
        rootContentNow,
        mergedFullContent,
      );
      if (written !== mergedFullContent) {
        // A newer save landed while merging; redo with fresh reads.
        this.scheduleSync(0);
        return;
      }
    }

    const projected = buildLogseqProjection(
      this.parser,
      mergedKeptContent,
      folder,
      this.getName,
      knownIds,
    );
    if (!projected.projection) {
      this.showError(
        "Outline synchronization paused",
        projected.error ?? "The root outline could not be projected.",
      );
      return;
    }
    const projection = projected.projection;

    // Register adoptions. A diverged note that is newer than the root keeps
    // its content for now; the next cycle merges it upward. Otherwise the
    // mirror write below aligns the file with the root.
    const skipMirrorWrite = new Set<string>();
    for (const adoption of adoptions) {
      const node = projection.byId.get(adoption.id);
      if (!node) {
        continue;
      }
      state.notes[adoption.id] = {
        base: node.content,
        ctime: adoption.file.stat.ctime,
        path: adoption.file.path,
      };
      this.trackedFiles.set(adoption.id, adoption.file);
      noteReads.set(adoption.id, adoption.content);
      const rawFileLines = parseText(adoption.content).lines;
      const rawNodeLines = parseText(node.content).lines;
      const fileLines = rawFileLines
        .slice(0, getScratchStart(rawFileLines))
        .map(stripLineBlockId);
      const nodeLines = rawNodeLines
        .slice(0, getScratchStart(rawNodeLines))
        .map(stripLineBlockId);
      if (!linesEqual(fileLines, nodeLines)) {
        if (adoption.file.stat.mtime >= root.stat.mtime) {
          skipMirrorWrite.add(adoption.id);
        } else {
          conflicts++;
        }
      }
    }

    await this.moveTrackedNotes(state, projection);

    let rerun = false;
    const finalIds = getDocumentBlockIds(mergedLines);
    for (const [id, note] of Object.entries(state.notes)) {
      const node = projection.byId.get(id);
      if (!node) {
        if (finalIds.has(id)) {
          delete state.pendingDeletions[id];
          continue;
        }
        state.pendingDeletions[id] ??= await this.createPendingDeletion(
          id,
          note,
        );
        continue;
      }
      delete state.pendingDeletions[id];
      const file = this.getTrackedFile(id, note);
      if (!file) {
        if (this.plugin.app.vault.getAbstractFileByPath(note.path) === null) {
          // The mirror was removed by hand; disconnect so a later Shift+click
          // can recreate and re-adopt it.
          delete state.notes[id];
          this.trackedFiles.delete(id);
        }
        continue;
      }
      note.path = file.path;
      if (skipMirrorWrite.has(id)) {
        continue;
      }
      const lastRead = noteReads.get(id);
      if (lastRead === undefined) {
        continue;
      }
      if (lastRead === node.content) {
        note.base = node.content;
        continue;
      }
      // The note's scratch bullet is not part of the mirror; keep it at the
      // end of whatever the mirror write produces.
      const lastLines = parseText(lastRead).lines;
      const scratchLines = lastLines.slice(getScratchStart(lastLines));
      const nodeLines = parseText(node.content).lines;
      if (
        linesEqual(
          lastLines.slice(0, lastLines.length - scratchLines.length),
          nodeLines.slice(0, getScratchStart(nodeLines)),
        )
      ) {
        note.base = node.content;
        continue;
      }
      const next =
        scratchLines.length === 0
          ? node.content
          : `${node.content}${scratchLines.join("\n")}\n`;
      try {
        const written = await this.writeDocument(file, lastRead, next);
        if (written === next) {
          note.base = node.content;
        } else {
          rerun = true;
        }
      } catch (error) {
        this.showError(`Unable to update ${file.path}`, error);
      }
    }

    state.rootContent = mergedKeptContent;
    state.rootCtime = root.stat.ctime;
    state.rootMtime = root.stat.mtime;
    state.rootPath = root.path;
    await this.settings.saveLogseqSyncState(state);
    this.schedulePendingDeletions(state);
    if (rerun) {
      this.scheduleSync(0);
    }
    if (conflicts > 0) {
      new Notice(
        `Bullet kept the newest edit in ${conflicts} conflicting outline change${conflicts === 1 ? "" : "s"}.`,
        7000,
      );
    }
  }

  private bindTrackedFiles(state: LogseqSyncStateV3): void {
    for (const [id, note] of Object.entries(state.notes)) {
      if (this.trackedFiles.has(id)) {
        continue;
      }
      const file = this.getFileAtTrackedPath(note);
      if (file) {
        this.trackedFiles.set(id, file);
      }
    }
  }

  private async createPendingDeletion(
    id: string,
    note: StoredNoteState,
  ): Promise<PendingDeletion> {
    const file = this.getTrackedFile(id, note);
    return {
      ctime:
        isManagedNotePath(
          note.path,
          this.normalizeFolder(this.settings.logseqFolder),
        ) && file
          ? note.ctime
          : null,
      dueAt: Date.now() + DELETE_GRACE_MS,
      path: note.path,
    };
  }

  private getFileAtTrackedPath(note: StoredNoteState): TFile | null {
    const atTrackedPath = this.plugin.app.vault.getAbstractFileByPath(
      note.path,
    );
    return isVaultFile(atTrackedPath) && atTrackedPath.stat.ctime === note.ctime
      ? atTrackedPath
      : null;
  }

  private getTrackedFile(id: string, note: StoredNoteState): TFile | null {
    const atTrackedPath = this.getFileAtTrackedPath(note);
    return atTrackedPath && this.trackedFiles.get(id) === atTrackedPath
      ? atTrackedPath
      : null;
  }

  private async moveTrackedNotes(
    state: LogseqSyncStateV3,
    projection: LogseqProjection,
  ): Promise<void> {
    const tracked = Object.entries(state.notes)
      .flatMap(([id, note]) => {
        const node = projection.byId.get(id);
        return node ? [{ id, node, note }] : [];
      })
      .sort((left, right) => left.node.depth - right.node.depth);

    for (const { id, node, note } of tracked) {
      if (!isManagedNotePath(note.path, state.folder)) {
        continue;
      }
      if (note.path === node.filePath) {
        continue;
      }
      const currentFile = this.getTrackedFile(id, note);
      const alreadyMoved = this.plugin.app.vault.getAbstractFileByPath(
        node.filePath,
      );
      if (isVaultFile(alreadyMoved)) {
        continue;
      }

      if (!currentFile) {
        continue;
      }
      const currentFolderPath = getParentPath(currentFile.path);
      const targetFolderPath = node.folderPath;
      if (currentFolderPath !== targetFolderPath) {
        const currentFolder =
          this.plugin.app.vault.getAbstractFileByPath(currentFolderPath);
        const targetFolder =
          this.plugin.app.vault.getAbstractFileByPath(targetFolderPath);
        if (!isVaultFolder(currentFolder) || targetFolder) {
          continue;
        }
        const sourcePathAtTargetName = `${currentFolderPath}${node.filePath.slice(targetFolderPath.length)}`;
        const sourceTarget = this.plugin.app.vault.getAbstractFileByPath(
          sourcePathAtTargetName,
        );
        if (sourceTarget && sourceTarget !== currentFile) {
          continue;
        }
        await this.ensureFolder(getParentPath(targetFolderPath));
        const currentFileAfterEnsure = this.getTrackedFile(id, note);
        const currentFolderAfterEnsure =
          this.plugin.app.vault.getAbstractFileByPath(currentFolderPath);
        const targetFolderAfterEnsure =
          this.plugin.app.vault.getAbstractFileByPath(targetFolderPath);
        if (
          currentFileAfterEnsure !== currentFile ||
          currentFolderAfterEnsure !== currentFolder ||
          targetFolderAfterEnsure !== null ||
          (this.plugin.app.vault.getAbstractFileByPath(
            sourcePathAtTargetName,
          ) ?? currentFile) !== currentFile ||
          this.plugin.app.vault.getAbstractFileByPath(node.filePath) !== null
        ) {
          continue;
        }
        try {
          await this.plugin.app.fileManager.renameFile(
            currentFolder,
            targetFolderPath,
          );
        } catch (error) {
          this.showError(`Unable to move ${currentFolderPath}`, error);
          continue;
        }
        this.rewriteTrackedPathPrefix(
          state,
          currentFolderPath,
          targetFolderPath,
        );
      }

      const movedPath = note.path;
      if (movedPath === node.filePath) {
        continue;
      }
      const movedFile = this.getTrackedFile(id, note);
      const targetFile = this.plugin.app.vault.getAbstractFileByPath(
        node.filePath,
      );
      if (!movedFile || targetFile) {
        continue;
      }
      try {
        await this.plugin.app.fileManager.renameFile(movedFile, node.filePath);
        const renamedFile = this.plugin.app.vault.getAbstractFileByPath(
          node.filePath,
        );
        if (renamedFile === movedFile && movedFile.stat.ctime === note.ctime) {
          note.path = node.filePath;
        }
      } catch (error) {
        this.showError(`Unable to rename ${movedPath}`, error);
      }
    }
  }

  private rewriteTrackedPathPrefix(
    state: LogseqSyncStateV3,
    oldFolder: string,
    newFolder: string,
  ): void {
    for (const note of Object.values(state.notes)) {
      if (note.path.startsWith(`${oldFolder}/`)) {
        note.path = `${newFolder}${note.path.slice(oldFolder.length)}`;
      }
    }
    for (const pending of Object.values(state.pendingDeletions)) {
      if (pending.path.startsWith(`${oldFolder}/`)) {
        pending.path = `${newFolder}${pending.path.slice(oldFolder.length)}`;
      }
    }
  }

  private async ensureFolder(folderPath: string): Promise<void> {
    if (folderPath === "") {
      return;
    }
    const existing = this.plugin.app.vault.getAbstractFileByPath(folderPath);
    if (isVaultFolder(existing)) {
      return;
    }
    if (existing) {
      throw new Error(`A file already exists at ${folderPath}`);
    }
    await this.ensureFolder(getParentPath(folderPath));
    try {
      await this.plugin.app.vault.createFolder(folderPath);
    } catch (error) {
      if (
        !isVaultFolder(this.plugin.app.vault.getAbstractFileByPath(folderPath))
      ) {
        throw error;
      }
    }
  }

  private schedulePendingDeletions(state: LogseqSyncStateV3): void {
    if (this.deletionTimer !== null) {
      window.clearTimeout(this.deletionTimer);
      this.deletionTimer = null;
    }
    const dueTimes = Object.values(state.pendingDeletions).map(
      (pending) => pending.dueAt,
    );
    if (dueTimes.length === 0 || this.disposed) {
      return;
    }
    const delay = Math.max(0, Math.min(...dueTimes) - Date.now());
    this.deletionTimer = window.setTimeout(() => {
      this.deletionTimer = null;
      void this.confirmPendingDeletionsNow().catch((error: unknown) =>
        this.showError("Unable to remove deleted outline notes", error),
      );
    }, delay);
  }

  private async confirmPendingDeletions(): Promise<void> {
    if (this.disposed) {
      return;
    }
    const folder = this.normalizeFolder(this.settings.logseqFolder);
    const root = this.getRootFile();
    const state = parseSyncState(this.settings.getLogseqSyncState());
    if (
      !root ||
      !state ||
      state.folder !== folder ||
      state.rootPath !== root.path ||
      state.rootCtime !== root.stat.ctime ||
      state.rootMtime !== root.stat.mtime
    ) {
      return;
    }
    const content = await this.readDocument(root);
    const drafts = getOutlineDrafts(this.parser, content, folder, this.getName);
    if (!drafts.drafts) {
      return;
    }
    const draftPaths = new Set(
      drafts.drafts.map((draft) => draft.filePath.toLowerCase()),
    );
    const rootIds = getDocumentBlockIds(parseText(content).lines);
    const now = Date.now();
    const due = Object.entries(state.pendingDeletions)
      .filter(([, pending]) => pending.dueAt <= now)
      .sort(
        (left, right) =>
          right[1].path.split("/").length - left[1].path.split("/").length,
      );
    let trashed = 0;
    let rootChanged = false;
    for (const [id, pending] of due) {
      if (rootIds.has(id)) {
        delete state.pendingDeletions[id];
        continue;
      }
      if (draftPaths.has(pending.path.toLowerCase())) {
        // The bullet still exists even though its ^id marker is gone; keep
        // the note and let the next cycle restore the identity.
        delete state.pendingDeletions[id];
        this.scheduleSync(0);
        continue;
      }
      if (!isManagedNotePath(pending.path, folder) || pending.ctime === null) {
        delete state.pendingDeletions[id];
        delete state.notes[id];
        this.trackedFiles.delete(id);
        continue;
      }
      const file = this.plugin.app.vault.getAbstractFileByPath(pending.path);
      if (isVaultFile(file)) {
        if (
          file.stat.ctime !== pending.ctime ||
          this.trackedFiles.get(id) !== file
        ) {
          delete state.pendingDeletions[id];
          delete state.notes[id];
          this.trackedFiles.delete(id);
          continue;
        }

        // The grace-period check and trash operation cannot be made atomic
        // with an external editor. Re-read the authoritative root immediately
        // before each trash and abort if any save or replacement raced us.
        const latestRoot = this.getRootFile();
        if (
          latestRoot !== root ||
          latestRoot.path !== state.rootPath ||
          latestRoot.stat.ctime !== state.rootCtime ||
          latestRoot.stat.mtime !== state.rootMtime
        ) {
          rootChanged = true;
          this.scheduleSync(0);
          break;
        }
        const latestRootContent = await this.readDocument(latestRoot);
        const rootAfterRead = this.getRootFile();
        if (
          rootAfterRead !== latestRoot ||
          latestRoot.stat.ctime !== state.rootCtime ||
          latestRoot.stat.mtime !== state.rootMtime
        ) {
          rootChanged = true;
          this.scheduleSync(0);
          break;
        }
        if (getDocumentBlockIds(parseText(latestRootContent).lines).has(id)) {
          delete state.pendingDeletions[id];
          continue;
        }
        const fileAfterRootRead = this.plugin.app.vault.getAbstractFileByPath(
          pending.path,
        );
        if (fileAfterRootRead !== file || file.stat.ctime !== pending.ctime) {
          delete state.pendingDeletions[id];
          delete state.notes[id];
          this.trackedFiles.delete(id);
          continue;
        }
        await this.plugin.app.vault.trash(file, false);
        trashed++;
        await this.trashFolderIfEmpty(getParentPath(pending.path));
      }
      delete state.pendingDeletions[id];
      delete state.notes[id];
      this.trackedFiles.delete(id);
    }
    await this.settings.saveLogseqSyncState(state);
    if (!rootChanged) {
      this.schedulePendingDeletions(state);
    }
    if (trashed > 0) {
      new Notice(
        `Bullet moved ${trashed} deleted outline note${trashed === 1 ? "" : "s"} to Obsidian trash.`,
        5000,
      );
    }
  }

  private async trashFolderIfEmpty(folderPath: string): Promise<void> {
    const configuredFolder = this.normalizeFolder(this.settings.logseqFolder);
    let candidate = folderPath;
    while (candidate !== "" && candidate !== configuredFolder) {
      const folder = this.plugin.app.vault.getAbstractFileByPath(candidate);
      if (!isVaultFolder(folder) || folder.children.length > 0) {
        return;
      }
      const parent = getParentPath(candidate);
      await this.plugin.app.vault.trash(folder, false);
      candidate = parent;
    }
  }

  private showError(summary: string, error: unknown): void {
    const detail = error instanceof Error ? error.message : String(error);
    new Notice(`${summary}: ${detail}`, 7000);
  }
}
