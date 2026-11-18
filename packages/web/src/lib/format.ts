const pad = (n: number, w: number) => String(n).padStart(w, "0");

export function stamp(d: Date): string {
  return `${pad(d.getHours(), 2)}:${pad(d.getMinutes(), 2)}:${pad(d.getSeconds(), 2)}.${pad(d.getMilliseconds(), 3)}`;
}

export function dur(ms: number | null): string {
  if (ms == null) return "—";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h}h ${m % 60}m`;
  if (m) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export function bytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.round(n / 1024 ** 2)} MB`;
}

/** "12% CPU · 340 MB", or null when nothing is running. */
export function usage(s: { cpu: number; rssBytes: number } | undefined): string | null {
  return s ? `${Math.round(s.cpu)}% CPU · ${bytes(s.rssBytes)}` : null;
}

/** "3 changed · ↑2 ↓1", or null when the worktree is clean and in sync. */
export function gitSummary(g: { changed: number; ahead: number | null; behind: number | null } | undefined): string | null {
  if (!g) return null;
  const parts = [g.changed ? `${g.changed} changed` : "", g.ahead ? `↑${g.ahead}` : "", g.behind ? `↓${g.behind}` : ""].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}
