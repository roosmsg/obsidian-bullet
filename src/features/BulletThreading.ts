import { Plugin } from "obsidian";

import { DocumentBodyClass } from "./DocumentBodyClass";
import { Feature } from "./Feature";

import { Settings } from "../services/Settings";

const BULLET_THREADING_BODY_CLASS = "bullet-plugin-bullet-threading";

export class BulletThreading implements Feature {
  private bodyClass: DocumentBodyClass;

  constructor(
    private plugin: Plugin,
    private settings: Settings,
  ) {
    this.bodyClass = new DocumentBodyClass(
      this.plugin,
      BULLET_THREADING_BODY_CLASS,
      this.shouldApplyBodyClass,
    );
  }

  async load() {
    this.settings.onChange(["bulletThreading"], this.updateBodyClass);
    this.bodyClass.load();
  }

  async unload() {
    this.settings.removeCallback(this.updateBodyClass);
    this.bodyClass.unload();
  }

  private updateBodyClass = () => {
    this.bodyClass.update();
  };

  private shouldApplyBodyClass = () => {
    return this.settings.bulletThreading;
  };
}
