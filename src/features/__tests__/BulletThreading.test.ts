import { readFileSync } from "node:fs";
import { join } from "node:path";

import { BulletThreading } from "../BulletThreading";

function makeClassList() {
  const values = new Set<string>();

  return {
    add: jest.fn((value: string) => values.add(value)),
    remove: jest.fn((value: string) => values.delete(value)),
    contains: (value: string) => values.has(value),
  };
}

function makeDocument() {
  return { body: { classList: makeClassList() } };
}

describe("BulletThreading", () => {
  test("updates the scoped body class immediately and in pop-out windows", async () => {
    const mainDocument = makeDocument();
    const popoutDocument = makeDocument();
    Object.defineProperty(global, "activeDocument", {
      configurable: true,
      value: mainDocument,
    });

    const eventHandlers = new Map<string, (...args: never[]) => void>();
    const workspace = {
      on: jest.fn((eventName: string, handler: (...args: never[]) => void) => {
        eventHandlers.set(eventName, handler);
        return { eventName };
      }),
    };
    const plugin = {
      app: { workspace },
      registerEvent: jest.fn(),
    };
    const settingsCallbacks: Array<() => void> = [];
    const settings = {
      bulletThreading: false,
      onChange: jest.fn((keys: unknown, callback?: () => void) => {
        settingsCallbacks.push(callback ?? (keys as () => void));
      }),
      removeCallback: jest.fn(),
    };
    const feature = new BulletThreading(plugin as never, settings as never);

    await feature.load();
    eventHandlers.get("window-open")?.(
      {} as never,
      { document: popoutDocument } as never,
    );

    expect(settings.onChange).toHaveBeenCalledWith(
      ["bulletThreading"],
      expect.any(Function),
    );
    expect(
      mainDocument.body.classList.contains("bullet-plugin-bullet-threading"),
    ).toBe(false);

    settings.bulletThreading = true;
    settingsCallbacks[0]?.();

    expect(
      mainDocument.body.classList.contains("bullet-plugin-bullet-threading"),
    ).toBe(true);
    expect(
      popoutDocument.body.classList.contains("bullet-plugin-bullet-threading"),
    ).toBe(true);

    await feature.unload();

    expect(
      mainDocument.body.classList.contains("bullet-plugin-bullet-threading"),
    ).toBe(false);
    expect(
      popoutDocument.body.classList.contains("bullet-plugin-bullet-threading"),
    ).toBe(false);
    expect(settings.removeCallback).toHaveBeenCalledWith(expect.any(Function));
  });

  test("scopes editor, reading-view, and Outline styles to the feature class", () => {
    const css = readFileSync(join(__dirname, "../../../styles.css"), "utf-8");
    const start = css.indexOf("/* bullet threading */");
    const threadingCss = css.slice(start);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(threadingCss).toContain(
      "@scope (body.bullet-plugin-bullet-threading)",
    );
    expect(threadingCss).toContain(".HyperMD-list-line-1");
    expect(threadingCss).toContain(".markdown-rendered li:hover");
    expect(threadingCss).toContain(
      '.workspace-leaf-content[data-type="outline"]',
    );
  });
});
