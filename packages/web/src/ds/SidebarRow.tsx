import { useState, type CSSProperties, type ReactNode } from "react";
import type { ProcessStatus } from "@devhub/shared";
import { Icon } from "./Icon";
import { StatusDot } from "./StatusDot";

interface Props {
  label: string;
  status?: ProcessStatus;
  icon?: string;
  meta?: ReactNode;
  badge?: ReactNode;
  selected?: boolean;
  indent?: number;
  density?: "compact" | "default" | "comfy";
  actions?: ReactNode;
  onClick?: () => void;
  style?: CSSProperties;
}

/** One selectable process row in the sidebar list. */
export function SidebarRow({
  label,
  status,
  icon,
  meta,
  badge,
  selected = false,
  indent = 0,
  density = "default",
  actions,
  onClick,
  style,
  ...rest
}: Props) {
  const [hover, setHover] = useState(false);
  const h = density === "compact" ? "var(--row-height-compact)" : density === "comfy" ? "var(--row-height-comfy)" : "var(--row-height)";
  return (
    <div
      role="option"
      aria-selected={selected}
      tabIndex={0}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        height: h,
        flex: "0 0 auto",
        padding: `0 8px 0 ${8 + indent * 14}px`,
        borderRadius: "var(--radius-sm)",
        background: selected ? "var(--state-selected)" : hover ? "var(--state-hover)" : "transparent",
        color: selected ? "var(--color-on-surface)" : "var(--color-on-surface-variant)",
        cursor: "default",
        transition: "var(--transition-state)",
        outline: "none",
        boxShadow: selected ? "inset 0 0 0 1px var(--state-selected)" : undefined,
        ...style,
      }}
      {...rest}
    >
      {status ? <StatusDot status={status} /> : icon ? <Icon name={icon} size={14} color="var(--color-on-surface-variant)" /> : null}
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontFamily: "var(--font-ui)",
          fontWeight: selected ? 600 : 400,
          fontSize: "var(--text-body-medium-size)",
          lineHeight: "var(--text-body-medium-line)",
          color: selected ? "var(--color-on-surface)" : "inherit",
          fontFeatureSettings: "var(--font-feature-ui)",
        }}
      >
        {label}
      </span>
      {meta ? (
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontWeight: 400,
            fontSize: "var(--text-mono-small-size)",
            lineHeight: 1,
            color: "var(--color-outline)",
            fontVariantNumeric: "tabular-nums",
            flex: "0 0 auto",
            visibility: hover && actions ? "hidden" : "visible",
          }}
        >
          {meta}
        </span>
      ) : null}
      {badge}
      {actions ? (
        <span style={{ display: "flex", gap: 2, flex: "0 0 auto", opacity: hover ? 1 : 0, transition: "opacity var(--duration-fast) var(--ease-standard)" }}>
          {actions}
        </span>
      ) : null}
    </div>
  );
}
