import { useId, type ReactNode } from "react";
import { Overlay } from "./Overlay";

interface Props {
  title: string;
  /** Compact machine-readable context under the title, e.g. "acme · main". */
  subtitle?: string;
  subtitleMono?: boolean;
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
export function Dialog({ title, subtitle, subtitleMono = false, width = "560px", onClose, onBack, dangerSlot, footer, children, compact = false }: Props) {
  const titleId = useId();
  return (
    <Overlay
      onClose={onClose}
      // Above the log drawer (41), so a dialog opened from a drawer row is not
      // rendered behind the drawer that opened it.
      zIndex={42}
      sheet={compact}
      panelStyle={{
        width: compact ? "100%" : width,
        maxWidth: "100%",
        height: compact ? "88vh" : undefined,
        background: "var(--dh-surface-overlay)",
        // A dialog with no shadow at all sat flat on the page it was blocking.
        boxShadow: "var(--dh-shadow-dialog)",
        // Never put `border` and `borderTop` in one style object. React writes
        // the shorthand and then applies the longhand — and a longhand whose
        // value is `undefined` is written as the empty string, which DELETES
        // that edge. That is what left every centered dialog with three
        // borders and a bare top edge, reading as if it were cut off.
        ...(compact
          ? { border: "none", borderTop: "1px solid var(--dh-border-button)", borderRadius: "16px 16px 0 0" }
          : { border: "1px solid var(--dh-border-button)", borderRadius: 16 }),
        overflow: "hidden",
        // `forwards`, not `both` — same reasoning as the scrim. `both` holds
        // the `from` keyframe (opacity: 0) before the animation starts, so a
        // dialog opened in a backgrounded or throttled tab is fully invisible
        // while still blocking the app behind it.
        animation: compact ? "dh-sheet-in .25s ease-out forwards" : "dhrise .2s ease-out forwards",
      }}
    >
      <div
        data-dh-dialog="1"
        role="dialog"
        aria-modal="true"
        // Without this the dialog announces as unnamed, even though the title
        // it should be named by is rendered a few lines below.
        aria-labelledby={titleId}
        style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}
      >
        <div
          style={{
            flex: "0 0 auto",
            padding: compact ? "14px 16px" : "22px 24px 18px",
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
                  font: "var(--type-control)",
                  cursor: "pointer",
                }}
              >
                ‹ back
              </button>
              <span id={titleId} style={{ flex: 1, textAlign: "center", font: "var(--type-section-title)", letterSpacing: "var(--tracking-title)", color: "var(--dh-text)" }}>
                {title}
              </span>
              <span style={{ width: 56, flex: "0 0 auto" }} />
            </>
          ) : (
            <>
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                <span id={titleId} style={{ font: "var(--type-section-title)", letterSpacing: "var(--tracking-title)", color: "var(--dh-text)" }}>
                  {title}
                </span>
                {subtitle && <span style={{ font: subtitleMono ? "var(--type-code)" : "var(--type-meta-text)", color: "var(--dh-text-host)" }}>{subtitle}</span>}
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={onClose}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 32,
                  height: 32,
                  border: "1px solid var(--dh-border-control)",
                  background: "transparent",
                  borderRadius: 9,
                  color: "var(--dh-text-action)",
                  cursor: "pointer",
                  font: "400 var(--type-title)/1 var(--font-mono)",
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

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: compact ? "18px 16px" : 24, display: "flex", flexDirection: "column", gap: 22 }}>{children}</div>

        <div
          style={{
            flex: "0 0 auto",
            padding: compact ? "12px 16px 18px" : "16px 24px 20px",
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
    </Overlay>
  );
}
