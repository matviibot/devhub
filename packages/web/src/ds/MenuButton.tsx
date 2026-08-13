import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
  const [placement, setPlacement] = useState<{ up: boolean; left: boolean }>({ up: false, left: false });
  const ref = useRef<HTMLSpanElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const t = TRIGGER_SIZES[size];

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Flip near viewport edges: left-aligned within 220px of the right edge,
  // above the trigger within 200px of the bottom.
  useLayoutEffect(() => {
    if (!open || compact || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPlacement({
      up: window.innerHeight - r.bottom < 200,
      left: window.innerWidth - r.right < 220,
    });
  }, [open, compact]);

  return (
    <span ref={ref} style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: t.box,
          height: t.box,
          flex: "0 0 auto",
          border: "1px solid var(--dh-border-button)",
          borderRadius: 8,
          padding: 0,
          background: open || hover ? "var(--dh-bg-hover)" : "transparent",
          color: open || hover ? "var(--dh-text-bright)" : "var(--dh-text-action)",
          cursor: "pointer",
          WebkitAppearance: "none",
          outline: "none",
          transition: "var(--transition-state)",
        }}
      >
        <Icon name={icon} size={t.icon} />
      </button>
      {open && compact && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{ position: "fixed", inset: 0, background: "var(--dh-scrim)", opacity: 0.58, zIndex: 40, animation: "dh-scrim-in var(--duration-normal) var(--ease-out)" }}
          />
          <div
            role="menu"
            style={{
              position: "fixed",
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 41,
              background: "var(--dh-bg-card)",
              borderTop: "1px solid var(--dh-border-button)",
              borderRadius: "16px 16px 0 0",
              padding: "6px 6px 10px",
              display: "flex",
              flexDirection: "column",
              gap: 2,
              animation: "dh-sheet-in .25s ease-out both",
            }}
          >
            <div style={{ padding: "12px 10px 8px", font: "600 14px/1 var(--font-ui)", color: "var(--dh-text)", textAlign: "center" }}>{label}</div>
            {items.map((item) =>
              item.divider ? (
                <div key={item.key} style={{ height: 1, margin: "5px 6px", background: "var(--dh-border-hairline)" }} />
              ) : (
                <MenuRow
                  key={item.key}
                  item={item}
                  compact
                  onSelect={() => {
                    setOpen(false);
                    item.onSelect?.();
                  }}
                />
              ),
            )}
          </div>
        </>
      )}
      {open && !compact && (
        <div
          ref={panelRef}
          role="menu"
          style={{
            position: "absolute",
            top: placement.up ? "auto" : "calc(100% + 4px)",
            bottom: placement.up ? "calc(100% + 4px)" : "auto",
            ...(placement.left ? { right: 0 } : { left: 0 }),
            zIndex: 30,
            minWidth: 200,
            maxHeight: 280,
            overflowY: "auto",
            padding: 6,
            borderRadius: 10,
            background: "var(--dh-bg-card)",
            border: "1px solid var(--dh-border-button)",
            boxShadow: "0 14px 34px rgba(8,7,12,0.6)",
            display: "flex",
            flexDirection: "column",
            gap: 2,
            animation: "dh-menu-in .16s ease-out both",
          }}
        >
          {items.map((item) =>
            item.divider ? (
              <div key={item.key} style={{ height: 1, margin: "5px 4px", background: "var(--dh-border-hairline)" }} />
            ) : (
              <MenuRow
                key={item.key}
                item={item}
                onSelect={() => {
                  setOpen(false);
                  item.onSelect?.();
                }}
              />
            ),
          )}
        </div>
      )}
    </span>
  );
}

function MenuRow({ item, onSelect, compact = false }: { item: MenuButtonItem; onSelect: () => void; compact?: boolean }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      role="menuitem"
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        minHeight: compact ? 44 : undefined,
        padding: "9px",
        borderRadius: 7,
        background: hover ? (item.danger ? "rgba(238,139,120,0.1)" : "var(--dh-bg-hover)") : "transparent",
        cursor: "pointer",
        transition: "var(--transition-state)",
      }}
    >
      <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 15, flex: "0 0 auto", color: item.danger ? "var(--dh-status-crashed)" : "var(--dh-text-secondary)" }}>
        {item.icon && <Icon name={item.icon} size={14} />}
      </span>
      <span style={{ font: "400 12px/1 var(--font-mono)", color: item.danger ? "var(--dh-status-crashed)" : "var(--dh-text)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {item.label}
      </span>
      {item.hint && <span style={{ font: "400 10px/1 var(--font-mono)", color: "var(--dh-text-faint)", flex: "0 0 auto" }}>{item.hint}</span>}
    </div>
  );
}
