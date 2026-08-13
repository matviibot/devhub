import type { CSSProperties, ReactNode } from "react";

interface Props {
  title?: string;
  description?: string;
  /** Border color of the geometric mark — the mockup uses a plain bordered
   *  shape instead of an icon for every empty state. Defaults to the
   *  neutral outline tone; pass the accent-tinted rgba for a first-run
   *  "primary" empty state. */
  markColor?: string;
  /** "8px" (rounded square, default), "50%" (circle), or any radius. */
  markRadius?: string;
  action?: ReactNode;
  secondaryAction?: ReactNode;
  size?: "sm" | "md";
  style?: CSSProperties;
}

/** Centered, quiet placeholder for an empty pane — geometric mark, title,
 *  one line of body copy, optional action. */
export function EmptyState({ title, description, markColor = "var(--dh-border-button)", markRadius = "8px", action, secondaryAction, size = "md", style, ...rest }: Props) {
  const sm = size === "sm";
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: sm ? 8 : 12,
        textAlign: "center",
        padding: sm ? "24px 16px" : "30px 22px",
        ...style,
      }}
      {...rest}
    >
      <span style={{ width: sm ? 22 : 30, height: sm ? 22 : 30, border: `1px solid ${markColor}`, borderRadius: markRadius, display: "block", flex: "0 0 auto" }} />
      {title ? <div style={{ font: `600 ${sm ? 12.5 : 14}px/1.3 var(--font-ui)`, letterSpacing: "-0.015em", color: "var(--dh-text)" }}>{title}</div> : null}
      {description ? (
        <div style={{ font: `400 11px/1.55 var(--font-mono)`, color: "var(--dh-text-host)", maxWidth: 240 }}>{description}</div>
      ) : null}
      {action || secondaryAction ? (
        <div style={{ display: "flex", gap: 8, marginTop: sm ? 2 : 4 }}>
          {action}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  );
}
