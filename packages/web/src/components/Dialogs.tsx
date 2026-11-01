import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Launcher, MigrationCandidate, PortPolicy, RepoInput, ServiceView } from "@devhub/shared";
import { Button, Dialog, FolderBrowser, Icon } from "../ds";
import type { Devhub } from "../hooks/useDevhub";
import { tildify } from "../lib/paths";

export type DialogState =
  | null
  | { kind: "project"; mode: "add" }
  | { kind: "project"; mode: "edit"; projectId: string }
  | { kind: "launcher"; projectId: string; repoPath: string; service: ServiceView | null }
  | { kind: "migration" }
  | { kind: "confirmDeleteProject"; projectId: string };

interface Props {
  dialog: DialogState;
  devhub: Devhub;
  onClose: () => void;
  onOpen: (d: DialogState) => void;
}

/** Every dialog is keyed by its identity and mounted fresh, so form state is
 *  seeded by `useState` initialisers rather than reset in an effect — a
 *  reset-in-effect paints one frame of the previous dialog's values. */
export function Dialogs({ dialog, devhub, onClose, onOpen }: Props) {
  // Escape is handled by `ScrimHost` against the overlay stack, so it closes
  // only the topmost surface. Handling it here closed the entire dialog tree,
  // which discarded a half-filled form whenever the folder picker above it was
  // dismissed with the key most people reach for.
  if (!dialog) return null;
  if (dialog.kind === "project") {
    return <ProjectDialog key={`project:${dialog.mode === "edit" ? dialog.projectId : "add"}`} dialog={dialog} devhub={devhub} onClose={onClose} onOpen={onOpen} />;
  }
  if (dialog.kind === "launcher") {
    return <LauncherDialog key={`launcher:${dialog.repoPath}:${dialog.service?.role ?? "new"}`} dialog={dialog} devhub={devhub} onClose={onClose} />;
  }
  if (dialog.kind === "migration") return <MigrationDialog devhub={devhub} onClose={onClose} />;
  return <ConfirmDeleteProject projectId={dialog.projectId} devhub={devhub} onClose={onClose} />;
}

// --------------------------------------------------------------- project

function ProjectDialog({
  dialog,
  devhub,
  onClose,
  onOpen,
}: {
  dialog: Extract<DialogState, { kind: "project" }>;
  devhub: Devhub;
  onClose: () => void;
  onOpen: (d: DialogState) => void;
}) {
  const editing = dialog.mode === "edit";
  const project = editing ? devhub.projects.find((p) => p.id === dialog.projectId) : undefined;

  const [name, setName] = useState(project?.name ?? "");
  const [repos, setRepos] = useState<RepoInput[]>(project?.repos.map((r) => ({ path: r.path })) ?? []);
  const [browsing, setBrowsing] = useState(false);
  const [showValidation, setShowValidation] = useState(false);

  function submit() {
    if (!name.trim()) {
      setShowValidation(true);
      return;
    }
    if (editing) devhub.updateProject(dialog.projectId, name, repos);
    else devhub.createProject(name, repos);
    onClose();
  }

  return (
    <>
      <Dialog
        title={editing ? `Edit ${project?.name ?? ""}` : "New project"}
        subtitle={editing ? `${repos.length} ${repos.length === 1 ? "repository" : "repositories"}` : "A name for one or more Git repositories"}
        onClose={onClose}
        dangerSlot={
          editing ? (
            <Button size="sm" variant="ghost" style={{ color: "var(--dh-status-crashed)" }} onClick={() => onOpen({ kind: "confirmDeleteProject", projectId: dialog.projectId })}>
              Delete project
            </Button>
          ) : undefined
        }
        footer={
          <>
            <Button size="sm" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" onClick={submit}>
              {editing ? "Save changes" : "Create project"}
            </Button>
          </>
        }
      >
        <Field label="Project name" value={name} onChange={setName} placeholder="acme" autoFocus invalid={showValidation && !name.trim()} />

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Label>Repositories</Label>
          <Hint>
            DevHub reads each repository’s <Mono>git worktree list</Mono> and includes everything running inside those worktrees. Launchers you
            declare on a repo are inherited by all of its worktrees, so adding a worktree costs no config.
          </Hint>
          {repos.map((r, i) => (
            <div key={`${r.path}-${i}`} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Icon name="folder" size={13} />
              <span style={{ flex: 1, minWidth: 0, font: "400 var(--type-meta)/1 var(--font-mono)", color: "var(--dh-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.path}
              </span>
              <Button size="sm" variant="ghost" icon="close" aria-label={`remove ${r.path}`} onClick={() => setRepos((rs) => rs.filter((_, j) => j !== i))} />
            </div>
          ))}
          <button
            type="button"
            onClick={() => setBrowsing(true)}
            style={{
              alignSelf: "flex-start",
              display: "flex",
              alignItems: "center",
              gap: 8,
              font: "var(--type-control)",
              color: "var(--dh-text-action)",
              background: "transparent",
              border: "1px dashed var(--dh-border-button)",
              borderRadius: 8,
              padding: "8px 12px",
              cursor: "pointer",
            }}
          >
            <Icon name="add" size={12} /> Add repository
          </button>
        </div>
      </Dialog>

      {browsing && (
        <FolderBrowser
          listing={devhub.directoryListing}
          onNavigate={devhub.listDirectory}
          onSelect={(path) => {
            const p = tildify(path);
            setRepos((rs) => (rs.some((r) => r.path === p) ? rs : [...rs, { path: p }]));
            setBrowsing(false);
          }}
          onClose={() => setBrowsing(false)}
        />
      )}
    </>
  );
}

function ConfirmDeleteProject({ projectId, devhub, onClose }: { projectId: string; devhub: Devhub; onClose: () => void }) {
  const project = devhub.projects.find((p) => p.id === projectId);
  return (
    <Dialog
      title={`Delete project "${project?.name ?? ""}"?`}
      onClose={onClose}
      footer={
        <>
          <Button size="sm" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={() => {
              devhub.deleteProject(projectId);
              onClose();
            }}
          >
            Delete
          </Button>
        </>
      }
    >
      <Hint>
        This removes the grouping and its launchers from <Mono>devhub.config.json</Mono>. Nothing is stopped: the processes under it were never started
        by DevHub, and nothing about them is stored.
      </Hint>
    </Dialog>
  );
}

// -------------------------------------------------------------- launcher

const DEFAULT_ALLOC: [number, number] = [3100, 3199];

function LauncherDialog({ dialog, devhub, onClose }: { dialog: Extract<DialogState, { kind: "launcher" }>; devhub: Devhub; onClose: () => void }) {
  const project = devhub.projects.find((p) => p.id === dialog.projectId);
  const svc = dialog.service;
  const declared = svc?.launchable && svc.command ? svc : null;

  const [role, setRole] = useState(svc?.role ?? "");
  const [cmd, setCmd] = useState(declared?.command ?? "");
  const [dir, setDir] = useState(svc ? relDir(svc.cwd, dialog.repoPath, devhub) : "");
  const [mode, setMode] = useState<"fixed" | "alloc">(declared?.policy?.ports === "alloc" ? "alloc" : "fixed");
  const [from, setFrom] = useState(String(declared?.policy?.ports === "alloc" ? declared.policy.range[0] : DEFAULT_ALLOC[0]));
  const [to, setTo] = useState(String(declared?.policy?.ports === "alloc" ? declared.policy.range[1] : DEFAULT_ALLOC[1]));
  const [envVar, setEnvVar] = useState(declared?.policy?.ports === "alloc" ? declared.policy.env ?? "PORT" : "PORT");
  const [showValidation, setShowValidation] = useState(false);

  // Offer the package.json scripts of whichever directory is typed, so the
  // command is usually one click instead of recalled from memory.
  const cwd = useMemo(() => joinPath(dialog.repoPath, dir), [dialog.repoPath, dir]);
  useEffect(() => {
    const t = setTimeout(() => devhub.detectScripts(cwd), 220);
    return () => clearTimeout(t);
  }, [cwd]);
  const scripts = devhub.detected?.cwd === cwd ? devhub.detected.scripts : [];

  function submit() {
    if (!role.trim() || !cmd.trim()) {
      setShowValidation(true);
      return;
    }
    const policy: PortPolicy =
      mode === "alloc"
        ? { ports: "alloc", range: [Number(from) || DEFAULT_ALLOC[0], Number(to) || DEFAULT_ALLOC[1]], env: envVar.trim() || "PORT" }
        : { ports: "fixed" };
    const launcher: Launcher = { role: role.trim(), cmd: cmd.trim(), ...(dir.trim() ? { dir: dir.trim() } : {}), policy };
    devhub.saveLauncher(dialog.projectId, dialog.repoPath, launcher, declared?.role);
    onClose();
  }

  return (
    <Dialog
      title={declared ? `Edit "${declared.role}"` : "Save as launcher"}
      subtitle={`${project?.name ?? ""} · ${dialog.repoPath}`}
      subtitleMono
      width="600px"
      onClose={onClose}
      footer={
        <>
          <Button size="sm" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" onClick={submit}>
            Save launcher
          </Button>
        </>
      }
    >
      {!declared && svc && (
        <Hint>
          DevHub sees <Mono>{svc.displayName}</Mono> running in <Mono>{tildify(svc.cwd)}</Mono> but has no command for it, so it can be stopped but not
          started. Declare it once and every worktree of this repo inherits it.
        </Hint>
      )}

      <div style={{ display: "flex", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <Field label="Role" value={role} onChange={setRole} placeholder="web" invalid={showValidation && !role.trim()} autoFocus={!declared} />
        </div>
        <div style={{ flex: 1 }}>
          <Field label="Directory in each worktree" value={dir} onChange={setDir} placeholder="apps/web" mono />
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Field label="Command" value={cmd} onChange={setCmd} placeholder="npm run dev" mono invalid={showValidation && !cmd.trim()} autoFocus={!!declared} />
        {scripts.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {scripts.slice(0, 12).map((s) => (
              <button
                key={s.name}
                type="button"
                onClick={() => setCmd(s.command)}
                style={{
                  font: "400 var(--type-micro)/1 var(--font-mono)",
                  color: "var(--dh-text-action)",
                  background: "transparent",
                  border: "1px solid var(--dh-border-button)",
                  borderRadius: 6,
                  padding: "6px 9px",
                  cursor: "pointer",
                }}
              >
                {s.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Label>Port policy</Label>
        <PolicyChoice
          selected={mode === "fixed"}
          onSelect={() => setMode("fixed")}
          title="Fixed"
          body="The repo hardcodes its ports and only one instance may run. Starting this role in one worktree fully stops it in every other worktree of this repo first."
        />
        <PolicyChoice
          selected={mode === "alloc"}
          onSelect={() => setMode("alloc")}
          title="Allocated per worktree"
          body="The command reads its port from an env var. Devhub gives each worktree its own port from this range, deterministically, so sibling worktrees stop colliding."
        />
        {mode === "alloc" && (
          <div style={{ display: "flex", gap: 10, paddingLeft: 26 }}>
            <div style={{ width: 100 }}>
              <Field label="From" value={from} onChange={setFrom} mono />
            </div>
            <div style={{ width: 100 }}>
              <Field label="To" value={to} onChange={setTo} mono />
            </div>
            <div style={{ width: 130 }}>
              <Field label="Environment variable" value={envVar} onChange={setEnvVar} mono />
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}

function PolicyChoice({ selected, onSelect, title, body }: { selected: boolean; onSelect: () => void; title: string; body: string }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        display: "flex",
        gap: 10,
        textAlign: "left",
        padding: "11px 12px",
        borderRadius: 9,
        border: `1px solid ${selected ? "var(--dh-accent)" : "var(--dh-border-button)"}`,
        background: selected ? "var(--dh-bg-hover)" : "transparent",
        cursor: "pointer",
      }}
    >
      <span
        style={{
          width: 13,
          height: 13,
          borderRadius: "50%",
          marginTop: 2,
          flex: "0 0 auto",
          border: `1px solid ${selected ? "var(--dh-accent)" : "var(--dh-border-control)"}`,
          background: selected ? "var(--dh-accent)" : "transparent",
        }}
      />
      <span style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <span style={{ font: "var(--type-row-title)", color: "var(--dh-text)" }}>{title}</span>
        <span style={{ font: "var(--type-meta-text)", color: "var(--dh-text-host)" }}>{body}</span>
      </span>
    </button>
  );
}

// ------------------------------------------------------------- migration

const migKey = (c: MigrationCandidate) => `${c.projectId}|${c.repoPath}|${c.role}`;

function MigrationDialog({ devhub, onClose }: { devhub: Devhub; onClose: () => void }) {
  const [saved, setSaved] = useState<Set<string>>(new Set());

  function save(c: MigrationCandidate) {
    devhub.saveLauncher(c.projectId, c.repoPath, {
      role: c.role,
      cmd: c.command,
      ...(c.dir ? { dir: c.dir } : {}),
      policy: { ports: "fixed" },
    });
    setSaved((s) => new Set(s).add(migKey(c)));
  }

  return (
    <Dialog
      title="Commands from your old config"
      subtitle={`${devhub.migration.length} recovered · nothing is saved until you say so`}
      width="660px"
      onClose={onClose}
      footer={
        <>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              devhub.dismissMigration();
              onClose();
            }}
          >
            Discard the rest
          </Button>
          <Button size="sm" variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <Hint>
        The old config stored a row per process DevHub ever saw, which is how one repository grew to 27 entries pointing at worktrees that no longer exist.
        None of those rows were kept. These are only the commands you had typed — save the ones still worth having as launchers every worktree inherits.
        They default to a <Mono>fixed</Mono> port policy; change that afterwards if the command takes a port.
      </Hint>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {devhub.migration.map((c) => {
          const done = saved.has(migKey(c));
          return (
            <div
              key={migKey(c)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 12px",
                borderRadius: 9,
                border: "1px solid var(--dh-border-hairline)",
                background: "var(--dh-bg-card)",
                opacity: done ? 0.5 : 1,
              }}
            >
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ font: "500 var(--type-body)/1 var(--font-mono)", color: "var(--dh-text)" }}>
                  {c.role}
                  <span style={{ color: "var(--dh-text-secondary)" }}>
                    {" · "}
                    {c.repoPath}
                    {c.dir ? `/${c.dir}` : ""}
                  </span>
                </span>
                <span style={{ font: "400 var(--type-meta)/1 var(--font-mono)", color: "var(--dh-text-host)" }}>{c.command}</span>
              </div>
              <Button size="sm" variant={done ? "ghost" : "secondary"} disabled={done} onClick={() => save(c)}>
                {done ? "Saved" : "Save"}
              </Button>
            </div>
          );
        })}
      </div>
    </Dialog>
  );
}

// ----------------------------------------------------------------- atoms

function Field({
  label,
  value,
  onChange,
  placeholder,
  mono,
  autoFocus,
  invalid,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  autoFocus?: boolean;
  invalid?: boolean;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      <Label>{label}</Label>
      <input
          data-autofocus={autoFocus || undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        spellCheck={false}
        style={{
          background: "var(--dh-bg-input)",
          border: `1px solid ${invalid ? "var(--dh-status-crashed)" : "var(--dh-border-control)"}`,
          borderRadius: 8,
          padding: "10px 11px",
          color: "var(--dh-text)",
          font: mono ? "var(--type-code)" : "var(--type-body-text)",
          fontFeatureSettings: mono ? "var(--font-feature-mono)" : "var(--font-feature-ui)",
          width: "100%",
        }}
      />
    </label>
  );
}

function Label({ children }: { children: ReactNode }) {
  return (
    <span style={{ font: "var(--type-meta-text)", letterSpacing: "var(--tracking-meta)", color: "var(--dh-text-tertiary)" }}>
      {children}
    </span>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <span style={{ font: "var(--type-meta-text)", color: "var(--dh-text-host)" }}>{children}</span>;
}

function Mono({ children }: { children: ReactNode }) {
  return <span style={{ color: "var(--dh-text)" }}>{children}</span>;
}

/** Directory of an observed service relative to the worktree that owns it —
 *  the value a launcher's `dir` should hold, since launchers are declared
 *  once per repo and resolved per worktree. */
function relDir(cwd: string, repoPath: string, devhub: Devhub): string {
  const repo = devhub.projects.flatMap((p) => p.repos).find((r) => r.path === repoPath);
  const worktree = repo?.worktrees.map((w) => w.path).find((p) => cwd === p || cwd.startsWith(`${p}/`));
  if (!worktree) return "";
  return cwd === worktree ? "" : cwd.slice(worktree.length + 1);
}

function joinPath(repoPath: string, dir: string): string {
  const base = repoPath.replace(/\/$/, "");
  const rel = dir.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  return rel ? `${base}/${rel}` : base;
}
