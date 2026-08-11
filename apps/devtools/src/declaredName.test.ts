import { describe, it, expect } from "vite-plus/test";
import { declaredNameAtLine } from "./declaredName.js";

/**
 * Recovering a component's real name on a minified build. Source maps often
 * carry no `names` entry for a function's body position (React DevTools leaves
 * this as a TODO), but the resolved ORIGINAL line still spells the
 * declaration out.
 */
const src = (...lines: string[]) => lines.join("\n");

describe("declaredNameAtLine", () => {
  it("reads exported and plain function declarations", () => {
    expect(declaredNameAtLine(src("", "export function App() {"), 2)).toBe("App");
    expect(declaredNameAtLine(src("function Card({ title }) {"), 1)).toBe("Card");
    expect(declaredNameAtLine(src("export default function Page() {"), 1)).toBe("Page");
    expect(declaredNameAtLine(src("export async function Loader() {"), 1)).toBe("Loader");
  });

  it("reads arrow and function-expression assignments", () => {
    expect(declaredNameAtLine(src("const Button = () => {"), 1)).toBe("Button");
    expect(declaredNameAtLine(src("export const Row = ({ a }) => (") , 1)).toBe("Row");
    expect(declaredNameAtLine(src("let Legacy = function () {"), 1)).toBe("Legacy");
  });

  it("reads class components", () => {
    expect(declaredNameAtLine(src("export class Boundary extends React.Component {"), 1)).toBe(
      "Boundary",
    );
    expect(declaredNameAtLine(src("class Widget extends Component {"), 1)).toBe("Widget");
  });

  it("prefers the inner name of a wrapped component", () => {
    // memo(function Inner…) — the located function IS the inner one.
    expect(declaredNameAtLine(src("const Fancy = memo(function FancyInner(props) {"), 1)).toBe(
      "FancyInner",
    );
    expect(
      declaredNameAtLine(src("export const Input = forwardRef(function InputInner(p, ref) {"), 1),
    ).toBe("InputInner");
  });

  it("ignores non-component identifiers (lowercase, hooks)", () => {
    expect(declaredNameAtLine(src("function useThing() {"), 1)).toBeNull();
    expect(declaredNameAtLine(src("const helper = () => {"), 1)).toBeNull();
  });

  it("returns null for lines with no declaration and out-of-range lines", () => {
    expect(declaredNameAtLine(src("  return <div />;"), 1)).toBeNull();
    expect(declaredNameAtLine(src("function App() {"), 99)).toBeNull();
    expect(declaredNameAtLine("", 1)).toBeNull();
  });
});
