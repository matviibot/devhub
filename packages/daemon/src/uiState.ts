import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { UiState } from "@devhub/shared";
import { CONFIG_PATH } from "./config.js";

// Sits next to whichever config is in use — a scratch config pointed at via
// DEVHUB_CONFIG gets its own sibling state file, so manual/test runs never
// cross-contaminate the real one.
export const UI_STATE_PATH = process.env.DEVHUB_STATE ?? join(dirname(CONFIG_PATH), "devhub.state.json");

// "ignored" starts pre-collapsed — it's a rarely-visited bin, not something
// that should compete for attention with active projects on a fresh install.
const DEFAULT_UI_STATE: UiState = { ignoredDiscovered: [], collapsedGroups: ["section:ignored"] };

export function loadUiState(path: string = UI_STATE_PATH): UiState {
  if (!existsSync(path)) return DEFAULT_UI_STATE;
  try {
    const data = JSON.parse(readFileSync(path, "utf-8"));
    return {
      ignoredDiscovered: Array.isArray(data.ignoredDiscovered) ? data.ignoredDiscovered : [],
      collapsedGroups: Array.isArray(data.collapsedGroups) ? data.collapsedGroups : [],
    };
  } catch {
    return DEFAULT_UI_STATE;
  }
}

export function writeUiState(state: UiState, path: string = UI_STATE_PATH): void {
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
}
