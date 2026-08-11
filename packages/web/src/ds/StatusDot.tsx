import type { CSSProperties } from "react";
import type { ProcessStatus } from "@devhub/shared";

export const STATUS_ROLES: Record<ProcessStatus, { color: string; container: string; on: string; label: string; pulse: boolean }> = {
  running: { color: "var(--status-running)", container: "var(--status-running-container)", on: "var(--status-on-running-container)", label: "Running", pulse: false },
  starting: { color: "var(--status-starting)", container: "var(--status-starting-container)", on: "var(--status-on-starting-container)", label: "Starting", pulse: true },
  crashed: { color: "var(--status-crashed)", container: "var(--status-crashed-container)", on: "var(--status-on-crashed-container)", label: "Crashed", pulse: false },
  stopped: { color: "var(--status-stopped)", container: "var(--status-stopped-container)", on: "var(--status-on-stopped-container)", label: "Stopped", pulse: false },
};

interface Props {
  status?: ProcessStatus;
  size?: number;
  ring?: boolean;
  style?: CSSProperties;
}

/** 8px status dot. Semantic role in, no decoration. */
export function StatusDot({ status = "stopped", size = 8, ring = false, style, ...rest }: Props) {
  const r = STATUS_ROLES[status] || STATUS_ROLES.stopped;
  const hollow = status === "stopped";
  return (
    <span
      role="img"
      aria-label={r.label}
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "var(--radius-full)",
        flex: "0 0 auto",
        background: hollow ? "transparent" : r.color,
        boxShadow:
          [hollow ? `inset 0 0 0 1.5px ${r.color}` : null, ring ? `0 0 0 3px ${r.container}` : null]
            .filter(Boolean)
            .join(",") || undefined,
        animation: r.pulse ? "ds-pulse 1.4s var(--ease-standard) infinite" : undefined,
        ...style,
      }}
      {...rest}
    />
  );
}
