import { describe, it, expect } from "vitest";
import { parseQuery } from "./query.js";
import type { ComponentDatum } from "./types.js";
import type { ComponentId } from "@react-lens/protocol";

function datum(over: Partial<ComponentDatum>): ComponentDatum {
  return {
    id: 1 as ComponentId,
    name: "ProductCard",
    renders: 5,
    selfTime: 2,
    compiled: false,
    ...over,
  };
}

describe("parseQuery", () => {
  it("empty query matches everything", () => {
    const p = parseQuery("");
    expect(p(datum({}))).toBe(true);
  });

  it("bare text matches name case-insensitively", () => {
    const p = parseQuery("card");
    expect(p(datum({ name: "ProductCard" }))).toBe(true);
    expect(p(datum({ name: "Navbar" }))).toBe(false);
  });

  it("renders:>20", () => {
    const p = parseQuery("renders:>20");
    expect(p(datum({ renders: 52 }))).toBe(true);
    expect(p(datum({ renders: 20 }))).toBe(false);
  });

  it("renders:>=5 and renders:<3", () => {
    expect(parseQuery("renders:>=5")(datum({ renders: 5 }))).toBe(true);
    expect(parseQuery("renders:<3")(datum({ renders: 2 }))).toBe(true);
    expect(parseQuery("renders:<3")(datum({ renders: 3 }))).toBe(false);
  });

  it("compiled:false", () => {
    expect(parseQuery("compiled:false")(datum({ compiled: false }))).toBe(true);
    expect(parseQuery("compiled:false")(datum({ compiled: true }))).toBe(false);
  });

  it("visual-change:false matches suspicious renders", () => {
    const p = parseQuery("visual-change:false");
    expect(p(datum({ observableChange: false }))).toBe(true);
    expect(p(datum({ observableChange: true }))).toBe(false);
    expect(p(datum({ observableChange: null }))).toBe(true); // unknown → treated as no change
  });

  it("AND-combines tokens", () => {
    const p = parseQuery("renders:>10 card compiled:true");
    expect(p(datum({ name: "ProductCard", renders: 52, compiled: true }))).toBe(true);
    expect(p(datum({ name: "ProductCard", renders: 52, compiled: false }))).toBe(false);
    expect(p(datum({ name: "Navbar", renders: 52, compiled: true }))).toBe(false);
  });
});
