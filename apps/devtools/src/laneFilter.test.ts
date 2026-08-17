import { describe, it, expect } from "vite-plus/test";
import { instanceLaneKey, laneChain, parentLaneKey, typeLaneKey } from "./laneFilter.js";
import type { ComponentId } from "@reactlens/protocol";

const id = (n: number) => n as ComponentId;

describe("lane keys", () => {
  it("keys a lane by component type, not by instance id", () => {
    expect(typeLaneKey("CartBadge")).toBe(typeLaneKey("CartBadge"));
    expect(typeLaneKey("CartBadge")).not.toBe(typeLaneKey("ListItem"));
  });

  it("nests an instance key under its type key", () => {
    const key = instanceLaneKey("ListItem", id(12));
    expect(parentLaneKey(key)).toBe(typeLaneKey("ListItem"));
    expect(laneChain(key)).toEqual([typeLaneKey("ListItem"), key]);
  });

  it("has no parent above a type key", () => {
    expect(parentLaneKey(typeLaneKey("App"))).toBeNull();
    expect(laneChain(typeLaneKey("App"))).toEqual([typeLaneKey("App")]);
  });

  it("survives a component name containing the instance separator", () => {
    const key = instanceLaneKey("Odd#Name", id(3));
    expect(parentLaneKey(key)).toBe(typeLaneKey("Odd#Name"));
  });
});
