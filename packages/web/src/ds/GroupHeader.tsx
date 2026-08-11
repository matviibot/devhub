import { useState, type CSSProperties, type DragEvent, type ReactNode } from "react";
import { Icon } from "./Icon";

interface Props {
  label: string;
  count?: number;
  collapsed?: boolean;
  onToggle?: () => void;
  actions?: ReactNode;
  sticky?: boolean;
  style?: CSSProperties;
  /** Presence makes the header draggable (a grip handle appears on hover). */
  onDragStart?: (e: DragEvent<HTMLDivElement>) => void;
  onDragOver?: (e: DragEvent<HTMLDivElement>) => void;
  onDrop?: (e: DragEvent<HTMLDivElement>) => void;
  onDragEnd?: () => void;
  dragging?: boolean;
}

/** Collapsible section header for a group of sidebar rows. */
export function GroupHeader({
  label,
  count,
  collapsed = false,
  onToggle,
  actions,
  sticky = false,
  style,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  dragging = false,
  ...rest
}: Props) {
  const [hover, setHover] = useState(false);
  const draggable = !!onDragStart;
  return (
    <div
      role="button"
      aria-expanded={!collapsed}
      tabIndex={0}
      onClick={onToggle}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        height: 24,
        padding: "0 8px 0 4px",
        position: sticky ? "sticky" : undefined,
        top: sticky ? 0 : undefined,
        zIndex: sticky ? 1 : undefined,
        background: sticky ? "var(--material-regular)" : "transparent",
        backdropFilter: sticky ? "saturate(180%) blur(var(--material-blur))" : undefined,
        WebkitBackdropFilter: sticky ? "saturate(180%) blur(var(--material-blur))" : undefined,
        cursor: "default",
        userSelect: "none",
        outline: "none",
        opacity: dragging ? 0.4 : 1,
        ...style,
      }}
      {...rest}
    >
      {draggable && (
        <Icon
          name="grip-vertical"
          size={12}
          color="var(--color-outline)"
          style={{ opacity: hover ? 1 : 0, transition: "opacity var(--duration-fast) var(--ease-standard)", cursor: "grab" }}
        />
      )}
      <Icon
        name="chevron-down"
        size={12}
        color="var(--color-outline)"
        style={{ transform: collapsed ? "rotate(-90deg)" : "none", transition: "transform var(--duration-fast) var(--ease-standard)" }}
      />
      <span
        style={{
          font: "var(--text-label-small-weight) var(--text-label-small-size)/var(--text-label-small-line) var(--font-ui)",
          letterSpacing: "var(--text-label-small-track)",
          textTransform: "uppercase",
          color: "var(--color-on-surface-variant)",
          flex: "0 0 auto",
        }}
      >
        {label}
      </span>
      {count != null ? (
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontWeight: 400,
            fontSize: "var(--text-mono-small-size)",
            lineHeight: 1,
            color: "var(--color-outline)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {count}
        </span>
      ) : null}
      <span style={{ flex: 1 }} />
      {actions ? (
        <span style={{ display: "flex", gap: 2, opacity: hover ? 1 : 0, transition: "opacity var(--duration-fast) var(--ease-standard)" }}>
          {actions}
        </span>
      ) : null}
    </div>
  );
}
