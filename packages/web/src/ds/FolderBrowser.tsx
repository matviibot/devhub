import { useEffect, useState } from "react";
import type { DirectoryListing } from "../hooks/useDevhub";
import { Dialog } from "./Dialog";

interface Props {
  /** Path to seed the browser at — falls back to $HOME when absent/unreadable. */
  initialPath?: string;
  listing: DirectoryListing | null;
  onNavigate: (path?: string) => void;
  onSelect: (path: string) => void;
  onClose: () => void;
}

interface Crumb {
  label: string;
  path: string;
}

/** Collapses a "/Users/<name>" or "/home/<name>" prefix into one "~" crumb,
 *  then one crumb per remaining path segment — each crumb's `path` is the
 *  real absolute path up to that point, for navigation. */
function buildCrumbs(rawPath: string): Crumb[] {
  const m = /^\/(Users|home)\/[^/]+/.exec(rawPath);
  const crumbs: Crumb[] = [];
  let rest = rawPath;
  if (m) {
    crumbs.push({ label: "~", path: m[0] });
    rest = rawPath.slice(m[0].length);
  }
  let acc = crumbs.length ? crumbs[0].path : "";
  for (const seg of rest.split("/").filter(Boolean)) {
    acc += `/${seg}`;
    crumbs.push({ label: seg, path: acc });
  }
  if (crumbs.length === 0) crumbs.push({ label: "/", path: "/" });
  return crumbs;
}

/** Breadcrumb folder browser backed by the daemon's real filesystem access
 *  — the browser sandbox can't hand back an absolute OS path, but the
 *  daemon runs on the user's own machine and can just `readdir`. Embedded
 *  as a nested dialog above the Add/Edit Project/Server modal. */
export function FolderBrowser({ initialPath, listing, onNavigate, onSelect, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [pathText, setPathText] = useState("");

  useEffect(() => {
    onNavigate(initialPath);
    // Only on mount — subsequent navigation goes through go().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Only one directory listing request is ever in flight from this dialog,
  // so any listing that arrives while we're loading is the answer to it.
  useEffect(() => {
    setLoading(false);
    if (listing?.path) setPathText(listing.path);
  }, [listing]);

  function go(path?: string) {
    setLoading(true);
    onNavigate(path);
  }

  const current = listing?.path;
  const crumbs = current ? buildCrumbs(current) : [];

  return (
    <Dialog
      title="Choose a folder"
      width="520px"
      onClose={onClose}
      footer={
        <>
          <input
            value={pathText}
            onChange={(e) => setPathText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") go(pathText);
            }}
            spellCheck={false}
            style={{
              flex: "1 1 200px",
              minWidth: 0,
              background: "var(--dh-bg-input)",
              border: "1px solid var(--dh-border-control)",
              borderRadius: 8,
              padding: "9px 11px",
              color: "var(--dh-text-log-msg)",
              font: "400 12px/1 var(--font-mono)",
              outline: "none",
            }}
          />
          <button
            type="button"
            disabled={!current}
            onClick={() => current && onSelect(current)}
            style={{
              font: "500 11.5px/1 var(--font-mono)",
              color: "var(--dh-on-accent)",
              background: "var(--dh-accent)",
              border: "none",
              borderRadius: 8,
              padding: "9px 16px",
              cursor: current ? "pointer" : "default",
              opacity: current ? 1 : 0.5,
              flex: "0 0 auto",
            }}
            onMouseEnter={(e) => current && (e.currentTarget.style.background = "var(--dh-accent-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "var(--dh-accent)")}
          >
            select this folder
          </button>
        </>
      }
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <ChromeButton label="↑ up" onClick={() => listing?.parent != null && go(listing.parent)} disabled={listing?.parent == null} />
        <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 6, background: "var(--dh-bg-input)", border: "1px solid var(--dh-border-control)", borderRadius: 8, padding: "8px 11px", overflowX: "auto" }}>
          {crumbs.map((c, i) => (
            <span key={c.path} style={{ display: "flex", alignItems: "center", gap: 6, flex: "0 0 auto" }}>
              {i > 0 && <span style={{ color: "var(--dh-text-dot)", font: "400 12px/1 var(--font-mono)" }}>/</span>}
              <Crumb crumb={c} onGo={() => go(c.path)} />
            </span>
          ))}
        </div>
      </div>

      <div style={{ height: 240, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2, marginTop: -6 }}>
        {loading && <span style={{ padding: "10px 11px", font: "400 12px/1 var(--font-mono)", color: "var(--dh-text-muted)" }}>loading…</span>}
        {!loading && listing?.error && (
          <span style={{ padding: "10px 11px", font: "400 12px/1.5 var(--font-mono)", color: "var(--dh-alert-text)" }}>can't read this folder: {listing.error}</span>
        )}
        {!loading && listing && !listing.error && listing.entries.length === 0 && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, padding: 30 }}>
            <span style={{ width: 26, height: 26, border: "1px solid var(--dh-border-button)", borderRadius: 7 }} />
            <span style={{ font: "400 11.5px/1 var(--font-mono)", color: "var(--dh-text-host)" }}>no subfolders here</span>
          </div>
        )}
        {!loading &&
          listing?.entries.map((e) => (
            <DirRow key={e.name} name={e.name} hasPackageJson={e.hasPackageJson} onClick={() => go(`${listing.path.replace(/\/$/, "")}/${e.name}`)} />
          ))}
      </div>
    </Dialog>
  );
}

function Crumb({ crumb, onGo }: { crumb: Crumb; onGo: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <span
      onClick={onGo}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ font: "400 12px/1 var(--font-mono)", color: hover ? "var(--dh-text-bright)" : "var(--dh-text-action)", cursor: "pointer", whiteSpace: "nowrap" }}
    >
      {crumb.label}
    </span>
  );
}

function DirRow({ name, hasPackageJson, onClick }: { name: string; hasPackageJson: boolean; onClick: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 11px", borderRadius: 9, cursor: "pointer", background: hover ? "var(--dh-bg-row-hover)" : "transparent" }}
    >
      <span style={{ font: "400 12px/1 var(--font-mono)", color: "var(--dh-text-tertiary)", flex: "0 0 auto" }}>▸</span>
      <span style={{ font: "400 12.5px/1 var(--font-mono)", color: "var(--dh-text)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
      {hasPackageJson && <span style={{ font: "400 10.5px/1 var(--font-mono)", color: "var(--dh-text-faint)", flex: "0 0 auto" }}>pkg</span>}
    </div>
  );
}

function ChromeButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        font: "400 11px/1 var(--font-mono)",
        color: hover && !disabled ? "var(--dh-text-bright)" : "var(--dh-text-action)",
        background: hover && !disabled ? "var(--dh-bg-hover)" : "transparent",
        border: "1px solid var(--dh-border-button)",
        borderRadius: 8,
        padding: "8px 11px",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.4 : 1,
        flex: "0 0 auto",
      }}
    >
      {label}
    </button>
  );
}
