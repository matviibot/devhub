import type { CSSProperties } from "react";
import type { ServiceStatus } from "@devhub/shared";

export const STATUS_ROLES: Record<ServiceStatus, { color: string; container: string; on: string; label: string; pulse: boolean }> = {
  running: { color: "var(--status-running)", container: "var(--status-running-container)", on: "var(--status-on-running-container)", label: "Running", pulse: false },
  starting: { color: "var(--status-starting)", container: "var(--status-starting-container)", on: "var(--status-on-starting-container)", label: "Starting", pulse: true },
  crashed: { color: "var(--status-crashed)", container: "var(--status-crashed-container)", on: "var(--status-on-crashed-container)", label: "Crashed", pulse: false },
  stopped: { color: "var(--status-stopped)", container: "var(--status-stopped-container)", on: "var(--status-on-stopped-container)", label: "Stopped", pulse: false },
};

interface Props {
  status?: ServiceStatus;
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
      // Tagged so prefers-reduced-motion can stop an indefinite pulse — an
      // animation that never ends is the clearest case for that setting.
      data-dh-pulse={r.pulse ? "1" : undefined}
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "var(--radius-full)",
        flex: "0 0 auto",
        background: hollow ? "transparent" : r.color,
        // 2px, not 1.5px. Hollow stays the shape distinction between stopped
        // and running, but as a 1.5px annulus in a 2.35:1 tone it was the
        // faintest mark in the UI — and "what is NOT running" is half of what
        // this dashboard is for. The tone moved to 4.8:1 in the token.
        boxShadow:
          [hollow ? `inset 0 0 0 2px ${r.color}` : null, ring ? `0 0 0 3px ${r.container}` : null]
            .filter(Boolean)
            .join(",") || undefined,
        animation: r.pulse ? "ds-pulse 1.4s var(--ease-standard) infinite" : undefined,
        ...style,
      }}
      {...rest}
    />
  );
}
