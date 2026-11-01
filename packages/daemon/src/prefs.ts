import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Prefs } from "@devhub/shared";
import { CONFIG_PATH } from "./config.js";

// Sits next to whichever config is in use — a scratch config pointed at via
// DEVHUB_CONFIG gets its own sibling state file, so manual/test runs never
// cross-contaminate the real one.
export const PREFS_PATH = process.env.DEVHUB_STATE ?? join(dirname(CONFIG_PATH), "devhub.state.json");

const EMPTY: Prefs = { renames: {}, roleOrder: {}, projectOrder: [], collapsed: [] };

const isStringRecord = (v: unknown): v is Record<string, string> =>
  !!v && typeof v === "object" && !Array.isArray(v) && Object.values(v).every((x) => typeof x === "string");

const isRoleOrder = (v: unknown): v is Record<string, string[]> =>
  !!v && typeof v === "object" && !Array.isArray(v) && Object.values(v).every((x) => Array.isArray(x) && x.every((s) => typeof s === "string"));

/** Tolerates a missing file and a pre-rewrite one: the old shape's
 *  `ignoredDiscovered`/`collapsedGroups` referenced server ids that no longer
 *  exist, so there is nothing worth carrying over — it just starts empty. */
export function loadPrefs(path: string = PREFS_PATH): Prefs {
  if (!existsSync(path)) return { ...EMPTY };
  try {
    const data = JSON.parse(readFileSync(path, "utf-8")) as Partial<Prefs>;
    return {
      renames: isStringRecord(data.renames) ? data.renames : {},
      roleOrder: isRoleOrder(data.roleOrder) ? data.roleOrder : {},
      projectOrder: Array.isArray(data.projectOrder) ? data.projectOrder.filter((s) => typeof s === "string") : [],
      collapsed: Array.isArray(data.collapsed) ? data.collapsed.filter((s) => typeof s === "string") : [],
    };
  } catch {
    return { ...EMPTY };
  }
}

export function writePrefs(prefs: Prefs, path: string = PREFS_PATH): void {
  writeFileSync(path, `${JSON.stringify(prefs, null, 2)}\n`, "utf-8");
}
