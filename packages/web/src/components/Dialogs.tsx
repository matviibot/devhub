import { useEffect, useMemo, useRef, useState } from "react";
import type { ProjectRoot } from "@devhub/shared";
import { Button, ContainerPicker, Dialog, FolderBrowser, Icon } from "../ds";
import type { useDevhub, ServerInput } from "../hooks/useDevhub";
import { tildify } from "../lib/paths";

type Devhub = ReturnType<typeof useDevhub>;

export type DialogState =
  | {
      kind: "project";
      mode: "add";
      prefillName?: string;
      prefillServerKind?: "process" | "docker";
      prefillCwd?: string;
      prefillContainer?: string;
      prefillPort?: number;
    }
  | { kind: "project"; mode: "edit"; projectId: string }
  | {
      kind: "server";
      mode: "add";
      projectId: string;
      prefillName?: string;
      prefillServerKind?: "process" | "docker";
      prefillCwd?: string;
      prefillContainer?: string;
      prefillPort?: number;
    }
  | { kind: "server"; mode: "edit"; serverId: string }
  | { kind: "delete"; target: "project"; id: string }
  | { kind: "delete"; target: "server"; id: string }
  | null;

export type DeletedServerSnapshot =
  | { kind: "process"; name: string; command: string; cwd: string; port?: number }
  | { kind: "docker"; name: string; container: string; port?: number };

/** A snapshot of what a delete-confirm just removed, enough to recreate it
 *  verbatim for an Undo action — new ids are assigned on recreate, which is
 *  fine, nothing meaningful survives a delete anyway. */
export type DeletedSnapshot =
  | { target: "project"; name: string; servers: DeletedServerSnapshot[] }
  | ({ target: "server"; projectId: string } & DeletedServerSnapshot);

interface Props {
  dialog: DialogState;
  onClose: () => void;
  devhub: Devhub;
  /** Called instead of onClose after creating a new project — the caller
   *  chains into an Add Server dialog once the project shows up, carrying
   *  over whatever was already known (e.g. from a discovered item). */
  onChainToAddServer: (name: string, prefill: { kind?: "process" | "docker"; cwd?: string; container?: string; port?: number }) => void;
  /** Called right before onClose after a delete-confirm actually deletes —
   *  the caller can offer an Undo toast from the snapshot. */
  onDeleted?: (snapshot: DeletedSnapshot) => void;
  /** Called from the project-edit dialog's "Delete project" action — the
   *  caller swaps in the delete-confirm dialog. */
  onDeleteProject: (id: string) => void;
  /** Same, from the server-edit dialog's "Delete server" action. */
  onDeleteServer: (id: string) => void;
}

const DETECT_DEBOUNCE_MS = 300;
// Mirrors useDevhub's own PENDING_TIMEOUT_MS — the daemon-confirmation
// window an optimistic create is allowed before the create dialog offers
// retry/keep-editing instead of sitting there silently.
const CREATE_TIMEOUT_MS = 10000;

/** Uppercase mono label + bordered input, the field shape every dialog in
 *  this file shares. */
function Field({
  label,
  value,
  onChange,
  placeholder,
  autoFocus,
  disabled,
  invalid,
  maxWidth,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  maxWidth?: number;
}) {
  const [focus, setFocus] = useState(false);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth, flex: maxWidth ? "0 0 auto" : undefined, minWidth: 0 }}>
      <span style={{ font: "400 9.5px/1 var(--font-mono)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--dh-text-tertiary)" }}>{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        disabled={disabled}
        spellCheck={false}
        style={{
          background: "var(--dh-bg-input)",
          border: `1px solid ${invalid ? "rgba(238,139,120,0.45)" : focus ? "var(--dh-accent-focus)" : "var(--dh-border-control)"}`,
          borderRadius: 8,
          padding: "10px 12px",
          color: "var(--dh-text)",
          font: "400 12.5px/1 var(--font-mono)",
          outline: "none",
          width: "100%",
          opacity: disabled ? 0.5 : 1,
        }}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
      />
    </div>
  );
}

/** Small bordered pill button matching the mockup's "browse"/"cancel"/
 *  "change" chrome throughout every dialog. */
function ChromeButton({
  label,
  onClick,
  disabled,
  square,
  danger,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  square?: boolean;
  danger?: boolean;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: square ? 30 : undefined,
        height: square ? 30 : undefined,
        padding: square ? 0 : "8px 11px",
        border: `1px solid ${danger && hover ? "rgba(238,139,120,0.35)" : "var(--dh-border-button)"}`,
        borderRadius: 8,
        background: hover && !danger ? "var(--dh-bg-hover)" : "transparent",
        color: danger ? (hover ? "var(--dh-status-crashed)" : "var(--dh-text-tertiary)") : hover ? "var(--dh-text-bright)" : "var(--dh-text-action)",
        font: "400 11px/1 var(--font-mono)",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
        flex: "0 0 auto",
        transition: "var(--transition-state)",
      }}
    >
      {label}
    </button>
  );
}

/** Filled-violet primary action, with its own literal hover swap. */
function PrimaryButton({ label, onClick, disabled, loading }: { label: string; onClick: () => void; disabled?: boolean; loading?: boolean }) {
  const [hover, setHover] = useState(false);
  const off = disabled || loading;
  return (
    <button
      type="button"
      onClick={off ? undefined : onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 7,
        font: "500 11.5px/1 var(--font-mono)",
        color: "var(--dh-on-accent)",
        background: hover && !off ? "var(--dh-accent-hover)" : "var(--dh-accent)",
        border: "none",
        borderRadius: 8,
        padding: "9px 16px",
        cursor: off ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "var(--transition-state)",
      }}
    >
      {loading && <span style={{ width: 12, height: 12, borderRadius: "50%", border: "1.5px solid rgba(21,15,38,0.35)", borderTopColor: "var(--dh-on-accent)", animation: "ds-spin 700ms linear infinite" }} />}
      {label}
    </button>
  );
}

/** Alert-tinted inline banner — validation / discovery / restart-notice /
 *  create-error all share this shape, only the tint color changes. */
function InlineBanner({ tone, children, dot = true }: { tone: "violet" | "amber" | "red"; children: React.ReactNode; dot?: boolean }) {
  const colors = {
    violet: { bg: "var(--dh-accent-tint-bg)", border: "rgba(165,140,245,0.24)", text: "var(--dh-accent-tint-text)", dotColor: "var(--dh-accent)" },
    amber: { bg: "rgba(223,179,92,0.08)", border: "rgba(223,179,92,0.22)", text: "#e5cd9c", dotColor: "var(--dh-status-starting)" },
    red: { bg: "var(--dh-flag-bg)", border: "var(--dh-flag-border)", text: "var(--dh-alert-text)", dotColor: "var(--dh-status-crashed)" },
  }[tone];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 11px", borderRadius: 7, background: colors.bg, border: `1px solid ${colors.border}` }}>
      {dot && <span style={{ width: 5, height: 5, borderRadius: "50%", background: colors.dotColor, flex: "0 0 auto" }} />}
      <span style={{ font: "400 11px/1.4 var(--font-mono)", color: colors.text }}>{children}</span>
    </div>
  );
}

interface RootRowProps {
  root: ProjectRoot;
  onLabelChange: (label: string) => void;
  onBrowse: () => void;
  onRemove: () => void;
}

function RootRow({ root, onLabelChange, onBrowse, onRemove }: RootRowProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 9, background: "var(--dh-bg-input)", border: "1px solid var(--dh-border-control)", borderRadius: 8, padding: "9px 11px" }}>
        <span style={{ font: "400 12px/1 var(--font-mono)", color: "var(--dh-text-log-msg)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tildify(root.path)}</span>
        <span style={{ flex: 1 }} />
        <input
          value={root.label ?? ""}
          onChange={(e) => onLabelChange(e.target.value)}
          placeholder="label"
          spellCheck={false}
          style={{ background: "transparent", border: "none", borderLeft: "1px solid var(--dh-border-control)", padding: "0 0 0 10px", width: 96, color: "var(--dh-text-action)", font: "400 11.5px/1 var(--font-mono)", outline: "none" }}
        />
      </div>
      <ChromeButton label="browse" onClick={onBrowse} />
      <ChromeButton label="×" onClick={onRemove} square danger />
    </div>
  );
}

export function Dialogs({ dialog, onClose, devhub, onChainToAddServer, onDeleted, onDeleteProject, onDeleteServer }: Props) {
  const {
    projects,
    servers,
    createProject,
    updateProject,
    deleteProject,
    createServer,
    updateServer,
    deleteServer,
    detectScripts,
    detected,
    listDirectory,
    directoryListing,
    error: daemonError,
    clearError,
  } = devhub;

  const [name, setName] = useState("");
  const [roots, setRoots] = useState<ProjectRoot[]>([]);
  const [serverKind, setServerKind] = useState<"process" | "docker">("process");
  const [command, setCommand] = useState("");
  const [cwd, setCwd] = useState("");
  const [container, setContainer] = useState("");
  const [port, setPort] = useState("");
  // What the shared FolderBrowser singleton is currently picking a folder
  // for — the project dialog's root-picker and the server dialog's cwd-
  // picker both reuse the one instance, just with a different onSelect.
  const [browsingTarget, setBrowsingTarget] = useState<"cwd" | "root" | null>(null);
  const [pickingContainer, setPickingContainer] = useState(false);
  const [showValidation, setShowValidation] = useState(false);
  const [submitPhase, setSubmitPhase] = useState<"idle" | "submitting" | "error">("idle");
  const detectTimer = useRef<ReturnType<typeof setTimeout>>();
  const createTimer = useRef<ReturnType<typeof setTimeout>>();

  const dialogKey = dialog
    ? dialog.kind === "project"
      ? `project:${dialog.mode === "edit" ? dialog.projectId : "add"}`
      : dialog.kind === "server"
        ? `server:${dialog.mode === "edit" ? dialog.serverId : `add:${dialog.projectId}`}`
        : `delete:${dialog.target}:${dialog.id}`
    : null;

  const projectId = dialog?.kind === "project" && dialog.mode === "edit" ? dialog.projectId : dialog?.kind === "server" ? (dialog.mode === "add" ? dialog.projectId : servers.find((s) => s.id === dialog.serverId)?.projectId) : null;
  const project = projectId ? projects.find((p) => p.id === projectId) : undefined;
  const editingServer = dialog?.kind === "server" && dialog.mode === "edit" ? servers.find((s) => s.id === dialog.serverId) : undefined;

  useEffect(() => {
    setBrowsingTarget(null);
    setPickingContainer(false);
    setShowValidation(false);
    setSubmitPhase("idle");
    clearTimeout(createTimer.current);
    if (!dialog) return;
    if (dialog.kind === "project") {
      const p = dialog.mode === "edit" ? projects.find((x) => x.id === dialog.projectId) : null;
      setName(p?.name ?? (dialog.mode === "add" ? (dialog.prefillName ?? "") : ""));
      setRoots(p?.roots ?? []);
    } else if (dialog.kind === "server") {
      const s = dialog.mode === "edit" ? servers.find((x) => x.id === dialog.serverId) : null;
      setName(s?.name ?? (dialog.mode === "add" ? (dialog.prefillName ?? "") : ""));
      setServerKind(s?.kind ?? (dialog.mode === "add" ? (dialog.prefillServerKind ?? "process") : "process"));
      setCommand(s?.kind === "process" ? s.command : "");
      setCwd(s?.kind === "process" ? s.cwd : dialog.mode === "add" ? (dialog.prefillCwd ?? "") : "");
      setContainer(s?.kind === "docker" ? s.container : dialog.mode === "add" ? (dialog.prefillContainer ?? "") : "");
      setPort(s?.port ? String(s.port) : dialog.mode === "add" && dialog.prefillPort ? String(dialog.prefillPort) : "");
    }
  }, [dialogKey]);

  // Add-project only: watch the global daemon error for the exact timeout
  // message useDevhub raises for this create, and surface it in-dialog
  // instead of (also) as the app-wide banner.
  useEffect(() => {
    if (submitPhase !== "submitting" || dialog?.kind !== "project" || dialog.mode !== "add") return;
    if (daemonError && daemonError.startsWith(`Couldn't create "${name}"`)) {
      setSubmitPhase("error");
      clearError();
    }
  }, [daemonError, submitPhase, dialog, name, clearError]);

  useEffect(() => {
    if (dialog?.kind !== "server" || serverKind !== "process") return;
    clearTimeout(detectTimer.current);
    const trimmed = cwd.trim();
    if (!trimmed) return;
    detectTimer.current = setTimeout(() => detectScripts(trimmed), DETECT_DEBOUNCE_MS);
    return () => clearTimeout(detectTimer.current);
  }, [dialog?.kind, serverKind, cwd]);

  const scripts = useMemo(() => {
    if (dialog?.kind !== "server" || serverKind !== "process" || !detected || detected.cwd !== cwd.trim()) return [];
    return detected.scripts;
  }, [dialog, serverKind, detected, cwd]);
  const noPackageJson = dialog?.kind === "server" && serverKind === "process" && detected?.cwd === cwd.trim() && !detected.hasPackageJson;

  useEffect(() => {
    if (!dialog) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        if (pickingContainer) setPickingContainer(false);
        else if (browsingTarget) setBrowsingTarget(null);
        else onClose();
      } else if (e.key === "Enter" && !browsingTarget && !pickingContainer && !(e as unknown as { isComposing?: boolean }).isComposing) {
        const active = document.activeElement;
        if (active instanceof HTMLInputElement) {
          e.preventDefault();
          submit();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialog, name, roots, serverKind, command, cwd, container, port, browsingTarget, pickingContainer]);

  if (!dialog) return null;

  function submitProjectAdd() {
    setSubmitPhase("submitting");
    createProject(name, roots);
    createTimer.current = setTimeout(() => setSubmitPhase("error"), CREATE_TIMEOUT_MS);
    // Real confirmation swaps this dialog out entirely (App.tsx's
    // chain-to-add-server effect fires once the project lands in
    // `projects`), so there's nothing further to do here on success.
    onChainToAddServer(name, dialog?.kind === "project" && dialog.mode === "add" ? { kind: dialog.prefillServerKind, cwd: dialog.prefillCwd, container: dialog.prefillContainer, port: dialog.prefillPort } : {});
  }

  function submit() {
    if (!dialog) return;
    if (dialog.kind === "project") {
      if (!name.trim()) {
        setShowValidation(true);
        return;
      }
      if (dialog.mode === "edit") {
        updateProject(dialog.projectId, name, roots);
      } else {
        submitProjectAdd();
        return;
      }
    } else if (dialog.kind === "server") {
      if (!name.trim()) return;
      if (serverKind === "docker" ? !container.trim() : !command.trim() || !cwd.trim()) return;
      const portNum = port.trim() ? Number(port.trim()) : undefined;
      const input: ServerInput =
        serverKind === "docker"
          ? { kind: "docker", name, container: container.trim(), port: portNum }
          : { kind: "process", name, command, cwd, port: portNum };
      if (dialog.mode === "edit") updateServer(dialog.serverId, input);
      else if (projectId) createServer(projectId, input);
    } else if (dialog.kind === "delete") {
      if (dialog.target === "project") {
        const p = projects.find((x) => x.id === dialog.id);
        const ps = servers.filter((s) => s.projectId === dialog.id);
        deleteProject(dialog.id);
        if (p) {
          onDeleted?.({
            target: "project",
            name: p.name,
            servers: ps.map((s): DeletedServerSnapshot =>
              s.kind === "docker"
                ? { kind: "docker", name: s.name, container: s.container, port: s.port }
                : { kind: "process", name: s.name, command: s.command, cwd: s.cwd, port: s.port },
            ),
          });
        }
      } else {
        const s = servers.find((x) => x.id === dialog.id);
        deleteServer(dialog.id);
        if (s) {
          onDeleted?.(
            s.kind === "docker"
              ? { target: "server", projectId: s.projectId, kind: "docker", name: s.name, container: s.container, port: s.port }
              : { target: "server", projectId: s.projectId, kind: "process", name: s.name, command: s.command, cwd: s.cwd, port: s.port },
          );
        }
      }
    }
    onClose();
  }

  // ---------------------------------------------------------------- project
  if (dialog.kind === "project") {
    const editing = dialog.mode === "edit";
    const projectServers = editing ? servers.filter((s) => s.projectId === dialog.projectId) : [];
    const submitting = submitPhase === "submitting";
    return (
      <>
        <Dialog
          title={editing ? `Edit ${project?.name ?? ""}` : "New project"}
          subtitle={editing ? `${projectServers.length} server${projectServers.length === 1 ? "" : "s"} · ${roots.length} root path${roots.length === 1 ? "" : "s"}` : "watched roots are scanned for servers"}
          onClose={onClose}
          dangerSlot={dialog.mode === "edit" && <ChromeButton label="delete project" onClick={() => onDeleteProject(dialog.projectId)} danger />}
          footer={
            submitPhase === "error" ? null : (
              <>
                <ChromeButton label="cancel" onClick={onClose} disabled={submitting} />
                <PrimaryButton
                  label={editing ? "save changes" : submitting ? "creating…" : "create project"}
                  onClick={submit}
                  disabled={submitting}
                  loading={submitting}
                />
              </>
            )
          }
        >
          {submitPhase === "error" ? (
            <>
              <InlineBanner tone="red">daemon didn't confirm in {CREATE_TIMEOUT_MS / 1000}s — project not created</InlineBanner>
              <div style={{ display: "flex", gap: 8 }}>
                <ChromeButton label="retry" onClick={submitProjectAdd} />
                <ChromeButton label="keep editing" onClick={() => setSubmitPhase("idle")} />
              </div>
            </>
          ) : (
            <>
              <Field label="project name" value={name} onChange={setName} placeholder="acme" autoFocus disabled={submitting} invalid={showValidation && !name.trim()} />
              {showValidation && !name.trim() && <span style={{ font: "400 11px/1 var(--font-mono)", color: "var(--dh-alert-text)" }}>a project needs a name</span>}

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ font: "400 9.5px/1 var(--font-mono)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--dh-text-tertiary)" }}>root paths</span>
                  <span style={{ flex: 1, height: 1, background: "var(--dh-border-hairline)", display: "block" }} />
                  <span style={{ font: "400 10px/1 var(--font-mono)", color: "var(--dh-text-faint)" }}>{roots.length}</span>
                </div>
                {roots.map((r) => (
                  <RootRow
                    key={r.id}
                    root={r}
                    onLabelChange={(label) => setRoots((rs) => rs.map((x) => (x.id === r.id ? { ...x, label } : x)))}
                    onBrowse={() => setBrowsingTarget("root")}
                    onRemove={() => setRoots((rs) => rs.filter((x) => x.id !== r.id))}
                  />
                ))}
                <button
                  type="button"
                  onClick={() => setBrowsingTarget("root")}
                  disabled={submitting}
                  style={{
                    alignSelf: "flex-start",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    font: "400 11px/1 var(--font-mono)",
                    color: "var(--dh-text-action)",
                    background: "transparent",
                    border: "1px dashed var(--dh-border-button)",
                    borderRadius: 8,
                    padding: "8px 12px",
                    cursor: submitting ? "default" : "pointer",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--dh-bg-hover)";
                    e.currentTarget.style.color = "var(--dh-text-bright)";
                    e.currentTarget.style.borderColor = "var(--dh-border-card-hover)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.color = "var(--dh-text-action)";
                    e.currentTarget.style.borderColor = "var(--dh-border-button)";
                  }}
                >
                  <Icon name="add" size={12} /> add root path
                </button>
              </div>
            </>
          )}
        </Dialog>
        {browsingTarget === "root" && (
          <FolderBrowser
            listing={directoryListing}
            onNavigate={listDirectory}
            onSelect={(path) => {
              setRoots((rs) => [...rs, { id: crypto.randomUUID(), path: tildify(path) }]);
              setBrowsingTarget(null);
            }}
            onClose={() => setBrowsingTarget(null)}
          />
        )}
      </>
    );
  }

  // ----------------------------------------------------------------- server
  if (dialog.kind === "server") {
    const editing = dialog.mode === "edit";
    const disabled = !name.trim() || (serverKind === "docker" ? !container.trim() : !command.trim() || !cwd.trim());
    const hasPrefill = dialog.mode === "add" && (dialog.prefillCwd || dialog.prefillContainer || dialog.prefillPort);
    const running = editingServer?.state.status === "running" || editingServer?.state.status === "starting";
    return (
      <>
        <Dialog
          title={editing ? `Edit ${name || "server"}` : "New server"}
          subtitle={project?.name}
          width="560px"
          onClose={onClose}
          dangerSlot={dialog.mode === "edit" && <ChromeButton label="delete server" onClick={() => onDeleteServer(dialog.serverId)} danger />}
          footer={
            <>
              <ChromeButton label="cancel" onClick={onClose} />
              <PrimaryButton label={editing ? (running ? "save · restart" : "save changes") : "add server"} onClick={submit} disabled={disabled} />
            </>
          }
        >
          {hasPrefill && (
            <InlineBanner tone="violet">
              from discovered{dialog.mode === "add" && dialog.prefillPort ? ` pid unknown · :${dialog.prefillPort}` : ""}
            </InlineBanner>
          )}
          {editing && running && <InlineBanner tone="amber">changes apply on next restart</InlineBanner>}

          {editing ? (
            <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 200px" }}>
                <Field label="name" value={name} onChange={setName} autoFocus />
              </div>
              <Field label="port" value={port} onChange={(v) => setPort(v.replace(/[^0-9]/g, ""))} placeholder="optional" maxWidth={140} />
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span style={{ font: "400 9.5px/1 var(--font-mono)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--dh-text-tertiary)" }}>kind</span>
                <span style={{ font: "400 11px/1 var(--font-mono)", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--dh-text-secondary)", border: "1px solid var(--dh-border-tag)", borderRadius: 4, padding: "9px 10px" }}>
                  {serverKind}
                </span>
              </div>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span style={{ font: "400 9.5px/1 var(--font-mono)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--dh-text-tertiary)" }}>kind</span>
                <div style={{ display: "flex", gap: 6, background: "var(--dh-bg-input)", border: "1px solid var(--dh-border-control)", borderRadius: 8, padding: 4, alignSelf: "flex-start" }}>
                  {(["process", "docker"] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setServerKind(k)}
                      style={{
                        font: "400 11.5px/1 var(--font-mono)",
                        border: "none",
                        borderRadius: 6,
                        padding: "7px 16px",
                        cursor: "pointer",
                        background: serverKind === k ? "var(--dh-accent)" : "transparent",
                        color: serverKind === k ? "var(--dh-on-accent)" : "var(--dh-text-action)",
                      }}
                    >
                      {k}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ display: "flex", gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <Field label="name" value={name} onChange={setName} placeholder="api" autoFocus />
                </div>
              </div>
            </>
          )}

          {serverKind === "docker" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={{ font: "400 9.5px/1 var(--font-mono)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--dh-text-tertiary)" }}>container</span>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 10, background: "var(--dh-bg-input)", border: "1px solid var(--dh-border-control)", borderRadius: 8, padding: "10px 12px" }}>
                  {container ? (
                    <>
                      <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--dh-status-running)", flex: "0 0 auto" }} />
                      <span style={{ font: "400 12px/1 var(--font-mono)", color: "var(--dh-text-log-msg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{container}</span>
                    </>
                  ) : (
                    <span style={{ font: "400 12px/1 var(--font-mono)", color: "var(--dh-text-muted)" }}>no container picked</span>
                  )}
                </div>
                <ChromeButton label={container ? "change" : "pick…"} onClick={() => setPickingContainer(true)} />
              </div>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span style={{ font: "400 9.5px/1 var(--font-mono)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--dh-text-tertiary)" }}>working directory</span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <input
                      value={cwd}
                      onChange={(e) => setCwd(e.target.value)}
                      placeholder="~/dev/acme/apps/api"
                      spellCheck={false}
                      style={{ background: "var(--dh-bg-input)", border: "1px solid var(--dh-border-control)", borderRadius: 8, padding: "10px 12px", color: "var(--dh-text-log-msg)", font: "400 12px/1 var(--font-mono)", outline: "none", width: "100%" }}
                    />
                  </div>
                  <ChromeButton label="browse" onClick={() => setBrowsingTarget("cwd")} />
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ font: "400 9.5px/1 var(--font-mono)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--dh-text-tertiary)" }}>command</span>
                  <span style={{ flex: 1, height: 1, background: "var(--dh-border-hairline)", display: "block" }} />
                  {scripts.length > 0 && <span style={{ font: "400 10px/1 var(--font-mono)", color: "var(--dh-text-faint)" }}>package.json</span>}
                </div>
                {scripts.length > 0 && (
                  <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                    {scripts.map((sc) => {
                      const active = sc.command === command.trim();
                      return (
                        <button
                          key={sc.name}
                          type="button"
                          title={sc.command}
                          onClick={() => setCommand(sc.command)}
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 3,
                            alignItems: "flex-start",
                            border: `1px solid ${active ? "var(--dh-border-card-hover)" : "var(--dh-border-button)"}`,
                            background: active ? "var(--dh-accent-tint-bg)" : "transparent",
                            borderRadius: 7,
                            padding: "7px 11px",
                            cursor: "pointer",
                          }}
                        >
                          <span style={{ font: "400 11.5px/1 var(--font-mono)", color: active ? "var(--dh-accent-tint-text)" : "var(--dh-text-action)" }}>{sc.name}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
                {scripts.length === 0 && (
                  <span style={{ font: "400 11px/1 var(--font-mono)", color: "var(--dh-text-muted)" }}>
                    {!cwd.trim() ? "enter a working directory to detect scripts" : noPackageJson ? "no package.json in this folder" : "scanning…"}
                  </span>
                )}
                <input
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="npm run dev"
                  spellCheck={false}
                  style={{ background: "var(--dh-bg-input)", border: "1px solid var(--dh-border-control)", borderRadius: 8, padding: "10px 12px", color: "var(--dh-text)", font: "400 12.5px/1 var(--font-mono)", outline: "none", width: "100%" }}
                />
                <span style={{ font: "400 10.5px/1 var(--font-mono)", color: "var(--dh-text-muted)" }}>pick a detected script or type any command</span>
              </div>
            </>
          )}

          {!editing && (
            <div style={{ maxWidth: 200 }}>
              <Field label="port · optional" value={port} onChange={(v) => setPort(v.replace(/[^0-9]/g, ""))} placeholder="3000" />
            </div>
          )}
        </Dialog>
        {browsingTarget === "cwd" && (
          <FolderBrowser
            initialPath={cwd.trim() || undefined}
            listing={directoryListing}
            onNavigate={listDirectory}
            onSelect={(path) => {
              setCwd(tildify(path));
              setBrowsingTarget(null);
            }}
            onClose={() => setBrowsingTarget(null)}
          />
        )}
        {pickingContainer && (
          <ContainerPicker
            containers={devhub.containers}
            fetchedAt={devhub.containersFetchedAt}
            onRefresh={devhub.listContainers}
            onPick={(c) => {
              setContainer(c.names[0] ?? c.id);
              setPickingContainer(false);
            }}
            onClose={() => setPickingContainer(false)}
          />
        )}
      </>
    );
  }

  // -------------------------------------------------------------- delete
  const isProject = dialog.target === "project";
  const targetProject = isProject ? projects.find((p) => p.id === dialog.id) : undefined;
  const targetServer = !isProject ? servers.find((s) => s.id === dialog.id) : undefined;
  const targetServerProject = targetServer ? projects.find((p) => p.id === targetServer.projectId) : undefined;
  const projectServers = isProject ? servers.filter((s) => s.projectId === dialog.id) : [];

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 40, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "var(--dh-scrim)", opacity: 0.58, animation: "dh-scrim-in var(--duration-normal) var(--ease-out)" }} />
      <div
        style={{
          position: "relative",
          width: isProject ? 440 : 400,
          maxWidth: "calc(100% - 32px)",
          background: "var(--dh-bg-card)",
          border: "1px solid var(--dh-border-button)",
          borderRadius: 10,
          padding: 22,
          display: "flex",
          flexDirection: "column",
          gap: 16,
          animation: "dhrise .2s ease-out both",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <span style={{ font: "600 15px/1 var(--font-ui)", letterSpacing: "-0.015em", color: "var(--dh-text)" }}>
            {isProject ? `Delete project "${targetProject?.name ?? ""}"?` : `Delete "${targetServer?.name ?? ""}"?`}
          </span>
          <span style={{ font: "400 11.5px/1.55 var(--font-mono)", color: "var(--dh-text-host)" }}>
            {isProject
              ? `this also deletes ${projectServers.length} configured server${projectServers.length === 1 ? "" : "s"}. running ones are stopped first.`
              : `${targetServerProject?.name ?? ""} · ${targetServer?.state.status ?? ""}. the ${targetServer?.kind === "docker" ? "container reference" : "process config"} is removed; nothing else is affected.`}
          </span>
        </div>
        {isProject && projectServers.length > 0 && (
          <div style={{ borderRadius: 8, background: "var(--dh-flag-bg)", border: "1px solid var(--dh-flag-border)", padding: "11px 12px", display: "flex", flexDirection: "column", gap: 7, maxHeight: 160, overflowY: "auto" }}>
            {projectServers.map((s) => (
              <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 9, font: "400 11px/1 var(--font-mono)", color: "var(--dh-alert-text)" }}>
                <span
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: "50%",
                    flex: "0 0 auto",
                    background: s.state.status === "running" || s.state.status === "starting" ? "var(--dh-status-running)" : s.state.status === "crashed" ? "var(--dh-status-crashed)" : "var(--dh-status-stopped)",
                  }}
                />
                <span>{s.name}</span>
                <span style={{ flex: 1 }} />
                <span style={{ color: "rgba(240,195,186,0.6)" }}>
                  {s.kind === "docker" ? "docker" : "process"} · {s.state.port ? `:${s.state.port}` : s.state.status}
                </span>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ flex: 1 }} />
          <ChromeButton label="cancel" onClick={onClose} />
          <button
            type="button"
            onClick={submit}
            style={{
              font: "400 11.5px/1 var(--font-mono)",
              color: "var(--dh-status-crashed)",
              background: "transparent",
              border: "1px solid rgba(238,139,120,0.35)",
              borderRadius: 8,
              padding: "9px 16px",
              cursor: "pointer",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(238,139,120,0.1)";
              e.currentTarget.style.borderColor = "rgba(238,139,120,0.55)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.borderColor = "rgba(238,139,120,0.35)";
            }}
          >
            {isProject ? `delete project · ${projectServers.length} servers` : "delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
