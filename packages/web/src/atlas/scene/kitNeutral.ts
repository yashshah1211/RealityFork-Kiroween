/**
 * The open sky: the abstract universe's island, for questions about ideas, policy, science, history or anything that
 * names no kind of place. A quiet ceremonial terrace in the sky: a ring of standing stones open towards the viewer, a
 * long reflecting pool lined with candles, a stepped dais, a few stones drifting round the island, and on the dais a
 * centrepiece that is a symbol, never a real building: a pointed archway (the plain open sky), an observatory (science),
 * a broken colonnade (history) or a rotunda (policy and public life). Built from shared modules (kitParts.ts,
 * generic.ts). Presentation only.
 */
import { AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, Color, DoubleSide, Group, Mesh, MeshBasicMaterial, SRGBColorSpace, Vector3, type Material } from "three";
import type { Theme } from "../environment/resolve";
import { AUTUMN, Builder, lampPost, leafCard, rimGreenery, tree, tube, type GenericMaterials, type IslandShape } from "./generic";
import { box, cuboid, disc, dome, drum, face, finish, frameAt, hoop, newBuilders, toWorld, type Col, type Dressed, type Site } from "./kitParts";
import type { KitMaterials } from "./kitMaterials";

// ---------- open sky ----------

/** The shape of a pointed (equilateral) arch, as a soft glow for the opening: drawn once on a canvas. */
let portalTexture: CanvasTexture | null = null;
export function portalMap(): CanvasTexture {
  if (portalTexture) return portalTexture;
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 128, 0, 0);
  grad.addColorStop(0, "rgba(255,255,255,0.95)");
  grad.addColorStop(0.55, "rgba(255,255,255,0.45)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(2, 128);
  g.lineTo(2, 64);
  g.quadraticCurveTo(4, 14, 32, 2);
  g.quadraticCurveTo(60, 14, 62, 64);
  g.lineTo(62, 128);
  g.closePath();
  g.fill();
  portalTexture = new CanvasTexture(c);
  portalTexture.colorSpace = SRGBColorSpace;
  return portalTexture;
}

/** A gothic stone archway of dressed voussoirs on two piers, behind the lantern: a doorway, not a building. */
export function archway(stone: Builder, at: Vector3, rot: number, r: () => number): { top: number; opening: { centre: Vector3; width: number; height: number } } {
  const span = 2.5, spring = 2.7, t = 0.5, depth = 0.65;
  const f = frameAt(at.x, at.y, at.z, rot);
  const tone = () => { const v = 0.88 + r() * 0.16; return [v, v * 0.98, v * 1.03] as Col; };
  // piers
  for (const side of [-1, 1]) {
    const px = side * (span / 2 + t / 2);
    for (let k = 0; k < 4; k++) box(stone, f, px, -0.6 + k * (spring + 0.6) / 4, 0, t + 0.04 * (k % 2), (spring + 0.6) / 4 - 0.03, depth + 0.04 * ((k + 1) % 2), tone(), 1.2);
  }
  // voussoirs on two arcs, each centred at the opposite springing point
  const n = 7;
  const rot3 = (v: Vector3) => {
    const [x, y, z] = toWorld(f, v.x, v.y, v.z);
    return new Vector3(x, y, z);
  };
  const dirW = (lx: number, ly: number, lz: number) => rot3(new Vector3(lx, ly, lz)).sub(rot3(new Vector3(0, 0, 0)));
  for (const side of [-1, 1]) {
    const centre = new Vector3(-side * (span / 2), spring, 0);
    const radius = span + t / 2;
    const startA = side < 0 ? Math.PI : 0;
    const endA = side < 0 ? (2 * Math.PI) / 3 + 0.02 : Math.PI / 3 - 0.02;
    for (let k = 0; k < n; k++) {
      const a0 = startA + ((endA - startA) * k) / n;
      const a1 = startA + ((endA - startA) * (k + 1)) / n;
      const am = (a0 + a1) / 2;
      const c = new Vector3(centre.x + Math.cos(am) * radius, centre.y + Math.sin(am) * radius, 0);
      const tangent = new Vector3(-Math.sin(am), Math.cos(am), 0);
      const radial = new Vector3(Math.cos(am), Math.sin(am), 0);
      const len = radius * Math.abs(a1 - a0) * 0.5 - 0.015;
      cuboid(stone, rot3(c), dirW(tangent.x * len, tangent.y * len, 0), dirW(radial.x * (t / 2), radial.y * (t / 2), 0), dirW(0, 0, depth / 2), tone(), 1.2);
    }
  }
  const apex = spring + Math.sqrt((span + t) ** 2 - (span / 2) ** 2);
  const inner = spring + Math.sqrt(span ** 2 - (span / 2) ** 2);
  return { top: at.y + apex + 0.3, opening: { centre: rot3(new Vector3(0, inner / 2, -0.05)), width: span, height: inner } };
}


// ---------- the terrace ----------

/** A rough shard of rock (a jittered double pyramid), for the stones drifting round the island. */
function shard(b: Builder, c: Vector3, size: number, r: () => number) {
  const n = 5;
  const ring = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 + r() * 0.4;
    const k = size * (0.7 + r() * 0.5);
    return b.vert(c.x + Math.cos(a) * k, c.y + (r() - 0.5) * size * 0.3, c.z + Math.sin(a) * k, i / n, 0.5, [0.8, 0.78, 0.84]);
  });
  const top = b.vert(c.x + (r() - 0.5) * size * 0.3, c.y + size * (0.5 + r() * 0.4), c.z, 0.5, 1, [0.95, 0.94, 1]);
  const tip = b.vert(c.x + (r() - 0.5) * size * 0.3, c.y - size * (1.3 + r() * 0.9), c.z, 0.5, 0, [0.45, 0.44, 0.5]);
  for (let i = 0; i < n; i++) {
    b.tri(ring[i]!, ring[(i + 1) % n]!, top);
    b.tri(ring[(i + 1) % n]!, ring[i]!, tip);
  }
}

/** The glow in an archway's opening: a soft pointed shape, square to the view. */
function portalGlow(o: { centre: Vector3; width: number; height: number }): { mesh: Mesh; dispose: () => void } {
  const m = new MeshBasicMaterial({ map: portalMap(), color: new Color("#b9b3ff"), transparent: true, opacity: 0.42, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, fog: true });
  const g = new BufferGeometry();
  const hw = o.width / 2 - 0.05, hh = o.height / 2;
  g.setAttribute("position", new BufferAttribute(new Float32Array([o.centre.x - hw, o.centre.y - hh, o.centre.z, o.centre.x + hw, o.centre.y - hh, o.centre.z, o.centre.x + hw, o.centre.y + hh, o.centre.z, o.centre.x - hw, o.centre.y + hh, o.centre.z]), 3));
  g.setAttribute("uv", new BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const mesh = new Mesh(g, m);
  mesh.name = "archway-glow";
  mesh.renderOrder = 3;
  return { mesh, dispose: () => { g.dispose(); m.dispose(); } };
}

interface Centre {
  readonly top: number;
  readonly extras?: readonly Mesh[] | readonly Group[];
  readonly animate?: (t: number) => void;
  readonly dispose?: () => void;
}

/** An observatory: a round stone tower under a verdigris dome, its shutter open on a telescope; an armillary sphere in front. */
function observatory(stone: Builder, metal: Builder, iron: Builder, at: Vector3, glows: Dressed["glows"], front: Vector3, ringMat: Material): Centre {
  const tr = 2.0, th = 4.3;
  drum(stone, at.x, at.y - 0.2, at.z, tr, th + 0.2, 20, [0.86, 0.84, 0.9], 2.2);
  box(stone, frameAt(at.x, at.y, at.z, 0), 0, th - 0.05, 0, tr * 2 + 0.3, 0.2, tr * 2 + 0.3, [0.76, 0.74, 0.8]);
  dome(metal, at.x, at.y + th + 0.12, at.z, tr + 0.08, 0.96, 20, [0.42, 0.6, 0.58], 7);
  // The open shutter: a dark band up the front of the dome, and the telescope tilted up through it.
  const R = tr + 0.12;
  const F = frameAt(at.x, at.y + th + 0.12, at.z, 0);
  for (let k = 0; k < 6; k++) {
    const p0 = (k / 6) * 1.25, p1 = ((k + 1) / 6) * 1.25;
    face(iron, F, [[-0.32, Math.sin(p0) * R * 0.96, Math.cos(p0) * R], [0.32, Math.sin(p0) * R * 0.96, Math.cos(p0) * R], [0.32, Math.sin(p1) * R * 0.96, Math.cos(p1) * R], [-0.32, Math.sin(p1) * R * 0.96, Math.cos(p1) * R]], [[0, 0], [1, 0], [1, 1], [0, 1]], [1, 1, 1]);
  }
  tube(iron, [new Vector3(at.x, at.y + th + 0.9, at.z + 0.2), new Vector3(at.x - 0.35, at.y + th + 2.2, at.z + 1.9)], [0.24, 0.17], 10);
  glows.push({ position: new Vector3(at.x, at.y + th + 1.0, at.z + R), size: 1.5, color: "#a9b6ff" });
  // Two narrow lit windows in the tower.
  for (const dx of [-0.75, 0.75]) box(iron, frameAt(at.x + dx, at.y, at.z + tr * Math.cos(Math.asin(dx / tr)) + 0.02, 0), 0, 1.6, 0, 0.32, 1.1, 0.04, [1, 1, 1]);
  glows.push({ position: new Vector3(at.x, at.y + 2.1, at.z + tr + 0.1), size: 0.9 });
  // The armillary sphere: three bronze rings that turn slowly on a stone plinth.
  drum(stone, front.x, front.y - 0.1, front.z, 0.42, 1.05, 12, [0.8, 0.78, 0.84], 1.2);
  const rings = new Builder();
  hoop(rings, new Vector3(0, 0, 0), new Vector3(1, 0, 0), new Vector3(0, 1, 0), 0.82, 0.035, 32, 4, [0.95, 0.72, 0.42]);
  hoop(rings, new Vector3(0, 0, 0), new Vector3(0, 0, 1), new Vector3(0, 1, 0), 0.76, 0.035, 32, 4, [0.95, 0.72, 0.42]);
  hoop(rings, new Vector3(0, 0, 0), new Vector3(1, 0, 0), new Vector3(0, 0.42, 0.91).normalize(), 0.7, 0.03, 32, 4, [0.95, 0.72, 0.42]);
  const g = rings.geometry();
  const sphere = new Group();
  sphere.position.set(front.x, front.y + 1.95, front.z);
  const ringMesh = new Mesh(g, ringMat);
  sphere.add(ringMesh);
  return { top: at.y + th + 2.4, extras: [sphere], animate: (t) => { ringMesh.rotation.y = t * 0.12; }, dispose: () => g.dispose() };
}

/** A broken colonnade: columns of every height, a fragment of architrave on two, a drum fallen on the terrace, ivy. */
function ruins(stone: Builder, leaves: Builder, at: Vector3, r: () => number, height: (x: number, z: number) => number): Centre {
  const heights = [4.4, 4.4, 3.0, 4.4, 1.5, 2.6];
  const xs = heights.map((_, i) => at.x - 3.1 + i * 1.24);
  let top = at.y + 5;
  heights.forEach((h, i) => {
    const x = xs[i]!, f = frameAt(x, at.y, at.z, 0);
    box(stone, f, 0, -0.1, 0, 0.82, 0.34, 0.82, [0.86, 0.84, 0.88], 1.2);
    tube(stone, [new Vector3(x, at.y + 0.2, at.z), new Vector3(x, at.y + h * 0.5, at.z), new Vector3(x, at.y + h, at.z)], [0.34, 0.31, 0.29], 12, 0.5);
    if (h > 4) box(stone, f, 0, h, 0, 0.86, 0.32, 0.86, [0.9, 0.88, 0.92], 1.2);
    for (let k = 0; k < Math.round(h * 2); k++) leafCard(leaves, x + (r() - 0.5) * 0.5, at.y + 0.4 + r() * h * 0.8, at.z + 0.32 + r() * 0.08, 0.5 + r() * 0.3, r() * Math.PI, AUTUMN[Math.floor(r() * AUTUMN.length)]!, false);
  });
  box(stone, frameAt((xs[0]! + xs[1]!) / 2, at.y + 4.72, at.z, 0), 0, 0, 0, 2.2, 0.55, 0.9, [0.88, 0.86, 0.9], 1.2);
  box(stone, frameAt(xs[3]! + 0.25, at.y + 4.72, at.z, 0.08), 0, 0, 0, 1.3, 0.55, 0.9, [0.84, 0.82, 0.86], 1.2);
  const fx = at.x + 1.6, fz = at.z + 3.4;
  tube(stone, [new Vector3(fx - 0.8, height(fx, fz) + 0.3, fz - 0.2), new Vector3(fx + 0.8, height(fx, fz) + 0.3, fz + 0.3)], [0.3, 0.3], 12, 0.5);
  top = Math.max(top, at.y + 5.3);
  return { top };
}

/** A rotunda: a ring of columns under a shallow dome, a lectern inside lit by one candle. */
function rotunda(stone: Builder, slate: Builder, wood: Builder, at: Vector3, glows: Dressed["glows"]): Centre {
  const rr = 2.45, ch = 3.7, n = 8;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.PI / n;
    const x = at.x + Math.cos(a) * rr, z = at.z + Math.sin(a) * rr;
    tube(stone, [new Vector3(x, at.y, z), new Vector3(x, at.y + ch, z)], [0.25, 0.22], 10, 0.5);
    box(stone, frameAt(x, at.y, z, -a), 0, -0.05, 0, 0.6, 0.25, 0.6, [0.88, 0.86, 0.9]);
    box(stone, frameAt(x, at.y, z, -a), 0, ch, 0, 0.58, 0.22, 0.58, [0.9, 0.88, 0.92]);
  }
  // The entablature: an octagon of blocks round the column tops.
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2 + Math.PI / n, a1 = ((i + 1) / n) * Math.PI * 2 + Math.PI / n;
    const x0 = at.x + Math.cos(a0) * rr, z0 = at.z + Math.sin(a0) * rr, x1 = at.x + Math.cos(a1) * rr, z1 = at.z + Math.sin(a1) * rr;
    box(stone, frameAt((x0 + x1) / 2, at.y + ch + 0.2, (z0 + z1) / 2, Math.atan2(x1 - x0, z1 - z0) + Math.PI / 2), 0, 0, 0, Math.hypot(x1 - x0, z1 - z0) + 0.5, 0.5, 0.62, [0.88, 0.86, 0.9], 1.2);
  }
  dome(slate, at.x, at.y + ch + 0.66, at.z, rr + 0.45, 0.55, 20, [0.86, 0.86, 0.94], 6);
  box(wood, frameAt(at.x, at.y, at.z, 0), 0, 0, 0, 0.6, 1.15, 0.45, [0.6, 0.44, 0.34], 1.2);
  glows.push({ position: new Vector3(at.x, at.y + 1.45, at.z + 0.1), size: 0.6 });
  return { top: at.y + ch + 0.66 + (rr + 0.45) * 0.55 + 0.6 };
}

function dressSky(s: IslandShape, gm: GenericMaterials, km: KitMaterials, theme: Theme): Dressed {
  const { r, R, height } = s;
  const B = newBuilders();
  const iron = new Builder(), glass = new Builder(), bark = new Builder(), leaves = new Builder(), terrace = new Builder(), water = new Builder(), stone = new Builder(), metal = new Builder(), wood = new Builder(), rocks = new Builder();
  const glows: Dressed["glows"] = [];
  const extras: (Mesh | Group)[] = [];
  const disposers: (() => void)[] = [];
  const movers: ((t: number) => void)[] = [];
  // The terrace: a round paved floor, raised a hand's height on a kerb.
  const ty = height(0, -1) + 0.1;
  const tr = R * 0.6;
  disc(terrace, 0, ty, -1, tr, 48, [0.74, 0.72, 0.8], undefined, 3);
  for (let i = 0; i < 40; i++) {
    const a0 = (i / 40) * Math.PI * 2, a1 = ((i + 1) / 40) * Math.PI * 2;
    const x0 = Math.cos(a0) * tr, z0 = -1 + Math.sin(a0) * tr, x1 = Math.cos(a1) * tr, z1 = -1 + Math.sin(a1) * tr;
    box(B.trim, frameAt((x0 + x1) / 2, ty - 0.35, (z0 + z1) / 2, Math.atan2(x1 - x0, z1 - z0) + Math.PI / 2), 0, 0, 0, Math.hypot(x1 - x0, z1 - z0) + 0.04, 0.47, 0.32, [0.66, 0.64, 0.72]);
  }
  // The dais: three stepped drums at the back of the terrace.
  const dz = -R * 0.32;
  let y = ty;
  for (const [rad, step] of [[4.5, 0.36], [3.6, 0.36], [2.75, 0.36]] as const) {
    drum(stone, 0, y - 0.02, dz, rad, step + 0.02, 28, [0.84, 0.82, 0.9], 2);
    y += step;
  }
  const top0 = new Vector3(0, y, dz);
  // The long pool, from the foot of the dais to the front of the terrace, edged in stone and lined with candles.
  const z0 = dz + 4.9, z1 = -1 + tr - 0.6;
  const pw = 1.25;
  const wv = [water.vert(-pw, ty + 0.03, z0, 0, 0), water.vert(pw, ty + 0.03, z0, 1, 0), water.vert(pw, ty + 0.03, z1, 1, 1), water.vert(-pw, ty + 0.03, z1, 0, 1)];
  water.quad(wv[3]!, wv[2]!, wv[1]!, wv[0]!);
  for (const sx of [-1, 1]) box(B.trim, frameAt(sx * (pw + 0.17), ty, (z0 + z1) / 2, 0), 0, -0.05, 0, 0.34, 0.2, z1 - z0 + 0.68, [0.78, 0.76, 0.84]);
  for (const z of [z0 - 0.17, z1 + 0.17]) box(B.trim, frameAt(0, ty, z, 0), 0, -0.05, 0, pw * 2 + 0.68, 0.2, 0.34, [0.78, 0.76, 0.84]);
  for (let k = 0; k < 5; k++) {
    const z = z0 + 0.6 + (k / 4) * (z1 - z0 - 1.2);
    for (const sx of [-1, 1]) {
      drum(B.trim, sx * (pw + 0.17), ty + 0.15, z, 0.06, 0.2 + ((k * 7) % 3) * 0.07, 6, [1.1, 1.05, 0.95], 1);
      glows.push({ position: new Vector3(sx * (pw + 0.17), ty + 0.5 + ((k * 7) % 3) * 0.07, z), size: 0.42, color: "#ffc98a" });
    }
  }
  // Standing stones round the back and sides, open towards the viewer.
  const ring = R * 0.8;
  for (let i = 0; i < 9; i++) {
    const a = Math.PI * (1.02 + (i / 8) * 0.96) + (r() - 0.5) * 0.06;
    const x = Math.cos(a) * ring, z = Math.sin(a) * ring;
    const h = 2.1 + r() * 1.6;
    const lean = (r() - 0.5) * 0.12;
    const yb = height(x, z) - 0.3;
    const tang = new Vector3(-Math.sin(a), 0, Math.cos(a));
    cuboid(stone, new Vector3(x, yb + h / 2, z), tang.clone().multiplyScalar(0.45 + r() * 0.15), new Vector3(lean, 1, 0).normalize().multiplyScalar(h / 2), new Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(0.32), [0.82 + r() * 0.1, 0.8 + r() * 0.1, 0.88], 1.4);
  }
  // Lanterns at the foot of the dais.
  let lamp = new Vector3();
  for (const sx of [-1, 1]) {
    const lx = sx * 3.4, lz = dz + 4.3;
    const head = lampPost(iron, glass, new Vector3(lx, ty, lz), 2.1, 0.16, 0.22);
    glows.push({ position: head, size: 1.2 });
    if (sx > 0) lamp = head;
  }
  // The centrepiece.
  let top = y + 6;
  if (theme === "observatory") {
    const c = observatory(stone, metal, iron, top0.clone().add(new Vector3(0, 0, -0.4)), glows, new Vector3(-3.0, ty, dz + 3.4), km.metal);
    top = c.top;
    extras.push(...(c.extras ?? []));
    if (c.animate) movers.push(c.animate);
    if (c.dispose) disposers.push(c.dispose);
  } else if (theme === "ruins") {
    top = ruins(stone, leaves, top0, r, height).top;
  } else if (theme === "forum") {
    top = rotunda(stone, B.slate, wood, top0, glows).top;
  } else {
    const a = archway(stone, top0.clone().add(new Vector3(0, -0.05, -0.2)), 0, r);
    top = a.top;
    const p = portalGlow(a.opening);
    extras.push(p.mesh);
    disposers.push(p.dispose);
  }
  // Stones drifting round the island, turning very slowly while the scene moves.
  for (let i = 0; i < 7; i++) {
    const a = Math.PI * 2 * (i / 7) + r() * 0.5;
    const rr = R * (1.08 + r() * 0.22);
    shard(rocks, new Vector3(Math.cos(a) * rr, 2.5 + r() * 7, Math.sin(a) * rr), 0.55 + r() * 0.75, r);
  }
  const drift = new Group();
  const rockGeo = rocks.geometry();
  const rockMesh = new Mesh(rockGeo, gm.rock);
  drift.add(rockMesh);
  extras.push(drift);
  disposers.push(() => rockGeo.dispose());
  movers.push((t) => {
    drift.rotation.y = t * 0.018;
    drift.position.y = Math.sin(t * 0.4) * 0.35;
  });
  // Two old trees outside the ring of stones.
  for (const sx of [-1, 1]) {
    const x = sx * R * (0.62 + r() * 0.1), z = R * (0.02 + r() * 0.16);
    top = Math.max(top, tree(bark, leaves, r, new Vector3(x, 0, z), height(x, z) - 0.1, AUTUMN, 0.85));
  }
  rimGreenery(leaves, s, Math.PI / 2);
  return {
    parts: [...finish(B, km, r), [terrace, gm.plaza, true], [stone, km.arch, true], [water, km.water, false], [metal, km.metal, true], [wood, km.wood, true], [iron, gm.iron, true], [glass, gm.glass, false], [bark, gm.bark, true], [leaves, gm.leaves, true]],
    lamp, glows, top, extras,
    animate: (t) => {
      for (const m of movers) m(t);
    },
    dispose: () => {
      for (const d of disposers) d();
    },
  };
}

export function neutralSite(theme: Theme): Site {
  return { base: { dome: 0.12, bumps: 0.06, tint: [0.7, 0.78, 0.84], radius: [15, 17], boulders: 3 }, top: "grass", dress: (s, gm, km) => dressSky(s, gm, km, theme) };
}
