/** Longest common directory prefix across a set of absolute paths. */
export function commonAncestor(paths: string[]): string {
  if (paths.length === 0) return "";
  const split = paths.map((p) => p.split("/"));
  const first = split[0];
  let i = 0;
  while (i < first.length && split.every((segs) => segs[i] === first[i])) i++;
  const common = first.slice(0, i).join("/");
  return common || "/";
}

/** Collapses "/Users/name" or "/home/name" to "~" for display. */
export function tildify(path: string): string {
  return path.replace(/^\/(Users|home)\/[^/]+/, "~");
}
