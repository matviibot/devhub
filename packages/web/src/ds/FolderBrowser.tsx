import { useEffect, useState } from "react";
import type { DirectoryListing } from "../hooks/useDevhub";
import { Button } from "./Button";
import { Dialog } from "./Dialog";
import { Icon } from "./Icon";
import { IconButton } from "./IconButton";

interface Props {
  /** Path to seed the browser at — falls back to $HOME when absent/unreadable. */
  initialPath?: string;
  listing: DirectoryListing | null;
  onNavigate: (path?: string) => void;
  onSelect: (path: string) => void;
  onClose: () => void;
}

/** Breadcrumb-style folder browser backed by the daemon's real filesystem
 *  access — the browser sandbox can't hand back an absolute OS path, but the
 *  daemon runs on the user's own machine and can just `readdir`. */
export function FolderBrowser({ initialPath, listing, onNavigate, onSelect, onClose }: Props) {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    onNavigate(initialPath);
    // Only on mount — subsequent navigation goes through go().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Only one directory listing request is ever in flight from this dialog,
  // so any listing that arrives while we're loading is the answer to it.
  useEffect(() => {
    setLoading(false);
  }, [listing]);

  function go(path?: string) {
    setLoading(true);
    onNavigate(path);
  }

  const current = listing?.path;

  return (
    <Dialog
      icon="folder-open"
      title="Choose folder"
      width="440px"
      onClose={onClose}
      footer={
        <>
          <span
            style={{
              flex: 1,
              minWidth: 0,
              font: "400 11px/1 var(--font-mono)",
              color: "var(--color-outline)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={current}
          >
            {current ?? ""}
          </span>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" icon="check" disabled={!current} onClick={() => current && onSelect(current)}>
            Use this folder
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            height: 30,
            padding: "0 4px 0 8px",
            borderRadius: "var(--radius-sm)",
            background: "var(--color-surface-container-lowest)",
            boxShadow: "var(--inset-hairline)",
          }}
        >
          <IconButton icon="home" label="Go to home folder" size="sm" onClick={() => go(undefined)} />
          <Icon name="folder" size={12} color="var(--color-outline)" />
          <span
            style={{
              flex: 1,
              minWidth: 0,
              font: "400 12px/1 var(--font-mono)",
              color: "var(--color-on-surface)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              direction: "rtl",
              textAlign: "left",
            }}
            title={current}
          >
            {current ?? "…"}
          </span>
          <IconButton icon="refresh-cw" label="Rescan" size="sm" onClick={() => go(current)} />
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            height: 300,
            overflowY: "auto",
            borderRadius: "var(--radius-md)",
            background: "var(--color-surface-container-lowest)",
            boxShadow: "var(--inset-hairline)",
          }}
        >
          {listing?.parent != null && <Row icon="corner-left-up" label=".." onClick={() => go(listing.parent!)} />}
          {loading && (
            <div style={{ padding: "10px 12px", font: "400 12px/1 var(--font-mono)", color: "var(--color-outline)" }}>loading…</div>
          )}
          {!loading && listing?.error && (
            <div style={{ padding: "10px 12px", font: "400 12px/16px var(--font-mono)", color: "var(--color-error)" }}>
              Can't read this folder: {listing.error}
            </div>
          )}
          {!loading && listing && !listing.error && listing.entries.length === 0 && (
            <div style={{ padding: "10px 12px", font: "400 12px/1 var(--font-mono)", color: "var(--color-outline)" }}>no subfolders</div>
          )}
          {!loading &&
            listing?.entries.map((e) => (
              <Row
                key={e.name}
                icon="folder"
                label={e.name}
                onClick={() => go(`${listing.path.replace(/\/$/, "")}/${e.name}`)}
              />
            ))}
        </div>
      </div>
    </Dialog>
  );
}

function Row({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        height: 30,
        padding: "0 10px",
        flex: "0 0 auto",
        background: hover ? "var(--state-hover)" : "transparent",
        cursor: "default",
        font: "400 12px/1 var(--font-ui)",
        color: "var(--color-on-surface)",
      }}
    >
      <Icon name={icon} size={13} color="var(--color-on-surface-variant)" />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
    </div>
  );
}
