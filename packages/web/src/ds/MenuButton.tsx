import { Fragment, forwardRef, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";

export interface MenuButtonItem {
  key: string;
  label?: string;
  /** Leading Material Symbol name (e.g. "edit", "delete"). Omit for rows
   *  with no icon. */
  icon?: string;
  /** Trailing text, e.g. a shortcut ("⌘C"). */
  hint?: string;
  /** Destructive row — red text, red-tinted hover, sits below a divider. */
  danger?: boolean;
  /** Draw a separator ABOVE this row. It is not a separator *instead* of the
   *  row: rendering `item.divider ? <hr/> : <row/>` silently swallowed every
   *  item that asked for one, which is how "reveal in Finder" and "delete
   *  launcher" disappeared from their menus entirely. */
  divider?: boolean;
  onSelect?: () => void;
}

type Size = "sm" | "md";

const TRIGGER_SIZES: Record<Size, { box: number; icon: number }> = {
  sm: { box: 24, icon: 14 },
  md: { box: 30, icon: 16 },
};

interface Props {
  label: string;
  /** Trigger's Material Symbol name. */
  icon?: string;
  /** Square trigger box size — "md" for header-level menus sitting next to
   *  a full-height action button, "sm" (default) for row-level "actions"
   *  triggers. */
  size?: Size;
  items: MenuButtonItem[];
  /** Below 700px the panel becomes a full-width bottom sheet. */
  compact?: boolean;
}

/** Compact square icon trigger that opens an anchored dropdown menu — the
 *  one panel component behind every "more actions" menu in the app. */
export function MenuButton({ label, icon = "more_vert", size = "sm", items, compact = false }: Props) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, maxHeight: 280, ready: false });
  const ref = useRef<HTMLSpanElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();
  const t = TRIGGER_SIZES[size];
  const triggerBox = compact ? Math.max(t.box, 44) : Math.max(t.box, 30);

  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);

  /** Index of the first/last selectable row, skipping nothing — every item in
   *  `items` renders a row now that `divider` is a decoration rather than a
   *  replacement. */
  const focusRow = useCallback(
    (i: number) => {
      const n = items.length;
      if (!n) return;
      const target = ((i % n) + n) % n;
      rowRefs.current[target]?.focus();
    },
    [items.length],
  );

  /** Arrow/Home/End move focus between rows; Tab closes rather than letting
   *  focus escape into the page behind an open menu. */
  const onRowKey = useCallback(
    (e: React.KeyboardEvent, i: number) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        focusRow(i + 1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        focusRow(i - 1);
      } else if (e.key === "Home") {
        e.preventDefault();
        focusRow(0);
      } else if (e.key === "End") {
        e.preventDefault();
        focusRow(items.length - 1);
      } else if (e.key === "Tab") {
        setOpen(false);
      }
    },
    [focusRow, items.length],
  );

  // Move focus into the panel when it opens, so the keyboard never lands on a
  // menu it cannot operate. A layout effect, not a passive one with a rAF:
  // refs are attached by the time this runs, and it lands before paint so the
  // ring never appears on the trigger first.
  useLayoutEffect(() => {
    if (open) focusRow(0);
  }, [open, focusRow]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node;
      if (!ref.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onDocClick);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // The menu lives in a portal so overflow panes cannot clip it. Recompute
  // its fixed coordinates on scroll/resize so it stays attached to the
  // trigger rather than drifting with the page underneath it.
  useLayoutEffect(() => {
    if (!open || compact || !triggerRef.current || !panelRef.current) return;
    const place = () => {
      const trigger = triggerRef.current?.getBoundingClientRect();
      const panel = panelRef.current;
      if (!trigger || !panel) return;
      const margin = 8;
      const gap = 6;
      const width = Math.max(216, panel.offsetWidth);
      const desiredHeight = Math.min(panel.scrollHeight, 320);
      const below = window.innerHeight - trigger.bottom - margin - gap;
      const above = trigger.top - margin - gap;
      const opensUp = below < Math.min(desiredHeight, 180) && above > below;
      const maxHeight = Math.max(96, Math.min(320, opensUp ? above : below));
      const top = opensUp
        ? Math.max(margin, trigger.top - gap - Math.min(desiredHeight, maxHeight))
        : Math.min(window.innerHeight - margin - Math.min(desiredHeight, maxHeight), trigger.bottom + gap);
      const left = Math.min(window.innerWidth - margin - width, Math.max(margin, trigger.right - width));
      setPosition({ top, left, maxHeight, ready: true });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, compact]);

  return (
    <span ref={ref} style={{ position: "relative", display: "inline-flex" }}>
      <button
        data-ds-menu-trigger="1"
        ref={triggerRef}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => {
            if (!o) setPosition((current) => ({ ...current, ready: false }));
            return !o;
          });
        }}
        onKeyDown={(e) => {
          // Down/Up open the menu straight onto a row, the convention every
          // native menu button follows.
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: triggerBox,
          height: triggerBox,
          flex: "0 0 auto",
          border: `1px solid ${open ? "var(--dh-border-button)" : "transparent"}`,
          borderRadius: 8,
          padding: 0,
          background: open || hover ? "var(--dh-bg-hover)" : "transparent",
          color: open || hover ? "var(--dh-text-bright)" : "var(--dh-text-action)",
          cursor: "pointer",
          WebkitAppearance: "none",
          transition: "var(--transition-state)",
        }}
      >
        <Icon name={icon} size={t.icon} />
      </button>
      {open && compact && createPortal((
        <>
          <div
            onClick={() => setOpen(false)}
            data-dh-scrim="1"
            style={{ position: "fixed", inset: 0, background: "var(--dh-scrim-veil)", zIndex: 40, animation: "dh-scrim-in var(--duration-normal) var(--ease-out) forwards" }}
          />
          <div
            ref={panelRef}
            id={menuId}
            role="menu"
            style={{
              position: "fixed",
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 41,
              background: "var(--dh-surface-raised)",
              borderTop: "1px solid var(--dh-border-button)",
              borderRadius: "16px 16px 0 0",
              padding: "6px 6px 10px",
              display: "flex",
              flexDirection: "column",
              gap: 2,
              animation: "dh-sheet-in .25s ease-out both",
            }}
          >
            <div style={{ padding: "12px 10px 8px", font: "600 var(--type-title)/1 var(--font-ui)", color: "var(--dh-text)", textAlign: "center" }}>{label}</div>
            {items.map((item, i) => (
              <Fragment key={item.key}>
                {item.divider && <div style={{ height: 1, margin: "5px 6px", background: "var(--dh-border-hairline)" }} />}
                <MenuRow
                  item={item}
                  compact
                  ref={(el) => {
                    rowRefs.current[i] = el;
                  }}
                  onNav={(e) => onRowKey(e, i)}
                  onSelect={() => {
                    setOpen(false);
                    item.onSelect?.();
                  }}
                />
              </Fragment>
            ))}
          </div>
        </>
      ), document.body)}
      {open && !compact && createPortal((
        <div
          ref={panelRef}
          id={menuId}
          role="menu"
          style={{
            position: "fixed",
            top: position.top,
            left: position.left,
            zIndex: 100,
            minWidth: 216,
            maxHeight: position.maxHeight,
            overflowY: "auto",
            padding: 6,
            borderRadius: 10,
            background: "var(--dh-surface-raised)",
            border: "1px solid var(--dh-border-button)",
            boxShadow: "var(--dh-shadow-menu)",
            display: "flex",
            flexDirection: "column",
            gap: 2,
            animation: "dh-menu-in .16s ease-out both",
            visibility: position.ready ? "visible" : "hidden",
          }}
        >
          {items.map((item, i) => (
            <Fragment key={item.key}>
              {item.divider && <div style={{ height: 1, margin: "5px 4px", background: "var(--dh-border-hairline)" }} />}
              <MenuRow
                item={item}
                ref={(el) => {
                  rowRefs.current[i] = el;
                }}
                onNav={(e) => onRowKey(e, i)}
                onSelect={() => {
                  setOpen(false);
                  item.onSelect?.();
                }}
              />
            </Fragment>
          ))}
        </div>
      ), document.body)}
    </span>
  );
}

const MenuRow = forwardRef<HTMLButtonElement, { item: MenuButtonItem; onSelect: () => void; compact?: boolean; onNav: (e: React.KeyboardEvent) => void }>(
  function MenuRow({ item, onSelect, compact = false, onNav }, ref) {
    const [hover, setHover] = useState(false);
    const [focus, setFocus] = useState(false);
    return (
      <button
        ref={ref}
        type="button"
        role="menuitem"
        // -1 keeps the roving focus model: the panel focuses one row at a
        // time and Arrow keys move it, rather than Tab walking through the
        // menu and on into the page behind it.
        tabIndex={-1}
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
        onKeyDown={onNav}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          width: "100%",
          minHeight: compact ? 44 : undefined,
          padding: "9px",
          border: "none",
          borderRadius: 7,
          textAlign: "left",
          font: "inherit",
          background: hover || focus ? (item.danger ? "var(--dh-alert-bg-hover)" : "var(--dh-bg-hover)") : "transparent",
          cursor: "pointer",
          transition: "var(--transition-state)",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 15, flex: "0 0 auto", color: item.danger ? "var(--dh-status-crashed)" : "var(--dh-text-secondary)" }}>
          {item.icon && <Icon name={item.icon} size={14} />}
        </span>
        <span style={{ font: "var(--type-control)", color: item.danger ? "var(--dh-status-crashed)" : "var(--dh-text)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {item.label}
        </span>
        {item.hint && <span style={{ font: "400 var(--type-micro)/1 var(--font-mono)", color: "var(--dh-text-secondary)", flex: "0 0 auto" }}>{item.hint}</span>}
      </button>
    );
  },
);
