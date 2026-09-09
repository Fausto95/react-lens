import { describe, expect, it } from "vite-plus/test";
import type { ComponentId } from "@reactlens/protocol";
import {
  addAttachment,
  attachmentPreamble,
  removeAttachment,
  withAttachments,
  type AgentAttachment,
} from "./agentAttachments.js";

const cid = (n: number) => n as ComponentId;
const row = (id: number, name: string): AgentAttachment => ({ id: cid(id), name });

describe("addAttachment", () => {
  it("appends in the order they were added", () => {
    const list = addAttachment(addAttachment([], row(1, "App")), row(2, "Row"));
    expect(list.map((a) => a.name)).toEqual(["App", "Row"]);
  });

  it("ignores a component that is already attached", () => {
    const once = addAttachment([], row(1, "App"));
    expect(addAttachment(once, row(1, "App"))).toBe(once);
  });

  it("dedupes by component, not by name — two instances share a name", () => {
    const list = addAttachment(addAttachment([], row(1, "Row")), row(2, "Row"));
    expect(list).toHaveLength(2);
  });

  it("never mutates the list it was given", () => {
    const before: AgentAttachment[] = [row(1, "App")];
    addAttachment(before, row(2, "Row"));
    expect(before).toHaveLength(1);
  });
});

describe("removeAttachment", () => {
  it("drops the one component", () => {
    const list = addAttachment(addAttachment([], row(1, "App")), row(2, "Row"));
    expect(removeAttachment(list, cid(1)).map((a) => a.name)).toEqual(["Row"]);
  });

  it("returns the same list when nothing matches, so React can skip the render", () => {
    const list = addAttachment([], row(1, "App"));
    expect(removeAttachment(list, cid(9))).toBe(list);
  });
});

describe("attachmentPreamble", () => {
  it("says nothing when nothing is attached", () => {
    expect(attachmentPreamble([])).toBe("");
  });

  it("names a single component", () => {
    expect(attachmentPreamble([row(1, "ProductList")])).toContain("ProductList");
  });

  it("names every attached component", () => {
    const text = attachmentPreamble([row(1, "App"), row(2, "Row"), row(3, "Cell")]);
    for (const name of ["App", "Row", "Cell"]) expect(text).toContain(name);
  });

  it("carries the component id, so the agent can call its tools on it", () => {
    expect(attachmentPreamble([row(42, "Row")])).toContain("42");
  });
});

describe("withAttachments", () => {
  it("leaves the question alone when nothing is attached", () => {
    expect(withAttachments("why is this slow?", [])).toBe("why is this slow?");
  });

  it("puts the context before the question", () => {
    const out = withAttachments("why is this slow?", [row(1, "ProductList")]);
    expect(out.indexOf("ProductList")).toBeLessThan(out.indexOf("why is this slow?"));
    expect(out).toContain("why is this slow?");
  });

  it("trims the question so a stray newline cannot bury it", () => {
    expect(withAttachments("  ask  ", [])).toBe("ask");
  });
});
