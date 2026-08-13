import { useEffect, useMemo, useRef, useState } from "react";
import type { ProjectRoot } from "@devhub/shared";
import { Button, Dialog, FolderBrowser, Icon, IconButton, TextField } from "../ds";
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
}

const DETECT_DEBOUNCE_MS = 300;

export function Dialogs({ dialog, onClose, devhub, onChainToAddServer, onDeleted, onDeleteProject }: Props) {
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
  const detectTimer = useRef<ReturnType<typeof setTimeout>>();

  const dialogKey = dialog
    ? dialog.kind === "project"
      ? `project:${dialog.mode === "edit" ? dialog.projectId : "add"}`
      : dialog.kind === "server"
        ? `server:${dialog.mode === "edit" ? dialog.serverId : `add:${dialog.projectId}`}`
        : `delete:${dialog.target}:${dialog.id}`
    : null;

  const projectId = dialog?.kind === "project" && dialog.mode === "edit" ? dialog.projectId : dialog?.kind === "server" ? (dialog.mode === "add" ? dialog.projectId : servers.find((s) => s.id === dialog.serverId)?.projectId) : null;
  const project = projectId ? projects.find((p) => p.id === projectId) : undefined;

  useEffect(() => {
    setBrowsingTarget(null);
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
        if (browsingTarget) setBrowsingTarget(null);
        else onClose();
      } else if (e.key === "Enter" && !browsingTarget && !(e as unknown as { isComposing?: boolean }).isComposing) {
        const active = document.activeElement;
        if (active instanceof HTMLInputElement) {
          e.preventDefault();
          submit();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog, name, roots, serverKind, command, cwd, container, port, browsingTarget]);

  if (!dialog) return null;

  function submit() {
    if (!dialog) return;
    if (dialog.kind === "project") {
      if (!name.trim()) return;
      if (dialog.mode === "edit") {
        updateProject(dialog.projectId, name, roots);
      } else {
        createProject(name);
        onChainToAddServer(name, {
          kind: dialog.prefillServerKind,
          cwd: dialog.prefillCwd,
          container: dialog.prefillContainer,
          port: dialog.prefillPort,
        });
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

  if (dialog.kind === "project") {
    const editing = dialog.mode === "edit";
    return (
      <>
      <Dialog
        icon={editing ? "folder-cog" : "folder-plus"}
        title={editing ? "Edit project" : "New project"}
        width="360px"
        onClose={onClose}
        footer={
          editing ? (
            <>
              <Button variant="ghost" size="sm" icon="trash-2" style={{ color: "var(--color-error)" }} onClick={() => onDeleteProject(dialog.projectId)}>
                Delete project
              </Button>
              <span style={{ flex: 1 }} />
              <Button variant="ghost" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" icon="check" disabled={!name.trim()} onClick={submit}>
                Save
              </Button>
            </>
          ) : (
            <DialogFooter onClose={onClose} onSubmit={submit} disabled={!name.trim()} label="Create project" icon="plus" />
          )
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <TextField
            id="dh-p-name"
            label="Name"
            value={name}
            onChange={setName}
            placeholder="Storefront"
            autoFocus
            hint={
              <span style={{ font: "400 11px/16px var(--font-mono)", color: "var(--color-outline)" }}>
                Just a label — servers you add to it can live anywhere
              </span>
            }
          />

          {editing && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span
                style={{
                  font: "500 11px/1 var(--font-ui)",
                  letterSpacing: "0.55px",
                  textTransform: "uppercase",
                  color: "var(--color-on-surface-variant)",
                }}
              >
                Roots
              </span>
              {roots.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {roots.map((r) => (
                    <div
                      key={r.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        height: 34,
                        padding: "0 6px 0 11px",
                        borderRadius: "var(--radius-md)",
                        background: "var(--color-surface-container-lowest)",
                        boxShadow: "var(--inset-hairline)",
                      }}
                    >
                      <span
                        style={{
                          flex: 1,
                          minWidth: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          font: "400 11.5px/16px var(--font-mono)",
                          color: "var(--color-on-surface)",
                        }}
                      >
                        {r.path}
                      </span>
                      <IconButton icon="x" label="Remove root" size="sm" onClick={() => setRoots((rs) => rs.filter((x) => x.id !== r.id))} />
                    </div>
                  ))}
                </div>
              )}
              <div
                role="button"
                tabIndex={0}
                onClick={() => setBrowsingTarget("root")}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  height: 30,
                  borderRadius: "var(--radius-md)",
                  border: "1px dashed var(--color-outline-variant)",
                  color: "var(--color-on-surface-variant)",
                  cursor: "default",
                  font: "400 11.5px/1 var(--font-mono)",
                }}
              >
                <Icon name="plus" size={12} />
                add root path
              </div>
            </div>
          )}
        </div>
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

  if (dialog.kind === "server") {
    const editing = dialog.mode === "edit";
    const disabled = !name.trim() || (serverKind === "docker" ? !container.trim() : !command.trim() || !cwd.trim());
    return (
      <>
      <Dialog
        icon={editing ? "settings-2" : "circle-plus"}
        title={`${editing ? "Edit server" : "New server"}${project ? ` · ${project.name}` : ""}`}
        width="520px"
        onClose={onClose}
        footer={<DialogFooter onClose={onClose} onSubmit={submit} disabled={disabled} label={editing ? "Save" : "Add server"} icon={editing ? "check" : "plus"} />}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {editing ? (
            <div style={{ display: "flex", alignItems: "center", gap: 6, font: "400 11px/1 var(--font-mono)", color: "var(--color-outline)" }}>
              <Icon name={serverKind === "docker" ? "container" : "folder"} size={12} color="var(--color-outline)" />
              {serverKind === "docker" ? "Docker container" : "Process"}
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                gap: 4,
                padding: 3,
                borderRadius: "var(--radius-sm)",
                background: "var(--color-surface-container-lowest)",
                boxShadow: "var(--inset-hairline)",
              }}
            >
              {(["process", "docker"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setServerKind(k)}
                  style={{
                    flex: 1,
                    height: 26,
                    border: "none",
                    borderRadius: "var(--radius-xs)",
                    background: serverKind === k ? "var(--color-surface-container-high)" : "transparent",
                    color: serverKind === k ? "var(--color-on-surface)" : "var(--color-on-surface-variant)",
                    font: "500 12px/1 var(--font-ui)",
                    cursor: "pointer",
                    WebkitAppearance: "none",
                  }}
                >
                  {k === "process" ? "Process" : "Docker container"}
                </button>
              ))}
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 96px", gap: 12 }}>
            <TextField id="dh-s-name" label="Name" value={name} onChange={setName} placeholder="web" autoFocus />
            <TextField id="dh-s-port" label="Port" value={port} onChange={(v) => setPort(v.replace(/[^0-9]/g, ""))} placeholder="optional" mono />
          </div>

          {serverKind === "docker" ? (
            <TextField id="dh-s-container" label="Container" value={container} onChange={setContainer} placeholder="container name or id" mono />
          ) : (
            <>
              <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <TextField id="dh-s-cwd" label="Working directory" value={cwd} onChange={setCwd} placeholder="~/code/storefront/apps/web" mono />
                </div>
                <IconButton icon="folder-open" label="Browse for folder" onClick={() => setBrowsingTarget("cwd")} />
              </div>
              <TextField id="dh-s-cmd" label="Command" value={command} onChange={setCommand} placeholder="npm run dev" mono />

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  flexWrap: "wrap",
                  padding: "6px 4px 6px 8px",
                  borderRadius: "var(--radius-md)",
                  background: "var(--color-surface-container-lowest)",
                  boxShadow: "var(--inset-hairline)",
                }}
              >
                <span style={{ font: "500 11px/22px var(--font-ui)", letterSpacing: "0.55px", textTransform: "uppercase", color: "var(--color-on-surface-variant)", flex: "0 0 auto" }}>
                  {scripts.length ? "detected" : "detect"}
                </span>
                {scripts.map((sc) => {
                  const active = sc.command === command.trim();
                  return (
                    <div
                      key={sc.name}
                      role="button"
                      tabIndex={0}
                      title={sc.command}
                      onClick={() => setCommand(sc.command)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        height: 22,
                        padding: "0 7px",
                        borderRadius: "var(--radius-sm)",
                        boxShadow: "var(--inset-hairline)",
                        cursor: "default",
                        font: "400 11px/1 var(--font-mono)",
                        color: "var(--color-primary)",
                      }}
                    >
                      {active && <Icon name="check" size={11} color="var(--color-primary)" />}
                      <span>{sc.name}</span>
                    </div>
                  );
                })}
                {scripts.length === 0 && (
                  <span style={{ font: "400 11px/22px var(--font-mono)", color: "var(--color-outline)" }}>
                    {!cwd.trim() ? "enter a working directory to detect scripts" : noPackageJson ? `nothing to detect in ${cwd.trim()} — type the command` : "scanning…"}
                  </span>
                )}
                <span style={{ flex: 1 }} />
                <IconButton icon="refresh-cw" label="Rescan directory" size="sm" onClick={() => cwd.trim() && detectScripts(cwd.trim())} />
              </div>
            </>
          )}
        </div>
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
      </>
    );
  }

  // delete confirm
  const isProject = dialog.target === "project";
  const targetProject = isProject ? projects.find((p) => p.id === dialog.id) : undefined;
  const targetServer = !isProject ? servers.find((s) => s.id === dialog.id) : undefined;
  const targetServerProject = targetServer ? projects.find((p) => p.id === targetServer.projectId) : undefined;
  const projectServers = isProject ? servers.filter((s) => s.projectId === dialog.id) : [];
  const runningCount = projectServers.filter((s) => s.state.status !== "stopped").length;

  return (
    <Dialog
      icon="trash-2"
      title={isProject ? "Delete project" : "Delete server"}
      width="400px"
      onClose={onClose}
      footer={<DialogFooter onClose={onClose} onSubmit={submit} disabled={false} label="Delete" icon="trash-2" variant="danger" hint="esc to cancel" />}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ font: "400 13px/20px var(--font-ui)", color: "var(--color-on-surface)" }}>
          {isProject
            ? `Remove "${targetProject?.name ?? ""}" and its servers from the config. Files on disk are untouched.`
            : `Remove "${targetServer?.name ?? ""}" from ${targetServerProject?.name ?? ""}. Files on disk are untouched.`}
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            padding: 8,
            borderRadius: "var(--radius-md)",
            background: "var(--color-surface-container-lowest)",
            boxShadow: "var(--inset-hairline)",
            font: "400 11px/16px var(--font-mono)",
            color: "var(--color-on-surface-variant)",
          }}
        >
          <span style={{ color: "var(--color-on-surface)" }}>
            {isProject
              ? projectServers.map((s) => s.name).join(", ") || "no servers"
              : targetServer?.kind === "docker"
                ? targetServer.container
                : targetServer?.command}
          </span>
          <span>
            {isProject
              ? `${projectServers.length} servers removed · ${runningCount} processes stopped`
              : targetServer?.state.pid
                ? `stops pid ${targetServer.state.pid}`
                : `not running · ${targetServer?.state.status ?? ""}`}
          </span>
        </div>
      </div>
    </Dialog>
  );
}

function DialogFooter({
  onClose,
  onSubmit,
  disabled,
  label,
  icon,
  variant = "primary",
  hint = "esc to cancel · ⏎ to save",
}: {
  onClose: () => void;
  onSubmit: () => void;
  disabled: boolean;
  label: string;
  icon: string;
  variant?: "primary" | "danger";
  hint?: string;
}) {
  return (
    <>
      <span style={{ font: "400 11px/1 var(--font-mono)", color: "var(--color-outline)" }}>{hint}</span>
      <span style={{ flex: 1 }} />
      <Button variant="ghost" size="sm" onClick={onClose}>
        Cancel
      </Button>
      <Button variant={variant} size="sm" icon={icon} disabled={disabled} onClick={onSubmit}>
        {label}
      </Button>
    </>
  );
}
