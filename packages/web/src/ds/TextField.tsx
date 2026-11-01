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
          font: "var(--type-meta-text)",
          letterSpacing: "var(--tracking-meta)",
          color: "var(--color-on-surface-variant)",
        }}
      >
        {label}
      </label>
      <input
        className="ds-text-field"
        id={id}
        data-autofocus={autoFocus || undefined}
        type="text"
        autoFocus={autoFocus}
        value={value}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        style={{
          minHeight: 38,
          padding: "7px 10px",
          border: "none",
          outline: "none",
          borderRadius: "var(--radius-sm)",
          background: "var(--color-surface-container-lowest)",
          color: "var(--color-on-surface)",
          font: mono ? "var(--type-code)" : "var(--type-body-text)",
          fontFeatureSettings: mono ? "var(--font-feature-mono)" : "var(--font-feature-ui)",
          fontVariantLigatures: mono ? "none" : undefined,
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
