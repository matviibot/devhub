import type { ReactNode } from "react";

interface Props {
  title: string;
  /** 11px mono secondary line under the title, e.g. "acme · main". */
  subtitle?: string;
  width?: string;
  onClose: () => void;
  /** Compact-only: replaces the × with a "‹ back" affordance. Falls back
   *  to `onClose` when omitted. */
  onBack?: () => void;
  /** Left-aligned destructive action in the footer (e.g. "delete project"),
   *  separated from the trailing buttons by a flexible spacer. */
  dangerSlot?: ReactNode;
  footer: ReactNode;
  children: ReactNode;
  compact?: boolean;
}

/** Scrim + panel — the shared shell behind every modal (Add/Edit Project,
 *  Add/Edit Server, Folder Browser, Container Picker). Centered floating
 *  dialog at rest; below 700px it becomes a full-height bottom sheet. */
export function Dialog({ title, subtitle, width = "560px", onClose, onBack, dangerSlot, footer, children, compact = false }: Props) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 40, display: "flex", alignItems: compact ? "flex-end" : "center", justifyContent: "center" }}>
      <div
        data-dh-scrim="1"
        onClick={onClose}
        style={{ position: "absolute", inset: 0, background: "var(--dh-scrim)", opacity: 0.58, animation: "dh-scrim-in var(--duration-normal) var(--ease-out)" }}
      />
      <div
        data-dh-dialog="1"
        role="dialog"
        aria-modal="true"
        style={{
          position: "relative",
          width: compact ? "100%" : width,
          maxWidth: "100%",
          height: compact ? "88%" : undefined,
          maxHeight: compact ? undefined : "calc(100% - 64px)",
          display: "flex",
          flexDirection: "column",
          background: "var(--dh-bg-card)",
          border: compact ? "none" : "1px solid var(--dh-border-button)",
          borderTop: compact ? "1px solid var(--dh-border-button)" : undefined,
          borderRadius: compact ? "16px 16px 0 0" : 10,
          overflow: "hidden",
          animation: compact ? "dh-sheet-in .25s ease-out both" : "dhrise .2s ease-out both",
        }}
      >
        <div
          style={{
            flex: "0 0 auto",
            padding: compact ? "14px 16px" : "20px 22px 16px",
            borderBottom: "1px solid var(--dh-border-hairline)",
            display: "flex",
            alignItems: compact ? "center" : "flex-start",
            gap: 12,
          }}
        >
          {compact ? (
            <>
              <button
                type="button"
                onClick={onBack ?? onClose}
                style={{
                  minHeight: 44,
                  padding: "0 12px",
                  background: "transparent",
                  border: "1px solid var(--dh-border-button)",
                  borderRadius: 9,
                  color: "var(--dh-text-back)",
                  font: "400 12px/1 var(--font-mono)",
                  cursor: "pointer",
                }}
              >
                ‹ back
              </button>
              <span style={{ flex: 1, textAlign: "center", font: "600 14px/1 var(--font-ui)", letterSpacing: "-0.015em", color: "var(--dh-text)" }}>{title}</span>
              <span style={{ width: 56, flex: "0 0 auto" }} />
            </>
          ) : (
            <>
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 5 }}>
                <span style={{ font: "600 15px/1 var(--font-ui)", letterSpacing: "-0.015em", color: "var(--dh-text)" }}>{title}</span>
                {subtitle && <span style={{ font: "400 11px/1 var(--font-mono)", color: "var(--dh-text-host)" }}>{subtitle}</span>}
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={onClose}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 28,
                  height: 28,
                  border: "1px solid var(--dh-border-control)",
                  background: "transparent",
                  borderRadius: 6,
                  color: "var(--dh-text-action)",
                  cursor: "pointer",
                  font: "400 15px/1 var(--font-mono)",
                  padding: 0,
                  flex: "0 0 auto",
                  transition: "var(--transition-state)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--dh-bg-hover)";
                  e.currentTarget.style.color = "var(--dh-text-bright)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.color = "var(--dh-text-action)";
                }}
              >
                <span style={{ display: "inline-block", transform: "rotate(45deg)" }}>+</span>
              </button>
            </>
          )}
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: compact ? "18px 16px" : 22, display: "flex", flexDirection: "column", gap: 22 }}>{children}</div>

        <div
          style={{
            flex: "0 0 auto",
            padding: compact ? "12px 16px 18px" : "16px 22px 18px",
            borderTop: "1px solid var(--dh-border-hairline)",
            display: "flex",
            flexDirection: compact ? "column" : "row",
            alignItems: compact ? "stretch" : "center",
            gap: compact ? 8 : 9,
            flexWrap: "wrap",
          }}
        >
          {compact ? (
            <>
              {footer}
              {dangerSlot}
            </>
          ) : (
            <>
              {dangerSlot}
              <span style={{ flex: 1 }} />
              {footer}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
