/**
 * Where each path's island floats in the 3D Explore preview. Pure presentation geometry: it reads the tree of paths
 * (ids and parents only) and returns placements; it never decides anything about the futures themselves.
 *
 * Focus: the selected future is large, in the middle of the free part of the screen. Where it came from recedes to
 * the left; other paths from the same parent float low on the left; paths that continue from it wait on the right.
 * Placements are given in screen terms (ScreenHint) so the composition holds on any screen size; the scene turns them
 * into positions with its real camera. Everything else is hidden (Overview shows it).
 * Overview: every path, as a tree that reads from the start (left) to its latest futures (right), in metres.
 */
import type { Reality } from "@realityfork/core";

export type Vec3 = readonly [number, number, number];
export type Role = "selected" | "ancestor" | "sibling" | "child" | "other";
export type Mode = "focus" | "overview";

export interface TreeNode {
  readonly id: string;
  readonly parentId: string | null;
  readonly name: string;
  readonly depth: number;
  /** Depth-first order from the start (the order of the 2D map). */
  readonly order: number;
  readonly children: readonly string[];
}

/** Where an island appears, relative to the free part of the screen (not covered by the title, panel or controls). */
export interface ScreenHint {
  /** -1 = left edge, 1 = right edge of the free area. */
  readonly x: number;
  /** -1 = bottom, 1 = top of the free area. */
  readonly y: number;
  /** Metres behind the selected island, along the view: further islands are smaller and hazier. */
  readonly depth: number;
  /**
   * Selected island: the share of the free half-height its bounding sphere fills.
   * Others: their radius on screen, as a share of the smaller of the free half-width and half-height.
   */
  readonly size: number;
}

export interface Slot {
  readonly role: Role;
  /** Overview: where the island floats, in metres. */
  readonly position: Vec3;
  /** Focus: where the island appears on screen. */
  readonly screen?: ScreenHint;
  /** Overview: scale of the island. */
  readonly scale: number;
  readonly visible: boolean;
  /** 1 for the selected future, lower for context (label order and size). */
  readonly emphasis: number;
  /** On the line from the start to the selected future. */
  readonly onPath: boolean;
}

export function treeOf(r: Pick<Reality, "branches">): TreeNode[] {
  const kids = new Map<string, string[]>();
  for (const b of r.branches) if (b.parentId) kids.set(b.parentId, [...(kids.get(b.parentId) ?? []), b.id]);
  const byId = new Map(r.branches.map((b) => [b.id, b]));
  const out: TreeNode[] = [];
  const seen = new Set<string>();
  const visit = (id: string, depth: number) => {
    const b = byId.get(id);
    if (!b || seen.has(id)) return;
    seen.add(id);
    out.push({ id, parentId: b.parentId, name: b.name, depth, order: out.length, children: kids.get(id) ?? [] });
    for (const c of kids.get(id) ?? []) visit(c, depth + 1);
  };
  for (const b of r.branches) if (b.parentId === null) visit(b.id, 0);
  return out;
}

/** The ids from the start to `id`, inclusive. */
export function lineage(nodes: readonly TreeNode[], id: string): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: string[] = [];
  for (let cur = byId.get(id); cur && !out.includes(cur.id); cur = cur.parentId ? byId.get(cur.parentId) : undefined) out.unshift(cur.id);
  return out;
}

export interface LayoutOptions {
  /** Portrait phone: the panel is a sheet at the bottom, so context sits above and beside the selected island. */
  readonly narrow?: boolean;
}

const h = (x: number, y: number, depth: number, size: number): ScreenHint => ({ x, y, depth, size });
const WIDE = {
  selected: h(0, 0.02, 0, 0.8),
  ancestors: [h(-0.76, 0.34, 150, 0.3), h(-0.93, 0.6, 420, 0.17)],
  siblings: [h(-0.66, -0.56, 70, 0.31), h(-0.9, -0.1, 230, 0.22)],
  children: [
    [h(0.76, 0.2, 120, 0.3)],
    [h(0.76, 0.48, 160, 0.25), h(0.78, -0.4, 80, 0.27)],
    [h(0.74, 0.62, 200, 0.22), h(0.8, 0.06, 120, 0.24), h(0.74, -0.52, 70, 0.24)],
  ],
};
const NARROW = { selected: h(0, -0.2, 0, 0.56), left: h(-0.6, 0.45, 110, 0.29), right: h(0.6, 0.45, 110, 0.29) };

export function focusLayout(nodes: readonly TreeNode[], selectedId: string, opts: LayoutOptions = {}): Map<string, Slot> {
  const narrow = opts.narrow === true;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = new Map<string, Slot>();
  const sel = byId.get(selectedId) ?? nodes[0];
  if (!sel) return out;
  const path = lineage(nodes, sel.id);
  const onPath = new Set(path);
  const show = (id: string, role: Role, screen: ScreenHint, emphasis: number) => out.set(id, { role, position: [0, 0, 0], screen, scale: 1, visible: true, emphasis, onPath: onPath.has(id) });
  out.set(sel.id, { role: "selected", position: [0, 0, 0], screen: narrow ? NARROW.selected : WIDE.selected, scale: 1, visible: true, emphasis: 1, onPath: true });
  const ancestors = path.slice(0, -1).reverse();
  const parent = sel.parentId ? byId.get(sel.parentId) : undefined;
  const siblings = (parent?.children ?? []).filter((id) => id !== sel.id);
  const children = [...sel.children];
  if (narrow) {
    // Two places beside the selected island: where it came from on the left, what continues from it on the right;
    // free places go to other paths from the same parent, then to further paths from here.
    const order: [string, Role][] = [
      ...(ancestors[0] ? [[ancestors[0], "ancestor"] as [string, Role]] : []),
      ...children.map((id) => [id, "child"] as [string, Role]),
      ...siblings.map((id) => [id, "sibling"] as [string, Role]),
    ];
    let left: [string, Role] | undefined = ancestors[0] ? order.shift() : undefined;
    const right = order.shift();
    left ??= order.shift();
    if (left) show(left[0], left[1], NARROW.left, 0.55);
    if (right) show(right[0], right[1], NARROW.right, 0.6);
  } else {
    ancestors.slice(0, WIDE.ancestors.length).forEach((id, i) => show(id, "ancestor", WIDE.ancestors[i]!, 0.55 - 0.2 * i));
    siblings.slice(0, WIDE.siblings.length).forEach((id, i) => show(id, "sibling", WIDE.siblings[i]!, 0.5 - 0.1 * i));
    const set = WIDE.children[Math.min(children.length, WIDE.children.length) - 1] ?? [];
    children.slice(0, set.length).forEach((id, i) => show(id, "child", set[i]!, 0.6));
  }
  // Everything else waits, hidden, behind the island it is attached to (so it rises from there when it appears).
  for (const n of nodes) {
    if (out.has(n.id)) continue;
    const near = (n.parentId && out.get(n.parentId)?.screen) || h(0, 0, 0, 0.2);
    const role: Role = ancestors.includes(n.id) ? "ancestor" : "other";
    out.set(n.id, { role, position: [0, 0, 0], screen: { ...near, depth: near.depth + 260, size: near.size * 0.4 }, scale: 0.3, visible: false, emphasis: 0, onPath: onPath.has(n.id) });
  }
  return out;
}

// Overview: generations step right and slightly back; the futures of one generation are stacked and staggered in depth.
const OV_DX = 58;
const OV_DY = 50;

export function overviewLayout(nodes: readonly TreeNode[], selectedId: string, opts: LayoutOptions = {}): Map<string, Slot> {
  const narrow = opts.narrow === true;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const onPath = new Set(lineage(nodes, selectedId));
  // Rows from a depth-first walk; a parent sits in the middle of its children (as in the 2D map).
  const row = new Map<string, number>();
  let next = 0;
  const place = (id: string): number => {
    const n = byId.get(id);
    if (!n) return 0;
    const rows = n.children.map(place);
    const v = rows.length ? (rows[0]! + rows[rows.length - 1]!) / 2 : next++;
    row.set(id, v);
    return v;
  };
  for (const n of nodes) if (n.parentId === null) place(n.id);
  const mid = (next - 1) / 2;
  const out = new Map<string, Slot>();
  for (const n of nodes) {
    const r = (row.get(n.id) ?? 0) - mid;
    const selected = n.id === selectedId;
    // Portrait: generations run down the screen instead of across.
    const position: Vec3 = narrow ? [r * 52, -n.depth * 66, -n.depth * 30 + (r % 2) * 6] : [n.depth * OV_DX, -r * OV_DY + n.depth * 3, -n.depth * 26 - Math.abs(r) * 10];
    out.set(n.id, { role: selected ? "selected" : onPath.has(n.id) ? "ancestor" : "other", position, scale: selected ? 1 : 0.86, visible: true, emphasis: selected ? 1 : onPath.has(n.id) ? 0.6 : 0.45, onPath: onPath.has(n.id) });
  }
  return out;
}

/** Keyboard navigation in the tree: ← → move between paths from the same parent, ↑ to the parent, ↓ to the first path from here. */
export function neighbour(nodes: readonly TreeNode[], id: string, key: "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown" | "Home"): string | null {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const n = byId.get(id);
  if (!n) return null;
  if (key === "Home") return nodes.find((x) => x.parentId === null)?.id ?? null;
  if (key === "ArrowUp") return n.parentId;
  if (key === "ArrowDown") return n.children[0] ?? null;
  const peers = n.parentId ? byId.get(n.parentId)?.children ?? [] : nodes.filter((x) => x.parentId === null).map((x) => x.id);
  const i = peers.indexOf(id);
  const j = key === "ArrowLeft" ? i - 1 : i + 1;
  return j >= 0 && j < peers.length ? peers[j]! : null;
}
