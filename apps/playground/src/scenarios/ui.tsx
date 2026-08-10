import type { ReactNode, CSSProperties } from "react";

export const card: CSSProperties = {
  border: "1px solid #e2e5ea",
  borderRadius: 10,
  background: "#fff",
  padding: 16,
  marginBottom: 16,
};

export const btn: CSSProperties = {
  padding: "6px 12px",
  borderRadius: 8,
  border: "1px solid #e2e5ea",
  background: "#fff",
  color: "#16181d",
  cursor: "pointer",
  font: "inherit",
};

export function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <section style={card}>
      <h2 style={{ fontSize: 15, margin: "0 0 2px" }}>{title}</h2>
      <p style={{ color: "#5f6878", margin: "0 0 12px", fontSize: 13 }}>{hint}</p>
      {children}
    </section>
  );
}
