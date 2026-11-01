import { useEffect, useRef, useState } from "react";

export interface ToastData {
  id: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

interface StackProps {
  toasts: ToastData[];
  onDismiss: (id: string) => void;
}

const AUTO_DISMISS_MS = 6000;
const MAX_VISIBLE = 3;

/** Absolutely-positioned bottom-left stack — the caller places it inside a
 *  `position: relative` container (the detail pane, 24px inset) so it never
 *  covers the rail. Newest on top, capped at 3 visible with the rest
 *  collapsed into a "+N more" line. */
export function ToastStack({ toasts, onDismiss }: StackProps) {
  if (!toasts.length) return null;
  const visible = toasts.slice(-MAX_VISIBLE).reverse();
  const overflow = toasts.length - visible.length;
  return (
    <div
      style={{
        position: "absolute",
        left: 24,
        bottom: 24,
        zIndex: 50,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 8,
        pointerEvents: "none",
      }}
    >
      {visible.map((t) => (
        <Toast key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
      ))}
      {overflow > 0 && (
        <span style={{ font: "var(--type-meta-text)", color: "var(--dh-text-secondary)", pointerEvents: "none" }}>
          +{overflow} more delete{overflow === 1 ? "" : "s"}
        </span>
      )}
    </div>
  );
}

function Toast({ toast, onDismiss }: { toast: ToastData; onDismiss: () => void }) {
  const [paused, setPaused] = useState(false);
  const [left, setLeft] = useState(100);
  const startRef = useRef(Date.now());
  const remainingRef = useRef(AUTO_DISMISS_MS);

  useEffect(() => {
    if (paused) return;
    startRef.current = Date.now();
    const frame = () => {
      const elapsed = Date.now() - startRef.current;
      const pct = Math.max(0, 100 - (elapsed / remainingRef.current) * 100);
      setLeft(pct);
      if (pct <= 0) {
        onDismiss();
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    let raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused]);

  function pause() {
    remainingRef.current = Math.max(1, remainingRef.current - (Date.now() - startRef.current));
    setPaused(true);
  }
  function resume() {
    setPaused(false);
  }

  return (
    <div
      role="status"
      data-dh-toast="1"
      onMouseEnter={pause}
      onMouseLeave={resume}
      onFocus={pause}
      onBlur={resume}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        width: 380,
        maxWidth: "min(380px, calc(100vw - 48px))",
        padding: "13px 14px",
        borderRadius: 10,
        background: "var(--dh-surface-raised)",
        border: "1px solid var(--dh-border-button)",
        boxShadow: "var(--dh-shadow-menu)",
        pointerEvents: "auto",
        animation: "dhrise .18s ease-out both",
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--dh-text-dot)", flex: "0 0 auto" }} />
      <span style={{ flex: 1, minWidth: 0, font: "var(--type-body-text)", color: "var(--dh-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {toast.message}
      </span>
      {toast.actionLabel && toast.onAction && (
        <button
          type="button"
          onClick={() => {
            toast.onAction?.();
            onDismiss();
          }}
          style={{
            flex: "0 0 auto",
            padding: "5px 10px",
            border: "1px solid var(--dh-border-button)",
            borderRadius: 6,
            background: "transparent",
            color: "var(--dh-link)",
            font: "var(--type-control)",
            cursor: "pointer",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--dh-bg-hover)";
            e.currentTarget.style.color = "var(--dh-link-hover)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "var(--dh-link)";
          }}
        >
          {toast.actionLabel}
        </button>
      )}
      <span style={{ width: 22, height: 2, borderRadius: 2, background: "var(--dh-border-button)", flex: "0 0 auto", overflow: "hidden", display: "block" }}>
        <span style={{ display: "block", width: `${left}%`, height: 2, background: "var(--dh-text-dot)" }} />
      </span>
    </div>
  );
}
