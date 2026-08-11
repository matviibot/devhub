import type { CSSProperties } from "react";

const CDN = "https://cdn.jsdelivr.net/npm/lucide-static@0.544.0/icons/";

if (typeof document !== "undefined" && !document.getElementById("ds-keyframes")) {
  const el = document.createElement("style");
  el.id = "ds-keyframes";
  el.textContent =
    "@keyframes ds-spin{to{transform:rotate(360deg)}}@keyframes ds-pulse{0%,100%{opacity:.4}50%{opacity:1}}@keyframes ds-shimmer{0%{background-position:-160px 0}100%{background-position:240px 0}}";
  document.head.appendChild(el);
}

interface Props {
  name: string;
  size?: number;
  color?: string;
  title?: string;
  style?: CSSProperties;
}

/** Lucide glyph rendered as a CSS mask so it inherits currentColor. */
export function Icon({ name, size = 16, color = "currentColor", title, style, ...rest }: Props) {
  const url = `url("${CDN}${name}.svg")`;
  return (
    <span
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      aria-label={title}
      style={{
        display: "inline-block",
        width: size,
        height: size,
        flex: "0 0 auto",
        backgroundColor: color,
        WebkitMaskImage: url,
        maskImage: url,
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
        WebkitMaskSize: "contain",
        maskSize: "contain",
        ...style,
      }}
      {...rest}
    />
  );
}
