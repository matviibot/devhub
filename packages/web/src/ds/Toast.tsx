import { useEffect } from "react";
import { IconButton } from "./IconButton";

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

/** Fixed bottom-right stack of ephemeral messages, each with an optional
 *  action button and an auto-dismiss timer. */
export function ToastStack({ toasts, onDismiss }: StackProps) {
  if (!toasts.length) return null;
  return (
    <div
      style={{
        position: "absolute",
        right: 16,
        bottom: 16,
        zIndex: 50,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        pointerEvents: "none",
      }}
    >
      {toasts.map((t) => (
        <Toast key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  );
}

function Toast({ toast, onDismiss }: { toast: ToastData; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
    // Intentionally re-armed only when the toast identity changes, not on
    // every onDismiss identity change (which is a fresh closure per render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast.id]);

  return (
    <div
      role="status"
      data-dh-toast="1"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        minWidth: 240,
        maxWidth: 360,
        padding: "10px 8px 10px 14px",
        borderRadius: "var(--radius-md)",
        background: "var(--color-surface-container-high)",
        boxShadow: "var(--elevation-3)",
        pointerEvents: "auto",
        animation: "dh-toast-in var(--duration-normal) var(--ease-out)",
      }}
    >
      <span style={{ flex: 1, minWidth: 0, font: "400 13px/18px var(--font-ui)", color: "var(--color-on-surface)" }}>{toast.message}</span>
      {toast.actionLabel && toast.onAction && (
        <button
          type="button"
          onClick={() => {
            toast.onAction?.();
            onDismiss();
          }}
          style={{
            flex: "0 0 auto",
            height: 26,
            padding: "0 10px",
            border: "none",
            borderRadius: "var(--radius-sm)",
            background: "transparent",
            color: "var(--color-primary)",
            font: "600 12px/1 var(--font-ui)",
            cursor: "pointer",
            WebkitAppearance: "none",
          }}
        >
          {toast.actionLabel}
        </button>
      )}
      <IconButton icon="x" label="Dismiss" size="sm" onClick={onDismiss} />
    </div>
  );
}
