import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";

/** The URL is the navigation state: `/`, `/active`, `/attention`, `/ports`,
 *  `/unowned`, `/projects/<id>`, plus `?logs=<serviceId>` for the log drawer. */
export type DashboardView =
  | { kind: "home" }
  | { kind: "active" }
  | { kind: "project"; id: string }
  | { kind: "attention" }
  | { kind: "ports" }
  | { kind: "unowned" };

const PAGES = ["active", "attention", "ports", "unowned"] as const;
const NAVIGATE = "devhub:navigate";

export function parseView(pathname: string): DashboardView {
  const [, first = "", second] = pathname.split("/");
  if (first === "projects" && second) return { kind: "project", id: decodeURIComponent(second) };
  return (PAGES as readonly string[]).includes(first) ? ({ kind: first } as DashboardView) : { kind: "home" };
}

export function viewPath(view: DashboardView): string {
  if (view.kind === "home") return "/";
  if (view.kind === "project") return `/projects/${encodeURIComponent(view.id)}`;
  return `/${view.kind}`;
}

function navigate(url: string, replace = false) {
  if (url === location.pathname + location.search) return;
  history[replace ? "replaceState" : "pushState"](null, "", url);
  window.dispatchEvent(new Event(NAVIGATE));
}

function withLogs(pathname: string, logs: string | null) {
  const params = new URLSearchParams(location.search);
  if (logs) params.set("logs", logs);
  else params.delete("logs");
  const q = params.toString();
  return q ? `${pathname}?${q}` : pathname;
}

/** Re-renders on back/forward and on in-app navigation. */
function useLocation() {
  const [loc, setLoc] = useState(() => location.pathname + location.search);
  useEffect(() => {
    const sync = () => setLoc(location.pathname + location.search);
    window.addEventListener("popstate", sync);
    window.addEventListener(NAVIGATE, sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener(NAVIGATE, sync);
    };
  }, []);
  return loc;
}

export function useView(): [DashboardView, (view: DashboardView) => void] {
  const loc = useLocation();
  const pathname = loc.split("?")[0];
  const view = useMemo(() => parseView(pathname), [pathname]);
  // Changing view keeps an open log drawer open; it is page-independent.
  const setView = useCallback((next: DashboardView) => navigate(withLogs(viewPath(next), new URLSearchParams(location.search).get("logs"))), []);
  return [view, setView];
}

export function useLogParam(): [string | null, (next: string | null | ((cur: string | null) => string | null)) => void] {
  const loc = useLocation();
  const logs = new URLSearchParams(loc.split("?")[1] ?? "").get("logs");
  const setLogs = useCallback((next: string | null | ((cur: string | null) => string | null)) => {
    const cur = new URLSearchParams(location.search).get("logs");
    // Drawer toggles replace history: Back should leave the page, not close a pane.
    navigate(withLogs(location.pathname, typeof next === "function" ? next(cur) : next), true);
  }, []);
  return [logs, setLogs];
}

/** Props for an `<a>` that navigates in-app on a plain click and still opens
 *  a real tab on cmd/ctrl/middle click. */
export function linkProps(view: DashboardView, onNavigate?: () => void) {
  const href = viewPath(view);
  return {
    href,
    onClick: (event: MouseEvent<HTMLAnchorElement>) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      if (onNavigate) onNavigate();
      else navigate(withLogs(href, new URLSearchParams(location.search).get("logs")));
    },
  };
}
