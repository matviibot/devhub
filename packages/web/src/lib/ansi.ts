import type { CSSProperties } from "react";

export interface Span {
  text: string;
  style?: CSSProperties;
}

// Tuned for the dark log surface: readable, not neon.
const BASIC = ["#4b5260", "#ee8b78", "#74cf9a", "#dfb35c", "#8ea6ff", "#c79bf2", "#6fc6d6", "#c7cbd2"];
const BRIGHT = ["#7a828f", "#ffa597", "#94e3b4", "#f0cd85", "#adc0ff", "#dab6f7", "#8fdbe8", "#f0f1f3"];
const CUBE = [0, 95, 135, 175, 215, 255];

function color256(n: number): string {
  if (n < 8) return BASIC[n];
  if (n < 16) return BRIGHT[n - 8];
  if (n >= 232) {
    const v = 8 + (n - 232) * 10;
    return `rgb(${v},${v},${v})`;
  }
  const i = n - 16;
  return `rgb(${CUBE[Math.floor(i / 36)]},${CUBE[Math.floor(i / 6) % 6]},${CUBE[i % 6]})`;
}

// SGR is the only escape we render; every other CSI/OSC sequence (cursor
// moves, erase, hyperlinks, titles) is dropped.
const ESCAPE_RE = /\x1b\[([0-9;]*)([A-Za-z])|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Za-z0-9]|\x1b./g;

export function stripAnsi(text: string): string {
  return text.replace(ESCAPE_RE, "");
}

/** Splits one line into styled spans by its SGR codes. */
export function parseAnsi(text: string): Span[] {
  const spans: Span[] = [];
  let style: CSSProperties = {};
  let last = 0;
  const push = (chunk: string) => {
    if (chunk) spans.push(Object.keys(style).length ? { text: chunk, style } : { text: chunk });
  };
  for (const m of text.matchAll(ESCAPE_RE)) {
    push(text.slice(last, m.index));
    last = m.index! + m[0].length;
    if (m[2] !== "m") continue;
    const codes = (m[1] || "0").split(";").map(Number);
    const next: CSSProperties = { ...style };
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i];
      if (c === 0) for (const k of Object.keys(next)) delete next[k as keyof CSSProperties];
      else if (c === 1) next.fontWeight = 600;
      else if (c === 2) next.opacity = 0.6;
      else if (c === 3) next.fontStyle = "italic";
      else if (c === 4) next.textDecoration = "underline";
      else if (c === 22) {
        delete next.fontWeight;
        delete next.opacity;
      }
      else if (c === 23) delete next.fontStyle;
      else if (c === 24) delete next.textDecoration;
      else if (c >= 30 && c <= 37) next.color = BASIC[c - 30];
      else if (c >= 90 && c <= 97) next.color = BRIGHT[c - 90];
      else if (c === 39) delete next.color;
      else if (c >= 40 && c <= 47) next.background = BASIC[c - 40];
      else if (c >= 100 && c <= 107) next.background = BRIGHT[c - 100];
      else if (c === 49) delete next.background;
      else if (c === 38 || c === 48) {
        const key = c === 38 ? "color" : "background";
        if (codes[i + 1] === 5) {
          next[key] = color256(codes[i + 2] ?? 0);
          i += 2;
        } else if (codes[i + 1] === 2) {
          next[key] = `rgb(${codes[i + 2] ?? 0},${codes[i + 3] ?? 0},${codes[i + 4] ?? 0})`;
          i += 4;
        }
      }
    }
    style = next;
  }
  push(text.slice(last));
  return spans;
}
