import type { ComponentId } from "@react-lens/protocol";
import type { ComponentDatum, SemanticNode, ComponentNode, GroupNode, BuildOptions } from "./types.js";

const DEFAULT_GROUP_THRESHOLD = 3;

/**
 * Turns flat component data into a semantic ownership tree: repeated siblings
 * of the same type are compressed into groups, and an optional projection
 * filter keeps only matching nodes plus the ancestors needed to reach them.
 */
export function buildTree(data: ComponentDatum[], opts: BuildOptions = {}): SemanticNode[] {
  const group = opts.group ?? true;
  const threshold = opts.groupThreshold ?? DEFAULT_GROUP_THRESHOLD;

  const byId = new Map<ComponentId, ComponentDatum>();
  for (const d of data) byId.set(d.id, d);

  const childIds = new Map<ComponentId | "root", ComponentId[]>();
  for (const d of data) {
    const parentKey: ComponentId | "root" =
      d.parentId !== undefined && byId.has(d.parentId) ? d.parentId : "root";
    const list = childIds.get(parentKey) ?? [];
    list.push(d.id);
    childIds.set(parentKey, list);
  }

  const keep = opts.include ? computeKeepSet(data, byId, opts.include) : null;

  const buildChildren = (parentKey: ComponentId | "root", parentNodeKey: string): SemanticNode[] => {
    const ids = (childIds.get(parentKey) ?? []).filter((id) => !keep || keep.has(id));
    const componentNodes: ComponentNode[] = ids.map((id) => {
      const datum = byId.get(id)!;
      return {
        kind: "component",
        key: `c:${id}`,
        id,
        datum,
        children: buildChildren(id, `c:${id}`),
      };
    });
    return group ? groupSiblings(componentNodes, parentNodeKey, threshold) : componentNodes;
  };

  return buildChildren("root", "root");
}

/** A component is kept if it matches or is an ancestor of a match. */
function computeKeepSet(
  data: ComponentDatum[],
  byId: Map<ComponentId, ComponentDatum>,
  include: (d: ComponentDatum) => boolean,
): Set<ComponentId> {
  const keep = new Set<ComponentId>();
  for (const d of data) {
    if (!include(d)) continue;
    keep.add(d.id);
    let parentId = d.parentId;
    let guard = 0;
    while (parentId !== undefined && byId.has(parentId) && !keep.has(parentId) && guard < 1000) {
      keep.add(parentId);
      parentId = byId.get(parentId)!.parentId;
      guard++;
    }
  }
  return keep;
}

/** Compress runs of same-name component siblings into group nodes. */
function groupSiblings(
  nodes: ComponentNode[],
  parentNodeKey: string,
  threshold: number,
): SemanticNode[] {
  const byName = new Map<string, ComponentNode[]>();
  for (const node of nodes) {
    const list = byName.get(node.datum.name) ?? [];
    list.push(node);
    byName.set(node.datum.name, list);
  }

  const out: SemanticNode[] = [];
  const emittedGroup = new Set<string>();

  for (const node of nodes) {
    const siblings = byName.get(node.datum.name)!;
    if (siblings.length < threshold) {
      out.push(node);
      continue;
    }
    // Emit the group once, at the position of its first instance.
    if (emittedGroup.has(node.datum.name)) continue;
    emittedGroup.add(node.datum.name);
    out.push(makeGroup(node.datum.name, siblings, parentNodeKey));
  }
  return out;
}

function makeGroup(name: string, instances: ComponentNode[], parentNodeKey: string): GroupNode {
  let renders = 0;
  let selfTime = 0;
  let suspicious = 0;
  for (const inst of instances) {
    renders += inst.datum.renders;
    selfTime += inst.datum.selfTime;
    if (inst.datum.observableChange === false) suspicious++;
  }
  return {
    kind: "group",
    key: `g:${parentNodeKey}:${name}`,
    name,
    count: instances.length,
    renders,
    selfTime,
    suspicious,
    instances,
  };
}
