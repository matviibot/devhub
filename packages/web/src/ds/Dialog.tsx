import type { ReactNode } from "react";
import { Icon } from "./Icon";
import { IconButton } from "./IconButton";

interface Props {
  icon: string;
  title: string;
  width?: string;
  onClose: () => void;
  footer: ReactNode;
  children: ReactNode;
}

/** Scrim + centered panel, matching the console chrome (header/body/footer). */
export function Dialog({ icon, title, width = "440px", onClose, footer, children }: Props) {
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 40, display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: 48 }}>
      <div
        data-dh-scrim="1"
        onClick={onClose}
        style={{ position: "absolute", inset: 0, background: `rgba(0, 0, 0, var(--scrim-alpha))`, animation: "dh-scrim-in var(--duration-fast) var(--ease-standard)" }}
      />
      <div
        data-dh-dialog="1"
        role="dialog"
        aria-modal="true"
        style={{
          position: "relative",
          width,
          maxWidth: "calc(100% - 48px)",
          maxHeight: "calc(100% - 96px)",
          display: "flex",
          flexDirection: "column",
          background: "var(--color-surface-container-high)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--elevation-4)",
          overflow: "hidden",
          animation: "dh-dialog-in var(--duration-normal) var(--ease-out)",
        }}
      >
        <div
          style={{
            flex: "0 0 auto",
            height: 38,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "0 6px 0 12px",
            background: "var(--material-thick)",
            backdropFilter: "saturate(180%) blur(var(--material-blur-thick))",
            boxShadow: "inset 0 -1px 0 var(--material-hairline)",
          }}
        >
          <Icon name={icon} size={15} color="var(--color-on-surface-variant)" />
          <span
            style={{
              flex: 1,
              minWidth: 0,
              font: "600 13px/1 var(--font-ui)",
              letterSpacing: "-0.1px",
              color: "var(--color-on-surface)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {title}
          </span>
          <IconButton icon="x" label="Close" size="sm" onClick={onClose} />
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 12 }}>{children}</div>

        <div
          style={{
            flex: "0 0 auto",
            height: 44,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "0 12px",
            background: "var(--color-surface-container)",
            boxShadow: "inset 0 1px 0 var(--material-hairline)",
          }}
        >
          {footer}
        </div>
      </div>
    </div>
  );
}
