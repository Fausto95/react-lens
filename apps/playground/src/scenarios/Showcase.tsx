import {
  createContext,
  useContext,
  useState,
  useReducer,
  useRef,
  useMemo,
  useCallback,
  useEffect,
  useLayoutEffect,
} from "react";
import { Section, card, btn } from "./ui.js";

/** Every hook + every prop type → drives all inspector sections. */
const ThemeContext = createContext<"light" | "dark">("light");
const FIXED_DATE = new Date("2026-01-01T00:00:00.000Z");

export function Showcase() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const stableFn = useCallback(() => {}, []);
  return (
    <ThemeContext.Provider value={theme}>
      <Section
        title="Hooks & Props"
        hint="Select HooksShowcase / PropsShowcase for State, Hooks, Context, Effects, Props (editable) and the object explorer."
      >
        <button style={btn} onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}>
          Theme: {theme}
        </button>
        <div style={{ marginTop: 12 }}>
          <HooksShowcase />
          <PropsShowcase
            text="hello world"
            count={42}
            ratio={3.14159}
            enabled={true}
            tags={["alpha", "beta", "gamma"]}
            meta={{ id: 7, nested: { deep: { value: 99 } }, list: [1, 2, 3] }}
            createdAt={FIXED_DATE}
            nothing={null}
            stableOnClick={stableFn}
            unstableOnClick={() => {}}
          />
        </div>
      </Section>
    </ThemeContext.Provider>
  );
}

function HooksShowcase() {
  const [count, setCount] = useState(0);
  const [items, dispatch] = useReducer(
    (s: string[], a: { type: "add" }) => (a.type === "add" ? [...s, `item ${s.length}`] : s),
    ["item 0"],
  );
  const renders = useRef(0);
  renders.current += 1;
  const doubled = useMemo(() => count * 2, [count]);
  const theme = useContext(ThemeContext);

  useEffect(() => {}, [count]);
  useLayoutEffect(() => {}, []);

  return (
    <div style={{ ...card, marginBottom: 12 }}>
      <strong>HooksShowcase</strong> <span style={{ color: "#5f6878" }}>({theme})</span>
      <div style={{ color: "#5f6878", fontSize: 13, margin: "6px 0" }}>
        count {count} · doubled {doubled} · items {items.length} · renders {renders.current}
      </div>
      <button style={btn} onClick={() => setCount((c) => c + 1)}>count +1</button>{" "}
      <button style={btn} onClick={() => dispatch({ type: "add" })}>add item</button>
    </div>
  );
}

function PropsShowcase(props: {
  text: string;
  count: number;
  ratio: number;
  enabled: boolean;
  tags: string[];
  meta: { id: number; nested: { deep: { value: number } }; list: number[] };
  createdAt: Date;
  nothing: null;
  stableOnClick: () => void;
  unstableOnClick: () => void;
}) {
  return (
    <div style={card}>
      <strong>PropsShowcase</strong>
      <div style={{ color: "#5f6878", fontSize: 13, marginTop: 6 }}>
        Receives every prop type — inspect Props to explore/edit them. text={props.text}, count=
        {props.count}, enabled={String(props.enabled)}
      </div>
    </div>
  );
}
