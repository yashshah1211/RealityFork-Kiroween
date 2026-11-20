/**
 * The island every universe is built on, and the open landscape that dresses it in the abstract universe.
 *
 * `islandBase` is the floating rock and its top surface; the scenery kits (kit.ts) dress it for each family. The open
 * landscape (`buildGenericIsland`) is deliberately neutral: grass, a stone path leading to a lantern, a few autumn
 * trees. It shows that a future exists, never what is in it. Shapes vary with a seed taken from the path's id so
 * islands can be told apart; nothing about the path's content changes them.
 *
 * About 5k triangles in six draw calls, built once per seed. Materials and textures are shared by every island.
 */
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  type Material,
  type Texture,
} from "three";
import rock from "../assets/generic/rock_albedo.webp?url";
import rockNormal from "../assets/generic/rock_normal.webp?url";
import grass from "../assets/generic/grass.webp?url";
import paving from "../assets/generic/paving_albedo.webp?url";
import bark from "../assets/generic/bark_albedo.webp?url";
import leaves from "../assets/generic/leaf_cluster.webp?url";

/** Textures taken from the London GLB (made for the same art direction; see docs/validation/atlas-3d/README.md). */
export const GENERIC_TEXTURES = { rock, rockNormal, grass, paving, bark, leaves } as const;

/** Deterministic random numbers (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A stable 32-bit seed from a path id. */
export function seedOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Smooth periodic noise on a circle, from a few seeded harmonics. */
export function ringNoise(r: () => number, harmonics: number): (a: number) => number {
  const terms = Array.from({ length: harmonics }, (_, i) => ({ k: i + 2, amp: (r() * 0.9 + 0.1) / (i + 1.4), ph: r() * Math.PI * 2 }));
  const norm = terms.reduce((s, t) => s + t.amp, 0);
  return (a) => terms.reduce((s, t) => s + t.amp * Math.sin(t.k * a + t.ph), 0) / norm;
}

/** Cheap 3D value noise (smooth, deterministic), for crags. */
export function valueNoise(seed: number): (x: number, y: number, z: number) => number {
  const hash = (i: number, j: number, k: number) => {
    let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 1440662683) ^ seed;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const s = (t: number) => t * t * (3 - 2 * t);
  return (x, y, z) => {
    const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z);
    const fx = s(x - i), fy = s(y - j), fz = s(z - k);
    const l = (a: number, b: number, t: number) => a + (b - a) * t;
    const c = (di: number, dj: number, dk: number) => hash(i + di, j + dj, k + dk);
    return l(
      l(l(c(0, 0, 0), c(1, 0, 0), fx), l(c(0, 1, 0), c(1, 1, 0), fx), fy),
      l(l(c(0, 0, 1), c(1, 0, 1), fx), l(c(0, 1, 1), c(1, 1, 1), fx), fy),
      fz,
    ) * 2 - 1;
  };
}

export interface GenericMaterials {
  readonly grass: MeshStandardMaterial;
  readonly rock: MeshStandardMaterial;
  readonly paving: MeshStandardMaterial;
  readonly bark: MeshStandardMaterial;
  readonly leaves: MeshStandardMaterial;
  readonly iron: MeshStandardMaterial;
  readonly glass: MeshStandardMaterial;
  /** The same flagstones as `paving`, tinted per vertex: whole paved island tops. */
  readonly plaza: MeshStandardMaterial;
  dispose(): void;
}

/** Shared materials; textures load in the background and appear when ready (plain colours until then). */
export function genericMaterials(maxAnisotropy: number): GenericMaterials {
  const loader = new TextureLoader();
  const textures: Texture[] = [];
  const tex = (url: string, srgb: boolean, repeat = 1) => {
    const t = loader.load(url);
    t.wrapS = t.wrapT = RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.anisotropy = maxAnisotropy;
    if (srgb) t.colorSpace = SRGBColorSpace;
    textures.push(t);
    return t;
  };
  const grass = new MeshStandardMaterial({ name: "Generic_Grass", map: tex(GENERIC_TEXTURES.grass, true), color: new Color("#a7b38f"), roughness: 0.96, vertexColors: true });
  const rock = new MeshStandardMaterial({ name: "Generic_Rock", map: tex(GENERIC_TEXTURES.rock, true), normalMap: tex(GENERIC_TEXTURES.rockNormal, false), color: new Color("#9b939c"), roughness: 0.92, vertexColors: true });
  const pavingMap = tex(GENERIC_TEXTURES.paving, true);
  const paving = new MeshStandardMaterial({ name: "Generic_Paving", map: pavingMap, color: new Color("#c9c2b8"), roughness: 0.8 });
  const plaza = new MeshStandardMaterial({ name: "Generic_Plaza", map: pavingMap, color: new Color("#a9a3b0"), roughness: 0.62, vertexColors: true });
  const bark = new MeshStandardMaterial({ name: "Generic_Bark", map: tex(GENERIC_TEXTURES.bark, true), color: new Color("#8a7a70"), roughness: 0.95 });
  const leaves = new MeshStandardMaterial({ name: "Generic_Leaves", map: tex(GENERIC_TEXTURES.leaves, true), alphaTest: 0.45, side: DoubleSide, roughness: 0.85, vertexColors: true });
  const iron = new MeshStandardMaterial({ name: "Generic_Iron", color: new Color("#1d1c22"), roughness: 0.55, metalness: 0.6 });
  const glass = new MeshStandardMaterial({ name: "Generic_Lantern", color: new Color("#ffcf96"), emissive: new Color("#ffad5c"), emissiveIntensity: 5.5, roughness: 0.4 });
  const all = [grass, rock, paving, plaza, bark, leaves, iron, glass];
  for (const m of all) m.envMapIntensity = 0.35;
  plaza.envMapIntensity = 0.6;
  return {
    grass, rock, paving, plaza, bark, leaves, iron, glass,
    dispose() {
      for (const t of textures) t.dispose();
      for (const m of all) m.dispose();
    },
  };
}

/** Accumulates triangles with positions, normals (computed later), uvs and colours. */
export class Builder {
  readonly pos: number[] = [];
  readonly uv: number[] = [];
  readonly col: number[] = [];
  readonly idx: number[] = [];
  vert(x: number, y: number, z: number, u: number, v: number, c: readonly [number, number, number] = [1, 1, 1]): number {
    this.pos.push(x, y, z);
    this.uv.push(u, v);
    this.col.push(c[0], c[1], c[2]);
    return this.pos.length / 3 - 1;
  }
  tri(a: number, b: number, c: number) {
    this.idx.push(a, b, c);
  }
  quad(a: number, b: number, c: number, d: number) {
    this.idx.push(a, b, c, a, c, d);
  }
  geometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute("uv", new BufferAttribute(new Float32Array(this.uv), 2));
    g.setAttribute("color", new BufferAttribute(new Float32Array(this.col), 3));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    return g;
  }
}

/** A tapered tube along a polyline, for trunks, branches and posts. */
export function tube(b: Builder, pts: readonly Vector3[], radii: readonly number[], sides: number, vScale = 1) {
  const up = new Vector3(0, 1, 0);
  const rings: number[][] = [];
  let len = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const next = pts[Math.min(i + 1, pts.length - 1)]!;
    const prev = pts[Math.max(i - 1, 0)]!;
    const t = next.clone().sub(prev).normalize();
    const n = Math.abs(t.dot(up)) > 0.95 ? new Vector3(1, 0, 0).cross(t).normalize() : up.clone().cross(t).normalize();
    const bn = t.clone().cross(n).normalize();
    if (i > 0) len += p.distanceTo(pts[i - 1]!);
    const ring: number[] = [];
    for (let s = 0; s <= sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      const r = radii[i]!;
      const q = p.clone().addScaledVector(n, Math.cos(a) * r).addScaledVector(bn, Math.sin(a) * r);
      ring.push(b.vert(q.x, q.y, q.z, s / sides, len * vScale));
    }
    rings.push(ring);
  }
  for (let i = 0; i + 1 < rings.length; i++) for (let s = 0; s < sides; s++) b.quad(rings[i]![s]!, rings[i + 1]![s]!, rings[i + 1]![s + 1]!, rings[i]![s + 1]!);
}

export const AUTUMN: readonly (readonly [number, number, number])[] = [
  [0.86, 0.5, 0.17], [0.72, 0.27, 0.12], [0.88, 0.69, 0.3], [0.58, 0.17, 0.11], [0.8, 0.4, 0.14],
].map((c) => [c[0]! ** 2.2, c[1]! ** 2.2, c[2]! ** 2.2] as const);

/** How an island's top is shaped and shaded. The defaults are the open landscape's. */
export interface BaseStyle {
  /** Height of the gentle dome over the top (m). */
  readonly dome?: number;
  /** Height of the small bumps (m). */
  readonly bumps?: number;
  /** Colour multiplier for the top surface. */
  readonly tint?: readonly [number, number, number];
  /** Texture scale of the top surface (m per repeat). */
  readonly tile?: number;
  readonly boulders?: number;
  /** Radius range (m). */
  readonly radius?: readonly [number, number];
}

/** An island's outline and ground, for the scenery placed on it. `r` continues the island's seeded stream. */
export interface IslandShape {
  readonly seed: number;
  readonly r: () => number;
  readonly R: number;
  readonly outline: (a: number) => number;
  readonly height: (x: number, z: number) => number;
  readonly crag: (x: number, y: number, z: number) => number;
  readonly depth: number;
}

/** The floating rock and the top surface of one island. The top uses the grass or the flagstones (the caller decides). */
export function islandBase(seed: number, style: BaseStyle = {}): { shape: IslandShape; top: Builder; rock: Builder } {
  const r = rng(seed);
  const [r0, r1] = style.radius ?? [14.5, 17];
  const R = r0 + r() * (r1 - r0);
  const edge = ringNoise(r, 4);
  const crag = valueNoise(seed);
  const dome = style.dome ?? 0.45;
  const bumps = style.bumps ?? 0.18;
  const tint = style.tint ?? [1, 1, 1];
  const tile = style.tile ?? 7;
  const outline = (a: number) => R * (1 + 0.075 * edge(a));
  const height = (x: number, z: number) => {
    const d = Math.hypot(x, z) / R;
    return dome * (1 - Math.min(1, d) ** 2) + bumps * crag(x * 0.12, 0.5, z * 0.12);
  };
  const SEG = 96;

  // --- top: a polar grid, gently domed, darker towards the edge
  const top = new Builder();
  const RINGS = 9;
  const centre = top.vert(0, height(0, 0), 0, 0, 0, [tint[0], tint[1], tint[2]]);
  const ringIdx: number[][] = [];
  for (let i = 1; i <= RINGS; i++) {
    const row: number[] = [];
    for (let s = 0; s < SEG; s++) {
      const a = (s / SEG) * Math.PI * 2;
      const rr = outline(a) * (i / RINGS) ** 0.85;
      const x = Math.cos(a) * rr;
      const z = Math.sin(a) * rr;
      const y = i === RINGS ? 0 : height(x, z);
      const shade = 1 - 0.28 * (i / RINGS) ** 3;
      const patch = 0.5 + 0.5 * crag(x * 0.18 + 40, 1.5, z * 0.18);
      row.push(top.vert(x, y, z, x / tile, z / tile, [tint[0] * shade * (0.86 + 0.22 * patch), tint[1] * shade * (0.92 + 0.1 * patch), tint[2] * shade * (0.9 - 0.06 * patch)]));
    }
    ringIdx.push(row);
  }
  for (let s = 0; s < SEG; s++) top.tri(centre, ringIdx[0]![(s + 1) % SEG]!, ringIdx[0]![s]!);
  for (let i = 0; i + 1 < RINGS; i++) for (let s = 0; s < SEG; s++) {
    const s1 = (s + 1) % SEG;
    top.quad(ringIdx[i]![s]!, ringIdx[i]![s1]!, ringIdx[i + 1]![s1]!, ringIdx[i + 1]![s]!);
  }

  // --- rock: a short stratified cliff under the top's edge, then a craggy underside tapering to a tip
  const rock = new Builder();
  const depth = 15.5 + r() * 3;
  const profile: readonly (readonly [number, number])[] = [
    [0, 1.005], [0.45, 1.022], [0.9, 1.0], [1.4, 1.012], [2.0, 0.99], [2.7, 0.965], [3.5, 0.92], [4.5, 0.86], [5.6, 0.78], [6.8, 0.7], [8.1, 0.61],
    [9.4, 0.52], [10.7, 0.43], [12.0, 0.34], [13.2, 0.25], [14.3, 0.17], [15.2, 0.1], [16.0, 0.05],
  ];
  const scaleD = depth / 16.0;
  const rows: number[][] = [];
  const tipX = (r() - 0.5) * 3;
  const tipZ = (r() - 0.5) * 3;
  profile.forEach(([d0, f], i) => {
    const d = d0 * scaleD;
    const row: number[] = [];
    const ledge = i < 6 ? 0.022 * Math.sin(d * 3.1 + seed) : 0;
    for (let s = 0; s <= SEG; s++) {
      const a = (s / SEG) * Math.PI * 2;
      const base = outline(a);
      const n = crag(Math.cos(a) * 2.2, d * 0.38, Math.sin(a) * 2.2);
      const n2 = crag(Math.cos(a) * 6, d * 1.1 + 9, Math.sin(a) * 6);
      const n3 = crag(Math.cos(a) * 13, d * 2.3 + 21, Math.sin(a) * 13);
      const amp = i === 0 ? 0 : 0.07 + 0.15 * Math.min(1, d / 6);
      const rr = base * Math.max(0.02, f * (1 + ledge + amp * n + 0.06 * n2 + 0.025 * n3));
      const shift = d / depth;
      const x = Math.cos(a) * rr + tipX * shift * shift;
      const z = Math.sin(a) * rr + tipZ * shift * shift;
      // Fake ambient occlusion: darker under the overhang and towards the tip.
      const shade = Math.max(0.35, 1 - 0.55 * (d / depth) ** 0.8);
      row.push(rock.vert(x, -d - (i === 0 ? 0.02 : 0), z, (a * base) / 9, -d / 9, [shade, shade * 0.97, shade]));
    }
    rows.push(row);
  });
  for (let i = 0; i + 1 < rows.length; i++) for (let s = 0; s < SEG; s++) rock.quad(rows[i]![s]!, rows[i]![s + 1]!, rows[i + 1]![s + 1]!, rows[i + 1]![s]!);
  const tip = rock.vert(tipX, -depth - 1.4, tipZ, 0, -depth / 9, [0.32, 0.31, 0.32]);
  const last = rows[rows.length - 1]!;
  for (let s = 0; s < SEG; s++) rock.tri(last[s]!, last[s + 1]!, tip);
  // a few boulders resting near the rim
  for (let k = 0; k < (style.boulders ?? 4); k++) {
    const a = r() * Math.PI * 2;
    const rr = outline(a) * (0.8 + r() * 0.12);
    const cx = Math.cos(a) * rr, cz = Math.sin(a) * rr;
    const size = 0.6 + r() * 0.9;
    const cy = height(cx, cz) + size * 0.35;
    const lat = 5, lon = 8;
    const grid: number[][] = [];
    for (let i = 0; i <= lat; i++) {
      const row: number[] = [];
      const ph = (i / lat) * Math.PI;
      for (let j = 0; j <= lon; j++) {
        const th = (j / lon) * Math.PI * 2;
        const n = 1 + 0.25 * crag(Math.cos(th) * 1.7 + k * 7, Math.cos(ph) * 1.7, Math.sin(th) * 1.7);
        const x = cx + Math.sin(ph) * Math.cos(th) * size * n * 1.2;
        const y = cy + Math.cos(ph) * size * n * 0.7;
        const z = cz + Math.sin(ph) * Math.sin(th) * size * n;
        row.push(rock.vert(x, y, z, j / lon, i / lat, [0.85, 0.85, 0.85]));
      }
      grid.push(row);
    }
    for (let i = 0; i < lat; i++) for (let j = 0; j < lon; j++) rock.quad(grid[i]![j]!, grid[i + 1]![j]!, grid[i + 1]![j + 1]!, grid[i]![j + 1]!);
  }
  return { shape: { seed, r, R, outline, height, crag, depth }, top, rock };
}

/** Joins builders into one group: one mesh (one draw call) per builder that has triangles. */
export function assemble(name: string, parts: readonly (readonly [Builder, Material, boolean])[]): { group: Group; geoms: BufferGeometry[]; triangles: number } {
  const group = new Group();
  group.name = name;
  const geoms: BufferGeometry[] = [];
  let triangles = 0;
  for (const [b, mat, cast] of parts) {
    if (!b.idx.length) continue;
    const g = b.geometry();
    geoms.push(g);
    triangles += b.idx.length / 3;
    const mesh = new Mesh(g, mat);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return { group, geoms, triangles };
}

/** A pale stone path from the front edge (towards the camera, +Z) to `to`, following the ground. */
export function stonePath(paving: Builder, s: IslandShape, to: Vector3, width = 0.85): Vector3[] {
  const { r, outline, height } = s;
  const start = new Vector3((r() - 0.5) * 3, 0, outline(Math.PI / 2) * 0.97);
  const bend = new Vector3((r() - 0.5) * 9, 0, (start.z + to.z) / 2);
  const P = 26;
  const pathPts: Vector3[] = [];
  for (let i = 0; i <= P; i++) {
    const t = i / P;
    const q = start.clone().multiplyScalar((1 - t) ** 2).addScaledVector(bend, 2 * t * (1 - t)).addScaledVector(to, t * t);
    q.y = height(q.x, q.z) + 0.05;
    pathPts.push(q);
  }
  const prow: [number, number][] = [];
  let along = 0;
  pathPts.forEach((q, i) => {
    const nxt = pathPts[Math.min(i + 1, P)]!;
    const prv = pathPts[Math.max(i - 1, 0)]!;
    const t = nxt.clone().sub(prv).setY(0).normalize();
    const side = new Vector3(-t.z, 0, t.x);
    const w = width * (1 - 0.3 * (i / P));
    if (i > 0) along += q.distanceTo(pathPts[i - 1]!);
    const a = q.clone().addScaledVector(side, w);
    const b = q.clone().addScaledVector(side, -w);
    a.y = height(a.x, a.z) + 0.05;
    b.y = height(b.x, b.z) + 0.05;
    prow.push([paving.vert(a.x, a.y, a.z, 0, along / 2.2), paving.vert(b.x, b.y, b.z, 0.75, along / 2.2)]);
  });
  for (let i = 0; i < P; i++) paving.quad(prow[i]![0], prow[i + 1]![0], prow[i + 1]![1], prow[i]![1]);
  return pathPts;
}

/** An iron lamp post with a glowing head. Returns the head (where its glow and light go). */
export function lampPost(iron: Builder, glass: Builder, at: Vector3, postTop = 3.1, hw = 0.2, hh = 0.3): Vector3 {
  tube(iron, [new Vector3(at.x, at.y, at.z), new Vector3(at.x, at.y + 0.25, at.z), new Vector3(at.x, at.y + postTop, at.z)], [0.16, 0.09, 0.07], 8);
  const head = new Vector3(at.x, at.y + postTop + hh + 0.02, at.z);
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const;
  const lo = corners.map(([sx, sz]) => glass.vert(head.x + sx * hw, head.y - hh, head.z + sz * hw, 0, 0));
  const hi = corners.map(([sx, sz]) => glass.vert(head.x + sx * hw * 1.15, head.y + hh, head.z + sz * hw * 1.15, 0, 1));
  for (let i = 0; i < 4; i++) glass.quad(lo[i]!, lo[(i + 1) % 4]!, hi[(i + 1) % 4]!, hi[i]!);
  const capC = iron.vert(head.x, head.y + hh + 0.32, head.z, 0, 0);
  const capR = corners.map(([sx, sz]) => iron.vert(head.x + sx * hw * 1.45, head.y + hh, head.z + sz * hw * 1.45, 0, 0));
  for (let i = 0; i < 4; i++) iron.tri(capR[i]!, capR[(i + 1) % 4]!, capC);
  return head;
}

/** One tree: a tapered trunk, three branches and crossed leaf cards. Returns the top of its crown. */
export function tree(bark: Builder, leaves: Builder, r: () => number, at: Vector3, y0: number, palette: readonly (readonly [number, number, number])[] = AUTUMN, scale = 1): number {
  const h = (4.6 + r() * 2.6) * scale;
  const lean = new Vector3((r() - 0.5) * 0.8, 0, (r() - 0.5) * 0.8);
  const trunk = [0, 0.35, 0.7, 1].map((t) => new Vector3(at.x + lean.x * t * t, y0 + h * t, at.z + lean.z * t * t));
  tube(bark, trunk, [0.32, 0.22, 0.16, 0.09].map((x) => x * scale), 7, 0.5);
  const crown = trunk[3]!.clone();
  for (let j = 0; j < 3; j++) {
    const a = r() * Math.PI * 2;
    const from = trunk[1]!.clone().lerp(trunk[2]!, r());
    const to = from.clone().add(new Vector3(Math.cos(a) * (1.4 + r()) * scale, (1.2 + r() * 1.2) * scale, Math.sin(a) * (1.4 + r()) * scale));
    tube(bark, [from, from.clone().lerp(to, 0.5).add(new Vector3(0, 0.25, 0)), to], [0.11, 0.07, 0.035].map((x) => x * scale), 5, 0.5);
  }
  const cards = 16 + Math.floor(r() * 6);
  const crownR = (1.9 + r() * 0.9) * scale;
  let topY = crown.y;
  for (let c = 0; c < cards; c++) {
    const u = r() * 2 - 1;
    const th = r() * Math.PI * 2;
    const rad = Math.cbrt(r()) * crownR;
    const cx = crown.x + Math.sqrt(1 - u * u) * Math.cos(th) * rad;
    const cy = crown.y - 0.6 * scale + u * rad * 0.75;
    const cz = crown.z + Math.sqrt(1 - u * u) * Math.sin(th) * rad;
    const size = (1.5 + r() * 1.1) * scale;
    const rot = r() * Math.PI;
    const tilt = (r() - 0.5) * 0.8;
    const colr = palette[Math.floor(r() * palette.length)]!;
    const sh = 0.75 + 0.35 * (u * 0.5 + 0.5);
    const cc: [number, number, number] = [colr[0] * sh, colr[1] * sh, colr[2] * sh];
    for (const extra of [0, Math.PI / 2]) {
      const dx = Math.cos(rot + extra) * size * 0.5;
      const dz = Math.sin(rot + extra) * size * 0.5;
      const dy = size * 0.5;
      const v0 = leaves.vert(cx - dx, cy - dy + tilt, cz - dz, 0, 0, cc);
      const v1 = leaves.vert(cx + dx, cy - dy - tilt, cz + dz, 1, 0, cc);
      const v2 = leaves.vert(cx + dx, cy + dy - tilt, cz + dz, 1, 1, cc);
      const v3 = leaves.vert(cx - dx, cy + dy + tilt, cz - dz, 0, 1, cc);
      leaves.quad(v0, v1, v2, v3);
    }
    topY = Math.max(topY, cy + size * 0.5);
  }
  return topY;
}

/** One alpha-cut leaf card; `hang` makes it hang down from its anchor (creeper over a rim). */
export function leafCard(leaves: Builder, cx: number, cy: number, cz: number, size: number, rot: number, cc: readonly [number, number, number], hang: boolean) {
  const dx = Math.cos(rot) * size * 0.5;
  const dz = Math.sin(rot) * size * 0.5;
  const top = hang ? 0 : size * 0.5;
  const bot = hang ? size : size * 0.5;
  const v0 = leaves.vert(cx - dx, cy - bot, cz - dz, 0, 0, cc);
  const v1 = leaves.vert(cx + dx, cy - bot, cz + dz, 1, 0, cc);
  const v2 = leaves.vert(cx + dx, cy + top, cz + dz, 1, 1, cc);
  const v3 = leaves.vert(cx - dx, cy + top, cz - dz, 0, 1, cc);
  leaves.quad(v0, v1, v2, v3);
}

/** Virginia creeper hanging over the rim and low shrubs along it, kept clear of the angle `keepClear` (a path). */
export function rimGreenery(leaves: Builder, s: IslandShape, keepClear: number, palette: readonly (readonly [number, number, number])[] = AUTUMN) {
  const { r, outline, height } = s;
  const curtains = 3 + Math.floor(r() * 3);
  for (let k = 0; k < curtains; k++) {
    let a = r() * Math.PI * 2;
    if (Math.abs(Math.atan2(Math.sin(a - keepClear), Math.cos(a - keepClear))) < 0.5) a += 1.2;
    const width = 0.35 + r() * 0.3;
    const len = 1.6 + r() * 2.6;
    const strands = 7 + Math.floor(r() * 5);
    for (let j = 0; j < strands; j++) {
      const aa = a + (j / strands - 0.5) * width;
      const rr = outline(aa) * 1.015;
      const sl = len * (0.5 + 0.5 * r());
      const red = palette[Math.min(palette.length - 1, Math.floor(r() * 2) + 1)]!;
      for (let d = 0; d < sl; d += 0.55) {
        const out = rr * (1 + 0.012 * Math.sin(d * 2 + j)) * (1 - 0.01 * d);
        const sh = 0.95 - 0.35 * (d / len);
        leafCard(leaves, Math.cos(aa) * out, -d + 0.2, Math.sin(aa) * out, 0.8 + r() * 0.35, aa + Math.PI / 2 + (r() - 0.5) * 0.6, [red[0] * sh, red[1] * sh, red[2] * sh], true);
      }
    }
  }
  const shrubs = 7 + Math.floor(r() * 6);
  for (let k = 0; k < shrubs; k++) {
    const a = r() * Math.PI * 2;
    if (Math.abs(Math.atan2(Math.sin(a - keepClear), Math.cos(a - keepClear))) < 0.35) continue;
    const rr = outline(a) * (0.9 + r() * 0.05);
    const cx = Math.cos(a) * rr, cz = Math.sin(a) * rr;
    const cy = height(cx, cz);
    const col = palette[Math.floor(r() * palette.length)]!;
    const dark: [number, number, number] = [col[0] * 0.55, col[1] * 0.6, col[2] * 0.55];
    for (let c = 0; c < 5; c++) leafCard(leaves, cx + (r() - 0.5) * 1.2, cy + 0.45 + r() * 0.35, cz + (r() - 0.5) * 1.2, 1.1 + r() * 0.6, r() * Math.PI, dark, false);
  }
}

export interface GenericIsland {
  readonly group: Group;
  /** Lantern head, in the island's local space: where its glow and (when in focus) its light go. */
  readonly lantern: Vector3;
  /** Every warm light on the island (lantern, lamps, windows seen from afar), for the glow sprites. */
  readonly glows: readonly { readonly position: Vector3; readonly size: number; readonly color?: string }[];
  /** Top of the tallest thing on the island, for the label. */
  readonly top: number;
  readonly bottom: number;
  readonly radius: number;
  readonly triangles: number;
  /** Moving parts (a mill wheel, rotors, drifting stones): called each frame while the scene animates. */
  readonly animate?: (t: number) => void;
  dispose(): void;
}

/** Build one open-landscape island from a seed. Top surface at y ≈ 0; the rock hangs down to about -17 m. */
export function buildGenericIsland(seed: number, m: GenericMaterials, extra?: (s: IslandShape, lantern: Vector3) => { builders: readonly (readonly [Builder, Material, boolean])[]; top?: number }): GenericIsland {
  const { shape, top, rock } = islandBase(seed);
  const { r, R, height } = shape;
  const paving = new Builder();
  const lanternAt = new Vector3((r() - 0.5) * 4, 0, -1.5 - r() * 3);
  const pathPts = stonePath(paving, shape, lanternAt);
  const iron = new Builder();
  const glass = new Builder();
  const head = lampPost(iron, glass, new Vector3(lanternAt.x, height(lanternAt.x, lanternAt.z), lanternAt.z));
  const bark = new Builder();
  const leaves = new Builder();
  const trees = 2 + Math.floor(r() * 3);
  let topY = head.y + 1;
  const taken: Vector3[] = [lanternAt, ...pathPts.filter((_, i) => i % 4 === 0)];
  for (let k = 0; k < trees; k++) {
    let at = new Vector3();
    for (let tries = 0; tries < 30; tries++) {
      const a = r() * Math.PI * 2;
      const rr = R * (0.25 + r() * 0.5);
      at = new Vector3(Math.cos(a) * rr, 0, Math.sin(a) * rr);
      if (taken.every((q) => Math.hypot(q.x - at.x, q.z - at.z) > 4.2)) break;
    }
    taken.push(at);
    topY = Math.max(topY, tree(bark, leaves, r, at, height(at.x, at.z) - 0.1));
  }
  rimGreenery(leaves, shape, Math.atan2(pathPts[0]!.z, pathPts[0]!.x));
  const more = extra?.(shape, head);
  if (more?.top !== undefined) topY = Math.max(topY, more.top);
  const { group, geoms, triangles } = assemble(`generic-${seed}`, [
    [top, m.grass, true], [rock, m.rock, true], [paving, m.paving, true], [bark, m.bark, true], [leaves, m.leaves, true], [iron, m.iron, true], [glass, m.glass, false],
    ...(more?.builders ?? []),
  ]);
  group.rotation.y = r() * 0.6 - 0.3;
  return {
    group, lantern: head, glows: [{ position: head, size: 1.7 }], top: topY, bottom: -shape.depth - 1.4, radius: R * 1.08, triangles,
    dispose() {
      for (const g of geoms) g.dispose();
    },
  };
}

/** A soft round glow texture for halos and mist, drawn on a canvas (no image file). */
export function glowTexture(size = 64, soft = 0.55): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(soft * 0.35, "rgba(255,255,255,0.55)");
  grad.addColorStop(soft, "rgba(255,255,255,0.12)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}
