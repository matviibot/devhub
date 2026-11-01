import { useEffect, useRef, useState, type ReactNode } from "react";

const HOVER_DELAY_MS = 400;
const CHAIN_WINDOW_MS = 300;
const COMPACT_QUERY = "(max-width: 699px)";

// Module-level so re-entering a neighboring trigger within 300ms of the
// last tooltip closing skips the hover delay, matching a native menu bar.
let lastHideAt = 0;

/** Hover-delay label pill for icon-only affordances. Dropped entirely on
 *  compact/touch widths (no hover there) — callers should ensure the
 *  action is otherwise reachable via a visible label or menu. */
export function Tooltip({ label, children }: { label?: string; children: ReactNode }) {
  const [show, setShow] = useState(false);
  const [flip, setFlip] = useState(false);
  const [compact, setCompact] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const wrapRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const mq = window.matchMedia(COMPACT_QUERY);
    const sync = () => setCompact(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  function open() {
    if (compact || !label) return;
    if (wrapRef.current) {
      const r = wrapRef.current.getBoundingClientRect();
      setFlip(window.innerHeight - r.bottom < 60);
    }
    const skipDelay = Date.now() - lastHideAt < CHAIN_WINDOW_MS;
    clearTimeout(timerRef.current);
    if (skipDelay) setShow(true);
    else timerRef.current = setTimeout(() => setShow(true), HOVER_DELAY_MS);
  }
  function close() {
    clearTimeout(timerRef.current);
    if (show) lastHideAt = Date.now();
    setShow(false);
  }

  return (
    <span ref={wrapRef} style={{ position: "relative", display: "inline-flex" }} onMouseEnter={open} onMouseLeave={close} onFocus={open} onBlur={close}>
      {children}
      {show && label && (
        <span
          role="tooltip"
          style={{
            position: "absolute",
            top: flip ? "auto" : "calc(100% + 8px)",
            bottom: flip ? "calc(100% + 8px)" : "auto",
            left: "50%",
            transform: "translateX(-50%)",
            whiteSpace: "nowrap",
            background: "var(--dh-bg-rail-footer)",
            border: "1px solid var(--dh-border-button)",
            borderRadius: 6,
            padding: "5px 9px",
            font: "var(--type-caption)",
            color: "var(--dh-text-back)",
            pointerEvents: "none",
            zIndex: 60,
            animation: "dh-tooltip-in 80ms ease both",
          }}
        >
          {label}
        </span>
      )}
    </span>
  );
}
