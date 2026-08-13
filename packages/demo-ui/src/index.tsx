import type { ButtonHTMLAttributes, CSSProperties, InputHTMLAttributes, ReactNode } from "react";

export function Stack({
  children,
  row,
  style,
  className,
}: {
  children: ReactNode;
  row?: boolean;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <div className={`${row ? "demo-stack-row" : "demo-stack"}${className ? ` ${className}` : ""}`} style={style}>
      {children}
    </div>
  );
}

export function Section({
  kicker,
  title,
  hint,
  children,
}: {
  kicker?: string;
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="demo-section">
      <header className="demo-section-head">
        {kicker ? <span className="demo-section-kicker">{kicker}</span> : null}
        <h2 className="demo-section-title">{title}</h2>
        {hint ? <p className="demo-section-hint">{hint}</p> : null}
      </header>
      {children}
    </section>
  );
}

export function Card({
  children,
  flush,
  style,
  className,
}: {
  children: ReactNode;
  flush?: boolean;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <div
      className={`demo-card${flush ? " demo-card-flush" : ""}${className ? ` ${className}` : ""}`}
      style={style}
    >
      {children}
    </div>
  );
}

type BtnVariant = "default" | "primary" | "ghost";

export function Button({
  variant = "default",
  size = "md",
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: BtnVariant;
  size?: "md" | "sm";
}) {
  const classes = [
    "demo-btn",
    variant === "primary" ? "demo-btn-primary" : "",
    variant === "ghost" ? "demo-btn-ghost" : "",
    size === "sm" ? "demo-btn-sm" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  return <button type="button" className={classes} {...rest} />;
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="demo-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className="demo-input" {...props} />;
}

export function Badge({
  children,
  tone = "accent",
}: {
  children: ReactNode;
  tone?: "accent" | "neutral";
}) {
  return (
    <span className={`demo-badge${tone === "neutral" ? " demo-badge-neutral" : ""}`}>{children}</span>
  );
}

export function Meta({ children }: { children: ReactNode }) {
  return <div className="demo-meta">{children}</div>;
}

export function Hero({
  brand,
  lead,
  note,
}: {
  brand: string;
  lead: string;
  note?: string;
}) {
  return (
    <header className="demo-hero">
      <h1>{brand}</h1>
      <p>{lead}</p>
      {note ? <p className="demo-hero-note">{note}</p> : null}
    </header>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  return <div className="demo-shell">{children}</div>;
}
