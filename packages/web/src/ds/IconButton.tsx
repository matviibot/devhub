import { useState, type ButtonHTMLAttributes, type CSSProperties } from "react";
import { Icon } from "./Icon";
import { Tooltip } from "./Tooltip";

type Size = "sm" | "md" | "lg";

const SIZES: Record<Size, { box: number; icon: number; r: string }> = {
  sm: { box: 22, icon: 13, r: "var(--radius-xs)" },
  md: { box: 28, icon: 15, r: "var(--radius-sm)" },
  lg: { box: 34, icon: 18, r: "var(--radius-md)" },
};

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "size"> {
  icon: string;
  label: string;
  size?: Size;
  variant?: "ghost" | "filled";
  selected?: boolean;
  style?: CSSProperties;
}

/** Square, label-less button for toolbars and row affordances — the label
 *  surfaces as a hover tooltip (dropped on compact/touch widths) and as
 *  `aria-label` always. */
export function IconButton({
  icon,
  label,
  size = "md",
  variant = "ghost",
  selected = false,
  disabled = false,
  style,
  onClick,
  ...rest
}: Props) {
  const [hover, setHover] = useState(false);
  const [press, setPress] = useState(false);
  const s = SIZES[size] || SIZES.md;
  const filled = variant === "filled";
  const bg = filled ? "var(--color-primary)" : selected ? "var(--state-selected)" : press ? "var(--state-press)" : hover ? "var(--state-hover)" : "transparent";
  const fg = filled ? "var(--color-on-primary)" : selected ? "var(--color-primary)" : hover ? "var(--dh-text-bright)" : "var(--color-on-surface-variant)";
  return (
    <Tooltip label={label}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={selected || undefined}
        disabled={disabled}
        onClick={disabled ? undefined : onClick}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => {
          setHover(false);
          setPress(false);
        }}
        onMouseDown={() => setPress(true)}
        onMouseUp={() => setPress(false)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: s.box,
          height: s.box,
          borderRadius: s.r,
          border: "none",
          padding: 0,
          background: bg,
          color: fg,
          cursor: disabled ? "default" : "pointer",
          opacity: disabled ? 0.38 : 1,
          transition: "var(--transition-state)",
          outline: "none",
          ...style,
        }}
        {...rest}
      >
        <Icon name={icon} size={s.icon} />
      </button>
    </Tooltip>
  );
}
