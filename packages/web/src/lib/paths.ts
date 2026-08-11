/** Collapses "/Users/name" or "/home/name" to "~" for display. */
export function tildify(path: string): string {
  return path.replace(/^\/(Users|home)\/[^/]+/, "~");
}
