import { useState, type ButtonHTMLAttributes, type CSSProperties } from "react";
import { Icon } from "./Icon";

type Size = "sm" | "md" | "lg";
type Variant = "primary" | "secondary" | "ghost" | "tonal" | "danger";

const SIZES: Record<Size, { h: string; px: number; gap: number; fs: string; lh: string; tr: string; icon: number; r: string }> = {
  sm: { h: "var(--control-height-sm)", px: 8, gap: 5, fs: "var(--text-label-medium-size)", lh: "var(--text-label-medium-line)", tr: "var(--text-label-medium-track)", icon: 13, r: "var(--radius-sm)" },
  md: { h: "var(--control-height)", px: 12, gap: 6, fs: "var(--text-label-large-size)", lh: "var(--text-label-large-line)", tr: "var(--text-label-large-track)", icon: 15, r: "var(--radius-md)" },
  lg: { h: "var(--control-height-lg)", px: 16, gap: 8, fs: "var(--text-label-large-size)", lh: "var(--text-label-large-line)", tr: "var(--text-label-large-track)", icon: 16, r: "var(--radius-md)" },
};

function tint(a: number) {
  return `linear-gradient(rgba(0,0,0,${a}),rgba(0,0,0,${a}))`;
}

const VARIANTS: Record<Variant, { bg: string; fg: string; ring: string; hover: string; press: string }> = {
  primary: { bg: "var(--color-primary)", fg: "var(--color-on-primary)", ring: "none", hover: tint(0.1), press: tint(0.18) },
  secondary: { bg: "var(--color-surface-container-high)", fg: "var(--color-on-surface)", ring: "var(--inset-hairline)", hover: "linear-gradient(var(--state-hover),var(--state-hover))", press: "linear-gradient(var(--state-press),var(--state-press))" },
  ghost: { bg: "transparent", fg: "var(--color-on-surface-variant)", ring: "none", hover: "linear-gradient(var(--state-hover),var(--state-hover))", press: "linear-gradient(var(--state-press),var(--state-press))" },
  tonal: { bg: "var(--color-primary-container)", fg: "var(--color-on-primary-container)", ring: "none", hover: "linear-gradient(var(--state-hover),var(--state-hover))", press: "linear-gradient(var(--state-press),var(--state-press))" },
  danger: { bg: "var(--color-error)", fg: "var(--color-on-error)", ring: "none", hover: tint(0.1), press: tint(0.18) },
};

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "size"> {
  variant?: Variant;
  size?: Size;
  icon?: string;
  iconTrailing?: string;
  loading?: boolean;
  fullWidth?: boolean;
  style?: CSSProperties;
}

/** Text button. Primary / secondary / ghost / tonal / danger, three heights. */
export function Button({
  children,
  variant = "secondary",
  size = "md",
  icon,
  iconTrailing,
  disabled = false,
  loading = false,
  fullWidth = false,
  type = "button",
  style,
  onClick,
  ...rest
}: Props) {
  const [hover, setHover] = useState(false);
  const [press, setPress] = useState(false);
  const [focus, setFocus] = useState(false);
  const s = SIZES[size] || SIZES.md;
  const v = VARIANTS[variant] || VARIANTS.secondary;
  const off = disabled || loading;
  return (
    <button
      type={type}
      disabled={off}
      onClick={off ? undefined : onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false);
        setPress(false);
      }}
      onMouseDown={() => setPress(true)}
      onMouseUp={() => setPress(false)}
      onFocus={(e) => setFocus(e.target.matches(":focus-visible"))}
      onBlur={() => setFocus(false)}
      style={{
        display: fullWidth ? "flex" : "inline-flex",
        width: fullWidth ? "100%" : undefined,
        alignItems: "center",
        justifyContent: "center",
        gap: s.gap,
        height: s.h,
        padding: `0 ${s.px}px`,
        borderRadius: s.r,
        border: "none",
        fontFamily: "var(--font-ui)",
        fontWeight: 600,
        fontSize: s.fs,
        lineHeight: s.lh,
        letterSpacing: s.tr,
        fontFeatureSettings: "var(--font-feature-ui)",
        backgroundColor: v.bg,
        backgroundImage: !off && press ? v.press : !off && hover ? v.hover : "none",
        color: v.fg,
        cursor: off ? "default" : "pointer",
        opacity: off ? 0.38 : 1,
        whiteSpace: "nowrap",
        boxShadow: focus ? `${v.ring === "none" ? "" : v.ring + ","} var(--focus-ring)` : v.ring,
        transition: "var(--transition-state)",
        WebkitAppearance: "none",
        outline: "none",
        ...style,
      }}
      {...rest}
    >
      {loading ? (
        <Icon name="progress_activity" size={s.icon} style={{ animation: "ds-spin 900ms linear infinite" }} />
      ) : icon ? (
        <Icon name={icon} size={s.icon} />
      ) : null}
      {children}
      {iconTrailing ? <Icon name={iconTrailing} size={s.icon} /> : null}
    </button>
  );
}
