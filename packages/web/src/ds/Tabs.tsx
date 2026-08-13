import { useState, type CSSProperties } from "react";
import type { ProcessStatus } from "@devhub/shared";
import { Icon } from "./Icon";
import { StatusDot } from "./StatusDot";

export interface TabItem {
  id: string;
  label: string;
  status?: ProcessStatus;
  icon?: string;
  count?: number;
}

interface TabProps {
  item: TabItem;
  active: boolean;
  variant: "segmented" | "underline";
  onSelect?: (id: string) => void;
}

function Tab({ item, active, variant, onSelect }: TabProps) {
  const [hover, setHover] = useState(false);
  const segmented = variant === "segmented";
  return (
    <div
      role="tab"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      onClick={() => onSelect?.(item.id)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        height: segmented ? "var(--control-height-sm)" : 28,
        padding: segmented ? "0 10px" : "0 2px",
        borderRadius: segmented ? "var(--radius-xs)" : 0,
        boxShadow: segmented ? undefined : `inset 0 -2px 0 ${active ? "var(--color-primary)" : "transparent"}`,
        background: segmented ? (active ? "var(--state-selected)" : hover ? "var(--state-hover)" : "transparent") : "transparent",
        color: active ? "var(--color-on-surface)" : "var(--color-on-surface-variant)",
        fontFamily: "var(--font-ui)",
        fontWeight: active ? 600 : 400,
        fontSize: "var(--text-label-medium-size)",
        lineHeight: 1,
        cursor: "default",
        transition: "var(--transition-state)",
        outline: "none",
        whiteSpace: "nowrap",
      }}
    >
      {item.status ? <StatusDot status={item.status} size={7} /> : item.icon ? <Icon name={item.icon} size={13} /> : null}
      {item.label}
      {item.count != null ? (
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
          {item.count}
        </span>
      ) : null}
    </div>
  );
}

interface Props {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  variant?: "segmented" | "underline";
  style?: CSSProperties;
}

/** Horizontal tab strip — segmented (filter) or underline (view switch). */
export function Tabs({ items, value, onChange, variant = "segmented", style }: Props) {
  const segmented = variant === "segmented";
  return (
    <div
      role="tablist"
      style={{
        boxSizing: "border-box",
        display: "inline-flex",
        alignItems: "center",
        gap: segmented ? 2 : 0,
        padding: segmented ? 2 : 0,
        borderRadius: segmented ? "var(--radius-sm)" : 0,
        background: segmented ? "var(--color-surface-container-lowest)" : "transparent",
        boxShadow: segmented ? "var(--inset-hairline)" : undefined,
        ...style,
      }}
    >
      {items.map((it) => (
        <Tab key={it.id} item={it} active={it.id === value} variant={variant} onSelect={onChange} />
      ))}
    </div>
  );
}
