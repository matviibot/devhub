import { useEffect, useRef, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Every open overlay, oldest first. Module-level rather than React context
 *  because overlays are rendered as *siblings*, not nested — the Folder
 *  Browser sits next to the Add Project dialog in the tree, so context from
 *  one never reaches the other. */
const stack: { onClose?: () => void }[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
const snapshot = () => stack.length;

/** One scrim for the whole app, mounted once by `<ScrimHost>` and shown
 *  whenever at least one overlay is open. Previously each overlay painted
 *  its own, so opening the Folder Browser over Add Project stacked two at
 *  0.58 into a near-black 0.82 and fired two entrance animations. */
export function ScrimHost() {
  const depth = useSyncExternalStore(subscribe, snapshot, snapshot);

  // Escape closes the TOPMOST overlay, matching what a backdrop click already
  // did. Previously Escape was handled by `Dialogs` against the whole dialog
  // tree, so dismissing the folder picker stacked over an edit dialog closed
  // both and threw the form away — two dismiss gestures with two different
  // outcomes, the destructive one being the reflex.
  useEffect(() => {
    if (depth === 0) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      const top = stack[stack.length - 1];
      if (top?.onClose) {
        e.stopPropagation();
        top.onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [depth]);

  // The page behind a modal scrim should not scroll under it.
  useEffect(() => {
    if (depth === 0) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [depth]);

  if (depth === 0) return null;
  return (
    <div
      data-dh-scrim="1"
      onClick={() => stack[stack.length - 1]?.onClose?.()}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 39,
        background: "var(--dh-scrim-veil)",
        // `forwards`, never `both`: the resting look is this element's own
        // style, so if the animation hasn't started yet (a backgrounded tab
        // doesn't run them) the scrim is already correct rather than
        // invisible. Alpha lives in --dh-scrim-veil and never in an
        // `opacity` declaration — a running animation outranks an inline
        // style, so inline `opacity:.58` under a 0→1 keyframe ramped to
        // fully opaque and snapped back the moment it ended.
        animation: "dh-scrim-in var(--duration-normal) var(--ease-out) forwards",
      }}
    />
  );
}

/** Registers a surface that is NOT laid out by `Overlay` — currently the log
 *  drawer, which is pinned to the right edge rather than centered — so it
 *  still takes part in the shared scrim, the Escape stack and the scroll
 *  lock. Previously the drawer painted its own scrim and sat outside the
 *  stack entirely, so backdrop-click closed it but Escape did nothing, and a
 *  dialog opened over it produced two independent scrims. */
export function useOverlayEntry(onClose?: () => void) {
  useEffect(() => {
    const entry = { onClose };
    stack.push(entry);
    emit();
    return () => {
      const i = stack.indexOf(entry);
      if (i !== -1) stack.splice(i, 1);
      emit();
    };
  }, [onClose]);
}

interface Props {
  /** Backdrop click / Escape target. Only the topmost overlay's `onClose`
   *  fires on a scrim click. */
  onClose?: () => void;
  zIndex?: number;
  /** Bottom-sheet presentation: panel pinned to the bottom edge, full width. */
  sheet?: boolean;
  /** Style for the panel wrapper (background, border, width…). */
  panelStyle?: CSSProperties;
  children: ReactNode;
}

/** Portal + scroll-safe centering — the one implementation behind every
 *  floating surface (Dialog, and the Folder Browser nested above it).
 *
 *  Two things here are load-bearing and easy to regress:
 *
 *  1. It portals to `document.body`. Nested inside the app root, a
 *     `position: fixed` panel is at the mercy of any ancestor that grows a
 *     `transform`/`filter`/`contain` — which silently turns that ancestor
 *     into the containing block and clips the panel. The app root already
 *     has `overflow: hidden` and framer-motion subtrees, so this is one
 *     stray style away at all times; portalling makes the class of bug
 *     unreachable.
 *
 *  2. The panel is centered with `margin: auto` inside a scrollable, padded
 *     container — not with `align-items: center`. A flex item centered by
 *     `align-items` and taller than its container overflows equally in both
 *     directions, and the top overflow sits above the scroll origin where
 *     it can never be reached. `margin: auto` collapses to 0 in that case
 *     and the container scrolls instead. */
export function Overlay({ onClose, zIndex = 40, sheet = false, panelStyle, children }: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const entry = { onClose };
    stack.push(entry);
    emit();
    return () => {
      const i = stack.indexOf(entry);
      if (i !== -1) stack.splice(i, 1);
      emit();
    };
  }, [onClose]);

  /** Focus in on open, focus back on close, and keep Tab inside while open.
   *  Without this the modality was purely visual: the scrim blocked clicks
   *  but Tab walked straight into the dashboard behind it, the folder picker
   *  opened with focus still in the dialog underneath, and closing a dialog
   *  dropped focus on <body> so the next Tab restarted at the top of the app. */
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const tabbables = () =>
      [...panel.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(
        (el) => !el.hasAttribute("disabled") && el.offsetParent !== null,
      );

    // Prefer an element that asked for focus (autoFocus), else the first
    // tabbable, else the panel itself so the ring has somewhere to land.
    const first = panel.querySelector<HTMLElement>("[data-autofocus], [autofocus]") ?? tabbables()[0] ?? panel;
    const id = requestAnimationFrame(() => first.focus());

    function onKey(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      // Only the topmost overlay traps; a stacked child owns the keyboard.
      if (stack[stack.length - 1]?.onClose !== onClose) return;
      const items = tabbables();
      if (!items.length) {
        e.preventDefault();
        return;
      }
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    }
    panel.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(id);
      panel.removeEventListener("keydown", onKey);
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex,
        display: "flex",
        alignItems: sheet ? "flex-end" : "flex-start",
        justifyContent: "center",
        overflowY: sheet ? "hidden" : "auto",
        overscrollBehavior: "contain",
        padding: sheet ? 0 : "32px 16px",
        // The shared scrim handles dismissal; this container is only a
        // positioner and must not swallow clicks meant for it.
        pointerEvents: "none",
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        style={{
          position: "relative",
          margin: sheet ? 0 : "auto",
          maxHeight: "100%",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          pointerEvents: "auto",
          ...panelStyle,
        }}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
