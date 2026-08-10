import { createContext, useContext, useState } from "react";
import { Section } from "./ui.js";

interface Product {
  id: number;
  title: string;
  price: number;
}

const PRODUCTS: Product[] = [
  { id: 1, title: "MacBook Pro", price: 2399 },
  { id: 2, title: "Magic Keyboard", price: 149 },
  { id: 3, title: "Studio Display", price: 1599 },
  { id: 4, title: "AirPods Pro", price: 249 },
  { id: 5, title: "Mac Studio", price: 1999 },
];

const SelectedContext = createContext<{ selected: number | null; select: (id: number) => void }>({
  selected: null,
  select: () => {},
});

/** Context fanout — selecting re-renders the grid; only one card changes DOM. */
export function Shop() {
  const [selected, setSelected] = useState<number | null>(null);
  return (
    <SelectedContext.Provider value={{ selected, select: setSelected }}>
      <Section
        title="Shop (context fanout)"
        hint="Selecting a product re-renders the grid; only the selected card changes DOM — the rest are suspicious/avoidable."
      >
        <ProductGrid />
        <Cart />
      </Section>
    </SelectedContext.Provider>
  );
}

function ProductGrid() {
  const { selected, select } = useContext(SelectedContext);
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {PRODUCTS.map((product) => (
        <ProductCard
          key={product.id}
          product={product}
          selected={selected === product.id}
          onSelect={() => select(product.id)}
        />
      ))}
    </div>
  );
}

function ProductCard({
  product,
  selected,
  onSelect,
}: {
  product: Product;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      style={{
        display: "flex",
        justifyContent: "space-between",
        padding: "12px 16px",
        borderRadius: 8,
        border: selected ? "2px solid #a78bfa" : "1px solid #e2e5ea",
        background: selected ? "#f5f3ff" : "#fff",
        color: "#16181d",
        cursor: "pointer",
        font: "inherit",
      }}
    >
      <span>{product.title}</span>
      <span style={{ color: "#5f6878" }}>${product.price}</span>
    </button>
  );
}

function Cart() {
  const { selected } = useContext(SelectedContext);
  const product = PRODUCTS.find((p) => p.id === selected);
  return (
    <div style={{ marginTop: 16, padding: 12, borderRadius: 8, background: "#f7f8fa" }}>
      <strong>Cart</strong>
      <div style={{ color: "#5f6878", marginTop: 4 }}>
        {product ? `${product.title} — $${product.price}` : "Nothing selected"}
      </div>
    </div>
  );
}
