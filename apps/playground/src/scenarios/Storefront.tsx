import { createContext, useContext, useState } from "react";
import { Badge, Button, Card, Meta, Stack } from "@reactlens/demo-ui";

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
 * "Refresh prices" is the wasted-render case: equal values in new objects.
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
  origin: string;
  price: number;
}

const CATALOG: Product[] = [
  { id: 1, name: "Kettle", origin: "Osaka", price: 89 },
  { id: 2, name: "Grinder", origin: "Solingen", price: 145 },
  { id: 3, name: "Cafetière", origin: "Lyon", price: 34 },
  { id: 4, name: "Scale", origin: "Seoul", price: 62 },
  { id: 5, name: "Dripper", origin: "Tokyo", price: 28 },
  { id: 6, name: "Carafe", origin: "Prague", price: 41 },
  { id: 7, name: "Tamper", origin: "Milan", price: 23 },
  { id: 8, name: "Milk pitcher", origin: "Sheffield", price: 19 },
  { id: 9, name: "Thermometer", origin: "Basel", price: 31 },
  { id: 10, name: "Knock box", origin: "Melbourne", price: 47 },
  { id: 11, name: "Filter papers", origin: "Hamamatsu", price: 9 },
  { id: 12, name: "Shot glass", origin: "Murano", price: 14 },
];

interface Cart {
  items: number[];
  totals: { count: number };
  products: Product[];
}

const CartContext = createContext<{
  cart: Cart;
  addToCart: (id: number) => void;
} | null>(null);
CartContext.displayName = "CartContext";

export function Storefront() {
  return (
    <Card>
      <CartProvider />
    </Card>
  );
}

function CartProvider() {
  const [items, setItems] = useState<number[]>([]);
  const [products, setProducts] = useState<Product[]>(CATALOG);

  const setCart = (next: number[]) => setItems(next);
  const addToCart = (id: number) => {
    if (!items.includes(id)) setCart([...items, id]);
  };
  const refreshPrices = () => setProducts((prev) => prev.map((p) => ({ ...p })));

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

function Header({ count, onRefresh }: { count: number; onRefresh: () => void }) {
  spinFor(10);
  return (
    <div
      className="demo-toolbar"
      style={{ borderBottom: "1px solid var(--demo-line)", paddingBottom: 14 }}
    >
      <Stack row style={{ gap: 12 }}>
        <strong style={{ fontFamily: "var(--demo-display)", fontSize: 18 }}>
          Shop{count > 0 ? ` · ${count}` : ""}
        </strong>
        <CartBadge />
      </Stack>
      <Button size="sm" onClick={onRefresh}>
        Refresh prices
      </Button>
    </div>
  );
}
Header.displayName = "Header";

function CartBadge() {
  const { cart } = useContext(CartContext)!;
  spinFor(18);
  return (
    <Badge tone={cart.totals.count > 0 ? "accent" : "neutral"}>{cart.totals.count} in cart</Badge>
  );
}
CartBadge.displayName = "CartBadge";

function SortControl() {
  const [dir, setDir] = useState<"name" | "price">("name");
  spinFor(6);
  return (
    <div className="demo-toolbar" style={{ padding: "12px 0" }}>
      <Meta>Sort by</Meta>
      <Button size="sm" variant="ghost" onClick={() => setDir(dir === "name" ? "price" : "name")}>
        {dir}
      </Button>
    </div>
  );
}
SortControl.displayName = "SortControl";

function Catalog() {
  const { cart, addToCart } = useContext(CartContext)!;
  spinFor(12);
  const inCart = new Set(cart.items);
  return (
    <div className="demo-grid-products">
      {cart.products.map((product) => (
        <ProductRow
          key={product.id}
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
  const { name, origin, price } = product;
  spinFor(1.5);
  return (
    <article
      className="demo-product"
      style={
        inCart
          ? { borderColor: "var(--demo-accent)", background: "var(--demo-accent-soft)" }
          : undefined
      }
    >
      <span className="demo-product-origin">{origin}</span>
      <span className="demo-product-name">{name}</span>
      <Stack row style={{ justifyContent: "space-between", marginTop: 4 }}>
        <PriceTag amount={price} />
        <Button size="sm" variant={inCart ? "ghost" : "primary"} onClick={onAdd} disabled={inCart}>
          {inCart ? "Added" : "Add"}
        </Button>
      </Stack>
    </article>
  );
}
ProductRow.displayName = "ProductRow";

function PriceTag({ amount }: { amount: number }) {
  spinFor(1.2);
  return <span className="demo-product-price">${amount}</span>;
}
PriceTag.displayName = "PriceTag";
