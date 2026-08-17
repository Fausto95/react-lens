import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { css } from "@emotion/css";
import { createStoreAdapter, registerStores } from "@reactlens/adapters";
import { Card, Section, Stack } from "@reactlens/demo-ui";

/**
 * Does a style follow the playhead?
 *
 * The site claims class names and styles rewind, and nothing in this repo tested
 * it — so a real failure had nowhere to show up. Each row drives one styling
 * mechanism from `useState` and reports its own value as text, so an e2e can
 * assert the computed style and the state agree at every cursor position.
 *
 * Every mechanism appears twice: once compiled by the React Compiler and once
 * opted out with `"use no memo"`. If a row rewinds only in its opted-out form,
 * the compiler's memo cache is implicated — that pair is the whole point of this
 * specimen, because the memo cache lives in a hook slot `overrideHookState`
 * never touches.
 */

/** Static rules, which is also what vanilla-extract compiles down to. */
const STATIC_CLASSES = ["sm-hue-a", "sm-hue-b", "sm-hue-c"] as const;

/**
 * Runtime CSS-in-JS — the engine Chakra UI styles with. `@emotion/css` rather
 * than `@emotion/react` so the class comes from the same runtime sheet without
 * needing a JSX pragma alongside the React Compiler's babel config.
 */
const EMOTION_HUES = [
  css({ backgroundColor: "rgb(10, 20, 30)" }),
  css({ backgroundColor: "rgb(40, 50, 60)" }),
  css({ backgroundColor: "rgb(70, 80, 90)" }),
];

const INLINE_HUES = ["rgb(11, 22, 33)", "rgb(44, 55, 66)", "rgb(77, 88, 99)"];
const VAR_HUES = ["rgb(3, 6, 9)", "rgb(33, 66, 99)", "rgb(133, 166, 199)"];

/**
 * A CSS variable on `documentElement`, driven by module state — the shape of a
 * theme or colour-mode toggle, and the shape React Lens cannot rewind on its
 * own: there is no hook to override, and the variable is not React's to restore.
 *
 * Two identical stores follow: one left alone to pin the limit, one registered
 * through the adapter seam to show the opt-in fix.
 */
function makeVarStore(cssVar: string) {
  let step = 0;
  const listeners = new Set<() => void>();
  const write = (n: number) => {
    step = n;
    document.documentElement.style.setProperty(cssVar, VAR_HUES[n]!);
    for (const l of listeners) l();
  };
  write(0);
  return {
    get: (): number => step,
    set: write,
    subscribe: (l: () => void): (() => void) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
  };
}

const globalVar = makeVarStore("--sm-global-hue");
const adapterVar = makeVarStore("--sm-adapter-hue");

// Only the second one opts in. The first is the control.
registerStores(
  createStoreAdapter<number>({
    id: "css-variable",
    get: adapterVar.get,
    set: adapterVar.set,
  }),
);

function next(step: number): number {
  return (step + 1) % 3;
}

/** state → className, over static CSS rules. */
function StyleClass() {
  const [step, setStep] = useState(0);
  return (
    <Row
      label="class"
      step={step}
      onBump={() => setStep(next)}
      swatchProps={{ className: `sm-swatch ${STATIC_CLASSES[step]}` }}
    />
  );
}
StyleClass.displayName = "StyleClass";

/** The same thing with the compiler off, so the pair can be compared. */
function StyleClassNoMemo() {
  "use no memo";
  const [step, setStep] = useState(0);
  return (
    <Row
      label="class-nomemo"
      step={step}
      onBump={() => setStep(next)}
      swatchProps={{ className: `sm-swatch ${STATIC_CLASSES[step]}` }}
    />
  );
}
StyleClassNoMemo.displayName = "StyleClassNoMemo";

/** state → inline style object. */
function StyleInline() {
  const [step, setStep] = useState(0);
  return (
    <Row
      label="inline"
      step={step}
      onBump={() => setStep(next)}
      swatchProps={{ className: "sm-swatch", style: { backgroundColor: INLINE_HUES[step] } }}
    />
  );
}
StyleInline.displayName = "StyleInline";

function StyleInlineNoMemo() {
  "use no memo";
  const [step, setStep] = useState(0);
  return (
    <Row
      label="inline-nomemo"
      step={step}
      onBump={() => setStep(next)}
      swatchProps={{ className: "sm-swatch", style: { backgroundColor: INLINE_HUES[step] } }}
    />
  );
}
StyleInlineNoMemo.displayName = "StyleInlineNoMemo";

/** state → Emotion class, inserted at runtime. */
function StyleEmotion() {
  const [step, setStep] = useState(0);
  return (
    <Row
      label="emotion"
      step={step}
      onBump={() => setStep(next)}
      swatchProps={{ className: `sm-swatch ${EMOTION_HUES[step]}` }}
    />
  );
}
StyleEmotion.displayName = "StyleEmotion";

/**
 * A transitioned property. Without snap mode the page eases toward the rewound
 * value, so a scrub reads as "the style didn't follow" for the length of the
 * transition.
 */
function StyleTransition() {
  const [step, setStep] = useState(0);
  return (
    <Row
      label="transition"
      step={step}
      onBump={() => setStep(next)}
      swatchProps={{
        className: `sm-swatch sm-transition ${STATIC_CLASSES[step]}`,
      }}
    />
  );
}
StyleTransition.displayName = "StyleTransition";

/**
 * The documented limit: an effect writing the DOM directly. React state rewinds,
 * the effect re-runs, and the write follows — but only because the write is
 * derived from state. A CSS variable set outside React would not.
 */
function StyleImperative() {
  const [step, setStep] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    ref.current?.style.setProperty("background-color", INLINE_HUES[step]!);
  }, [step]);
  return (
    <Row
      label="imperative"
      step={step}
      onBump={() => setStep(next)}
      swatchProps={{ className: "sm-swatch", ref }}
    />
  );
}
StyleImperative.displayName = "StyleImperative";

/** Module state + a CSS variable, unregistered: the documented limit. */
function StyleGlobalVar() {
  const step = useSyncExternalStore(globalVar.subscribe, globalVar.get);
  return (
    <Row
      label="globalvar"
      step={step}
      onBump={() => globalVar.set(next(step))}
      swatchProps={{ className: "sm-swatch sm-var-global" }}
    />
  );
}
StyleGlobalVar.displayName = "StyleGlobalVar";

/** The same mechanism, opted in through a store adapter. */
function StyleAdapterVar() {
  const step = useSyncExternalStore(adapterVar.subscribe, adapterVar.get);
  return (
    <Row
      label="adaptervar"
      step={step}
      onBump={() => adapterVar.set(next(step))}
      swatchProps={{ className: "sm-swatch sm-var-adapter" }}
    />
  );
}
StyleAdapterVar.displayName = "StyleAdapterVar";

interface SwatchProps {
  className?: string;
  style?: React.CSSProperties;
  ref?: React.Ref<HTMLSpanElement>;
}

/** One mechanism: a button that advances state, and the swatch it styles. */
function Row({
  label,
  step,
  onBump,
  swatchProps,
}: {
  label: string;
  step: number;
  onBump: () => void;
  swatchProps: SwatchProps;
}) {
  return (
    <div className="sm-row">
      <button type="button" className="demo-btn demo-btn-sm" onClick={onBump}>
        {label}
      </button>
      {/* The e2e reads the step from text and the colour from the swatch, so a
          mismatch between them is exactly the bug being hunted. */}
      <output data-style-row={label}>{step}</output>
      <span data-style-swatch={label} {...swatchProps} />
    </div>
  );
}
Row.displayName = "Row";

export function StyleMatrix() {
  return (
    <Section
      kicker="Styles"
      title="Do styles follow the playhead?"
      hint="Each row drives one styling mechanism from state. Scrub and the swatch should match the number."
    >
      <Card>
        <Stack>
          <StyleClass />
          <StyleClassNoMemo />
          <StyleInline />
          <StyleInlineNoMemo />
          <StyleEmotion />
          <StyleTransition />
          <StyleImperative />
          <StyleGlobalVar />
          <StyleAdapterVar />
        </Stack>
      </Card>
    </Section>
  );
}
StyleMatrix.displayName = "StyleMatrix";
