import { useState, type DragEvent, type MouseEvent } from "react";
import type { ProcessStatus } from "@devhub/shared";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { IconButton } from "./IconButton";
import { MenuButton, type MenuButtonItem } from "./MenuButton";
import { StatusDot } from "./StatusDot";

export interface ServerCardData {
  id: string;
  name: string;
  status: ProcessStatus;
  /** Tildified working directory (process-kind) or container ref
   *  (docker-kind) — servers are grouped by project, not co-located, so
   *  each card carries its own real location. */
  pathLine: string;
  /** Icon shown next to pathLine — defaults to "folder"; pass "container"
   *  for docker-kind cards. */
  pathIcon?: string;
  metaLine: string;
  portLabel?: string;
  url?: string;
  /** Drawer is open for this card. */
  active?: boolean;
  /** Show edit/delete on hover — configured servers only. */
  editable?: boolean;
  /** Dashed outline, transparent fill — discovered suggestions. */
  ghost?: boolean;
  /** Non-clickable name, no log-stream affordance — discovered suggestions. */
  static?: boolean;
  showStart?: boolean;
  showTrack?: boolean;
  showRestart?: boolean;
  showStop?: boolean;
  /** Start/stop/restart was just clicked and hasn't been confirmed by the
   *  daemon yet — shows a spinner on the action button instead of leaving
   *  it looking inert while the request is in flight. */
  pending?: boolean;
  /** Renders the "Add ▾" project-picker menu — discovered suggestions only. */
  showAddMenu?: boolean;
  showIgnore?: boolean;
  showUnignore?: boolean;
}

interface Props {
  card: ServerCardData;
  /** Options for the "Add ▾" menu — required when card.showAddMenu is set. */
  addMenuItems?: MenuButtonItem[];
  onOpen?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onStart?: () => void;
  onStop?: () => void;
  onRestart?: () => void;
  onTrack?: () => void;
  onIgnore?: () => void;
  onUnignore?: () => void;
  /** Presence makes the card draggable (a grip handle appears on hover). */
  onDragStart?: (e: DragEvent<HTMLDivElement>) => void;
  onDragOver?: (e: DragEvent<HTMLDivElement>) => void;
  onDrop?: (e: DragEvent<HTMLDivElement>) => void;
  onDragEnd?: () => void;
  dragging?: boolean;
}

/** Dashboard grid tile for a single server — status, meta, and its controls. */
export function ServerCard({
  card,
  addMenuItems,
  onOpen,
  onEdit,
  onDelete,
  onStart,
  onStop,
  onRestart,
  onTrack,
  onIgnore,
  onUnignore,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  dragging = false,
}: Props) {
  const [hover, setHover] = useState(false);
  const draggable = !!onDragStart;
  const [nameHover, setNameHover] = useState(false);
  const ghost = !!card.ghost;
  const showLogs = !card.static;
  const showRowActions = hover && !!card.editable;
  const showPort = !(hover && card.editable) && !!card.portLabel;
  const showNoPort = !(hover && card.editable) && !card.portLabel && !card.static;

  const stop = (fn?: () => void) => (e: MouseEvent) => {
    e.stopPropagation();
    fn?.();
  };

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 9,
        padding: "9px 9px 8px",
        borderRadius: "var(--radius-lg)",
        background: ghost
          ? hover
            ? "var(--state-hover)"
            : "transparent"
          : card.active
            ? "var(--state-selected)"
            : hover
              ? "var(--color-surface-container)"
              : "var(--color-surface-container-low)",
        boxShadow: ghost ? "none" : card.active ? "inset 0 0 0 1px var(--color-primary)" : "var(--inset-hairline)",
        border: ghost ? "1px dashed var(--color-outline-variant)" : "1px solid transparent",
        transition: "var(--transition-state)",
        fontFamily: "var(--font-ui)",
        opacity: dragging ? 0.4 : 1,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, height: 20 }}>
        {draggable && (
          <Icon
            name="grip-vertical"
            size={12}
            color="var(--color-outline)"
            style={{ flex: "0 0 auto", opacity: hover ? 1 : 0, transition: "opacity var(--duration-fast) var(--ease-standard)", cursor: "grab" }}
          />
        )}
        <StatusDot status={card.status} size={9} ring />

        {card.static ? (
          <span
            style={{
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              font: "600 13px/18px var(--font-ui)",
              letterSpacing: "-0.1px",
              color: "var(--color-on-surface)",
            }}
          >
            {card.name}
          </span>
        ) : (
          <span
            role="button"
            tabIndex={0}
            title="Open log stream"
            onClick={onOpen}
            onMouseEnter={() => setNameHover(true)}
            onMouseLeave={() => setNameHover(false)}
            style={{
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              font: "600 13px/18px var(--font-ui)",
              letterSpacing: "-0.1px",
              color: nameHover ? "var(--color-primary)" : "var(--color-on-surface)",
              cursor: "default",
              transition: "var(--transition-state)",
            }}
          >
            {card.name}
          </span>
        )}

        {showRowActions && (
          <span style={{ display: "flex", gap: 2, flex: "0 0 auto" }}>
            <IconButton icon="pencil" label="Edit server" size="sm" onClick={stop(onEdit)} />
            <IconButton icon="trash-2" label="Delete server" size="sm" onClick={stop(onDelete)} />
          </span>
        )}

        {showPort && (
          <a
            href={card.url}
            target="_blank"
            rel="noreferrer"
            title="Open in browser"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              height: 20,
              padding: "0 5px",
              flex: "0 0 auto",
              borderRadius: "var(--radius-xs)",
              font: "400 11px/1 var(--font-mono)",
              fontVariantNumeric: "tabular-nums",
              color: "var(--color-primary)",
              textDecoration: "none",
            }}
          >
            {card.portLabel}
          </a>
        )}
        {showNoPort && <span style={{ font: "400 11px/1 var(--font-mono)", color: "var(--color-outline)", flex: "0 0 auto" }}>no port</span>}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 4, overflow: "hidden" }}>
        <Icon name={card.pathIcon ?? "folder"} size={11} color="var(--color-outline)" style={{ flex: "0 0 auto" }} />
        <span
          style={{
            font: "400 11px/16px var(--font-mono)",
            color: "var(--color-outline)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {card.pathLine}
        </span>
      </div>

      <div
        style={{
          font: "400 11px/16px var(--font-mono)",
          color: "var(--color-on-surface-variant)",
          fontVariantNumeric: "tabular-nums",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {card.metaLine}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {card.showStart && (
          <Button variant="primary" size="sm" icon="play" loading={card.pending} onClick={stop(onStart)}>
            Start
          </Button>
        )}
        {card.showTrack && (
          <Button variant="tonal" size="sm" icon="link" onClick={stop(onTrack)}>
            Track
          </Button>
        )}
        {card.showRestart && (
          <Button variant="secondary" size="sm" icon="rotate-cw" loading={card.pending} onClick={stop(onRestart)}>
            Restart
          </Button>
        )}
        {card.showStop && (
          <Button variant="secondary" size="sm" icon="square" loading={card.pending} onClick={stop(onStop)}>
            Stop
          </Button>
        )}
        {card.showAddMenu && addMenuItems && <MenuButton label="Add" items={addMenuItems} />}
        {card.showIgnore && (
          <Button variant="ghost" size="sm" onClick={stop(onIgnore)}>
            Ignore
          </Button>
        )}
        {card.showUnignore && (
          <Button variant="ghost" size="sm" icon="rotate-ccw" onClick={stop(onUnignore)}>
            Unignore
          </Button>
        )}
        <span style={{ flex: 1 }} />
        {showLogs && <IconButton icon="scroll-text" label="Open log stream" size="sm" selected={card.active} onClick={stop(onOpen)} />}
      </div>
    </div>
  );
}
