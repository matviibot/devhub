import assert from "node:assert/strict";
import { test } from "node:test";
import { parseBytes, parseGitStatus, subtree } from "./resourceStats.js";

test("parseBytes reads docker MemUsage units", () => {
  assert.equal(parseBytes("12.5MiB "), Math.round(12.5 * 1024 ** 2));
  assert.equal(parseBytes("1.2GiB"), Math.round(1.2 * 1024 ** 3));
  assert.equal(parseBytes("512kB"), 512000);
  assert.equal(parseBytes("garbage"), 0);
});

test("parseGitStatus counts entries and ahead/behind", () => {
  const out = "# branch.oid abc\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +2 -1\n1 .M N... 100644 100644 100644 a b src/x.ts\n? new.txt\n";
  assert.deepEqual(parseGitStatus(out), { changed: 2, ahead: 2, behind: 1 });
  assert.deepEqual(parseGitStatus("# branch.head main\n"), { changed: 0, ahead: null, behind: null });
});

test("subtree stops at another service's root", () => {
  // 1 = devhub daemon, 2 = a service it launched (with child 3), 4 = daemon's own helper.
  const children = new Map([[1, [2, 4]], [2, [3]]]);
  assert.deepEqual(subtree(1, children, new Set([1, 2])).sort(), [1, 4]);
  assert.deepEqual(subtree(2, children, new Set([1, 2])).sort(), [2, 3]);
});
