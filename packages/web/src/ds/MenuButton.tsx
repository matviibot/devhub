import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

export interface MenuButtonItem {
  key: string;
  label?: string;
  icon?: string;
  divider?: boolean;
  onSelect?: () => void;
}

interface Props {
  label: string;
  icon?: string;
  items: MenuButtonItem[];
}

/** Compact primary button with a chevron that opens an anchored dropdown menu. */
export function MenuButton({ label, icon = "plus", items }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement | null>(null);

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

  return (
    <span ref={ref} style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          height: "var(--control-height-sm)",
          padding: "0 6px 0 8px",
          borderRadius: "var(--radius-sm)",
          border: "none",
          background: "var(--color-primary)",
          color: "var(--color-on-primary)",
          font: "600 var(--text-label-medium-size)/var(--text-label-medium-line) var(--font-ui)",
          letterSpacing: "var(--text-label-medium-track)",
          fontFamily: "var(--font-ui)",
          cursor: "pointer",
          WebkitAppearance: "none",
          outline: "none",
        }}
      >
        <Icon name={icon} size={13} />
        {label}
        <Icon
          name="chevron-down"
          size={12}
          style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform var(--duration-fast) var(--ease-standard)" }}
        />
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            zIndex: 30,
            minWidth: 170,
            maxHeight: 240,
            overflowY: "auto",
            padding: 4,
            borderRadius: "var(--radius-md)",
            background: "var(--color-surface-container-high)",
            boxShadow: "var(--elevation-3)",
          }}
        >
          {items.map((item) =>
            item.divider ? (
              <div key={item.key} style={{ height: 1, margin: "4px 4px", background: "var(--material-hairline)" }} />
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

function MenuRow({ item, onSelect }: { item: MenuButtonItem; onSelect: () => void }) {
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
        gap: 8,
        height: 28,
        padding: "0 8px",
        borderRadius: "var(--radius-sm)",
        background: hover ? "var(--state-hover)" : "transparent",
        font: "400 12px/1 var(--font-ui)",
        color: "var(--color-on-surface)",
        cursor: "default",
        transition: "var(--transition-state)",
      }}
    >
      {item.icon && <Icon name={item.icon} size={13} color="var(--color-on-surface-variant)" />}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.label}</span>
    </div>
  );
}
