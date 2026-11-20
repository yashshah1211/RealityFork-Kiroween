/**
 * Energy and environment: island settings built from shared modules (kitParts.ts, generic.ts). The home (a stone
 * cottage whose roof panels, battery and heat pump appear only where the path's own figures say so), wind on the hills,
 * a river and its banks, woodland and farmland. Presentation only: every detail comes from pathScenery (resolve.ts).
 */
import { Group, Mesh, Vector3, type BufferGeometry } from "three";
import type { Prop, Theme } from "../environment/resolve";
import { AUTUMN, Builder, lampPost, leafCard, rimGreenery, stonePath, tree, tube, type GenericMaterials, type IslandShape } from "./generic";
import { box, cone, disc, dome, drum, face, finish, frameAt, hoop, house, newBuilders, pane, strip, toWorld, type Builders, type Col, type Dressed, type Frame, type Site, type V3 } from "./kitParts";
import { CELL, type KitMaterials } from "./kitMaterials";

// ---------- energy and environment ----------

export const MEADOW: readonly Col[] = [[0.42, 0.55, 0.16], [0.6, 0.62, 0.2], [0.75, 0.55, 0.16], [0.3, 0.45, 0.14], [0.68, 0.45, 0.12]].map((c) => [c[0]! ** 2.2, c[1]! ** 2.2, c[2]! ** 2.2] as const);

/** Solar modules laid on the front slope of a roof: rows up the slope, columns along it, a hand's width above the slates. */
export function solarArray(b: Builder, f: Frame, w: number, d: number, h: number, rise: number) {
  const wz = d / 2;
  const L = Math.hypot(rise, wz);
  const up = new Vector3(0, rise / L, -wz / L);
  const n = new Vector3(0, wz / L, rise / L);
  const pw = 1.0, ph = 1.6, gap = 0.06;
  const cols = Math.max(1, Math.floor((w - 1.0) / (pw + gap)));
  const rows = Math.max(1, Math.min(2, Math.floor((L - 0.7) / (ph + gap))));
  const x0 = -((cols * (pw + gap) - gap) / 2);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const base = new Vector3(0, h, wz).addScaledVector(up, 0.4 + j * (ph + gap)).addScaledVector(n, 0.07);
      const lx0 = x0 + i * (pw + gap), lx1 = lx0 + pw;
      const p0 = base.clone().setX(lx0);
      const p1 = base.clone().setX(lx1);
      const p2 = p1.clone().addScaledVector(up, ph);
      const p3 = p0.clone().addScaledVector(up, ph);
      face(b, f, [[p0.x, p0.y, p0.z], [p1.x, p1.y, p1.z], [p2.x, p2.y, p2.z], [p3.x, p3.y, p3.z]], [[0, 0], [1, 0], [1, 1], [0, 1]], [1, 1, 1]);
    }
  }
}

/**
 * A meadow island with a stone cottage, a shed, dry-stone walls and a lit path. Solar modules on the roof, a battery on
 * the wall and a heat pump by the door appear only when the path's own figures (or name) say so (pathScenery).
 */
export function dressCottage(s: IslandShape, gm: GenericMaterials, km: KitMaterials, props: readonly Prop[]): Dressed {
  const { r, R, height } = s;
  const B = newBuilders();
  const iron = new Builder();
  const glass = new Builder();
  const bark = new Builder();
  const leaves = new Builder();
  const paving = new Builder();
  const solar = new Builder();
  const metal = new Builder();
  const led = new Builder();
  const glows: Dressed["glows"] = [];
  const cx = (r() - 0.5) * 3, cz = -2.4 - r() * 1.6;
  const rot = (r() - 0.5) * 0.36;
  const ground = height(cx, cz);
  const f = frameAt(cx, ground, cz, rot);
  const w = 7.6 + r() * 1.2, d = 5.3, h = 3.1, rise = 2.7;
  house(B, f, { w, d, h, floors: 1, rise, wall: "stone", tint: [0.95, 0.9, 0.82], roofTint: [1, 1, 1.04], chimney: r() < 0.5 ? -1 : 1, door: true, sides: true });
  if (props.includes("solar")) solarArray(solar, f, w, d, h, rise);
  // A lean-to shed at one end.
  const side = r() < 0.5 ? -1 : 1;
  const [sx, , sz] = toWorld(f, side * (w / 2 + 1.5), 0, 0.4);
  const sf = frameAt(sx, height(sx, sz), sz, rot);
  box(B.plaster, sf, 0, -0.8, 0, 2.6, 3.0, 2.6, [0.62, 0.6, 0.58]);
  face(B.slate, sf, [[-1.5, 2.25, 1.5], [1.5, 2.25, 1.5], [1.5, 2.75, -1.5], [-1.5, 2.75, -1.5]], [[0, 0], [1.5, 0], [1.5, 1.5], [0, 1.5]], [0.9, 0.9, 0.95]);
  B.panes.push(pane(sf, "front", 2.6, 2.6, 0, 1.0, 0.9, 1.9, true));
  // The battery: a white wall unit beside the door, its small status light the only blue light on the island.
  // It stands against the end wall away from the shed, facing the front.
  if (props.includes("battery")) {
    const bx = -side * (w / 2 + 0.5), bz = d / 2 - 0.55;
    box(metal, f, bx, -0.2, bz, 0.66, 1.3, 0.34, [0.95, 0.96, 1]);
    box(metal, f, bx, 1.1, bz, 0.74, 0.06, 0.42, [0.7, 0.72, 0.78]);
    box(led, f, bx, 0.86, bz + 0.18, 0.14, 0.05, 0.02, [1, 1, 1]);
    const [lx, ly, lz] = toWorld(f, bx, 0.88, bz + 0.22);
    glows.push({ position: new Vector3(lx, ly, lz), size: 0.5, color: "#59d8c6" });
  }
  // A heat pump: an outdoor unit with a dark fan grille, on the ground in front of the wall at the shed's end.
  if (props.includes("heatpump")) {
    const hx = side * (w / 2 - 1.15), hz = d / 2 + 0.5;
    box(metal, f, hx, -0.05, hz, 1.05, 0.85, 0.42, [0.84, 0.86, 0.9]);
    box(iron, f, hx - 0.16, 0.12, hz + 0.22, 0.56, 0.56, 0.02, [1, 1, 1]);
    for (const k of [-0.2, 0, 0.2]) box(metal, f, hx - 0.16, 0.38 + k, hz + 0.24, 0.6, 0.03, 0.02, [0.6, 0.62, 0.66]);
  }
  // The path from the front edge to the door, with two low garden lights.
  const [dx, , dz] = toWorld(f, 0, 0, d / 2 + 0.8);
  const pathPts = stonePath(paving, s, new Vector3(dx, 0, dz), 0.7);
  let lamp = new Vector3(dx, ground + 1, dz);
  [0.35, 0.7].forEach((t, i) => {
    const q = pathPts[Math.round(t * (pathPts.length - 1))]!;
    const off = (i % 2 ? 1 : -1) * 1.15;
    const head = lampPost(iron, glass, new Vector3(q.x + off, height(q.x + off, q.z), q.z), 0.85, 0.13, 0.17);
    glows.push({ position: head, size: 0.95 });
    if (i === 1) lamp = head;
  });
  // A porch light over the door.
  const [px, py, pz] = toWorld(f, 0.9, 2.45, d / 2 + 0.25);
  glows.push({ position: new Vector3(px, py, pz), size: 1.1 });
  // Dry-stone walls round the garden, open where the path comes in.
  const wallR = R * 0.74;
  const keep = Math.atan2(pathPts[0]!.z, pathPts[0]!.x);
  for (let i = 0; i < 40; i++) {
    const t0 = Math.PI * (-0.15 + (i / 40) * 1.3);
    const t1 = Math.PI * (-0.15 + ((i + 1) / 40) * 1.3);
    if (Math.abs(Math.atan2(Math.sin(t0 - keep), Math.cos(t0 - keep))) < 0.2) continue;
    const ax = Math.cos(t0) * wallR, az = Math.sin(t0) * wallR, bx = Math.cos(t1) * wallR, bz = Math.sin(t1) * wallR;
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    const tone = 0.75 + r() * 0.2;
    box(B.stone, frameAt(mx, height(mx, mz), mz, Math.atan2(bx - ax, bz - az) + Math.PI / 2), 0, -0.3, 0, Math.hypot(bx - ax, bz - az) + 0.05, 0.85 + r() * 0.12, 0.5, [tone, tone, tone * 1.02], 1.2);
  }
  // A pond that holds the sky, ringed with reeds, on the side away from the path.
  const water = new Builder();
  // In front, to one side of the path, so the view always finds it.
  const pa = Math.PI / 2 + (r() < 0.5 ? 1 : -1) * (0.85 + r() * 0.25);
  const pond = new Vector3(Math.cos(pa) * R * 0.52, 0, Math.sin(pa) * R * 0.52);
  const pr = 2.3 + r() * 0.8;
  const waterY = height(pond.x, pond.z) + 0.07;
  const centreV = water.vert(pond.x, waterY, pond.z, 0.5, 0.5);
  const ring: number[] = [];
  for (let i = 0; i <= 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    const rr = pr * (1 + 0.12 * Math.sin(a * 3 + pa) + 0.06 * Math.sin(a * 5));
    ring.push(water.vert(pond.x + Math.cos(a) * rr, waterY, pond.z + Math.sin(a) * rr * 0.8, 0, 0));
  }
  for (let i = 0; i < 28; i++) water.tri(centreV, ring[i + 1]!, ring[i]!);
  for (let i = 0; i < 26; i++) {
    const a = r() * Math.PI * 2;
    const rr = pr * (1.02 + r() * 0.12);
    leafCard(leaves, pond.x + Math.cos(a) * rr, waterY + 0.3, pond.z + Math.sin(a) * rr * 0.8, 0.5 + r() * 0.3, r() * Math.PI, MEADOW[Math.floor(r() * 2)]!, false);
  }
  // Trees in green and gold, enough to read as the edge of a wood; hedges along the rim.
  let topY = h + rise + 2;
  const taken = [new Vector3(cx, 0, cz), pond, ...pathPts.filter((_, i) => i % 4 === 0)];
  const trees = 4 + Math.floor(r() * 3);
  for (let k = 0; k < trees; k++) {
    let at = new Vector3();
    for (let tries = 0; tries < 30; tries++) {
      const a = r() * Math.PI * 2;
      const rr = R * (0.45 + r() * 0.35);
      at = new Vector3(Math.cos(a) * rr, 0, Math.sin(a) * rr);
      if (taken.every((q) => Math.hypot(q.x - at.x, q.z - at.z) > (q === taken[0] ? 6.5 : 3.6))) break;
    }
    taken.push(at);
    topY = Math.max(topY, tree(bark, leaves, r, at, height(at.x, at.z) - 0.1, MEADOW));
  }
  rimGreenery(leaves, s, keep, MEADOW);
  return {
    parts: [...finish(B, km, r, 0.5), [paving, gm.paving, true], [iron, gm.iron, true], [glass, gm.glass, false], [bark, gm.bark, true], [leaves, gm.leaves, true], [solar, km.solar, true], [metal, km.metal, true], [led, km.led, false], [water, km.water, false]],
    lamp, glows, top: topY,
  };
}


// ---------- shared by the settings below ----------

const gamma = (c: Col): Col => [c[0] ** 2.2, c[1] ** 2.2, c[2] ** 2.2];
/** Somewhere free on the island top (at least `gap` metres from everything taken), or the last try. */
function freeSpot(s: IslandShape, taken: readonly Vector3[], gap: number, from = 0.25, to = 0.8): Vector3 {
  let at = new Vector3();
  for (let tries = 0; tries < 40; tries++) {
    const a = s.r() * Math.PI * 2;
    const rr = s.R * (from + s.r() * (to - from));
    at = new Vector3(Math.cos(a) * rr, 0, Math.sin(a) * rr);
    if (taken.every((q) => Math.hypot(q.x - at.x, q.z - at.z) > gap)) break;
  }
  return at;
}

/** A dry-stone wall along an arc of the island (fractions of a turn, from the right going behind), with gaps. */
function stoneWall(b: Builder, s: IslandShape, radius: number, from: number, to: number, gaps: readonly number[] = []) {
  const n = 36;
  for (let i = 0; i < n; i++) {
    const t0 = Math.PI * 2 * (from + ((to - from) * i) / n), t1 = Math.PI * 2 * (from + ((to - from) * (i + 1)) / n);
    if (gaps.some((g) => Math.abs(Math.atan2(Math.sin(t0 - g), Math.cos(t0 - g))) < 0.18)) continue;
    const ax = Math.cos(t0) * radius, az = Math.sin(t0) * radius, bx = Math.cos(t1) * radius, bz = Math.sin(t1) * radius;
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    const tone = 0.72 + s.r() * 0.2;
    box(b, frameAt(mx, s.height(mx, mz), mz, Math.atan2(bx - ax, bz - az) + Math.PI / 2), 0, -0.3, 0, Math.hypot(bx - ax, bz - az) + 0.05, 0.8 + s.r() * 0.15, 0.5, [tone, tone, tone * 1.02], 1.2);
  }
}

/** Two low path lights along a path; returns the nearer one's head. */
function pathLights(iron: Builder, glass: Builder, s: IslandShape, pathPts: readonly Vector3[], glows: Dressed["glows"]): Vector3 {
  let lamp = pathPts[pathPts.length - 1]!.clone();
  [0.35, 0.72].forEach((t, i) => {
    const q = pathPts[Math.round(t * (pathPts.length - 1))]!;
    const off = (i % 2 ? 1 : -1) * 1.15;
    const head = lampPost(iron, glass, new Vector3(q.x + off, s.height(q.x + off, q.z), q.z), 0.85, 0.13, 0.17);
    glows.push({ position: head, size: 0.95 });
    if (i === 1) lamp = head;
  });
  return lamp;
}

// ---------- wind on the hills ----------

/** Three tapered blades round a nose cone, turning about local z (facing local +z). */
function rotorGeometry(L: number): BufferGeometry {
  const b = new Builder();
  const col: Col = [0.94, 0.95, 0.98];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    const c = Math.cos(a), sn = Math.sin(a);
    const P = (x: number, y: number, z: number) => b.vert(x * c - y * sn, x * sn + y * c, z, 0, 0, col);
    const v = [P(-0.3, 0.45, 0.06), P(0.3, 0.45, 0.06), P(0.07, L, 0.03), P(-0.05, L, 0.03), P(0.3, 0.45, -0.06), P(-0.3, 0.45, -0.06), P(-0.05, L, -0.03), P(0.07, L, -0.03)];
    b.quad(v[0]!, v[1]!, v[2]!, v[3]!);
    b.quad(v[4]!, v[5]!, v[6]!, v[7]!);
    b.quad(v[1]!, v[4]!, v[7]!, v[2]!);
    b.quad(v[5]!, v[0]!, v[3]!, v[6]!);
  }
  const apex = b.vert(0, 0, 1.0, 0, 0, col);
  const ring: number[] = [];
  for (let i = 0; i <= 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    ring.push(b.vert(Math.cos(a) * 0.48, Math.sin(a) * 0.48, -0.25, 0, 0, col));
  }
  for (let i = 0; i < 10; i++) b.tri(ring[i]!, ring[i + 1]!, apex);
  return b.geometry();
}

/** A grassy hilltop with slender turbines on the crest, a stone bothy below them and a wall along the slope. */
function dressWind(s: IslandShape, gm: GenericMaterials, km: KitMaterials): Dressed {
  const { r, R, height } = s;
  const B = newBuilders();
  const iron = new Builder(), glass = new Builder(), bark = new Builder(), leaves = new Builder(), paving = new Builder(), metal = new Builder();
  const glows: Dressed["glows"] = [];
  const yaw = 0.38;
  const L = 5.6;
  const rotorGeo = rotorGeometry(L);
  const rotors: { mesh: Mesh; phase: number; speed: number }[] = [];
  const extras: Group[] = [];
  let topY = 10;
  const spots: [number, number, number][] = [[-0.44, -0.3, 13.2], [0.06, -0.5, 15.4], [0.52, -0.16, 12.6]];
  for (const [fx, fz, H0] of spots) {
    const x = fx * R + (r() - 0.5) * 1.2, z = fz * R + (r() - 0.5) * 1.2;
    const y0 = height(x, z);
    const H = H0 + r() * 1.2;
    tube(metal, [new Vector3(x, y0 - 0.6, z), new Vector3(x, y0 + H * 0.45, z), new Vector3(x, y0 + H, z)], [0.52, 0.38, 0.25], 12);
    const f = frameAt(x, y0 + H, z, yaw);
    box(metal, f, 0, -0.4, -0.3, 0.86, 0.86, 2.4, [0.9, 0.91, 0.95]);
    const [hx, hy, hz] = toWorld(f, 0, 0.03, 1.12);
    const pivot = new Group();
    pivot.position.set(hx, hy, hz);
    pivot.rotation.y = yaw;
    const mesh = new Mesh(rotorGeo, km.metal);
    mesh.castShadow = true;
    const phase = r() * Math.PI * 2;
    mesh.rotation.z = phase;
    pivot.add(mesh);
    extras.push(pivot);
    rotors.push({ mesh, phase, speed: 0.55 + r() * 0.25 });
    // A dim red light on each nacelle, as turbines carry at night.
    const [lx, ly, lz] = toWorld(f, 0, 0.55, -1.2);
    glows.push({ position: new Vector3(lx, ly, lz), size: 0.42, color: "#ff5f52" });
    topY = Math.max(topY, y0 + H + L + 0.5);
  }
  // The bothy, low on the slope towards the viewer, and the path up to it.
  const bx = -R * 0.3 + (r() - 0.5) * 2, bz = R * 0.22;
  const rot = 0.25 + (r() - 0.5) * 0.2;
  const f = frameAt(bx, height(bx, bz), bz, rot);
  const w = 4.8, d = 3.9;
  house(B, f, { w, d, h: 2.6, floors: 1, rise: 2.0, wall: "stone", tint: [0.86, 0.84, 0.8], roofTint: [0.95, 0.97, 1.02], chimney: 1, door: true, sides: true });
  const [dx, , dz] = toWorld(f, 0, 0, d / 2 + 0.8);
  const pathPts = stonePath(paving, s, new Vector3(dx, 0, dz), 0.62);
  const lamp = pathLights(iron, glass, s, pathPts, glows);
  const [px, py, pz] = toWorld(f, 0.75, 2.15, d / 2 + 0.22);
  glows.push({ position: new Vector3(px, py, pz), size: 0.9 });
  stoneWall(B.stone, s, R * 0.8, 0.52, 0.98, [Math.atan2(pathPts[0]!.z, pathPts[0]!.x)]);
  // A few small trees bent by the wind, on the lee side.
  const taken = [new Vector3(bx, 0, bz), ...spots.map(([fx, fz]) => new Vector3(fx * R, 0, fz * R)), ...pathPts.filter((_, i) => i % 4 === 0)];
  for (let k = 0; k < 3; k++) {
    const at = freeSpot(s, taken, 4.5, 0.55, 0.82);
    taken.push(at);
    topY = Math.max(topY, tree(bark, leaves, r, at, height(at.x, at.z) - 0.1, MEADOW, 0.62));
  }
  rimGreenery(leaves, s, Math.atan2(pathPts[0]!.z, pathPts[0]!.x), MEADOW);
  return {
    parts: [...finish(B, km, r, 0.5), [paving, gm.paving, true], [iron, gm.iron, true], [glass, gm.glass, false], [bark, gm.bark, true], [leaves, gm.leaves, true], [metal, km.metal, true]],
    lamp, glows, top: topY, extras,
    animate: (t) => {
      for (const x of rotors) x.mesh.rotation.z = x.phase - t * x.speed;
    },
    dispose: () => rotorGeo.dispose(),
  };
}

// ---------- a river and its banks ----------

/** The mill's wheel: two rims, spokes and paddles round an axle along local z. */
function wheelGeometry(rad: number, width: number): BufferGeometry {
  const b = new Builder();
  const col: Col = [0.9, 0.86, 0.8];
  for (const z of [-width / 2, width / 2]) hoop(b, new Vector3(0, 0, z), new Vector3(1, 0, 0), new Vector3(0, 1, 0), rad, 0.07, 24, 5, col);
  hoop(b, new Vector3(0, 0, 0), new Vector3(1, 0, 0), new Vector3(0, 1, 0), 0.32, 0.12, 10, 5, col);
  const F = frameAt(0, 0, 0, 0);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const u = new Vector3(Math.cos(a), Math.sin(a), 0);
    for (const z of [-width / 2, width / 2]) {
      const c = u.clone().multiplyScalar(rad / 2).setZ(z);
      // a spoke: a thin bar from the hub to the rim
      const t = new Vector3(-u.y, u.x, 0);
      const p = [c.clone().addScaledVector(u, -rad / 2).addScaledVector(t, -0.05), c.clone().addScaledVector(u, rad / 2).addScaledVector(t, -0.05), c.clone().addScaledVector(u, rad / 2).addScaledVector(t, 0.05), c.clone().addScaledVector(u, -rad / 2).addScaledVector(t, 0.05)];
      face(b, F, p.map((q) => [q.x, q.y, q.z + 0.04] as const), [[0, 0], [1, 0], [1, 0.1], [0, 0.1]], col);
      face(b, F, [...p].reverse().map((q) => [q.x, q.y, q.z - 0.04] as const), [[0, 0], [1, 0], [1, 0.1], [0, 0.1]], col);
    }
  }
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2;
    const u = new Vector3(Math.cos(a), Math.sin(a), 0);
    const t = new Vector3(-u.y, u.x, 0);
    const c0 = u.clone().multiplyScalar(rad - 0.05), c1 = u.clone().multiplyScalar(rad + 0.38);
    // a paddle: a board between the rims, standing out from the wheel
    for (const sgn of [1, -1]) {
      const off = t.clone().multiplyScalar(0.03 * sgn);
      const q = [c0.clone().add(off).setZ(-width / 2), c1.clone().add(off).setZ(-width / 2), c1.clone().add(off).setZ(width / 2), c0.clone().add(off).setZ(width / 2)];
      face(b, F, (sgn > 0 ? q : [...q].reverse()).map((p) => [p.x, p.y, p.z] as const), [[0, 0], [0.3, 0], [0.3, 0.6], [0, 0.6]], col);
    }
  }
  return b.geometry();
}

/** A stream across a meadow, a stone mill with a turning wheel, a footbridge, willows; flood walls and wetland pools only where the path says so. */
function dressRiver(s: IslandShape, gm: GenericMaterials, km: KitMaterials, props: readonly Prop[]): Dressed {
  const { r, R, height, outline } = s;
  const B = newBuilders();
  const iron = new Builder(), glass = new Builder(), bark = new Builder(), leaves = new Builder(), paving = new Builder(), water = new Builder(), banks = new Builder(), wood = new Builder();
  const glows: Dressed["glows"] = [];
  // The mill, at the back, facing the viewer; the stream runs past its front wall.
  const xm = (r() - 0.5) * 3, zm = -R * 0.4;
  const mw = 6.2, md = 4.8;
  const mf = frameAt(xm, height(xm, zm), zm, 0);
  house(B, mf, { w: mw, d: md, h: 6.4, floors: 2, rise: 2.6, wall: "stone", tint: [0.9, 0.86, 0.8], roofTint: [1, 1, 1.03], chimney: -1, door: true, sides: true });
  const z0 = zm + md / 2 + 1.75;
  const half = 1.7;
  const zAt = (x: number) => z0 + 0.022 * (x - xm) ** 2;
  const inside = (x: number, z: number) => Math.hypot(x, z) < outline(Math.atan2(z, x)) * 0.97;
  // The water: a ribbon following the ground, with dark wet stones along both banks.
  const xs: number[] = [];
  for (let x = -R * 1.05; x <= R * 1.05; x += 0.6) if (inside(x, zAt(x) - half - 0.6) || inside(x, zAt(x) + half + 0.6)) xs.push(x);
  const rows: [number, number, number, number][] = [];
  for (const x of xs) {
    const z = zAt(x);
    const tz = 0.044 * (x - xm);
    const n = Math.hypot(1, tz);
    const [nx, nz] = [-tz / n, 1 / n];
    const pt = (o: number) => {
      const px = x + nx * o, pz = z + nz * o;
      return [px, height(px, pz) + 0.08, pz] as const;
    };
    const ids = [-half - 0.6, -half, half, half + 0.6].map((o) => pt(o));
    rows.push([
      banks.vert(ids[0]![0], ids[0]![1] - 0.02, ids[0]![2], x / 2, 0, [0.62, 0.6, 0.6]),
      water.vert(ids[1]![0], ids[1]![1], ids[1]![2], 0, 0),
      water.vert(ids[2]![0], ids[2]![1], ids[2]![2], 0, 0),
      banks.vert(ids[3]![0], ids[3]![1] - 0.02, ids[3]![2], x / 2, 0, [0.62, 0.6, 0.6]),
    ]);
  }
  // Bank strips need their own inner edge (separate builders): one more vertex each at the water's edge.
  const inner: [number, number][] = rows.map((row, i) => {
    const x = xs[i]!;
    const z = zAt(x);
    const tz = 0.044 * (x - xm);
    const n = Math.hypot(1, tz);
    const a = [x + (-tz / n) * -half, z + (1 / n) * -half], c = [x + (-tz / n) * half, z + (1 / n) * half];
    return [banks.vert(a[0]!, height(a[0]!, a[1]!) + 0.06, a[1]!, x / 2, 0.4, [0.4, 0.4, 0.44]), banks.vert(c[0]!, height(c[0]!, c[1]!) + 0.06, c[1]!, x / 2, 0.4, [0.4, 0.4, 0.44])];
  });
  for (let i = 0; i + 1 < rows.length; i++) {
    const a = rows[i]!, b = rows[i + 1]!, ia = inner[i]!, ib = inner[i + 1]!;
    water.quad(a[1], a[2], b[2], b[1]);
    banks.quad(a[0], ia[0], ib[0], b[0]);
    banks.quad(ia[1], a[3], b[3], ib[1]);
  }
  // Reeds along both banks, thicker away from the mill.
  for (let i = 0; i < 70; i++) {
    const x = xs[Math.floor(r() * xs.length)] ?? 0;
    if (Math.abs(x - xm) < mw / 2 + 0.5) continue;
    const side = r() < 0.5 ? -1 : 1;
    const z = zAt(x) + side * (half + 0.3 + r() * 0.7);
    if (!inside(x, z)) continue;
    leafCard(leaves, x, height(x, z) + 0.35, z, 0.55 + r() * 0.45, r() * Math.PI, MEADOW[Math.floor(r() * 2)]!, false);
  }
  // The wheel, dipping into the stream in front of the mill; it turns slowly while the scene moves.
  const wheelR = 1.95;
  const wx = xm + mw / 2 - 1.5;
  const wheelGeo = wheelGeometry(wheelR, 0.72);
  const wheelPivot = new Group();
  wheelPivot.position.set(wx, height(wx, zm + md / 2) + 1.25, zm + md / 2 + 0.8);
  const wheel = new Mesh(wheelGeo, km.wood);
  wheel.castShadow = true;
  wheelPivot.add(wheel);
  box(wood, frameAt(wx, height(wx, zm), zm + md / 2 + 0.4, 0), 0, 1.15, 0, 0.2, 0.2, 0.8, [0.7, 0.66, 0.6]);
  // The footbridge: an arched deck with parapets, crossing to the meadow at the front.
  const xb = xm + 6.5 + r() * 1.5;
  const zb = zAt(xb);
  const tz = 0.044 * (xb - xm);
  const ang = Math.atan2(1, -tz) - Math.PI / 2;
  const span = 2 * (half + 0.9);
  for (let k = 0; k < 8; k++) {
    const t = (k + 0.5) / 8;
    const o = -span / 2 + t * span;
    const x = xb + Math.sin(ang) * o, z = zb + Math.cos(ang) * o;
    const y = height(x, z) + 0.15 + 0.75 * Math.sin(Math.PI * t);
    const f = frameAt(x, y, z, ang);
    box(B.stone, f, 0, -0.25, 0, 1.7, 0.28, span / 8 + 0.04, [0.82, 0.8, 0.78], 1.2);
    for (const sx of [-0.85, 0.85]) box(B.stone, f, sx, 0.03, 0, 0.18, 0.5, span / 8 + 0.02, [0.74, 0.72, 0.72], 1.2);
  }
  // The path from the front edge to the bridge.
  const [ex, ez] = [xb + Math.sin(ang) * (span / 2 + 0.6), zb + Math.cos(ang) * (span / 2 + 0.6)];
  const pathPts = stonePath(paving, s, new Vector3(ex, 0, ez), 0.62);
  const lamp = pathLights(iron, glass, s, pathPts, glows);
  const [qx, qy, qz] = toWorld(mf, 0.95, 2.45, md / 2 + 0.25);
  glows.push({ position: new Vector3(qx, qy, qz), size: 1.0 });
  // Keep trees off the mill, its wheel and the bridge.
  const taken = [new Vector3(xm, 0, zm), new Vector3(wx, 0, zm + md / 2 + 1.6), new Vector3(xm - mw / 2, 0, zm + md / 2 + 1.6), new Vector3(xb, 0, zb), ...pathPts.filter((_, i) => i % 4 === 0)];
  // Flood walls: a stone wall along the front bank, open where the bridge lands.
  if (props.includes("levee")) {
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = xs[k]!, x1 = xs[Math.min(k + 2, xs.length - 1)]!;
      if (Math.abs((x0 + x1) / 2 - xb) < 1.6) continue;
      const pz0 = zAt(x0) + half + 1.05, pz1 = zAt(x1) + half + 1.05;
      if (!inside(x0, pz0) || !inside(x1, pz1)) continue;
      const mx = (x0 + x1) / 2, mz = (pz0 + pz1) / 2;
      const f = frameAt(mx, height(mx, mz), mz, Math.atan2(x1 - x0, pz1 - pz0) + Math.PI / 2);
      box(B.stone, f, 0, -0.5, 0, Math.hypot(x1 - x0, pz1 - pz0) + 0.04, 1.6, 0.55, [0.8, 0.79, 0.8], 1.2);
      box(B.trim, f, 0, 1.1, 0, Math.hypot(x1 - x0, pz1 - pz0) + 0.08, 0.14, 0.7, [0.7, 0.69, 0.7]);
    }
  }
  // Wetland: shallow pools among reeds and bulrushes in the meadow in front.
  if (props.includes("wetland")) {
    for (let k = 0; k < 5; k++) {
      const x = (r() - 0.5) * R * 1.2;
      const z = Math.min(R * 0.72, zAt(x) + half + 3.2 + r() * 5);
      if (!inside(x, z) || taken.some((q) => Math.hypot(q.x - x, q.z - z) < 2.6)) continue;
      const pr = 1.0 + r() * 0.9;
      const ph = r() * 6;
      disc(water, x, height(x, z) + 0.07, z, pr, 18, [1, 1, 1], (a) => 1 + 0.18 * Math.sin(a * 3 + ph) + 0.08 * Math.sin(a * 5));
      for (let j = 0; j < 16; j++) {
        const a = r() * Math.PI * 2, rr = pr * (1.05 + r() * 0.4);
        const rx = x + Math.cos(a) * rr, rz = z + Math.sin(a) * rr;
        leafCard(leaves, rx, height(rx, rz) + 0.4, rz, 0.6 + r() * 0.5, r() * Math.PI, MEADOW[Math.floor(r() * 3)]!, false);
        if (j % 4 === 0) tube(bark, [new Vector3(rx, height(rx, rz), rz), new Vector3(rx, height(rx, rz) + 1.1, rz)], [0.025, 0.02], 4);
      }
      taken.push(new Vector3(x, 0, z));
    }
  }
  // Willows on the banks.
  let topY = 6.4 + 2.6 + 1.5;
  for (let k = 0; k < 3; k++) {
    const x = (k - 1) * R * 0.55 + (r() - 0.5) * 2;
    const z = zAt(x) + (r() < 0.5 ? -1 : 1) * (half + 1.6);
    if (!inside(x, z) || taken.some((q) => Math.hypot(q.x - x, q.z - z) < 4)) continue;
    taken.push(new Vector3(x, 0, z));
    topY = Math.max(topY, tree(bark, leaves, r, new Vector3(x, 0, z), height(x, z) - 0.1, MEADOW, 0.9));
  }
  rimGreenery(leaves, s, Math.atan2(pathPts[0]!.z, pathPts[0]!.x), MEADOW);
  return {
    parts: [...finish(B, km, r, 0.5), [paving, gm.paving, true], [banks, gm.plaza, true], [water, km.water, false], [wood, km.wood, true], [iron, gm.iron, true], [glass, gm.glass, false], [bark, gm.bark, true], [leaves, gm.leaves, true]],
    lamp, glows, top: topY, extras: [wheelPivot],
    animate: (t) => {
      wheel.rotation.z = -t * 0.35;
    },
    dispose: () => wheelGeo.dispose(),
  };
}

// ---------- woodland ----------

/** A timber lookout tower: four raking legs, braces, a railed platform and a pyramid roof. Returns its roof's apex. */
function lookout(bark: Builder, wood: Builder, slate: Builder, f: Frame): number {
  const H = 7.4, base = 1.35, topW = 0.85;
  const leg = (sx: number, sz: number, h: number, wdt: number) => toWorld(f, sx * wdt, h, sz * wdt);
  const v = (p: readonly [number, number, number]) => new Vector3(p[0], p[1], p[2]);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) tube(bark, [v(leg(sx, sz, -0.3, base)), v(leg(sx, sz, H + 2.1, topW))], [0.14, 0.1], 6);
  for (const h of [2.4, 5.0]) {
    const k = h / H, wdt = base + (topW - base) * k;
    for (const [a, c] of [[[-1, -1], [1, 1]], [[1, -1], [-1, 1]]] as const) tube(bark, [v(leg(a[0], a[1], h - 1.1, wdt + 0.08)), v(leg(c[0], c[1], h + 0.9, wdt - 0.08))], [0.06, 0.06], 5);
  }
  const P = frameAt(f.x, f.y + H, f.z, Math.atan2(f.s, f.c));
  box(wood, P, 0, 0, 0, topW * 2 + 0.9, 0.2, topW * 2 + 0.9, [0.85, 0.8, 0.74], 1.5);
  for (const [sx, sz, wx, wz] of [[0, 1, 1, 0], [0, -1, 1, 0], [1, 0, 0, 1], [-1, 0, 0, 1]] as const) {
    box(wood, P, sx * (topW + 0.42), 0.95, sz * (topW + 0.42), wx ? topW * 2 + 0.9 : 0.08, 0.08, wz ? topW * 2 + 0.9 : 0.08, [0.8, 0.75, 0.7], 1.5);
  }
  const ry = H + 2.1;
  const apexY = ry + 1.5;
  const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const;
  const hw = topW + 0.55;
  for (let i = 0; i < 4; i++) {
    // Each roof face from the next corner back to this one, then up to the apex: wound to face outwards.
    const a = c[i]!, b = c[(i + 1) % 4]!;
    face(slate, f, [[b[0] * hw, ry, b[1] * hw], [a[0] * hw, ry, a[1] * hw], [0, apexY, 0]], [[0, 0], [1, 0], [0.5, 1]], [0.85, 0.85, 0.9]);
  }
  return f.y + apexY;
}

/** Old woodland round a clearing: tall trees, ferns, a fallen trunk, and a timber lookout tower above the canopy. */
function dressWoodland(s: IslandShape, gm: GenericMaterials, km: KitMaterials): Dressed {
  const { r, R, height } = s;
  const B = newBuilders();
  const iron = new Builder(), glass = new Builder(), bark = new Builder(), leaves = new Builder(), paving = new Builder(), wood = new Builder();
  const glows: Dressed["glows"] = [];
  const tx = R * (0.18 + r() * 0.12), tz = -R * (0.32 + r() * 0.1);
  const tf = frameAt(tx, height(tx, tz), tz, (r() - 0.5) * 0.5);
  let topY = lookout(bark, wood, B.slate, tf);
  glows.push({ position: new Vector3(tx, height(tx, tz) + 8.2, tz), size: 1.2 });
  const pathPts = stonePath(paving, s, new Vector3(tx - 1.5, 0, tz + 2.6), 0.6);
  const lamp = pathLights(iron, glass, s, pathPts, glows);
  const taken = [new Vector3(tx, 0, tz), ...pathPts.filter((_, i) => i % 3 === 0)];
  const trees = 10 + Math.floor(r() * 3);
  for (let k = 0; k < trees; k++) {
    const at = freeSpot(s, taken, 3.9, 0.2, 0.86);
    taken.push(at);
    const palette = r() < 0.3 ? AUTUMN : MEADOW;
    topY = Math.max(topY, tree(bark, leaves, r, at, height(at.x, at.z) - 0.1, palette, 0.95 + r() * 0.35));
  }
  // Ferns at the trees' feet, and a fallen trunk across the clearing.
  for (let i = 0; i < 46; i++) {
    const q = taken[1 + Math.floor(r() * (taken.length - 1))]!;
    const x = q.x + (r() - 0.5) * 3.2, z = q.z + (r() - 0.5) * 3.2;
    if (Math.hypot(x, z) > R * 0.92) continue;
    leafCard(leaves, x, height(x, z) + 0.3, z, 0.7 + r() * 0.5, r() * Math.PI, gamma([0.2 + r() * 0.08, 0.34 + r() * 0.1, 0.12]), false);
  }
  const lx = -R * 0.35, lz = R * 0.12;
  tube(bark, [new Vector3(lx, height(lx, lz) + 0.32, lz), new Vector3(lx + 4.2, height(lx + 4.2, lz + 1.1) + 0.3, lz + 1.1)], [0.36, 0.28], 9, 0.4);
  rimGreenery(leaves, s, Math.atan2(pathPts[0]!.z, pathPts[0]!.x), MEADOW);
  return {
    parts: [...finish(B, km, r), [paving, gm.paving, true], [wood, km.wood, true], [iron, gm.iron, true], [glass, gm.glass, false], [bark, gm.bark, true], [leaves, gm.leaves, true]],
    lamp, glows, top: topY,
  };
}

// ---------- fields and a farm ----------

/** A barn with its gambrel end to the viewer: red boards, white trim, double doors (one ajar on a lamplit inside), a hayloft. */
function barn(B: Builders, wood: Builder, f: Frame, w: number, d: number, h: number, rise: number, glows: Dressed["glows"]) {
  const wx = w / 2, wz = d / 2, sink = -0.9;
  const RED: Col = [2.2, 0.46, 0.38], DOOR: Col = [1.75, 0.4, 0.34], WHITE: Col = [0.95, 0.93, 0.9];
  const kx = wx * 0.62, ky = h + rise * 0.58, ry = h + rise;
  // Boards run upright: the plank texture runs along u, so u follows the height (one tile is 1.5 m).
  const boards = (pts: readonly V3[], across: (p: V3) => number) => face(wood, f, pts, pts.map((p) => [p[1] / 1.5, across(p) / 1.5] as const), RED);
  boards([[-wx, sink, wz], [wx, sink, wz], [wx, h, wz], [-wx, h, wz]], (p) => p[0]);
  boards([[wx, sink, -wz], [-wx, sink, -wz], [-wx, h, -wz], [wx, h, -wz]], (p) => -p[0]);
  boards([[wx, sink, wz], [wx, sink, -wz], [wx, h, -wz], [wx, h, wz]], (p) => -p[2]);
  boards([[-wx, sink, -wz], [-wx, sink, wz], [-wx, h, wz], [-wx, h, -wz]], (p) => p[2]);
  // The gambrel gables, front and back: a pentagon above the eaves, fanned from one corner.
  const front: V3[] = [[-wx, h, wz], [wx, h, wz], [kx, ky, wz], [0, ry, wz], [-kx, ky, wz]];
  const back: V3[] = [[wx, h, -wz], [-wx, h, -wz], [-kx, ky, -wz], [0, ry, -wz], [kx, ky, -wz]];
  for (let i = 1; i + 1 < 5; i++) {
    boards([front[0]!, front[i]!, front[i + 1]!], (p) => p[0]);
    boards([back[0]!, back[i]!, back[i + 1]!], (p) => -p[0]);
  }
  // The roof: four slopes, overhanging the gables and the eaves.
  const o = 0.35, oe = 0.3, s1 = (ky - h) / (wx - kx);
  const ex = wx + oe, ey = h - oe * s1;
  const t = (a: number) => a / 2;
  const slope = (x0: number, y0: number, x1: number, y1: number) => {
    const L = t(Math.hypot(x1 - x0, y1 - y0)), zf = wz + o, zb = -wz - o;
    if (x0 > 0) face(B.slate, f, [[x0, y0, zf], [x0, y0, zb], [x1, y1, zb], [x1, y1, zf]], [[t(zf), 0], [t(zb), 0], [t(zb), L], [t(zf), L]], [0.5, 0.52, 0.58]);
    else face(B.slate, f, [[x0, y0, zb], [x0, y0, zf], [x1, y1, zf], [x1, y1, zb]], [[t(zb), 0], [t(zf), 0], [t(zf), L], [t(zb), L]], [0.5, 0.52, 0.58]);
  };
  slope(ex, ey, kx, ky);
  slope(kx, ky, 0, ry);
  slope(-ex, ey, -kx, ky);
  slope(-kx, ky, 0, ry);
  // White trim: corner boards and barge boards along the gambrel.
  for (const sx of [-1, 1]) strip(B.trim, f, [sx * (wx - 0.1), -0.2], [sx * (wx - 0.1), h], wz + 0.05, 0.22, WHITE);
  const edge: [number, number][] = [[-ex, ey], [-kx, ky], [0, ry], [kx, ky], [ex, ey]];
  for (let i = 0; i + 1 < edge.length; i++) strip(B.trim, f, edge[i]!, edge[i + 1]!, wz + o + 0.02, 0.26, WHITE);
  // Double doors, white-framed and cross-braced; the right one stands ajar on a lamplit inside.
  const dw = 3.4, dh = 3.5;
  const leaf = (lf: Frame, cx: number, z: number) => {
    box(wood, lf, cx, -0.2, z, dw / 2, dh + 0.2, 0.12, DOOR, 1.5);
    const zf = z + 0.07, x0 = cx - dw / 4 + 0.12, x1 = cx + dw / 4 - 0.12, y0 = 0.12, y1 = dh - 0.12;
    const bars: [[number, number], [number, number]][] = [[[x0, y0], [x1, y0]], [[x1, y0], [x1, y1]], [[x1, y1], [x0, y1]], [[x0, y1], [x0, y0]], [[x0, y0], [x1, y1]], [[x0, y1], [x1, y0]]];
    for (const [a, c] of bars) strip(B.trim, lf, a, c, zf, 0.16, WHITE);
  };
  leaf(f, -dw / 4, wz + 0.06);
  leaf(frameAt(...toWorld(f, dw / 2, 0, wz + 0.06), Math.atan2(f.s, f.c) + 1.0), -dw / 4, 0);
  B.panes.push(pane(f, "front", w, d, dw / 4, dh / 2, dw / 2 - 0.08, dh - 0.08, false, CELL.litB));
  const [gx, gy, gz] = toWorld(f, dw / 4, 2.0, wz + 0.5);
  glows.push({ position: new Vector3(gx, gy, gz), size: 1.6 });
  // The hayloft door in the gable, and the hoist beam under the ridge.
  const hy0 = h + 0.3, hy1 = h + 1.9, hx = 0.72;
  box(wood, f, 0, hy0, wz + 0.04, hx * 2, hy1 - hy0, 0.1, DOOR, 1.5);
  for (const [a, c] of [[[-hx, hy0], [hx, hy0]], [[hx, hy0], [hx, hy1]], [[hx, hy1], [-hx, hy1]], [[-hx, hy1], [-hx, hy0]], [[-hx, hy0], [hx, hy1]]] as [[number, number], [number, number]][]) strip(B.trim, f, a, c, wz + 0.1, 0.14, WHITE);
  box(wood, f, 0, ry - 1.0, wz + 0.45, 0.22, 0.22, 1.1, [1.0, 0.8, 0.6], 1.5);
}

/** A red barn, fields of crops in rows, haystacks, a fence and a scarecrow keeping watch. */
function dressFarm(s: IslandShape, gm: GenericMaterials, km: KitMaterials): Dressed {
  const { r, R, height } = s;
  const B = newBuilders();
  const iron = new Builder(), glass = new Builder(), bark = new Builder(), leaves = new Builder(), paving = new Builder(), wood = new Builder(), figures = new Builder();
  const glows: Dressed["glows"] = [];
  const xb = (r() - 0.5) * 2.5, zb = -R * 0.36;
  const w = 7.6, d = 8.4, bh = 4.3, brise = 4.4;
  const f = frameAt(xb, height(xb, zb), zb, (r() - 0.5) * 0.2);
  barn(B, wood, f, w, d, bh, brise, glows);
  // Two fields in rows, either side of the track to the barn.
  const crops: [number, number, Col][] = [[-R * 0.42, R * 0.18, gamma([0.78, 0.62, 0.26])], [R * 0.42, R * 0.12, gamma([0.38, 0.52, 0.18])]];
  for (const [cx, cz, col] of crops) {
    for (let row = 0; row < 7; row++) {
      for (let k = 0; k < 13; k++) {
        const x = cx - 3 + k * 0.48 + (r() - 0.5) * 0.12, z = cz - 2.4 + row * 0.75;
        leafCard(leaves, x, height(x, z) + 0.32, z, 0.62 + r() * 0.22, r() * 0.6, [col[0] * (0.85 + r() * 0.3), col[1] * (0.85 + r() * 0.3), col[2]], false);
      }
    }
    // a post-and-rail fence along the front of the field
    for (let k = 0; k <= 4; k++) {
      const x = cx - 3.4 + k * 1.7, z = cz + 3.1;
      tube(wood, [new Vector3(x, height(x, z) - 0.2, z), new Vector3(x, height(x, z) + 1.0, z)], [0.07, 0.06], 5);
    }
    for (const hgt of [0.45, 0.85]) tube(wood, [new Vector3(cx - 3.4, height(cx - 3.4, cz + 3.1) + hgt, cz + 3.1), new Vector3(cx + 3.4, height(cx + 3.4, cz + 3.1) + hgt, cz + 3.1)], [0.04, 0.04], 4);
  }
  // The scarecrow, in the first field: a post and crossbar, a coat that is only a silhouette, a hat.
  const [scx, scz] = [crops[0]![0] + 0.6, crops[0]![1] - 0.3];
  const sy = height(scx, scz);
  tube(wood, [new Vector3(scx, sy - 0.2, scz), new Vector3(scx, sy + 2.0, scz)], [0.05, 0.045], 5);
  tube(wood, [new Vector3(scx - 0.75, sy + 1.55, scz), new Vector3(scx + 0.75, sy + 1.55, scz)], [0.04, 0.04], 4);
  const u0 = 1 / 3, u1 = 2 / 3;
  const sv = [figures.vert(scx - 0.5, sy + 0.75, scz + 0.05, u0, 0), figures.vert(scx + 0.5, sy + 0.75, scz + 0.05, u1, 0), figures.vert(scx + 0.5, sy + 2.1, scz + 0.05, u1, 1), figures.vert(scx - 0.5, sy + 2.1, scz + 0.05, u0, 1)];
  figures.quad(sv[0]!, sv[1]!, sv[2]!, sv[3]!);
  cone(iron, scx, sy + 2.02, scz + 0.05, 0.34, 0.42, 9, [1, 1, 1]);
  // Haystacks by the barn: round stacks of straw.
  for (const sx of [-1, 1]) {
    const hx = xb + sx * (w / 2 + 2.5), hz = zb + 1.4 + r();
    const hy = height(hx, hz);
    drum(B.plaster, hx, hy - 0.25, hz, 1.25, 0.9, 14, [0.84, 0.54, 0.15], 2, false);
    dome(B.plaster, hx, hy + 0.62, hz, 1.25, 1.15, 14, [0.92, 0.62, 0.19], 5);
  }
  const pathPts = stonePath(paving, s, new Vector3(xb + 0.5, 0, zb + d / 2 + 1.0), 0.75);
  const lamp = pathLights(iron, glass, s, pathPts, glows);
  let topY = bh + brise + 1;
  const corners = [-1, 1].flatMap((sx) => [-1, 0, 1].map((sz) => new Vector3(...toWorld(f, sx * (w / 2 + 2.5), 0, sz * (d / 2)))));
  const taken = [new Vector3(xb, 0, zb), ...corners, ...crops.map(([x, z]) => new Vector3(x, 0, z)), ...pathPts.filter((_, i) => i % 4 === 0)];
  for (let k = 0; k < 3; k++) {
    const at = freeSpot(s, taken, 5, 0.55, 0.85);
    taken.push(at);
    topY = Math.max(topY, tree(bark, leaves, r, at, height(at.x, at.z) - 0.1, k % 2 ? AUTUMN : MEADOW, 0.85));
  }
  rimGreenery(leaves, s, Math.atan2(pathPts[0]!.z, pathPts[0]!.x), AUTUMN);
  return {
    parts: [...finish(B, km, r, 0.5), [paving, gm.paving, true], [wood, km.wood, true], [figures, km.figures, true], [iron, gm.iron, true], [glass, gm.glass, false], [bark, gm.bark, true], [leaves, gm.leaves, true]],
    lamp, glows, top: topY,
  };
}

// ---------- which setting ----------

export function energySite(theme: Theme, props: readonly Prop[]): Site {
  switch (theme) {
    case "home": return { base: { dome: 0.85, bumps: 0.32, tint: [1.02, 1.06, 0.92], radius: [15.5, 18] }, top: "grass", dress: (s, gm, km) => dressCottage(s, gm, km, props) };
    case "wind": return { base: { dome: 2.8, bumps: 0.42, tint: [0.88, 1.02, 0.92], radius: [15.5, 18], boulders: 3 }, top: "grass", dress: dressWind };
    case "water": return { base: { dome: 0.4, bumps: 0.12, tint: [0.95, 1.06, 0.9], radius: [16, 18] }, top: "grass", dress: (s, gm, km) => dressRiver(s, gm, km, props) };
    case "farm": return { base: { dome: 0.5, bumps: 0.1, tint: [1.06, 1.02, 0.84], radius: [15.5, 18], boulders: 2 }, top: "grass", dress: dressFarm };
    default: return { base: { dome: 0.75, bumps: 0.55, tint: [0.86, 0.98, 0.84], radius: [15, 17.5] }, top: "grass", dress: dressWoodland };
  }
}
