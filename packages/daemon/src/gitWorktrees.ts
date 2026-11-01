import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const EXEC_OPTS = { timeout: 3000 };

export interface GitWorktreeEntry {
  path: string;
  /** Null when checked out at a detached HEAD. */
  branch: string | null;
  /** Short commit sha. */
  head: string;
}

/** All worktrees tied to the repo at `repoPath`, including its own primary
 *  checkout (always the first entry). Returns `[]` for anything that isn't a
 *  git repo (or a git repo without a common-git-dir the CLI can read) rather
 *  than throwing — same tolerate-and-degrade shape as `runLsof`/`runDocker`
 *  in externalScan.ts, since a project root need not be a git repo at all. */
export async function listWorktrees(repoPath: string): Promise<GitWorktreeEntry[]> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync("git", ["-C", repoPath, "worktree", "list", "--porcelain"], EXEC_OPTS));
  } catch {
    return [];
  }

  const entries: GitWorktreeEntry[] = [];
  let path: string | null = null;
  let head = "";
  let branch: string | null = null;

  const flush = () => {
    if (path) entries.push({ path, branch, head: head.slice(0, 7) });
    path = null;
    head = "";
    branch = null;
  };

  for (const line of stdout.split("\n")) {
    if (line === "") {
      flush();
      continue;
    }
    if (line.startsWith("worktree ")) path = line.slice("worktree ".length).trim();
    else if (line.startsWith("HEAD ")) head = line.slice("HEAD ".length).trim();
    else if (line.startsWith("branch ")) branch = line.slice("branch refs/heads/".length).trim();
    // "detached" / "bare" / "locked" / "prunable" lines carry no extra data we use.
  }
  flush();

  return entries;
}
