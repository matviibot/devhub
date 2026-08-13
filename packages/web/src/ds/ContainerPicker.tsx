import { useEffect, useState } from "react";
import type { DockerContainerInfo } from "@devhub/shared";

function relativeTime(ms: number | null, now: number): string {
  if (ms == null) return "never";
  const s = Math.floor((now - ms) / 1000);
  if (s < 2) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  return `${m}m ago`;
}

function stateColor(running: boolean, state: string): string {
  if (running) return "var(--dh-status-running)";
  if (state === "paused" || state === "restarting") return "var(--dh-status-starting)";
  return "var(--dh-text-muted)";
}

interface Props {
  containers: DockerContainerInfo[];
  fetchedAt: number | null;
  onRefresh: () => void;
  onPick: (c: DockerContainerInfo) => void;
  onClose: () => void;
}

/** Filterable "docker ps -a" list — opened from the Add/Edit Server
 *  dialog's docker "change" button. */
export function ContainerPicker({ containers, fetchedAt, onRefresh, onPick, onClose }: Props) {
  const [q, setQ] = useState("");
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    onRefresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const filtered = containers.filter((c) => {
    const query = q.trim().toLowerCase();
    if (!query) return true;
    return c.names.some((n) => n.toLowerCase().includes(query)) || c.image.toLowerCase().includes(query);
  });

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 45, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "var(--dh-scrim)", opacity: 0.58, animation: "dh-scrim-in var(--duration-normal) var(--ease-out)" }} />
      <div
        style={{
          position: "relative",
          width: 460,
          maxWidth: "calc(100% - 32px)",
          background: "var(--dh-bg-card)",
          border: "1px solid var(--dh-border-button)",
          borderRadius: 10,
          display: "flex",
          flexDirection: "column",
          animation: "dhrise .2s ease-out both",
        }}
      >
        <div style={{ padding: "18px 20px 14px", borderBottom: "1px solid var(--dh-border-hairline)", display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ font: "600 14px/1 var(--font-ui)", letterSpacing: "-0.015em", color: "var(--dh-text)" }}>Pick a container</span>
            <span style={{ flex: 1 }} />
            <span style={{ font: "400 10.5px/1 var(--font-mono)", color: "var(--dh-text-tertiary)" }}>{filtered.length}</span>
          </div>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="filter by name or image"
            spellCheck={false}
            autoFocus
            style={{ background: "var(--dh-bg-input)", border: "1px solid var(--dh-border-control)", borderRadius: 8, padding: "9px 11px", color: "var(--dh-text)", font: "400 12px/1 var(--font-mono)", outline: "none", width: "100%" }}
          />
        </div>

        <div style={{ height: 250, overflowY: "auto", padding: 10, display: "flex", flexDirection: "column", gap: 2 }}>
          {filtered.map((c) => (
            <ContainerRow key={c.id} c={c} onPick={() => onPick(c)} />
          ))}
          {filtered.length === 0 && (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, padding: 30 }}>
              <span style={{ width: 26, height: 26, border: "1px solid var(--dh-border-button)", borderRadius: 7 }} />
              <span style={{ font: "400 11.5px/1 var(--font-mono)", color: "var(--dh-text-host)" }}>{containers.length === 0 ? "no containers found" : "no matches"}</span>
            </div>
          )}
        </div>

        <div style={{ padding: "12px 20px 14px", borderTop: "1px solid var(--dh-border-hairline)", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ font: "400 10px/1 var(--font-mono)", color: "var(--dh-text-faint)", letterSpacing: "0.04em" }}>docker ps -a · refreshed {relativeTime(fetchedAt, now)}</span>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            onClick={onRefresh}
            style={{ font: "400 11px/1 var(--font-mono)", color: "var(--dh-text-action)", background: "transparent", border: "1px solid var(--dh-border-button)", borderRadius: 8, padding: "7px 12px", cursor: "pointer" }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--dh-bg-hover)";
              e.currentTarget.style.color = "var(--dh-text-bright)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "var(--dh-text-action)";
            }}
          >
            refresh
          </button>
        </div>
      </div>
    </div>
  );
}

function ContainerRow({ c, onPick }: { c: DockerContainerInfo; onPick: () => void }) {
  const [hover, setHover] = useState(false);
  const name = c.names[0] ?? c.id.slice(0, 12);
  return (
    <div
      onClick={onPick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ display: "flex", alignItems: "center", gap: 11, padding: 11, borderRadius: 9, cursor: "pointer", background: hover ? "var(--dh-bg-row-hover)" : "transparent" }}
    >
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: stateColor(c.running, c.state), flex: "0 0 auto" }} />
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
        <span style={{ font: "400 12.5px/1 var(--font-mono)", color: "var(--dh-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
        <span style={{ font: "400 10.5px/1 var(--font-mono)", color: "var(--dh-text-host)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.image}</span>
      </div>
      <span style={{ font: "400 10px/1 var(--font-mono)", letterSpacing: "0.06em", textTransform: "uppercase", color: stateColor(c.running, c.state), flex: "0 0 auto" }}>{c.state}</span>
    </div>
  );
}
