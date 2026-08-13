import { createContext, useContext, useState } from "react";

/**
 * The panel's demo: one small storefront, deep enough to paint a waterfall.
 *
 * Compiled by the React Compiler, like everything else in the repo. That is a
 * constraint on the demo, not a detail: a scenario whose waste the Compiler
 * removes is demonstrating a problem the panel's own users no longer have.
 *
 *   CartProvider   setCart   state     the origin (green)
 *     Header       props     props     takes the count, so Add re-renders it
 *       CartBadge  ctx       context   reads the cart; on "Refresh" it is wasted
 *     Catalog      ctx       context
 *       ProductRow props     props     takes the product object
 *         PriceTag props     props     ← the second hop
 *     SortControl  state     state     its own lane; no props, so the cascade
 *                                      genuinely cannot reach it
 *
 * That gives `CartProvider → Catalog → ProductRow → PriceTag`: select the
 * middle of it and the arrows point both ways.
 *
 * "Refresh prices" is the wasted-render case, and it is the real one: a refetch
 * that returns equal values in new objects. Identity changed, so no compiler and
 * no `memo` can bail out; the screen is identical, so every one of those renders
 * was for nothing. The old scenario faked this with an object literal rebuilt
 * per render, which the Compiler correctly optimises away.
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

interface Product {
  id: number;
  name: string;
  price: number;
}

const CATALOG: Product[] = [
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
  /**
   * Re-fetched on "Refresh": new objects, identical values. Nothing on screen
   * changes, and nothing can bail out either.
   */
  products: Product[];
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
  const [products, setProducts] = useState<Product[]>(CATALOG);

  /** Named so the origin clip reads `setCart`. */
  const setCart = (next: number[]) => setItems(next);
  const addToCart = (id: number) => {
    if (!items.includes(id)) setCart([...items, id]);
  };
  /** The refetch: same prices, fresh objects — nothing can bail out. */
  const refreshPrices = () => setProducts((prev) => prev.map((p) => ({ ...p })));

  // Recomputing cart totals from scratch on every render.
  spinFor(16);

  const value = {
    cart: { items, totals: { count: items.length }, products },
    addToCart,
  };

  return (
    <CartContext.Provider value={value}>
      <Header count={items.length} onRefresh={refreshPrices} />
      <SortControl />
      <Catalog />
    </CartContext.Provider>
  );
}
CartProvider.displayName = "CartProvider";

/** Takes the count, so adding to the cart really does re-render it. */
function Header({ count, onRefresh }: { count: number; onRefresh: () => void }) {
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
      <strong style={{ fontSize: 15, letterSpacing: "-0.01em" }}>
        Roastery{count > 0 ? ` · ${count}` : ""}
      </strong>
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
      {cart.products.map((product) => (
        <ProductRow
          key={product.id}
          // The whole object: a refetch hands over a new one per row, so every
          // row re-renders for values that did not change.
          product={product}
          inCart={inCart.has(product.id)}
          onAdd={() => addToCart(product.id)}
        />
      ))}
    </div>
  );
}
Catalog.displayName = "Catalog";

function ProductRow({
  product,
  inCart,
  onAdd,
}: {
  product: Product;
  inCart: boolean;
  onAdd: () => void;
}) {
  const { name, price } = product;
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
