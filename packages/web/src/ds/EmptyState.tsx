import type { CSSProperties, ReactNode } from "react";
import { Icon } from "./Icon";

interface Props {
  icon?: string;
  title?: string;
  description?: string;
  action?: ReactNode;
  secondaryAction?: ReactNode;
  size?: "sm" | "md";
  style?: CSSProperties;
}

/** Centered, quiet placeholder for an empty pane. */
export function EmptyState({ icon = "inbox", title, description, action, secondaryAction, size = "md", style, ...rest }: Props) {
  const sm = size === "sm";
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: sm ? 6 : 8,
        textAlign: "center",
        padding: sm ? "24px 16px" : "48px 24px",
        color: "var(--color-on-surface-variant)",
        ...style,
      }}
      {...rest}
    >
      <Icon name={icon} size={sm ? 20 : 26} color="var(--color-outline)" style={{ marginBottom: sm ? 0 : 2 }} />
      {title ? (
        <div
          style={{
            font: `var(--text-title-${sm ? "small" : "medium"}-weight) var(--text-title-${sm ? "small" : "medium"}-size)/var(--text-title-${sm ? "small" : "medium"}-line) var(--font-ui)`,
            letterSpacing: `var(--text-title-${sm ? "small" : "medium"}-track)`,
            color: "var(--color-on-surface)",
          }}
        >
          {title}
        </div>
      ) : null}
      {description ? (
        <div style={{ font: `400 var(--text-body-${sm ? "small" : "medium"}-size)/var(--text-body-${sm ? "small" : "medium"}-line) var(--font-ui)`, maxWidth: 320 }}>
          {description}
        </div>
      ) : null}
      {action || secondaryAction ? (
        <div style={{ display: "flex", gap: 8, marginTop: sm ? 2 : 6 }}>
          {action}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  );
}
