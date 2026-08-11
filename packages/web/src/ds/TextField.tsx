import { useState, type ChangeEvent, type ReactNode } from "react";

interface Props {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  mono?: boolean;
  hint?: ReactNode;
  autoFocus?: boolean;
}

/** Labeled single-line text input, matching the dialog form fields. */
export function TextField({ id, label, value, onChange, placeholder, mono, hint, autoFocus }: Props) {
  const [focus, setFocus] = useState(false);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
      <label
        htmlFor={id}
        style={{
          font: "500 11px/1 var(--font-ui)",
          letterSpacing: "0.55px",
          textTransform: "uppercase",
          color: "var(--color-on-surface-variant)",
        }}
      >
        {label}
      </label>
      <input
        id={id}
        type="text"
        autoFocus={autoFocus}
        value={value}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        style={{
          height: 30,
          padding: "0 8px",
          border: "none",
          outline: "none",
          borderRadius: "var(--radius-sm)",
          background: "var(--color-surface-container-lowest)",
          color: "var(--color-on-surface)",
          font: mono ? "400 12px/1 var(--font-mono)" : "400 13px/1 var(--font-ui)",
          fontVariantNumeric: mono ? "tabular-nums" : undefined,
          boxShadow: focus ? "var(--inset-hairline), var(--focus-ring)" : "var(--inset-hairline)",
        }}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
      />
      {hint}
    </div>
  );
}
