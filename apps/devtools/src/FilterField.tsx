import type { ReactNode } from "react";

/**
 * The panel's one filter field.
 *
 * The Components pane, the ledger and the roll-up all filter components, so
 * they share this markup rather than three lookalikes: the `.filter` class in
 * `redesign.css` owns the appearance, and anything that needs extra chrome
 * (chips, a match count) passes it as children.
 */
export interface FilterFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Shown at the right — a match count, or an invalid-pattern marker. */
  trailing?: ReactNode;
  /** Chips and other affordances rendered before the input. */
  children?: ReactNode;
  inputRef?: React.Ref<HTMLInputElement>;
  /**
   * Test/style hook on the input. Each pane gets its own, so a selector meaning
   * "the Components tree's filter" cannot accidentally match the cascade's.
   */
  className?: string;
  invalid?: boolean;
  title?: string;
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  onBlur?: () => void;
}

export function FilterIcon(): ReactNode {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#5C5C66" strokeWidth="2.4">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

export function FilterField({
  value,
  onChange,
  placeholder = "Filter components…",
  trailing,
  children,
  inputRef,
  className = "rl-filter-input",
  invalid = false,
  title,
  onKeyDown,
  onBlur,
}: FilterFieldProps): ReactNode {
  return (
    <div className="filter">
      <FilterIcon />
      {children}
      <input
        className={className}
        ref={inputRef}
        value={value}
        placeholder={placeholder}
        aria-label="Filter components"
        aria-invalid={invalid}
        spellCheck={false}
        {...(title ? { title } : {})}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
      />
      {trailing}
    </div>
  );
}
