/* oxlint-disable react/react-compiler -- specimen counts renders via ref mutation during render */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { Button, Card, Meta, Section, Stack } from "@reactlens/demo-ui";

const ThemeContext = createContext<"light" | "dark">("light");
ThemeContext.displayName = "ThemeContext";

const FIXED_DATE = new Date("2026-01-01T00:00:00.000Z");

/** Account + product detail — HooksShowcase / PropsShowcase for the inspector. */
export function Showcase() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const stableFn = useCallback(() => {}, []);
  return (
    <ThemeContext.Provider value={theme}>
      <Section
        kicker="Account"
        title="Member preferences"
        hint="State, reducer, context, and editable props for the inspector."
      >
        <Stack>
          <Button size="sm" onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}>
            Theme: {theme}
          </Button>
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
        </Stack>
      </Section>
    </ThemeContext.Provider>
  );
}
Showcase.displayName = "Showcase";

/* oxlint-disable react/react-compiler -- intentional render counter for e2e specimen */
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
    <div className="demo-card">
      <strong>Session counter</strong> <span className="demo-meta">({theme})</span>
      <div className="demo-meta">
        count {count} · doubled {doubled} · items {items.length} · renders {renders.current}
      </div>
      {/* No demo-ui composites here — inspect-mode must resolve to HooksShowcase. */}
      <div className="demo-stack-row" style={{ marginTop: 10 }}>
        <button
          type="button"
          className="demo-btn demo-btn-primary demo-btn-sm"
          onClick={() => setCount((c) => c + 1)}
        >
          count +1
        </button>
        <button
          type="button"
          className="demo-btn demo-btn-sm"
          onClick={() => dispatch({ type: "add" })}
        >
          add item
        </button>
      </div>
    </div>
  );
}
HooksShowcase.displayName = "HooksShowcase";

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
    <Card>
      <strong>Listed product</strong>
      <Meta>
        text={props.text}, count={props.count}, enabled={String(props.enabled)}
      </Meta>
    </Card>
  );
}
PropsShowcase.displayName = "PropsShowcase";
