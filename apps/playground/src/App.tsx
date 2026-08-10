import { createContext, useContext, useState } from "react";

/**
 * A shop UI engineered to exhibit classic React problems so React Lens has
 * something to explain. With the React Compiler ON, several of these are
 * automatically fixed — which is itself the interesting signal to observe.
 */

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

const SelectedContext = createContext<{
  selected: number | null;
  select: (id: number) => void;
}>({ selected: null, select: () => {} });

export function App() {
  const [selected, setSelected] = useState<number | null>(null);

  return (
    // Scenario: context value recreated every render → fanout to all consumers.
    <SelectedContext.Provider value={{ selected, select: setSelected }}>
      <header>
        <h1 style={{ fontSize: 22, marginBottom: 4 }}>React Lens Playground</h1>
        <p style={{ color: "#5f6878", marginTop: 0 }}>
          Try the different controls — each produces a distinct commit to replay.
        </p>
      </header>
      <Toolbar />
      <ProductGrid />
      <Cart />
    </SelectedContext.Provider>
  );
}

/**
 * A toolbar of independent widgets. Each holds its OWN state, so clicking one
 * produces a commit that renders only that widget — a visibly different update
 * wave from the product-grid fanout when you replay it.
 */
function Toolbar() {
  return (
    <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
      <Ticker />
      <Ticker />
      <Clock />
    </div>
  );
}

let tickerSeq = 0;
function Ticker() {
  const label = useState(() => `Ticker ${++tickerSeq}`)[0];
  const [n, setN] = useState(0);
  return (
    <button onClick={() => setN((v) => v + 1)} style={widgetStyle}>
      {label}: {n}
    </button>
  );
}

function Clock() {
  const [on, setOn] = useState(false);
  return (
    <button onClick={() => setOn((v) => !v)} style={widgetStyle}>
      Toggle: {on ? "on" : "off"}
    </button>
  );
}

const widgetStyle: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 8,
  border: "1px solid #e2e5ea",
  background: "#fff",
  color: "#16181d",
  cursor: "pointer",
  font: "inherit",
};

function ProductGrid() {
  const { selected, select } = useContext(SelectedContext);
  return (
    <div style={{ display: "grid", gap: 8, marginTop: 16 }}>
      {PRODUCTS.map((product) => (
        <ProductCard
          key={product.id}
          product={product}
          selected={selected === product.id}
          // Scenario: a fresh closure per card per render → unstable prop.
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
    <div
      style={{
        marginTop: 20,
        padding: 16,
        borderRadius: 8,
        background: "#fff",
        border: "1px solid #e2e5ea",
      }}
    >
      <strong>Cart</strong>
      <div style={{ color: "#5f6878", marginTop: 4 }}>
        {product ? `${product.title} — $${product.price}` : "Nothing selected"}
      </div>
    </div>
  );
}
