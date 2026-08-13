import type { CSSProperties } from "react";

if (typeof document !== "undefined" && !document.getElementById("ds-keyframes")) {
  const el = document.createElement("style");
  el.id = "ds-keyframes";
  el.textContent =
    "@keyframes ds-spin{to{transform:rotate(360deg)}}@keyframes ds-pulse{0%,100%{opacity:.4}50%{opacity:1}}@keyframes ds-shimmer{0%{background-position:-160px 0}100%{background-position:240px 0}}";
  document.head.appendChild(el);
}

interface Props {
  /** A Material Symbols ligature name, e.g. "folder", "add", "wrap_text" —
   *  see https://fonts.google.com/icons for the full set. */
  name: string;
  size?: number;
  color?: string;
  title?: string;
  style?: CSSProperties;
}

/** Google Material Symbol, rendered via the variable icon font's ligature
 *  text so it inherits currentColor/size like any other glyph. */
export function Icon({ name, size = 16, color = "currentColor", title, style, ...rest }: Props) {
  return (
    <span
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      aria-label={title}
      style={{
        fontFamily: "var(--font-icons)",
        fontWeight: "normal",
        fontStyle: "normal",
        display: "inline-block",
        lineHeight: 1,
        textTransform: "none",
        letterSpacing: "normal",
        wordWrap: "normal",
        whiteSpace: "nowrap",
        direction: "ltr",
        WebkitFontSmoothing: "antialiased",
        fontVariationSettings: `'opsz' ${Math.max(20, Math.min(48, size))}`,
        fontSize: size,
        width: size,
        height: size,
        color,
        flex: "0 0 auto",
        userSelect: "none",
        overflow: "hidden",
        ...style,
      }}
      {...rest}
    >
      {name}
    </span>
  );
}
