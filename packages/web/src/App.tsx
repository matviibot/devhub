import { useCallback, useMemo, useRef, useState } from "react";
import { useDevhub } from "./hooks/useDevhub";
import { useNow } from "./hooks/useNow";
import { useBreakpoint } from "./hooks/useBreakpoint";
import { Dashboard } from "./components/Dashboard";
import { LogDrawer } from "./components/LogDrawer";
import { Dialogs, type DialogState } from "./components/Dialogs";
import { ScrimHost, type ToastData } from "./ds";

export function App() {
  const devhub = useDevhub();
  const [openLogId, setOpenLogId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const tickingNow = useNow();
  // Uptimes freeze while the daemon is unreachable. Every number under the
  // banner is a stale observation at that point; counting them upward once a
  // second asserts a liveness devhub cannot see.
  const lastConnectedNow = useRef(tickingNow);
  if (devhub.connected) lastConnectedNow.current = tickingNow;
  const now = devhub.connected ? tickingNow : lastConnectedNow.current;
  const { ref: rootRef, compact, medium } = useBreakpoint<HTMLDivElement>();

  // Services are rebuilt every tick, so resolve the open log target by id on
  // each render instead of holding onto a stale object.
  const openService = useMemo(() => {
    if (!openLogId) return null;
    for (const p of devhub.projects) {
      for (const r of p.repos) {
        for (const w of r.worktrees) {
          const hit = w.services.find((s) => s.id === openLogId);
          if (hit) return hit;
        }
      }
      const loose = p.looseServices.find((s) => s.id === openLogId);
      if (loose) return loose;
    }
    return null;
  }, [devhub.projects, openLogId]);

  function dismissToast(id: string) {
    setToasts((ts) => ts.filter((t) => t.id !== id));
  }

  /** Raises a toast. The plumbing for this existed at HEAD (commit e0e02fe,
   *  "toast/undo for delete-project and delete-server") and was dropped in the
   *  rewrite, leaving `ToastStack` permanently rendering null — so there was
   *  no receipt and no undo for deleting a project or a launcher, killing an
   *  orphan, or stopping anything. */
  const pushToast = useCallback((t: Omit<ToastData, "id">) => {
    setToasts((ts) => [...ts, { ...t, id: crypto.randomUUID() }]);
  }, []);

  return (
    <div
      ref={rootRef}
      data-theme="dark"
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "var(--color-surface)",
        color: "var(--color-on-surface)",
        fontFamily: "var(--font-ui)",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* A probe that could not run is not a probe that found nothing. Without
          this, stopping Docker silently removed every container row and the
          dashboard rendered a confident, complete-looking "everything is fine". */}
      {!devhub.probes.docker && (
        <Banner tone="amber">
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--dh-status-starting)", flex: "0 0 auto", marginTop: 6 }} />
          <span style={{ flex: 1, minWidth: 0, font: "var(--type-meta-text)", color: "var(--dh-warning-text)" }}>
            Docker isn't responding — container rows are hidden, not gone. Start Docker to see them again.
          </span>
        </Banner>
      )}
      {!devhub.probes.lsof && (
        <Banner tone="amber">
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--dh-status-starting)", flex: "0 0 auto", marginTop: 6 }} />
          <span style={{ flex: 1, minWidth: 0, font: "var(--type-meta-text)", color: "var(--dh-warning-text)" }}>
            lsof isn't available, so devhub can't see what's listening. Ports, orphans and every "up" stay blank until it is.
          </span>
        </Banner>
      )}
      {!devhub.connected && (
        <Banner tone="amber">
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              border: "1.5px solid var(--dh-warning-border-strong)",
              borderTopColor: "var(--dh-status-starting)",
              animation: "ds-spin 700ms linear infinite",
              flex: "0 0 auto",
            }}
          />
          <span style={{ font: "var(--type-meta-text)", color: "var(--dh-warning-text)" }}>
            reconnecting to devhub daemon…
            {devhub.reconnectAttempt > 0 && <span style={{ color: "var(--dh-warning-text-muted)" }}> attempt {devhub.reconnectAttempt}</span>}
          </span>
        </Banner>
      )}
      {devhub.error && (
        <Banner tone="red">
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--dh-status-crashed)", flex: "0 0 auto", marginTop: 6 }} />
          <span style={{ flex: 1, minWidth: 0, font: "var(--type-meta-text)", color: "var(--dh-alert-text)", wordBreak: "break-word" }}>
            {devhub.error}
          </span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={devhub.clearError}
            style={{
              width: 26,
              height: 26,
              border: "1px solid var(--dh-alert-border)",
              background: "transparent",
              borderRadius: 6,
              color: "var(--dh-alert-text)",
              cursor: "pointer",
              font: "var(--type-control)",
              padding: 0,
              flex: "0 0 auto",
            }}
          >
            ×
          </button>
        </Banner>
      )}

      <Dashboard
        devhub={devhub}
        now={now}
        compact={compact}
        openLogId={openLogId}
        onOpenLogs={(id) => setOpenLogId((cur) => (cur === id ? null : id))}
        onAddProject={() => setDialog({ kind: "project", mode: "add" })}
        onEditProject={(projectId) => setDialog({ kind: "project", mode: "edit", projectId })}
        onEditLauncher={({ projectId, repoPath, service }) => setDialog({ kind: "launcher", projectId, repoPath, service })}
        onReviewMigration={() => setDialog({ kind: "migration" })}
        toasts={toasts}
        onDismissToast={dismissToast}
        pushToast={pushToast}
      />

      {openService && (
        <LogDrawer
          service={openService}
          addLogListener={devhub.addLogListener}
          onClose={() => setOpenLogId(null)}
          onStop={devhub.stop}
          onRestart={devhub.restart}
          now={now}
          compact={compact}
          medium={medium}
          pending={devhub.pending}
        />
      )}

      {/* One scrim for every overlay in the app — see ds/Overlay.tsx. */}
      <ScrimHost />

      <Dialogs dialog={dialog} devhub={devhub} onClose={() => setDialog(null)} onOpen={setDialog} />
    </div>
  );
}

function Banner({ tone, children }: { tone: "amber" | "red"; children: React.ReactNode }) {
  const amber = tone === "amber";
  return (
    <div
      style={{
        flex: "0 0 auto",
        margin: "12px 12px 0",
        padding: "11px 18px",
        background: amber ? "var(--dh-warning-bg)" : "var(--dh-alert-bg)",
        border: `1px solid ${amber ? "var(--dh-warning-border)" : "var(--dh-alert-border)"}`,
        borderRadius: 9,
        display: "flex",
        alignItems: amber ? "center" : "flex-start",
        gap: 12,
      }}
    >
      {children}
    </div>
  );
}
