"use no memo";

import { createContext, useContext, useState } from "react";
import { Section, btn } from "./ui.js";

/**
 * Headline scenario for the redesign timeline.
 *
 * One "Add to cart" click should paint:
 *
 *   CartProvider   setCart  (state)
 *   Header         casc     (recreated inside the provider body)
 *   CartBadge      ctx
 *   ProductList    ctx
 *   ListItem ×N    props / wasted density
 *
 * Deliberate mistakes:
 *   1. Context `value` is a new object every provider render.
 *   2. Each row gets a new `onSelect` arrow every ProductList render.
 *
 * Header / ProductList are created *inside* CartProvider's render — not passed
 * as `children` — so they participate in the cascade (stable children would
 * bail out when only provider state changes).
 */

interface CartState {
  items: string[];
  totals: { count: number };
}

const CartContext = createContext<{
  cart: CartState;
  add: (name: string) => void;
} | null>(null);
CartContext.displayName = "CartContext";

const CATALOG = [
  "Kettle",
  "Mug",
  "Cafetière",
  "Grinder",
  "Scale",
  "Filter papers",
  "Carafe",
  "Thermometer",
  "Tamper",
  "Knock box",
  "Milk pitcher",
  "Latte art pen",
  "Espresso cups",
  "Dripper",
  "Gooseneck",
  "Burrs",
  "Tablets",
  "Portafilter",
  "Distributor",
  "WDT",
  "Mat",
  "Hopper",
  "Shot glass",
  "Cloth",
];

export function CartCascade() {
  return (
    <Section
      title="Cart cascade"
      hint="One Add to cart → setCart → context fan-out → props / cascade → wasted ListItems."
    >
      <CartProvider />
    </Section>
  );
}

function CartProvider() {
  const [items, setItems] = useState<string[]>(["Kettle", "Mug", "Cafetière"]);

  /** Origin of the cascade — keep the name visible in traces / stories. */
  function setCart(next: string[]) {
    setItems(next);
  }

  const add = (name: string) => {
    if (items.includes(name)) return;
    setCart([...items, name]);
  };

  // Fresh object every render — consumers never bail out.
  const value = {
    cart: { items, totals: { count: items.length } },
    add,
  };

  return (
    <CartContext.Provider value={value}>
      <Header />
      <ProductList />
    </CartContext.Provider>
  );
}
CartProvider.displayName = "CartProvider";

/** Re-renders because CartProvider recreated it — no own props/state change. */
function Header() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
      <strong style={{ fontSize: 14 }}>Your cart</strong>
      <CartBadge />
    </div>
  );
}
Header.displayName = "Header";

/** Whole-context subscribe; DOM only depends on totals.count. */
function CartBadge() {
  const { cart } = useContext(CartContext)!;
  return (
    <span
      style={{
        fontSize: 12,
        padding: "2px 8px",
        borderRadius: 99,
        background: "#eef1f6",
        color: "#16181d",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {cart.totals.count} items
    </span>
  );
}
CartBadge.displayName = "CartBadge";

function ProductList() {
  const { cart, add } = useContext(CartContext)!;
  const inCart = new Set(cart.items);

  return (
    <div style={{ display: "grid", gap: 4, maxWidth: 360 }}>
      {CATALOG.map((name) => (
        <ListItem
          key={name}
          item={name}
          alreadyIn={inCart.has(name)}
          // New function identity every ProductList render → props cascade.
          onSelect={() => add(name)}
        />
      ))}
    </div>
  );
}
ProductList.displayName = "ProductList";

function ListItem({
  item,
  alreadyIn,
  onSelect,
}: {
  item: string;
  alreadyIn: boolean;
  onSelect: () => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: 13, flex: 1 }}>{item}</span>
      <button type="button" style={btn} onClick={onSelect} disabled={alreadyIn}>
        {alreadyIn ? "In cart" : "Add to cart"}
      </button>
    </div>
  );
}
ListItem.displayName = "ListItem";
