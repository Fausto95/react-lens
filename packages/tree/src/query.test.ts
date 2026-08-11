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

/** Convenience: predicate of a query expected to parse cleanly. */
function pred(input: string) {
  const q = parseQuery(input);
  expect(q.errors).toEqual([]);
  return q.predicate;
}

describe("parseQuery", () => {
  it("empty query matches everything", () => {
    expect(pred("")(datum({}))).toBe(true);
  });

  it("bare text matches name case-insensitively", () => {
    const p = pred("card");
    expect(p(datum({ name: "ProductCard" }))).toBe(true);
    expect(p(datum({ name: "Navbar" }))).toBe(false);
  });

  it("renders:>20", () => {
    const p = pred("renders:>20");
    expect(p(datum({ renders: 52 }))).toBe(true);
    expect(p(datum({ renders: 20 }))).toBe(false);
  });

  it("renders:>=5 and renders:<3", () => {
    expect(pred("renders:>=5")(datum({ renders: 5 }))).toBe(true);
    expect(pred("renders:<3")(datum({ renders: 2 }))).toBe(true);
    expect(pred("renders:<3")(datum({ renders: 3 }))).toBe(false);
  });

  it("compiled:false", () => {
    expect(pred("compiled:false")(datum({ compiled: false }))).toBe(true);
    expect(pred("compiled:false")(datum({ compiled: true }))).toBe(false);
  });

  it("visual-change:false matches suspicious renders", () => {
    const p = pred("visual-change:false");
    expect(p(datum({ observableChange: false }))).toBe(true);
    expect(p(datum({ observableChange: true }))).toBe(false);
    expect(p(datum({ observableChange: null }))).toBe(true); // unknown → treated as no change
  });

  it("AND-combines tokens", () => {
    const p = pred("renders:>10 card compiled:true");
    expect(p(datum({ name: "ProductCard", renders: 52, compiled: true }))).toBe(true);
    expect(p(datum({ name: "ProductCard", renders: 52, compiled: false }))).toBe(false);
    expect(p(datum({ name: "Navbar", renders: 52, compiled: true }))).toBe(false);
  });
});

describe("parseQuery — regex", () => {
  it("slash-delimited tokens match names as regex", () => {
    const p = pred("/^Product/");
    expect(p(datum({ name: "ProductCard" }))).toBe(true);
    expect(p(datum({ name: "MyProduct" }))).toBe(false);
  });

  it("supports the i flag and defaults to case-sensitive", () => {
    expect(pred("/^product/i")(datum({ name: "ProductCard" }))).toBe(true);
    expect(pred("/^product/")(datum({ name: "ProductCard" }))).toBe(false);
  });

  it("name:/re/ scopes regex through the field syntax too", () => {
    const p = pred("name:/Card$/");
    expect(p(datum({ name: "ProductCard" }))).toBe(true);
    expect(p(datum({ name: "CardList" }))).toBe(false);
  });

  it("an invalid regex reports an error and matches nothing", () => {
    const q = parseQuery("/[unclosed/");
    expect(q.errors).toHaveLength(1);
    expect(q.errors[0]).toMatch(/regex/i);
    expect(q.predicate(datum({ name: "[unclosed" }))).toBe(false);
  });
});

describe("parseQuery — malformed numerics error instead of matching all", () => {
  it("renders:abc reports an error and matches nothing", () => {
    const q = parseQuery("renders:abc");
    expect(q.errors).toHaveLength(1);
    expect(q.errors[0]).toContain("renders");
    expect(q.predicate(datum({ renders: 5 }))).toBe(false);
  });
});
