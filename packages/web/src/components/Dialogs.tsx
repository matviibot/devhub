import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Dialog, Icon, IconButton, TextField } from "../ds";
import type { useDevhub } from "../hooks/useDevhub";

type Devhub = ReturnType<typeof useDevhub>;

export type DialogState =
  | { kind: "project"; mode: "add"; prefillName?: string; prefillCwd?: string; prefillPort?: number }
  | { kind: "project"; mode: "edit"; projectId: string }
  | { kind: "server"; mode: "add"; projectId: string; prefillName?: string; prefillCwd?: string; prefillPort?: number }
  | { kind: "server"; mode: "edit"; serverId: string }
  | { kind: "delete"; target: "project"; id: string }
  | { kind: "delete"; target: "server"; id: string }
  | null;

interface Props {
  dialog: DialogState;
  onClose: () => void;
  devhub: Devhub;
  /** Called instead of onClose after creating a new project — the caller
   *  chains into an Add Server dialog once the project shows up, carrying
   *  over any cwd/port that was already known (e.g. from a discovered item). */
  onChainToAddServer: (name: string, prefill: { cwd?: string; port?: number }) => void;
}

const DETECT_DEBOUNCE_MS = 300;

export function Dialogs({ dialog, onClose, devhub, onChainToAddServer }: Props) {
  const { projects, servers, createProject, updateProject, deleteProject, createServer, updateServer, deleteServer, detectScripts, detected } =
    devhub;

  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [cwd, setCwd] = useState("");
  const [port, setPort] = useState("");
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
    if (!dialog) return;
    if (dialog.kind === "project") {
      const p = dialog.mode === "edit" ? projects.find((x) => x.id === dialog.projectId) : null;
      setName(p?.name ?? (dialog.mode === "add" ? (dialog.prefillName ?? "") : ""));
    } else if (dialog.kind === "server") {
      const s = dialog.mode === "edit" ? servers.find((x) => x.id === dialog.serverId) : null;
      setName(s?.name ?? (dialog.mode === "add" ? (dialog.prefillName ?? "") : ""));
      setCommand(s?.command ?? "");
      setCwd(s?.cwd ?? (dialog.mode === "add" ? (dialog.prefillCwd ?? "") : ""));
      setPort(s?.port ? String(s.port) : dialog.mode === "add" && dialog.prefillPort ? String(dialog.prefillPort) : "");
    }
  }, [dialogKey]);

  useEffect(() => {
    if (dialog?.kind !== "server") return;
    clearTimeout(detectTimer.current);
    const trimmed = cwd.trim();
    if (!trimmed) return;
    detectTimer.current = setTimeout(() => detectScripts(trimmed), DETECT_DEBOUNCE_MS);
    return () => clearTimeout(detectTimer.current);
  }, [dialog?.kind, cwd]);

  const scripts = useMemo(() => {
    if (dialog?.kind !== "server" || !detected || detected.cwd !== cwd.trim()) return [];
    return detected.scripts;
  }, [dialog, detected, cwd]);
  const noPackageJson = dialog?.kind === "server" && detected?.cwd === cwd.trim() && !detected.hasPackageJson;

  useEffect(() => {
    if (!dialog) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Enter" && !(e as unknown as { isComposing?: boolean }).isComposing) {
        const active = document.activeElement;
        if (active instanceof HTMLInputElement) {
          e.preventDefault();
          submit();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog, name, command, cwd, port]);

  if (!dialog) return null;

  function submit() {
    if (!dialog) return;
    if (dialog.kind === "project") {
      if (!name.trim()) return;
      if (dialog.mode === "edit") {
        updateProject(dialog.projectId, name);
      } else {
        createProject(name);
        onChainToAddServer(name, { cwd: dialog.prefillCwd, port: dialog.prefillPort });
        return;
      }
    } else if (dialog.kind === "server") {
      if (!name.trim() || !command.trim() || !cwd.trim()) return;
      const portNum = port.trim() ? Number(port.trim()) : undefined;
      if (dialog.mode === "edit") updateServer(dialog.serverId, name, command, cwd, portNum);
      else if (projectId) createServer(projectId, name, command, cwd, portNum);
    } else if (dialog.kind === "delete") {
      if (dialog.target === "project") deleteProject(dialog.id);
      else deleteServer(dialog.id);
    }
    onClose();
  }

  if (dialog.kind === "project") {
    const editing = dialog.mode === "edit";
    return (
      <Dialog
        icon={editing ? "folder-cog" : "folder-plus"}
        title={editing ? "Edit project" : "New project"}
        width="360px"
        onClose={onClose}
        footer={<DialogFooter onClose={onClose} onSubmit={submit} disabled={!name.trim()} label={editing ? "Save" : "Create project"} icon={editing ? "check" : "plus"} />}
      >
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
      </Dialog>
    );
  }

  if (dialog.kind === "server") {
    const editing = dialog.mode === "edit";
    return (
      <Dialog
        icon={editing ? "settings-2" : "circle-plus"}
        title={`${editing ? "Edit server" : "New server"}${project ? ` · ${project.name}` : ""}`}
        width="520px"
        onClose={onClose}
        footer={<DialogFooter onClose={onClose} onSubmit={submit} disabled={!name.trim() || !command.trim() || !cwd.trim()} label={editing ? "Save" : "Add server"} icon={editing ? "check" : "plus"} />}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 96px", gap: 12 }}>
            <TextField id="dh-s-name" label="Name" value={name} onChange={setName} placeholder="web" autoFocus />
            <TextField id="dh-s-port" label="Port" value={port} onChange={(v) => setPort(v.replace(/[^0-9]/g, ""))} placeholder="optional" mono />
          </div>

          <TextField id="dh-s-cwd" label="Working directory" value={cwd} onChange={setCwd} placeholder="~/code/storefront/apps/web" mono />
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
        </div>
      </Dialog>
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
            {isProject ? projectServers.map((s) => s.name).join(", ") || "no servers" : targetServer?.command}
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
