/**
 * Shared building parts for the scenery kits: local frames on an island, boxes, gabled houses, a spire, window and door
 * panes with a fixed share of lit windows. Moved out of kit.ts so every family's kit (city, energy and environment,
 * shops and studios, open sky) builds from the same modules. Presentation only.
 */
import { Vector3, type Material, type Object3D } from "three";
import { Builder, type BaseStyle, type GenericMaterials, type IslandShape } from "./generic";
import { CELL, WINDOW_CELLS, type KitMaterials } from "./kitMaterials";

export type Col = readonly [number, number, number];
export type V3 = readonly [number, number, number];

/** A local frame on the island: origin, ground height and a turn about the vertical. Local +Z is the front. */
export interface Frame {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly c: number;
  readonly s: number;
}
export const frameAt = (x: number, y: number, z: number, rot: number): Frame => ({ x, y, z, c: Math.cos(rot), s: Math.sin(rot) });
export const toWorld = (f: Frame, lx: number, ly: number, lz: number): V3 => [f.x + lx * f.c + lz * f.s, f.y + ly, f.z - lx * f.s + lz * f.c];

export function face(b: Builder, f: Frame, pts: readonly V3[], uvs: readonly (readonly [number, number])[], col: Col) {
  const ids = pts.map((p, i) => {
    const [x, y, z] = toWorld(f, p[0], p[1], p[2]);
    return b.vert(x, y, z, uvs[i]![0], uvs[i]![1], col);
  });
  if (ids.length === 4) b.quad(ids[0]!, ids[1]!, ids[2]!, ids[3]!);
  else b.tri(ids[0]!, ids[1]!, ids[2]!);
}

/** A flat band `wd` wide from point a to point c of the plane z = `z` in a frame, facing +Z: trim, braces, coping. */
export function strip(b: Builder, f: Frame, a: readonly [number, number], c: readonly [number, number], z: number, wd: number, col: Col) {
  const dx = c[0] - a[0], dy = c[1] - a[1], L = Math.hypot(dx, dy) || 1;
  const nx = (-dy / L) * (wd / 2), ny = (dx / L) * (wd / 2);
  face(b, f, [[a[0] - nx, a[1] - ny, z], [c[0] - nx, c[1] - ny, z], [c[0] + nx, c[1] + ny, z], [a[0] + nx, a[1] + ny, z]], [[0, 0], [L / 2, 0], [L / 2, wd / 2], [0, wd / 2]], col);
}

/** An upright box in a frame (no bottom face): x and z centred on (cx, cz), from y0 up by sy. UVs in metres / tile. */
export function box(b: Builder, f: Frame, cx: number, y0: number, cz: number, sx: number, sy: number, sz: number, col: Col, tile = 2) {
  const x0 = cx - sx / 2, x1 = cx + sx / 2, z0 = cz - sz / 2, z1 = cz + sz / 2, y1 = y0 + sy;
  const t = (a: number) => a / tile;
  face(b, f, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [[t(x0), t(y0)], [t(x1), t(y0)], [t(x1), t(y1)], [t(x0), t(y1)]], col);
  face(b, f, [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [[t(-x1), t(y0)], [t(-x0), t(y0)], [t(-x0), t(y1)], [t(-x1), t(y1)]], col);
  face(b, f, [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [[t(-z1), t(y0)], [t(-z0), t(y0)], [t(-z0), t(y1)], [t(-z1), t(y1)]], col);
  face(b, f, [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [[t(z0), t(y0)], [t(z1), t(y0)], [t(z1), t(y1)], [t(z0), t(y1)]], col);
  face(b, f, [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [[t(x0), t(z1)], [t(x1), t(z1)], [t(x1), t(z0)], [t(x0), t(z0)]], col);
}

/** A box with any orientation: centre and three half-extent axes. Winding is fixed from the geometry itself. */
export function cuboid(b: Builder, c: Vector3, u: Vector3, v: Vector3, w: Vector3, col: Col, tile = 1.5) {
  const axes: [Vector3, Vector3, Vector3][] = [[u, v, w], [u.clone().negate(), v, w], [v, u, w], [v.clone().negate(), u, w], [w, u, v], [w.clone().negate(), u, v]];
  for (const [n, a0, b0] of axes) {
    let a = a0, bb = b0;
    if (new Vector3().crossVectors(a, bb).dot(n) < 0) [a, bb] = [bb, a];
    const base = c.clone().add(n);
    const p = [base.clone().sub(a).sub(bb), base.clone().add(a).sub(bb), base.clone().add(a).add(bb), base.clone().sub(a).add(bb)];
    const la = (a.length() * 2) / tile, lb = (bb.length() * 2) / tile;
    const uv: [number, number][] = [[0, 0], [la, 0], [la, lb], [0, lb]];
    const ids = p.map((q, i) => b.vert(q.x, q.y, q.z, uv[i]![0], uv[i]![1], col));
    b.quad(ids[0]!, ids[1]!, ids[2]!, ids[3]!);
  }
}

export interface Pane {
  readonly f: Frame;
  /** Corners in the frame, counter-clockwise seen from outside. */
  readonly pts: readonly V3[];
  readonly door: boolean;
  /** A fixed cell of the window atlas (a shop's display window, screens); such a pane never counts as a lit window. */
  readonly cell?: number;
}

/** One window or door quad on a wall, `out` metres in front of it. `side` names the wall. */
export function pane(f: Frame, side: "front" | "back" | "left" | "right", w: number, d: number, cx: number, cy: number, pw: number, ph: number, door = false, cell?: number): Pane {
  const out = 0.05;
  const [x0, x1, y0, y1] = [cx - pw / 2, cx + pw / 2, cy - ph / 2, cy + ph / 2];
  const pts: V3[] =
    side === "front" ? [[x0, y0, d / 2 + out], [x1, y0, d / 2 + out], [x1, y1, d / 2 + out], [x0, y1, d / 2 + out]]
    : side === "back" ? [[-x0, y0, -d / 2 - out], [-x1, y0, -d / 2 - out], [-x1, y1, -d / 2 - out], [-x0, y1, -d / 2 - out]]
    : side === "right" ? [[w / 2 + out, y0, -x0], [w / 2 + out, y0, -x1], [w / 2 + out, y1, -x1], [w / 2 + out, y1, -x0]]
    : [[-w / 2 - out, y0, x0], [-w / 2 - out, y0, x1], [-w / 2 - out, y1, x1], [-w / 2 - out, y1, x0]];
  return { f, pts, door, ...(cell === undefined ? {} : { cell }) };
}

/** Emit window and door quads. Exactly `share` of the windows on the island are lit (seeded), whatever its size. */
export function emitPanes(b: Builder, panes: readonly Pane[], r: () => number, share = 0.42) {
  const windows = panes.filter((p) => !p.door && p.cell === undefined);
  const order = windows.map((p, i) => ({ i, k: r() })).sort((a, b) => a.k - b.k);
  const lit = new Set(order.slice(0, Math.round(windows.length * share)).map((x) => x.i));
  let wi = 0;
  for (const p of panes) {
    let cell: number = p.cell ?? CELL.door;
    if (!p.door && p.cell === undefined) {
      cell = lit.has(wi) ? (r() < 0.5 ? CELL.litA : CELL.litB) : r() < 0.5 ? CELL.darkA : CELL.darkB;
      wi++;
    }
    const u0 = cell / WINDOW_CELLS, u1 = (cell + 1) / WINDOW_CELLS;
    face(b, p.f, p.pts, [[u0, 0], [u1, 0], [u1, 1], [u0, 1]], [1, 1, 1]);
  }
}

export interface Builders {
  readonly brick: Builder;
  readonly plaster: Builder;
  readonly stone: Builder;
  readonly slate: Builder;
  readonly trim: Builder;
  readonly panes: Pane[];
}

export interface HouseSpec {
  readonly w: number;
  readonly d: number;
  /** Wall height (m). */
  readonly h: number;
  readonly floors: number;
  /** Roof rise above the walls. */
  readonly rise: number;
  readonly wall: "brick" | "plaster" | "stone";
  readonly tint: Col;
  readonly roofTint: Col;
  readonly chimney: -1 | 0 | 1;
  readonly door: boolean;
  /** Windows on the side walls too (end of a terrace). */
  readonly sides: boolean;
  /** A shopfront on the ground floor: a wide display window, a door at one end, a stall riser and a blank fascia. */
  readonly front?: { readonly cell: number; readonly fascia: Col };
}

/** A gabled house standing in `f` (front towards local +Z), walls sunk into the ground so slopes never show a gap. */
export function house(B: Builders, f: Frame, s: HouseSpec) {
  const { w, d, h, rise } = s;
  const walls = B[s.wall];
  const sink = -0.9;
  const wx = w / 2, wz = d / 2;
  const t = (a: number) => a / 2;
  // walls
  face(walls, f, [[-wx, sink, wz], [wx, sink, wz], [wx, h, wz], [-wx, h, wz]], [[t(-wx), t(sink)], [t(wx), t(sink)], [t(wx), t(h)], [t(-wx), t(h)]], s.tint);
  face(walls, f, [[wx, sink, -wz], [-wx, sink, -wz], [-wx, h, -wz], [wx, h, -wz]], [[t(-wx), t(sink)], [t(wx), t(sink)], [t(wx), t(h)], [t(-wx), t(h)]], s.tint);
  face(walls, f, [[wx, sink, wz], [wx, sink, -wz], [wx, h, -wz], [wx, h, wz]], [[t(-wz), t(sink)], [t(wz), t(sink)], [t(wz), t(h)], [t(-wz), t(h)]], s.tint);
  face(walls, f, [[-wx, sink, -wz], [-wx, sink, wz], [-wx, h, wz], [-wx, h, -wz]], [[t(-wz), t(sink)], [t(wz), t(sink)], [t(wz), t(h)], [t(-wz), t(h)]], s.tint);
  // gables (the ridge runs along the width)
  face(walls, f, [[wx, h, wz], [wx, h, -wz], [wx, h + rise, 0]], [[t(-wz), t(h)], [t(wz), t(h)], [0, t(h + rise)]], s.tint);
  face(walls, f, [[-wx, h, -wz], [-wx, h, wz], [-wx, h + rise, 0]], [[t(-wz), t(h)], [t(wz), t(h)], [0, t(h + rise)]], s.tint);
  // roof, overhanging a little on every side
  const o = 0.32;
  const k = rise / wz;
  const L = Math.hypot(rise, wz + o);
  const eaveY = h - o * k;
  face(B.slate, f, [[-wx - o, eaveY, wz + o], [wx + o, eaveY, wz + o], [wx + o, h + rise, 0], [-wx - o, h + rise, 0]], [[t(-wx - o), 0], [t(wx + o), 0], [t(wx + o), t(L)], [t(-wx - o), t(L)]], s.roofTint);
  face(B.slate, f, [[wx + o, eaveY, -wz - o], [-wx - o, eaveY, -wz - o], [-wx - o, h + rise, 0], [wx + o, h + rise, 0]], [[t(-wx - o), 0], [t(wx + o), 0], [t(wx + o), t(L)], [t(-wx - o), t(L)]], s.roofTint);
  // a cornice under the eaves
  box(B.trim, f, 0, h - 0.24, wz + 0.06, w + 0.12, 0.2, 0.16, [0.82, 0.8, 0.78]);
  box(B.trim, f, 0, h - 0.24, -wz - 0.06, w + 0.12, 0.2, 0.16, [0.82, 0.8, 0.78]);
  // chimney stack across the ridge, with two pots
  if (s.chimney !== 0) {
    const cx = s.chimney * (wx - 0.55);
    const top = h + rise + 0.95;
    box(B.brick, f, cx, h + rise * 0.35, -0.15, 0.62, top - (h + rise * 0.35), 0.95, [0.95, 0.86, 0.82]);
    box(B.trim, f, cx, top, -0.15, 0.74, 0.12, 1.07, [0.7, 0.68, 0.66]);
    for (const dz of [-0.2, 0.2]) box(B.brick, f, cx, top + 0.12, -0.15 + dz, 0.2, 0.34, 0.2, [1.25, 0.75, 0.55]);
  }
  // windows and the door
  const floorH = h / s.floors;
  const cols = Math.max(1, Math.floor((w - 0.6) / 1.3));
  const step = w / cols;
  const pw = Math.min(0.82, step * 0.56);
  const ph = Math.min(1.35, floorH * 0.56);
  const doorAt = s.door ? Math.floor(cols / 2) : -1;
  for (let i = 0; i < s.floors; i++) {
    const cy = floorH * i + floorH * 0.55;
    for (let j = 0; j < cols; j++) {
      const cx = -wx + step * (j + 0.5);
      if (i === 0 && s.front) {
        B.panes.push(pane(f, "back", w, d, cx, cy, pw, ph));
        continue;
      }
      if (i === 0 && j === doorAt) {
        B.panes.push(pane(f, "front", w, d, cx, 1.05, 0.98, 2.1, true));
        box(B.trim, f, cx, -0.2, wz + 0.25, 1.4, 0.2, 0.5, [0.75, 0.73, 0.72]);
      } else {
        B.panes.push(pane(f, "front", w, d, cx, cy, pw, ph));
        box(B.trim, f, cx, cy - ph / 2 - 0.1, wz + 0.07, pw + 0.16, 0.1, 0.16, [0.85, 0.83, 0.8]);
      }
      B.panes.push(pane(f, "back", w, d, cx, cy, pw, ph));
    }
    if (s.sides) for (const side of ["left", "right"] as const) B.panes.push(pane(f, side, w, d, 0, cy, pw, ph));
  }
  if (s.front) shopfront(B, f, w, d, s.front.cell, s.front.fascia);
}

/** Where a shopfront's parts are, in the house's frame: the display window, the door and the fascia's underside. */
export const shopfrontLayout = (w: number) => {
  const wx = w / 2;
  const door = { x: wx - 0.4 - 0.5, w: 1.0 };
  return { window: { x0: -wx + 0.4, x1: door.x - door.w / 2 - 0.3, y0: 0.5, y1: 2.5 }, door, fasciaY: 2.62 };
};

/** The ground floor of a shop or café: a wide lit window, a panelled door, a stall riser below and a blank sign board above. */
function shopfront(B: Builders, f: Frame, w: number, d: number, cell: number, fascia: Col) {
  const L = shopfrontLayout(w);
  const wz = d / 2;
  const { x0, x1, y0, y1 } = L.window;
  B.panes.push({ f, pts: [[x0, y0, wz + 0.05], [x1, y0, wz + 0.05], [x1, y1, wz + 0.05], [x0, y1, wz + 0.05]], door: false, cell });
  B.panes.push(pane(f, "front", w, d, L.door.x, 1.05, L.door.w, 2.1, true));
  // stall riser, mullion posts and the fascia (a sign board with nothing written on it)
  box(B.trim, f, (x0 + x1) / 2, -0.3, wz + 0.09, x1 - x0 + 0.24, 0.8, 0.18, fascia);
  for (const px of [x0 - 0.12, x1 + 0.12, L.door.x + L.door.w / 2 + 0.12]) box(B.trim, f, px, -0.3, wz + 0.1, 0.22, L.fasciaY + 0.3, 0.2, fascia);
  box(B.trim, f, 0, L.fasciaY, wz + 0.12, w + 0.12, 0.62, 0.24, fascia);
  box(B.trim, f, 0, L.fasciaY + 0.62, wz + 0.16, w + 0.3, 0.1, 0.34, [0.82, 0.8, 0.76]);
}

/** A slender stone tower with a pointed spire and a lit round window: a skyline accent, no particular building. */
export function tower(B: Builders, f: Frame, size: number, height: number) {
  const st: Col = [0.86, 0.84, 0.88];
  box(B.stone, f, 0, -0.9, 0, size, height + 0.9, size, st, 2.5);
  // a belt course and battlements
  box(B.trim, f, 0, height, 0, size + 0.3, 0.25, size + 0.3, [0.8, 0.78, 0.8]);
  for (const [px, pz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) box(B.stone, f, (px * (size + 0.1)) / 2, height + 0.25, (pz * (size + 0.1)) / 2, 0.45, 0.7, 0.45, st, 2.5);
  // the spire
  const apex = height + 0.25 + size * 1.9;
  const hs = size * 0.42;
  const corners: V3[] = [[-hs, height + 0.25, hs], [hs, height + 0.25, hs], [hs, height + 0.25, -hs], [-hs, height + 0.25, -hs]];
  for (let i = 0; i < 4; i++) face(B.slate, f, [corners[i]!, corners[(i + 1) % 4]!, [0, apex, 0]], [[0, 0], [1, 0], [0.5, 2]], [0.9, 0.92, 1]);
  // a round lit window high on the front, dark slits below
  B.panes.push(pane(f, "front", size, size, 0, height - 1.3, 0.9, 1.1));
  B.panes.push(pane(f, "front", size, size, 0, height * 0.55, 0.45, 1.5));
  B.panes.push(pane(f, "back", size, size, 0, height - 1.3, 0.9, 1.1));
}

export const BRICK_TINTS: readonly Col[] = [[1, 0.92, 0.88], [0.82, 0.78, 0.8], [1.1, 0.95, 0.85], [0.7, 0.66, 0.7]];
export const PLASTER_TINTS: readonly Col[] = [[0.92, 0.88, 0.82], [0.78, 0.8, 0.88], [0.86, 0.8, 0.76], [0.7, 0.72, 0.78]];
export const ROOF_TINTS: readonly Col[] = [[1, 1, 1], [0.86, 0.88, 0.96], [1.1, 1.05, 1.0]];

export function newBuilders(): Builders {
  return { brick: new Builder(), plaster: new Builder(), stone: new Builder(), slate: new Builder(), trim: new Builder(), panes: [] };
}

export interface Dressed {
  readonly parts: (readonly [Builder, Material, boolean])[];
  readonly lamp: Vector3;
  readonly glows: { position: Vector3; size: number; color?: string }[];
  readonly top: number;
  /** Parts with their own transform (a turning wheel, rotors, drifting stones, a glow): added to the island's group. */
  readonly extras?: readonly Object3D[];
  /** Moves those parts; called only while the scene animates (never with reduced motion or on simplified quality). */
  readonly animate?: (t: number) => void;
  /** Releases what `extras` hold. */
  readonly dispose?: () => void;
}

/** One kind of island: the shape of its ground, what its top is paved or grassed with, and how it is dressed. */
export interface Site {
  readonly base: BaseStyle;
  readonly top: "grass" | "plaza";
  readonly dress: (s: IslandShape, gm: GenericMaterials, km: KitMaterials) => Dressed;
}

export function finish(B: Builders, km: KitMaterials, r: () => number, share?: number): (readonly [Builder, Material, boolean])[] {
  const windows = new Builder();
  emitPanes(windows, B.panes, r, share);
  return [[B.brick, km.brick, true], [B.plaster, km.plaster, true], [B.stone, km.stone, true], [B.slate, km.slate, true], [B.trim, km.trim, true], [windows, km.windows, false]];
}


// ---------- round parts ----------

/** A flat disc facing up (a table top, a pond, a platform's cap), centred at (cx, y, cz). */
export function disc(b: Builder, cx: number, y: number, cz: number, rad: number, sides: number, col: Col, wobble?: (a: number) => number, tile = 2) {
  const c = b.vert(cx, y, cz, cx / tile, cz / tile, col);
  const ring: number[] = [];
  for (let i = 0; i <= sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    const rr = rad * (wobble ? wobble(a) : 1);
    const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
    ring.push(b.vert(x, y, z, x / tile, z / tile, col));
  }
  for (let i = 0; i < sides; i++) b.tri(c, ring[i + 1]!, ring[i]!);
}

/** A closed upright cylinder: side wall from y0 up by h, and its top cap (platforms, drums, tanks, hay bales). */
export function drum(b: Builder, cx: number, y0: number, cz: number, rad: number, h: number, sides: number, col: Col, tile = 2, top = true) {
  const lo: number[] = [], hi: number[] = [];
  for (let i = 0; i <= sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    const x = cx + Math.cos(a) * rad, z = cz + Math.sin(a) * rad;
    const u = (a * rad) / tile;
    lo.push(b.vert(x, y0, z, u, y0 / tile, col));
    hi.push(b.vert(x, y0 + h, z, u, (y0 + h) / tile, col));
  }
  for (let i = 0; i < sides; i++) b.quad(lo[i + 1]!, lo[i]!, hi[i]!, hi[i + 1]!);
  if (top) disc(b, cx, y0 + h, cz, rad, sides, col, undefined, tile);
}

/** A dome (part of a sphere) standing on y0: `sy` squashes it, `upto` < 1 stops short of the crown. */
export function dome(b: Builder, cx: number, y0: number, cz: number, rad: number, sy: number, sides: number, col: Col, rings = 6) {
  const grid: number[][] = [];
  for (let i = 0; i <= rings; i++) {
    const ph = (i / rings) * (Math.PI / 2);
    const row: number[] = [];
    for (let j = 0; j <= sides; j++) {
      const th = (j / sides) * Math.PI * 2;
      row.push(b.vert(cx + Math.cos(th) * Math.cos(ph) * rad, y0 + Math.sin(ph) * rad * sy, cz + Math.sin(th) * Math.cos(ph) * rad, j / sides, i / rings, col));
    }
    grid.push(row);
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < sides; j++) b.quad(grid[i]![j + 1]!, grid[i]![j]!, grid[i + 1]![j]!, grid[i + 1]![j + 1]!);
}

/** A cone from a base circle at y0 to an apex h above it (roofs of towers, parasols, a hat). */
export function cone(b: Builder, cx: number, y0: number, cz: number, rad: number, h: number, sides: number, col: Col) {
  const apex = b.vert(cx, y0 + h, cz, 0.5, 1, col);
  const ring: number[] = [];
  for (let i = 0; i <= sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    ring.push(b.vert(cx + Math.cos(a) * rad, y0, cz + Math.sin(a) * rad, i / sides, 0, col));
  }
  for (let i = 0; i < sides; i++) b.tri(ring[i + 1]!, ring[i]!, apex);
}

/** A ring of round section (a hoop, an armillary ring, a wheel's rim): radius R about `centre` in the plane of u and v. */
export function hoop(b: Builder, centre: Vector3, u: Vector3, v: Vector3, R: number, r: number, segments: number, sides: number, col: Col) {
  const n = new Vector3().crossVectors(u, v).normalize();
  const rows: number[][] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const radial = u.clone().multiplyScalar(Math.cos(a)).addScaledVector(v, Math.sin(a));
    const c = centre.clone().addScaledVector(radial, R);
    const row: number[] = [];
    for (let k = 0; k <= sides; k++) {
      const t = (k / sides) * Math.PI * 2;
      const p = c.clone().addScaledVector(radial, Math.cos(t) * r).addScaledVector(n, Math.sin(t) * r);
      row.push(b.vert(p.x, p.y, p.z, i / segments, k / sides, col));
    }
    rows.push(row);
  }
  for (let i = 0; i < segments; i++) for (let k = 0; k < sides; k++) b.quad(rows[i]![k]!, rows[i + 1]![k]!, rows[i + 1]![k + 1]!, rows[i]![k + 1]!);
}

/** Small lights strung between two points, sagging like a festoon (positions for glow sprites). */
export function festoon(a: Vector3, b: Vector3, sag: number, n: number): Vector3[] {
  return Array.from({ length: n }, (_, i) => {
    const t = (i + 0.5) / n;
    return a.clone().lerp(b, t).add(new Vector3(0, -sag * 4 * t * (1 - t), 0));
  });
}
