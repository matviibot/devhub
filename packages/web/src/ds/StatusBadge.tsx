import type { CSSProperties, ReactNode } from "react";
import type { ProcessStatus } from "@devhub/shared";
import { STATUS_ROLES } from "./StatusDot";

interface Props {
  status?: ProcessStatus;
  children?: ReactNode;
  tone?: "soft" | "outline";
  size?: "sm" | "md";
  showDot?: boolean;
  style?: CSSProperties;
}

/** Status pill: dot + label on the matching container role. */
export function StatusBadge({ status = "stopped", children, tone = "soft", size = "sm", showDot = true, style, ...rest }: Props) {
  const r = STATUS_ROLES[status] || STATUS_ROLES.stopped;
  const sm = size === "sm";
  const outline = tone === "outline";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        height: sm ? 18 : 20,
        padding: sm ? "0 6px" : "0 8px",
        borderRadius: "var(--radius-full)",
        background: outline ? "transparent" : r.container,
        boxShadow: outline ? `inset 0 0 0 1px ${r.color}` : undefined,
        color: outline ? r.color : r.on,
        font: `var(--text-label-${sm ? "small" : "medium"}-weight) var(--text-label-${sm ? "small" : "medium"}-size)/var(--text-label-${sm ? "small" : "medium"}-line) var(--font-ui)`,
        letterSpacing: `var(--text-label-${sm ? "small" : "medium"}-track)`,
        whiteSpace: "nowrap",
        ...style,
      }}
      {...rest}
    >
      {showDot && (
        <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "var(--radius-full)", flex: "0 0 auto", background: r.color }} />
      )}
      {children ?? r.label}
    </span>
  );
}
