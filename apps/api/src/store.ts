import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { defaultState } from "./defaults.js";
import type { AppState } from "./types.js";

export class StateStore {
  private state: AppState;

  constructor() {
    this.ensureFilesystem();
    this.state = this.load();
  }

  private ensureFilesystem() {
    fs.mkdirSync(config.dataRoot, { recursive: true });
    fs.mkdirSync(config.storageRoot, { recursive: true });
    fs.mkdirSync(config.filesRoot, { recursive: true });
    fs.mkdirSync(config.downloadsRoot, { recursive: true });
    fs.mkdirSync(config.mediaRoot, { recursive: true });
    fs.mkdirSync(path.dirname(config.stateFile), { recursive: true });
  }

  private load() {
    if (!fs.existsSync(config.stateFile)) {
      const initial = defaultState();
      fs.writeFileSync(config.stateFile, JSON.stringify(initial, null, 2));
      return initial;
    }

    const raw = fs.readFileSync(config.stateFile, "utf8");
    return JSON.parse(raw) as AppState;
  }

  private save() {
    fs.writeFileSync(config.stateFile, JSON.stringify(this.state, null, 2));
  }

  getState() {
    return this.state;
  }

  update(updater: (draft: AppState) => void) {
    updater(this.state);
    this.save();
    return this.state;
  }
}

export const stateStore = new StateStore();
