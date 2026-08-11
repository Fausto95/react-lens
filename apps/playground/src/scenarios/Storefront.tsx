"use no memo";

import { createContext, useContext, useState } from "react";

/**
 * The panel's demo: one small storefront, deep enough to paint a waterfall.
 *
 * Seven components, chosen so a single click produces every cause the timeline
 * colours, and a chain long enough to walk arrow by arrow:
 *
 *   CartProvider   setCart   state     the origin (green)
 *     Header       casc      cascade   re-rendered only because its parent was
 *       CartBadge  ctx       context   reads the cart, and on "Refresh" is wasted
 *     Catalog      ctx       context
 *       ProductRow props     props     new onAdd identity per row
 *         PriceTag props     props     ← the second hop
 *     SortControl  state     state     its own lane, untouched by the cascade
 *
 * That gives `CartProvider → Catalog → ProductRow → PriceTag`: select the
 * middle of it and the arrows point both ways.
 *
 * Every render does real work. React's own renders are sub-millisecond, so
 * without it every clip collapses to the timeline's 4px legibility floor and
 * the waterfall has nothing to show.
 */

/** Real CPU work for `ms`, so a clip has an honest width. */
function spinFor(ms: number): number {
  const deadline = performance.now() + ms;
  let acc = 0;
  for (let i = 1; performance.now() < deadline; i++) acc += Math.sqrt(i) * Math.sin(i);
  return acc;
}

const CATALOG = [
  { id: 1, name: "Kettle", price: 89 },
  { id: 2, name: "Grinder", price: 145 },
  { id: 3, name: "Cafetière", price: 34 },
  { id: 4, name: "Scale", price: 62 },
  { id: 5, name: "Dripper", price: 28 },
  { id: 6, name: "Carafe", price: 41 },
  { id: 7, name: "Tamper", price: 23 },
  { id: 8, name: "Milk pitcher", price: 19 },
  { id: 9, name: "Thermometer", price: 31 },
  { id: 10, name: "Knock box", price: 47 },
  { id: 11, name: "Filter papers", price: 9 },
  { id: 12, name: "Shot glass", price: 14 },
];

interface Cart {
  items: number[];
  totals: { count: number };
  /** "Refresh" bumps this. Nothing on screen depends on it. */
  priceVersion: number;
}

const CartContext = createContext<{
  cart: Cart;
  addToCart: (id: number) => void;
} | null>(null);
CartContext.displayName = "CartContext";

const card: React.CSSProperties = {
  border: "1px solid #e6e8ec",
  borderRadius: 14,
  background: "#fff",
  padding: 20,
  maxWidth: 560,
  boxShadow: "0 1px 2px rgba(16,18,22,.04)",
};

const ghostBtn: React.CSSProperties = {
  padding: "5px 11px",
  borderRadius: 8,
  border: "1px solid #e2e5ea",
  background: "#fff",
  color: "#16181d",
  cursor: "pointer",
  font: "inherit",
  fontSize: 12,
};

export function Storefront() {
  return (
    <section style={card}>
      <CartProvider />
    </section>
  );
}

function CartProvider() {
  const [items, setItems] = useState<number[]>([]);
  const [, setPriceVersion] = useState(0);

  /** Named so the origin clip reads `setCart`. */
  const setCart = (next: number[]) => setItems(next);
  const addToCart = (id: number) => {
    if (!items.includes(id)) setCart([...items, id]);
  };

  // Recomputing cart totals from scratch on every render.
  spinFor(16);

  // A new object every render, so no consumer can ever bail out.
  const value = {
    cart: { items, totals: { count: items.length }, priceVersion: 0 },
    addToCart,
  };

  return (
    <CartContext.Provider value={value}>
      <Header onRefresh={() => setPriceVersion((v) => v + 1)} />
      <SortControl />
      <Catalog />
    </CartContext.Provider>
  );
}
CartProvider.displayName = "CartProvider";

/** Pure passthrough — it re-renders only because the provider did. */
function Header({ onRefresh }: { onRefresh: () => void }) {
  spinFor(10);
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        paddingBottom: 14,
        borderBottom: "1px solid #f0f2f5",
      }}
    >
      <strong style={{ fontSize: 15, letterSpacing: "-0.01em" }}>Roastery</strong>
      <CartBadge />
      <span style={{ flex: 1 }} />
      <button type="button" style={ghostBtn} onClick={onRefresh}>
        Refresh prices
      </button>
    </header>
  );
}
Header.displayName = "Header";

/**
 * Subscribes to the whole context, renders only the count — so "Refresh
 * prices" re-renders it for nothing. Those are the hatched clips.
 */
function CartBadge() {
  const { cart } = useContext(CartContext)!;
  spinFor(18);
  return (
    <span
      style={{
        fontSize: 12,
        padding: "3px 10px",
        borderRadius: 99,
        background: cart.totals.count > 0 ? "#eef4ff" : "#f2f4f7",
        color: cart.totals.count > 0 ? "#2563eb" : "#5f6878",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {cart.totals.count} in cart
    </span>
  );
}
CartBadge.displayName = "CartBadge";

/** Its own state — a green lane the cascade never touches. */
function SortControl() {
  const [dir, setDir] = useState<"name" | "price">("name");
  spinFor(6);
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "12px 0" }}>
      <span style={{ fontSize: 11, color: "#8b93a1" }}>Sort</span>
      <button
        type="button"
        style={ghostBtn}
        onClick={() => setDir(dir === "name" ? "price" : "name")}
      >
        {dir}
      </button>
    </div>
  );
}
SortControl.displayName = "SortControl";

function Catalog() {
  const { cart, addToCart } = useContext(CartContext)!;
  spinFor(12);
  const inCart = new Set(cart.items);
  return (
    <div style={{ display: "grid", gap: 2 }}>
      {CATALOG.map((product) => (
        <ProductRow
          key={product.id}
          name={product.name}
          price={product.price}
          inCart={inCart.has(product.id)}
          // New identity per row, per render → the props cascade.
          onAdd={() => addToCart(product.id)}
        />
      ))}
    </div>
  );
}
Catalog.displayName = "Catalog";

function ProductRow({
  name,
  price,
  inCart,
  onAdd,
}: {
  name: string;
  price: number;
  inCart: boolean;
  onAdd: () => void;
}) {
  spinFor(1.5);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "7px 8px",
        borderRadius: 8,
        background: inCart ? "#f7faff" : "transparent",
      }}
    >
      <span style={{ fontSize: 13, flex: 1 }}>{name}</span>
      <PriceTag amount={price} />
      <button type="button" style={ghostBtn} onClick={onAdd} disabled={inCart}>
        {inCart ? "Added" : "Add"}
      </button>
    </div>
  );
}
ProductRow.displayName = "ProductRow";

/** The tail of the chain — re-renders purely because its parent's props did. */
function PriceTag({ amount }: { amount: number }) {
  spinFor(1.2);
  return (
    <span
      style={{
        fontSize: 12,
        color: "#5f6878",
        fontVariantNumeric: "tabular-nums",
        minWidth: 44,
        textAlign: "right",
      }}
    >
      ${amount}
    </span>
  );
}
PriceTag.displayName = "PriceTag";
