"use no memo";

import { createContext, useContext, useState } from "react";
import { Section, btn } from "./ui.js";

/**
 * The panel's headline demo: a storefront that misbehaves in the four ways the
 * timeline is built to show.
 *
 * Every render here is deliberately expensive enough to *see*. Real React work
 * is sub-millisecond, so a faithful demo has to do real work — otherwise every
 * clip collapses to the 4px legibility floor and the lane grid teaches nothing.
 * The numbers below are tuned so one interaction paints a readable cascade and
 * trips the ruler's long-task marker, while the page stays usable.
 *
 * What each action is meant to produce in the timeline:
 *
 *   "Add to cart"    CartProvider  setCart      state    (green, the origin)
 *                    Header        casc         cascade  (grey, pure passthrough)
 *                    CartBadge     ctx · Nms    context  (purple, real change)
 *                    ListItem ×200 density band props    (blue, per instance)
 *                    ...and a long task, because 200 rows re-render
 *
 *   "Refresh prices" every consumer re-renders and NOTHING changes on screen —
 *                    the hatched "wasted" clips. This is the money shot: a
 *                    button that costs 200 renders and produces no new pixels.
 *
 *   "Sort"           SortControl   state        (own state, unrelated lane)
 *   hovering a row   Tooltip       props        (a noisy lane worth muting)
 */

/** Real CPU work for `ms`, so a clip has an honest width. */
function spinFor(ms: number): number {
  const deadline = performance.now() + ms;
  let acc = 0;
  for (let i = 1; performance.now() < deadline; i++) {
    acc += Math.sqrt(i) * Math.sin(i);
  }
  return acc;
}

const PRODUCTS = [
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
  "Dripper",
  "Gooseneck",
  "Portafilter",
  "Distributor",
  "Shot glass",
];

/** 200 rows — enough that the lane collapses into a density band. */
const CATALOG = Array.from({ length: 200 }, (_, i) => ({
  id: i,
  name: `${PRODUCTS[i % PRODUCTS.length]} ${Math.floor(i / PRODUCTS.length) + 1}`,
  basePrice: 12 + ((i * 7) % 240),
}));

interface Store {
  items: number[];
  totals: { count: number };
  /** Bumped by "Refresh prices". Changes context identity, not any output. */
  priceVersion: number;
  prices: Record<number, number>;
}

const StoreContext = createContext<{
  store: Store;
  addToCart: (id: number) => void;
  refreshPrices: () => void;
} | null>(null);
StoreContext.displayName = "StoreContext";

export function Storefront() {
  return (
    <Section
      title="Storefront"
      hint="Add to cart → a state origin fans out through context into 200 rows. Refresh prices → 200 renders that change nothing."
    >
      <CartProvider />
    </Section>
  );
}

function CartProvider() {
  const [items, setItems] = useState<number[]>([]);
  const [priceVersion, setPriceVersion] = useState(0);

  /** Named so the origin clip reads `setCart` in traces. */
  const setCart = (next: number[]) => setItems(next);

  const addToCart = (id: number) => {
    if (items.includes(id)) return;
    setCart([...items, id]);
  };

  // "Refresh" recomputes prices that are, in fact, identical. Every consumer
  // re-renders; not one pixel changes.
  const refreshPrices = () => setPriceVersion((v) => v + 1);

  // Recomputing the whole price table on every render — unmemoized on purpose.
  spinFor(18);
  const prices: Record<number, number> = {};
  for (const product of CATALOG) prices[product.id] = product.basePrice;

  // A fresh object every render, so no consumer can ever bail out.
  const value = {
    store: { items, totals: { count: items.length }, priceVersion, prices },
    addToCart,
    refreshPrices,
  };

  return (
    <StoreContext.Provider value={value}>
      <Header />
      <SortControl />
      <ProductList />
    </StoreContext.Provider>
  );
}
CartProvider.displayName = "CartProvider";

/** Pure passthrough: re-renders only because the provider did. */
function Header() {
  spinFor(9);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
      <strong style={{ fontSize: 14 }}>Store</strong>
      <CartBadge />
      <RefreshButton />
    </div>
  );
}
Header.displayName = "Header";

/**
 * Subscribes to the whole context but renders only `totals.count`, so a price
 * refresh re-renders it for nothing — the hatched clips.
 */
function CartBadge() {
  const { store } = useContext(StoreContext)!;
  spinFor(22);
  return (
    <span
      style={{
        fontSize: 12,
        padding: "2px 10px",
        borderRadius: 99,
        background: "#eef1f6",
        color: "#16181d",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {store.totals.count} items
    </span>
  );
}
CartBadge.displayName = "CartBadge";

function RefreshButton() {
  const { refreshPrices } = useContext(StoreContext)!;
  return (
    <button type="button" style={btn} onClick={refreshPrices}>
      Refresh prices
    </button>
  );
}
RefreshButton.displayName = "RefreshButton";

/** Its own state, unrelated to the cart — a healthy green lane for contrast. */
function SortControl() {
  const [dir, setDir] = useState<"asc" | "desc">("asc");
  spinFor(6);
  return (
    <div style={{ marginBottom: 10 }}>
      <button type="button" style={btn} onClick={() => setDir(dir === "asc" ? "desc" : "asc")}>
        Sort: {dir}
      </button>
    </div>
  );
}
SortControl.displayName = "SortControl";

function ProductList() {
  const { store, addToCart } = useContext(StoreContext)!;
  const [hovered, setHovered] = useState<number | null>(null);
  const inCart = new Set(store.items);

  return (
    <div style={{ position: "relative", maxHeight: 260, overflowY: "auto" }}>
      {hovered !== null && <Tooltip name={CATALOG[hovered]!.name} />}
      {CATALOG.map((product) => (
        <ListItem
          key={product.id}
          name={product.name}
          price={store.prices[product.id]!}
          inCart={inCart.has(product.id)}
          // A new function identity per row per render → props cascade.
          onAdd={() => addToCart(product.id)}
          onHover={() => setHovered(product.id)}
        />
      ))}
    </div>
  );
}
ProductList.displayName = "ProductList";

function ListItem({
  name,
  price,
  inCart,
  onAdd,
  onHover,
}: {
  name: string;
  price: number;
  inCart: boolean;
  onAdd: () => void;
  onHover: () => void;
}) {
  // 200 rows × a fraction of a millisecond is what trips the long-task marker.
  spinFor(0.25);
  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 0" }}
      onMouseEnter={onHover}
    >
      <span style={{ fontSize: 13, flex: 1 }}>{name}</span>
      <span style={{ fontSize: 12, color: "#5f6878", fontVariantNumeric: "tabular-nums" }}>
        ${price}
      </span>
      <button type="button" style={btn} onClick={onAdd} disabled={inCart}>
        {inCart ? "In cart" : "Add to cart"}
      </button>
    </div>
  );
}
ListItem.displayName = "ListItem";

/** Hover-driven and chatty — the lane you mute to get it out of the way. */
function Tooltip({ name }: { name: string }) {
  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 1,
        alignSelf: "flex-start",
        fontSize: 11,
        color: "#5f6878",
      }}
    >
      {name}
    </div>
  );
}
Tooltip.displayName = "Tooltip";
