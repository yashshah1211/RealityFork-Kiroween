/**
 * Scenery kits: one island per future, dressed for its universe's family and setting (theme). Modular parts (terraced
 * houses, shopfronts, a warehouse studio, a sawtooth workshop, a cottage, wind turbines, a mill, an observatory, a
 * rotunda...) are assembled procedurally from the island's seed on the shared base from generic.ts. Presentation only:
 * the parts a path shows come from pathScenery (resolve.ts), never from how good, likely or wealthy a future is. Every
 * island of a family is lit the same way: the same share of windows is lit on every island, so no future looks brighter
 * than another.
 *
 * The families' modules: the city here; energy and environment in kitEnergy.ts; shops and studios in kitBusiness.ts;
 * the open sky in kitNeutral.ts; shared parts in kitParts.ts. Budgets: about 5k–14k triangles and 9–17 draw calls per
 * island. Materials and textures are shared across islands (kitMaterials.ts, generic.ts).
 */
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, DoubleSide, Mesh, MeshBasicMaterial, Vector3, type Material } from "three";
import type { Family, Prop, Theme } from "../environment/resolve";
import { AUTUMN, assemble, Builder, islandBase, lampPost, tree, type GenericIsland, type GenericMaterials, type IslandShape } from "./generic";
import { box, finish, frameAt, house, newBuilders, tower, BRICK_TINTS, PLASTER_TINTS, ROOF_TINTS, type Dressed, type HouseSpec, type Site } from "./kitParts";
import type { KitMaterials } from "./kitMaterials";
import { businessSite } from "./kitBusiness";
import { energySite } from "./kitEnergy";
import { neutralSite } from "./kitNeutral";

export interface KitView {
  readonly family: Family;
  readonly theme: Theme;
  readonly props: readonly Prop[];
  /** People at work, drawn as silhouettes (shops and studios): a number the path records, 0 for none. */
  readonly people: number;
  readonly hypothetical: boolean;
}

/** A stable key for what an island shows: the island is rebuilt only when this changes. */
export const kitSignature = (v: KitView) => `${v.family}|${v.theme}|${[...v.props].sort().join(",")}|${v.people}|${v.hypothetical ? "what-if" : ""}`;

// ---------- city at night ----------

/**
 * A paved island with a crescent of terraced houses round a lamplit square, open towards the viewer, and (on most
 * islands) a spire behind them. No real place: the detailed London model is used only where the map names London.
 */
function dressCity(s: IslandShape, gm: GenericMaterials, km: KitMaterials): Dressed {
  const { r, R, height } = s;
  const B = newBuilders();
  const iron = new Builder();
  const glass = new Builder();
  const bark = new Builder();
  const leaves = new Builder();
  const rho = R * 0.6;
  // The crescent spans the back of the island, facing its centre.
  const a0 = Math.PI + 0.32 + r() * 0.12;
  const a1 = 2 * Math.PI - 0.32 - r() * 0.12;
  let a = a0;
  const towerSlot = r() < 0.78 ? 0.35 + r() * 0.3 : -1;
  let topY = 8;
  let placedTower = false;
  let first = true;
  while (a < a1) {
    const progress = (a - a0) / (a1 - a0);
    const wantTower = !placedTower && towerSlot >= 0 && progress >= towerSlot;
    const w = wantTower ? 3.4 : 3 + r() * 1.5;
    const da = w / rho;
    if (a + da > a1 + 0.05) break;
    const mid = a + da / 2;
    const x = Math.cos(mid) * rho, z = Math.sin(mid) * rho;
    const rot = Math.atan2(-Math.cos(mid), -Math.sin(mid));
    if (wantTower) {
      const h = 12 + r() * 3;
      const back = 1.6;
      tower(B, frameAt(x + Math.cos(mid) * back, height(x, z), z + Math.sin(mid) * back, rot), 3.1, h);
      topY = Math.max(topY, h + 0.25 + 3.1 * 1.9);
      placedTower = true;
    } else {
      const floors = 2 + Math.floor(r() * 2.4);
      const floorH = 2.75 + r() * 0.35;
      const plaster = r() < 0.38;
      const spec: HouseSpec = {
        w, d: 4.4 + r() * 1.3, h: floors * floorH, floors, rise: 1.7 + r() * 1.1,
        wall: plaster ? "plaster" : "brick",
        tint: (plaster ? PLASTER_TINTS : BRICK_TINTS)[Math.floor(r() * 4)]!,
        roofTint: ROOF_TINTS[Math.floor(r() * ROOF_TINTS.length)]!,
        chimney: r() < 0.8 ? (r() < 0.5 ? -1 : 1) : 0,
        door: true,
        sides: first || a + da * 2 > a1,
      };
      house(B, frameAt(x, height(x, z), z, rot), spec);
      topY = Math.max(topY, spec.h + spec.rise + 1.2);
    }
    first = false;
    a += da + (r() < 0.14 ? 0.06 : 0.004);
  }
  // Lamps round the square; the one nearest the middle carries the light when the island is in focus.
  const glows: Dressed["glows"] = [];
  const lamps: Vector3[] = [];
  const centre = new Vector3((r() - 0.5) * 2, 0, (r() - 0.5) * 2 + 1);
  lamps.push(centre);
  for (let i = 0; i < 4; i++) {
    const t = a0 + ((i + 0.5) / 4) * (a1 - a0);
    lamps.push(new Vector3(Math.cos(t) * (rho - 4.6), 0, Math.sin(t) * (rho - 4.6)));
  }
  for (const side of [-1, 1]) lamps.push(new Vector3(side * R * 0.5, 0, R * 0.38));
  let lamp = centre;
  lamps.forEach((p, i) => {
    const head = lampPost(iron, glass, new Vector3(p.x, height(p.x, p.z), p.z), i === 0 ? 3.6 : 3.1);
    glows.push({ position: head, size: 1.55 });
    if (i === 0) lamp = head;
  });
  // Benches facing the square, and a few trees at the open front.
  for (let i = 0; i < 3; i++) {
    const t = Math.PI * (0.28 + 0.22 * i) + (r() - 0.5) * 0.1;
    const bx = Math.cos(t) * R * 0.42, bz = Math.sin(t) * R * 0.42;
    const f = frameAt(bx, height(bx, bz), bz, Math.atan2(-Math.cos(t), -Math.sin(t)));
    box(B.trim, f, 0, 0.42, 0, 1.6, 0.08, 0.45, [0.42, 0.3, 0.26]);
    box(B.trim, f, 0, 0.5, -0.2, 1.6, 0.45, 0.07, [0.42, 0.3, 0.26]);
    for (const lx of [-0.7, 0.7]) box(iron, f, lx, 0, 0, 0.07, 0.45, 0.42, [1, 1, 1]);
  }
  for (const side of [-1, 1]) {
    const tx = side * R * (0.62 + r() * 0.1), tz = R * (0.12 + r() * 0.12);
    topY = Math.max(topY, tree(bark, leaves, r, new Vector3(tx, 0, tz), height(tx, tz) - 0.1, AUTUMN, 0.8));
  }
  // A low iron railing along the rim, open where a path would come in at the front.
  const posts = 64;
  for (let i = 0; i < posts; i++) {
    const t = (i / posts) * Math.PI * 2;
    if (Math.abs(Math.atan2(Math.sin(t - Math.PI / 2), Math.cos(t - Math.PI / 2))) < 0.22) continue;
    const rr = s.outline(t) * 0.975;
    const px = Math.cos(t) * rr, pz = Math.sin(t) * rr;
    const y = height(px, pz);
    box(iron, frameAt(px, y, pz, -t), 0, 0, 0, 0.07, 0.95, 0.07, [1, 1, 1]);
    const t2 = ((i + 1) / posts) * Math.PI * 2;
    if (Math.abs(Math.atan2(Math.sin(t2 - Math.PI / 2), Math.cos(t2 - Math.PI / 2))) < 0.22) continue;
    const rr2 = s.outline(t2) * 0.975;
    const qx = Math.cos(t2) * rr2, qz = Math.sin(t2) * rr2;
    const mx = (px + qx) / 2, mz = (pz + qz) / 2;
    const len = Math.hypot(qx - px, qz - pz);
    box(iron, frameAt(mx, (y + height(qx, qz)) / 2, mz, Math.atan2(qx - px, qz - pz) + Math.PI / 2), 0, 0.88, 0, len, 0.06, 0.06, [1, 1, 1]);
  }
  return {
    parts: [...finish(B, km, r), [iron, gm.iron, true], [glass, gm.glass, false], [bark, gm.bark, true], [leaves, gm.leaves, true]],
    lamp, glows, top: topY,
  };
}

// ---------- assembly ----------

/** A dashed glowing ring round the rim: the mark of a path that explores a change described in words. */
function whatIfRing(s: IslandShape): Mesh {
  const pos: number[] = [];
  const idx: number[] = [];
  const dashes = 44;
  for (let i = 0; i < dashes; i++) {
    const a0 = (i / dashes) * Math.PI * 2, a1 = a0 + (Math.PI * 2 * 0.55) / dashes;
    const p = (a: number, y: number) => {
      const rr = s.outline(a) * 1.035;
      pos.push(Math.cos(a) * rr, y, Math.sin(a) * rr);
    };
    const b = pos.length / 3;
    p(a0, 0.05); p(a1, 0.05); p(a1, 0.42); p(a0, 0.42);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  const m = new MeshBasicMaterial({ color: new Color("#c7c1ff"), transparent: true, opacity: 0.85, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, fog: true });
  const mesh = new Mesh(g, m);
  mesh.name = "what-if";
  mesh.renderOrder = 3;
  return mesh;
}

const CITY: Site = { base: { dome: 0.22, bumps: 0.06, tint: [0.78, 0.78, 0.86], tile: 4.5, boulders: 2 }, top: "plaza", dress: dressCity };

function siteFor(v: KitView): Site {
  switch (v.family) {
    case "urban": return CITY;
    case "energy": return energySite(v.theme, v.props);
    case "business": return businessSite(v.theme, v.people, v.props);
    default: return neutralSite(v.theme);
  }
}

export function buildKitIsland(seed: number, view: KitView, gm: GenericMaterials, km: KitMaterials): GenericIsland {
  const site = siteFor(view);
  const base = islandBase(seed, site.base);
  const dressed = site.dress(base.shape, gm, km);
  const { group, geoms, triangles } = assemble(`${view.family}-${view.theme}-${seed}`, [[base.top, site.top === "plaza" ? gm.plaza : gm.grass, true], [base.rock, gm.rock, true], ...dressed.parts]);
  for (const o of dressed.extras ?? []) group.add(o);
  group.rotation.y = base.shape.r() * 0.4 - 0.2;
  const extraDispose: (() => void)[] = [];
  if (dressed.dispose) extraDispose.push(dressed.dispose);
  if (view.hypothetical) {
    const ring = whatIfRing(base.shape);
    group.add(ring);
    extraDispose.push(() => {
      ring.geometry.dispose();
      (ring.material as Material).dispose();
    });
  }
  return {
    group, lantern: dressed.lamp, glows: dressed.glows, top: dressed.top, bottom: -base.shape.depth - 1.4, radius: base.shape.R * 1.08, triangles,
    ...(dressed.animate ? { animate: dressed.animate } : {}),
    dispose() {
      for (const g of geoms) g.dispose();
      for (const d of extraDispose) d();
    },
  };
}
