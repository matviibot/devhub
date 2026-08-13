import { useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { Icon } from "./Icon";

interface Props {
  label: string;
  count?: number;
  collapsed?: boolean;
  onToggle?: () => void;
  /** Extra content rendered right after the count, before the flex spacer —
   *  e.g. an attention badge and summary line. */
  extra?: ReactNode;
  actions?: ReactNode;
  sticky?: boolean;
  style?: CSSProperties;
  /** Presence renders a grip handle (visible on hover) that starts a
   *  framer-motion Reorder drag on pointerdown — pass `dragControls.start`. */
  onDragHandlePointerDown?: (e: PointerEvent<HTMLSpanElement>) => void;
}

/** Collapsible section header for a group of sidebar rows. */
export function GroupHeader({
  label,
  count,
  collapsed = false,
  onToggle,
  extra,
  actions,
  sticky = false,
  style,
  onDragHandlePointerDown,
  ...rest
}: Props) {
  const [hover, setHover] = useState(false);
  return (
    <div
      role="button"
      aria-expanded={!collapsed}
      tabIndex={0}
      onClick={onToggle}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
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
        ...style,
      }}
      {...rest}
    >
      {onDragHandlePointerDown && (
        <span
          onPointerDown={(e) => {
            e.stopPropagation();
            onDragHandlePointerDown(e);
          }}
          style={{ display: "flex", touchAction: "none" }}
        >
          <Icon
            name="grip-vertical"
            size={12}
            color="var(--color-outline)"
            style={{ opacity: hover ? 1 : 0, transition: "opacity var(--duration-fast) var(--ease-standard)", cursor: "grab" }}
          />
        </span>
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
      {extra}
      <span style={{ flex: 1 }} />
      {actions ? (
        <span style={{ display: "flex", gap: 2, opacity: hover ? 1 : 0, transition: "opacity var(--duration-fast) var(--ease-standard)" }}>
          {actions}
        </span>
      ) : null}
    </div>
  );
}
