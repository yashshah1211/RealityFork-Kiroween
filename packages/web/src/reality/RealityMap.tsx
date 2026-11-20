import { useEffect, useRef, useState } from "react";
import { changesFromParent, type Branch, type Reality } from "@realityfork/core";
import { changeCaption, futureHue, HUES } from "./format";

export function useNarrow(px = 700) {
  const q = `(max-width: ${px}px)`;
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setNarrow(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [q]);
  return narrow;
}

export const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Colour of each path: the start is violet, each first-level future has its own hue, descendants keep it. */
export function pathHues(r: Reality): Map<string, number> {
  const out = new Map<string, number>();
  const root = r.branches.find((b) => b.parentId === null);
  if (!root) return out;
  out.set(root.id, HUES[0]);
  r.branches.filter((b) => b.parentId === root.id).forEach((b, i) => out.set(b.id, futureHue(i)));
  for (const b of r.branches) if (!out.has(b.id)) out.set(b.id, out.get(b.parentId!) ?? HUES[0]);
  return out;
}

/** The ids from the start to `id`, inclusive. */
export function pathTo(r: Reality, id: string): string[] {
  const out: string[] = [];
  let cur = r.branches.find((b) => b.id === id);
  while (cur) {
    out.unshift(cur.id);
    cur = cur.parentId ? r.branches.find((b) => b.id === cur!.parentId) : undefined;
  }
  return out;
}

interface Placed {
  readonly b: Branch;
  readonly depth: number;
  readonly row: number;
}

/** Depth = generation; rows from a depth-first walk; parents centred on their children. DOM order = walk order. */
function layout(r: Reality): Placed[] {
  const kids = new Map<string, Branch[]>();
  for (const b of r.branches) if (b.parentId) kids.set(b.parentId, [...(kids.get(b.parentId) ?? []), b]);
  const out: Placed[] = [];
  let next = 0;
  const visit = (b: Branch, depth: number): number => {
    const index = out.length;
    out.push({ b, depth, row: 0 });
    const rows = (kids.get(b.id) ?? []).map((c) => visit(c, depth + 1));
    const row = rows.length ? (rows[0]! + rows[rows.length - 1]!) / 2 : next++;
    out[index] = { b, depth, row };
    return row;
  };
  const root = r.branches.find((b) => b.parentId === null);
  if (root) visit(root, 0);
  return out;
}

/**
 * The map of paths. Where you started is on the left; each decision creates a new path to the right.
 * The path to the future you are exploring is drawn in colour. Clicking a path opens it.
 */
export function RealityMap({ reality: r, selectedId, onSelect }: { reality: Reality; selectedId: string; onSelect: (id: string) => void }) {
  const narrow = useNarrow();
  const W = narrow ? 156 : 206;
  const H = narrow ? 60 : 64;
  const GX = narrow ? 30 : 58;
  const GY = narrow ? 12 : 16;
  const nodes = layout(r);
  const hues = pathHues(r);
  const onPath = new Set(pathTo(r, selectedId));
  const pos = (p: Placed) => ({ x: p.depth * (W + GX), y: p.row * (H + GY) });
  const byId = new Map(nodes.map((p) => [p.b.id, p]));
  const width = Math.max(...nodes.map((p) => pos(p).x)) + W + 6;
  const height = Math.max(...nodes.map((p) => pos(p).y)) + H + 6;
  const scroller = useRef<HTMLDivElement>(null);

  // Keep the current path in view on small screens, without scrolling the page.
  useEffect(() => {
    const el = scroller.current;
    const p = byId.get(selectedId);
    if (!el || !p) return;
    const { x } = pos(p);
    if (x < el.scrollLeft || x + W > el.scrollLeft + el.clientWidth) el.scrollTo({ left: Math.max(0, x - (el.clientWidth - W) / 2), behavior: prefersReducedMotion() ? "auto" : "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, narrow, r.branches.length]);

  return (
    <nav className="map" aria-label="Map of your possible futures" data-testid="map">
      <div className="map-scroll" ref={scroller}>
        <div className="map-inner" style={{ width, height }}>
          <svg className="edges" width={width} height={height} aria-hidden="true">
            {nodes.filter((p) => p.b.parentId).map((p) => {
              const a = pos(byId.get(p.b.parentId!)!);
              const c = pos(p);
              const d = `M ${a.x + W} ${a.y + H / 2} C ${a.x + W + GX * 0.6} ${a.y + H / 2}, ${c.x - GX * 0.6} ${c.y + H / 2}, ${c.x} ${c.y + H / 2}`;
              const lit = onPath.has(p.b.id);
              return <path key={p.b.id} d={d} className={lit ? "lit" : ""} style={{ ["--hue" as string]: hues.get(p.b.id) }} />;
            })}
          </svg>
          {nodes.map((p, i) => {
            const { x, y } = pos(p);
            const b = p.b;
            const current = b.id === selectedId;
            const caption = changeCaption(changesFromParent(r, b), b.parentId === null);
            return (
              <button
                key={b.id}
                type="button"
                className={`mnode ${current ? "current" : ""} ${onPath.has(b.id) ? "on-path" : ""}`}
                style={{ left: x, top: y, width: W, height: H, ["--hue" as string]: hues.get(b.id), ["--i" as string]: i }}
                onClick={() => onSelect(b.id)}
                aria-current={current ? "location" : undefined}
                aria-label={`${b.name}. ${caption}${current ? ". You are exploring this." : ""}`}
                title={`${b.name}\n${caption}`}
                data-testid={`branch-${b.name}`}
              >
                <span className="mnode-name">{b.name}</span>
                <span className="mnode-caption">{caption}</span>
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
