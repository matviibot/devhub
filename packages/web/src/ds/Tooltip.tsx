import { cloneElement, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";

const HOVER_DELAY_MS = 400;
const CHAIN_WINDOW_MS = 300;
const COMPACT_QUERY = "(max-width: 699px)";
const GAP = 8;
const MARGIN = 8;

// Module-level so re-entering a neighboring trigger within 300ms of the
// last tooltip closing skips the hover delay, matching a native menu bar.
let lastHideAt = 0;

/** Hover-delay label pill for icon-only affordances. Dropped entirely on
 *  compact/touch widths (no hover there) — callers should ensure the
 *  action is otherwise reachable via a visible label or menu. Rendered in a
 *  portal with fixed coordinates so overflow/scroll ancestors cannot clip it. */
export function Tooltip({ label, children }: { label?: string; children: ReactNode }) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [compact, setCompact] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const tipRef = useRef<HTMLSpanElement | null>(null);
  const tipId = useId();

  useEffect(() => {
    const mq = window.matchMedia(COMPACT_QUERY);
    const sync = () => setCompact(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  function open() {
    if (compact || !label) return;
    const skipDelay = Date.now() - lastHideAt < CHAIN_WINDOW_MS;
    clearTimeout(timerRef.current);
    if (skipDelay) setShow(true);
    else timerRef.current = setTimeout(() => setShow(true), HOVER_DELAY_MS);
  }
  function close() {
    clearTimeout(timerRef.current);
    if (show) lastHideAt = Date.now();
    setShow(false);
    setPos(null);
  }

  useEffect(() => () => clearTimeout(timerRef.current), []);

  // Below the trigger by default, above when it would overflow the viewport
  // bottom; horizontally centered, clamped to the viewport edges.
  useLayoutEffect(() => {
    if (!show || !wrapRef.current || !tipRef.current) return;
    const r = wrapRef.current.getBoundingClientRect();
    const t = tipRef.current.getBoundingClientRect();
    const below = r.bottom + GAP;
    const top = below + t.height > window.innerHeight - MARGIN ? Math.max(MARGIN, r.top - GAP - t.height) : below;
    const left = Math.min(window.innerWidth - MARGIN - t.width, Math.max(MARGIN, r.left + r.width / 2 - t.width / 2));
    setPos({ top, left });
  }, [show]);

  // Fixed coordinates go stale once anything scrolls or resizes: hide rather than drift.
  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", onKey);
    };
  });

  const trigger = show && isValidElement(children) ? cloneElement(children as ReactElement<{ "aria-describedby"?: string }>, { "aria-describedby": tipId }) : children;

  return (
    <span
      ref={wrapRef}
      style={{ display: "inline-flex" }}
      onMouseEnter={open}
      onMouseLeave={close}
      // Keyboard focus only — a mouse click focusing the button must not pop the tooltip.
      onFocus={(e) => e.target.matches(":focus-visible") && open()}
      onBlur={close}
    >
      {trigger}
      {show && label && createPortal(
        <span
          ref={tipRef}
          id={tipId}
          role="tooltip"
          style={{
            position: "fixed",
            top: pos?.top ?? 0,
            left: pos?.left ?? 0,
            visibility: pos ? "visible" : "hidden",
            whiteSpace: "nowrap",
            background: "var(--dh-bg-rail-footer)",
            border: "1px solid var(--dh-border-button)",
            borderRadius: 6,
            padding: "5px 9px",
            font: "var(--type-caption)",
            color: "var(--dh-text-back)",
            pointerEvents: "none",
            zIndex: 110,
            animation: "dh-tooltip-in 80ms ease both",
          }}
        >
          {label}
        </span>,
        document.body,
      )}
    </span>
  );
}
