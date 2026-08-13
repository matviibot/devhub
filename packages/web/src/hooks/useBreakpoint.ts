import { useEffect, useRef, useState } from "react";

/** Window-size classes straight from the mockup: single-pane below 700px,
 *  a narrower rail from 700-1024px, full-size at 1024px and up. */
export interface Breakpoint {
  width: number;
  compact: boolean;
  medium: boolean;
}

/** Tracks the width of the returned ref's element via ResizeObserver and
 *  derives the mockup's compact/medium window-size classes from it — one
 *  measurement shared by the dashboard layout and the log drawer's width,
 *  mirroring the mockup's single `state.w`. */
export function useBreakpoint<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(1400);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      setWidth((prev) => (Math.abs(w - prev) > 0.5 ? w : prev));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const breakpoint: Breakpoint = { width, compact: width < 700, medium: width >= 700 && width < 1024 };
  return { ref, ...breakpoint };
}
