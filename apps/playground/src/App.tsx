import { Storefront } from "./scenarios/Storefront.js";

/**
 * The playground is the demo, and nothing else.
 *
 * It used to mount a dozen unrelated scenarios; every one of them added lanes
 * to the timeline and buried the cascade the panel exists to explain. One
 * small app, seven components, one story.
 */
export function App() {
  return (
    <main
      style={{
        maxWidth: 620,
        margin: "0 auto",
        padding: "40px 24px 80px",
        color: "#16181d",
      }}
    >
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, margin: "0 0 8px", letterSpacing: "-0.02em" }}>Roastery</h1>
        <p style={{ color: "#5f6878", margin: 0, lineHeight: 1.5, fontSize: 14 }}>
          Click <b>Add</b> on any row. The timeline paints the cascade it caused —{" "}
          <b>setCart → Catalog → ProductRow → PriceTag</b>. Select a clip in the middle and the
          arrows point both ways: back to what caused it, forward to what it caused.{" "}
          <b>Refresh prices</b> re-renders everything and changes nothing — the hatched clips.
        </p>
      </header>

      <Storefront />
    </main>
  );
}
