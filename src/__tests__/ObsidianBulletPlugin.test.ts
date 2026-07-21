import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("ObsidianBulletPlugin wiring", () => {
  test("does not load the removed release notes announcement feature", () => {
    const source = readFileSync(
      join(__dirname, "../ObsidianBulletPlugin.ts"),
      "utf-8",
    );

    expect(source).not.toContain("ReleaseNotesAnnouncement");
  });

  test("loads mobile right fold controls as an independent feature", () => {
    const source = readFileSync(
      join(__dirname, "../ObsidianBulletPlugin.ts"),
      "utf-8",
    );

    expect(source).toContain(
      "new MobileRightFoldControls(this, this.settings)",
    );
  });

  test("loads and unloads native fold scroll immediately after mobile fold controls", () => {
    const source = readFileSync(
      join(__dirname, "../ObsidianBulletPlugin.ts"),
      "utf-8",
    );
    expect(source).toContain(
      'import { NativeFoldScroll } from "./features/NativeFoldScroll";',
    );
    expect(source).toContain(
      [
        "new MobileRightFoldControls(this, this.settings),",
        "new NativeFoldScroll(this),",
      ].join("\n      "),
    );
    expect(source).toContain("for (const feature of this.features) {");
    expect(source).toContain("await feature.load();");
    expect(source).toContain("await feature.unload();");
  });

  test("loads bullet threading as an independent appearance feature", () => {
    const source = readFileSync(
      join(__dirname, "../ObsidianBulletPlugin.ts"),
      "utf-8",
    );

    expect(source).toContain("new BulletThreading(this, this.settings)");
  });

  test("loads folder-scoped Logseq navigation with the drag interaction guard", () => {
    const source = readFileSync(
      join(__dirname, "../ObsidianBulletPlugin.ts"),
      "utf-8",
    );

    expect(source).toContain("new LogseqMode(");
    expect(source).toContain("const listMarkerInteractionGuard");
    expect(source).toMatch(
      /new LogseqMode\([\s\S]*?listMarkerInteractionGuard,[\s\S]*?new DragAndDrop\([\s\S]*?listMarkerInteractionGuard,/,
    );
  });

  test("loads the bullet typing guard before selection behavior", () => {
    const source = readFileSync(
      join(__dirname, "../ObsidianBulletPlugin.ts"),
      "utf-8",
    );
    const guard = source.indexOf(
      "new BulletTypingGuard(this, this.settings, this.logger)",
    );
    const selectionBehavior = source.indexOf(
      "new EditorSelectionsBehaviourOverride(",
    );

    expect(guard).toBeGreaterThanOrEqual(0);
    expect(selectionBehavior).toBeGreaterThan(guard);
  });
});
