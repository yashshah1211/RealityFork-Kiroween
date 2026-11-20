/**
 * Shops and studios: a corner of a high street at night, built from shared modules (kitParts.ts, generic.ts). A cobbled
 * street runs across the island in front of a main building and its neighbours; the main building is the setting:
 *  - a café: a shopfront under a striped awning, bistro tables, a string of lights;
 *  - a shop street: tall narrow shops with display windows, awnings and a hanging sign;
 *  - a studio: a brick warehouse with tall glazing lit by screens, a water tower on the roof;
 *  - a workshop: a sawtooth-roofed works with a tall chimney, open doors on a warm glow, timber in the yard;
 *  - a small business: a plain, tidy building with a door canopy (for a business that names no trade).
 * Signs carry no words and nothing says how well a business is doing: every island has the same share of lit windows.
 * People at work appear only as a number the path records (pathScenery): one figure per person, each at a station on the
 * pavement in front of the main building (workCrew), where the view from above can see them. Two decisions a path
 * records are drawn as markers, from pathScenery only: an office tower behind the street while a current job continues
 * (dayjob), bunting across the front when the business launches (open), scaffolding and a barrier while it waits
 * (notyet). They use no random numbers and no lights of their own beyond one small roof beacon, so the rest of the
 * island stays exactly as it was and no future looks brighter than another. Presentation only.
 */
import { BufferAttribute, BufferGeometry, Mesh, Points, Vector3, type Object3D } from "three";
import type { Prop, Theme } from "../environment/resolve";
import { AUTUMN, Builder, lampPost, leafCard, rimGreenery, tree, tube, type GenericMaterials, type IslandShape } from "./generic";
import {
  box, cone, disc, drum, face, festoon, finish, frameAt, hoop, house, newBuilders, pane, shopfrontLayout, strip, toWorld,
  BRICK_TINTS, PLASTER_TINTS, ROOF_TINTS, type Builders, type Col, type Dressed, type Frame, type Site,
} from "./kitParts";
import { CELL, FIGURES, type KitMaterials } from "./kitMaterials";

type Awning = "red" | "green";
const FASCIA: Readonly<Record<string, Col>> = { oxblood: [0.42, 0.18, 0.18], green: [0.16, 0.3, 0.24], navy: [0.18, 0.2, 0.34], black: [0.14, 0.13, 0.15] };

/** A striped canvas awning sloping out from a wall (open at the sides), with a short valance along its edge. */
function awning(b: Builder, f: Frame, x0: number, x1: number, y: number, zWall: number, out: number, drop: number, colour: Awning) {
  const [v0, v1] = colour === "red" ? [0.52, 0.98] : [0.02, 0.48];
  const u = (x: number) => x / 2.2;
  face(b, f, [[x0, y - drop, zWall + out], [x1, y - drop, zWall + out], [x1, y, zWall], [x0, y, zWall]], [[u(x0), v1], [u(x1), v1], [u(x1), v0], [u(x0), v0]], [1, 1, 1]);
  const val = 0.3;
  face(b, f, [[x0, y - drop - val, zWall + out + 0.02], [x1, y - drop - val, zWall + out + 0.02], [x1, y - drop, zWall + out + 0.02], [x0, y - drop, zWall + out + 0.02]], [[u(x0), v0], [u(x1), v0], [u(x1), v0 + 0.12], [u(x0), v0 + 0.12]], [0.92, 0.92, 0.92]);
}

interface Parts {
  readonly B: Builders;
  readonly iron: Builder;
  readonly glass: Builder;
  readonly wood: Builder;
  readonly canvas: Builder;
  readonly metal: Builder;
  readonly ember: Builder;
  readonly people: Builder;
  readonly bark: Builder;
  readonly leaves: Builder;
  readonly glows: Dressed["glows"];
}

/** What a main building reports back: its width and depth, its wall height, and its height for the label. */
interface Built {
  readonly w: number;
  readonly d: number;
  /** Height of its front wall: where scaffolding and bunting reach to. */
  readonly eaves: number;
  readonly top: number;
}

// ---------- the main buildings ----------

function cafe(P: Parts, f: Frame, r: () => number): Built {
  const w = 7.2, d = 5.6, h = 6.4, rise = 2.4;
  house(P.B, f, { w, d, h, floors: 2, rise, wall: "plaster", tint: PLASTER_TINTS[Math.floor(r() * 2)]!, roofTint: ROOF_TINTS[0]!, chimney: r() < 0.5 ? -1 : 1, door: false, sides: true, front: { cell: CELL.cafe, fascia: FASCIA.oxblood! } });
  const L = shopfrontLayout(w);
  const wz = d / 2;
  awning(P.canvas, f, L.window.x0 - 0.2, L.door.x + L.door.w / 2 + 0.2, L.fasciaY - 0.04, wz + 0.14, 2.0, 0.62, "red");
  // Bistro tables and chairs on the pavement under the awning.
  for (const tx of [-2.45, -0.75, 0.95]) {
    const [x, y, z] = toWorld(f, tx, 0, wz + 1.45);
    tube(P.iron, [new Vector3(x, y - 0.1, z), new Vector3(x, y + 0.72, z)], [0.05, 0.035], 6);
    disc(P.B.trim, x, y + 0.74, z, 0.34, 14, [1.05, 1.03, 1.0]);
    for (const side of [-1, 1]) {
      const cf = frameAt(...toWorld(f, tx + side * 0.6, 0, wz + 1.45), Math.atan2(f.s, f.c) + (side * Math.PI) / 2);
      box(P.wood, cf, 0, 0.42, 0, 0.42, 0.06, 0.42, [0.62, 0.42, 0.32], 1.2);
      box(P.wood, cf, 0, 0.48, -0.19, 0.42, 0.5, 0.05, [0.62, 0.42, 0.32], 1.2);
      for (const [lx, lz] of [[-0.17, -0.17], [0.17, -0.17], [0.17, 0.17], [-0.17, 0.17]] as const) box(P.iron, cf, lx, -0.05, lz, 0.04, 0.47, 0.04, [1, 1, 1]);
    }
  }
  // A blank chalkboard by the door.
  const af = frameAt(...toWorld(f, L.door.x + 1.0, 0, wz + 0.55), Math.atan2(f.s, f.c) - 0.2);
  face(P.B.trim, af, [[-0.32, 0, 0.18], [0.32, 0, 0.18], [0.32, 0.95, 0.02], [-0.32, 0.95, 0.02]], [[0, 0], [1, 0], [1, 1], [0, 1]], [0.12, 0.13, 0.12]);
  face(P.B.trim, af, [[0.32, 0, -0.14], [-0.32, 0, -0.14], [-0.32, 0.95, 0.02], [0.32, 0.95, 0.02]], [[0, 0], [1, 0], [1, 1], [0, 1]], [0.3, 0.22, 0.18]);
  // Festoon lights from the awning's corners to two poles at the kerb.
  const poleZ = wz + 4.0;
  for (const side of [-1, 1]) {
    const px = side * (w / 2 + 0.6);
    const [x, y, z] = toWorld(f, px, 0, poleZ);
    tube(P.iron, [new Vector3(x, y - 0.1, z), new Vector3(x, y + 3.0, z)], [0.05, 0.04], 6);
    const [ax, ay, az] = toWorld(f, side * (w / 2 - 0.2), L.fasciaY - 0.7, wz + 2.1);
    for (const p of festoon(new Vector3(ax, ay, az), new Vector3(x, y + 2.95, z), 0.42, 7)) P.glows.push({ position: p, size: 0.34, color: "#ffd38f" });
  }
  const [mx, my, mz] = toWorld(f, 0, L.fasciaY - 0.5, wz + 1.9);
  for (const p of festoon(new Vector3(...toWorld(f, -w / 2 + 0.4, L.fasciaY - 0.62, wz + 2.12)), new Vector3(mx, my, mz), 0.12, 4)) P.glows.push({ position: p, size: 0.3, color: "#ffd38f" });
  return { w, d, eaves: h, top: h + rise + 1.4 };
}

function shop(P: Parts, f: Frame, r: () => number): Built {
  const w = 6.2, d = 5.4, h = 8.7, rise = 2.6;
  house(P.B, f, { w, d, h, floors: 3, rise, wall: "brick", tint: BRICK_TINTS[Math.floor(r() * 3)]!, roofTint: ROOF_TINTS[1]!, chimney: r() < 0.5 ? -1 : 1, door: false, sides: true, front: { cell: CELL.shop, fascia: FASCIA.green! } });
  const L = shopfrontLayout(w);
  const wz = d / 2;
  awning(P.canvas, f, L.window.x0 - 0.15, L.window.x1 + 0.15, L.fasciaY - 0.04, wz + 0.14, 1.5, 0.5, "green");
  // A hanging sign on an iron bracket, with nothing painted on it.
  const [bx, by, bz] = toWorld(f, -w / 2 + 0.25, 3.62, wz + 0.15);
  const [ex, ey, ez] = toWorld(f, -w / 2 + 0.25, 3.62, wz + 1.15);
  tube(P.iron, [new Vector3(bx, by, bz), new Vector3(ex, ey, ez)], [0.035, 0.03], 5);
  const sf = frameAt(...toWorld(f, -w / 2 + 0.25, 0, wz + 0.7), Math.atan2(f.s, f.c) + Math.PI / 2);
  box(P.wood, sf, 0, 2.95, 0, 0.78, 0.58, 0.06, [0.5, 0.36, 0.28], 1.2);
  box(P.B.trim, sf, 0, 3.5, 0, 0.84, 0.05, 0.08, [0.76, 0.6, 0.32]);
  // Crates of goods on a bench outside.
  const gf = frameAt(...toWorld(f, L.window.x0 + 1.1, 0, wz + 0.85), Math.atan2(f.s, f.c));
  box(P.wood, gf, 0, 0.4, 0, 1.7, 0.08, 0.5, [0.6, 0.44, 0.34], 1.2);
  for (const [lx, lz] of [[-0.75, 0], [0.75, 0]] as const) box(P.wood, gf, lx, -0.05, lz, 0.08, 0.45, 0.45, [0.5, 0.36, 0.28], 1.2);
  for (const lx of [-0.45, 0.4]) box(P.wood, gf, lx, 0.48, 0, 0.62, 0.36, 0.44, [0.78, 0.6, 0.44], 1.2);
  return { w, d, eaves: h, top: h + rise + 1.4 };
}

function studio(P: Parts, f: Frame, r: () => number): Built {
  const w = 10.6, d = 7.2, h = 8.6;
  const tint = BRICK_TINTS[Math.floor(r() * 4)]!;
  box(P.B.brick, f, 0, -0.9, 0, w, h + 0.9, d, tint, 2);
  // Parapet and a stone band between the floors.
  for (const [cx, cz, sx, sz] of [[0, d / 2 - 0.15, w, 0.3], [0, -d / 2 + 0.15, w, 0.3], [w / 2 - 0.15, 0, 0.3, d], [-w / 2 + 0.15, 0, 0.3, d]] as const) box(P.B.trim, f, cx, h, cz, sx + 0.05, 0.7, sz + 0.05, [0.72, 0.7, 0.7]);
  box(P.B.trim, f, 0, 4.15, d / 2 + 0.04, w + 0.1, 0.22, 0.12, [0.78, 0.76, 0.74]);
  // Tall factory glazing on two floors; about half the windows lit by screens, the rest dark. The ground floor's last
  // bay is a roller door, with a small door beside it.
  const cols = 5, step = w / cols;
  const cell = () => (r() < 0.5 ? CELL.cool : r() < 0.5 ? CELL.darkA : CELL.darkB);
  for (const [cy, ph] of [[2.05, 2.5], [6.25, 3.0]] as const) {
    for (let j = 0; j < cols; j++) {
      const cx = -w / 2 + step * (j + 0.5);
      if (cy < 4 && j === cols - 1) continue;
      P.B.panes.push(pane(f, "front", w, d, cx, cy, step * 0.62, ph, false, cell()));
      P.B.panes.push(pane(f, "back", w, d, cx, cy, step * 0.62, ph, false, cell()));
    }
    for (const side of ["left", "right"] as const) for (const cz of [-1.8, 1.8]) P.B.panes.push(pane(f, side, w, d, cz, cy, 1.3, ph, false, cell()));
  }
  const rx = -w / 2 + step * (cols - 0.5);
  box(P.metal, f, rx, -0.1, d / 2 + 0.06, step * 0.8, 3.3, 0.1, [0.42, 0.44, 0.5]);
  for (let k = 0; k < 9; k++) box(P.metal, f, rx, 0.1 + k * 0.35, d / 2 + 0.12, step * 0.8, 0.04, 0.03, [0.3, 0.32, 0.36]);
  P.B.panes.push(pane(f, "front", w, d, rx - step * 0.62, 1.05, 0.95, 2.1, true));
  // A loading dock and crates in front of the roller door.
  box(P.B.stone, f, rx, -0.4, d / 2 + 0.85, step * 0.95, 0.75, 1.5, [0.72, 0.72, 0.74], 1.4);
  box(P.wood, f, rx - 0.7, 0.35, d / 2 + 1.0, 0.7, 0.55, 0.6, [0.72, 0.56, 0.4], 1.2);
  // The water tower on the roof, and a slender mast with a dim red light.
  const [tx, ty, tz] = toWorld(f, w / 2 - 2.4, h, -d / 2 + 2.3);
  for (const [lx, lz] of [[-0.85, -0.85], [0.85, -0.85], [0.85, 0.85], [-0.85, 0.85]] as const) tube(P.iron, [new Vector3(tx + lx, ty, tz + lz), new Vector3(tx + lx * 0.8, ty + 2.5, tz + lz * 0.8)], [0.07, 0.06], 5);
  drum(P.wood, tx, ty + 2.45, tz, 1.25, 2.3, 16, [0.8, 0.64, 0.5], 1.5);
  for (const hy of [3.0, 4.05]) hoop(P.iron, new Vector3(tx, ty + hy, tz), new Vector3(1, 0, 0), new Vector3(0, 0, 1), 1.27, 0.035, 20, 4, [1, 1, 1]);
  cone(P.B.slate, tx, ty + 4.7, tz, 1.42, 1.15, 16, [0.9, 0.9, 0.95]);
  const [qx, qy, qz] = toWorld(f, -w / 2 + 1.3, h, -d / 2 + 1.4);
  tube(P.iron, [new Vector3(qx, qy, qz), new Vector3(qx, qy + 4.6, qz)], [0.06, 0.03], 5);
  for (const k of [1.6, 2.6, 3.5]) tube(P.iron, [new Vector3(qx - 0.45, qy + k, qz), new Vector3(qx + 0.45, qy + k, qz)], [0.02, 0.02], 3);
  P.glows.push({ position: new Vector3(qx, qy + 4.7, qz), size: 0.42, color: "#ff5f52" });
  return { w, d, eaves: h, top: h + 5.9 };
}

function workshop(P: Parts, f: Frame, r: () => number): Built {
  const w = 10.2, d = 7.6, h = 4.0, rise = 1.75;
  const tint = BRICK_TINTS[Math.floor(r() * 4)]!;
  const wx = w / 2, wz = d / 2;
  const t2 = (a: number) => a / 2;
  // Walls (no roof): four faces from below ground to the eaves.
  face(P.B.brick, f, [[-wx, -0.9, wz], [wx, -0.9, wz], [wx, h, wz], [-wx, h, wz]], [[t2(-wx), t2(-0.9)], [t2(wx), t2(-0.9)], [t2(wx), t2(h)], [t2(-wx), t2(h)]], tint);
  face(P.B.brick, f, [[wx, -0.9, -wz], [-wx, -0.9, -wz], [-wx, h, -wz], [wx, h, -wz]], [[t2(-wx), t2(-0.9)], [t2(wx), t2(-0.9)], [t2(wx), t2(h)], [t2(-wx), t2(h)]], tint);
  face(P.B.brick, f, [[wx, -0.9, wz], [wx, -0.9, -wz], [wx, h, -wz], [wx, h, wz]], [[t2(-wz), t2(-0.9)], [t2(wz), t2(-0.9)], [t2(wz), t2(h)], [t2(-wz), t2(h)]], tint);
  face(P.B.brick, f, [[-wx, -0.9, -wz], [-wx, -0.9, wz], [-wx, h, wz], [-wx, h, -wz]], [[t2(-wz), t2(-0.9)], [t2(wz), t2(-0.9)], [t2(wz), t2(h)], [t2(-wz), t2(h)]], tint);
  // The sawtooth roof: three teeth across the width, so the front and back walls end in the works' zig-zag. Each tooth
  // is a slate slope rising to the right, closed by an upright brick face with a band of north-light glazing.
  const n = 3, tooth = w / n, o = 0.15, L = Math.hypot(rise, tooth);
  for (let k = 0; k < n; k++) {
    const xl = -wx + k * tooth, xr = xl + tooth;
    face(P.B.slate, f, [[xl, h, wz + o], [xr, h + rise, wz + o], [xr, h + rise, -wz - o], [xl, h, -wz - o]], [[t2(wz + o), 0], [t2(wz + o), t2(L)], [t2(-wz - o), t2(L)], [t2(-wz - o), 0]], [0.92, 0.93, 0.98]);
    face(P.B.brick, f, [[xr, h, wz], [xr, h, -wz], [xr, h + rise, -wz], [xr, h + rise, wz]], [[t2(-wz), t2(h)], [t2(wz), t2(h)], [t2(wz), t2(h + rise)], [t2(-wz), t2(h + rise)]], tint);
    P.B.panes.push({ f, pts: [[xr + 0.04, h + 0.12, wz - 0.35], [xr + 0.04, h + 0.12, -wz + 0.35], [xr + 0.04, h + rise - 0.2, -wz + 0.35], [xr + 0.04, h + rise - 0.2, wz - 0.35]], door: false, cell: k === 1 ? CELL.litB : CELL.litA });
    face(P.B.brick, f, [[xl, h, wz], [xr, h, wz], [xr, h + rise, wz]], [[t2(xl), t2(h)], [t2(xr), t2(h)], [t2(xr), t2(h + rise)]], tint);
    face(P.B.brick, f, [[xr, h, -wz], [xl, h, -wz], [xr, h + rise, -wz]], [[t2(-xr), t2(h)], [t2(-xl), t2(h)], [t2(-xr), t2(h + rise)]], tint);
    // a pale coping board along each tooth's front edge, so the zig-zag reads against the night
    strip(P.B.trim, f, [xl - 0.04, h + 0.02], [xr + 0.04, h + rise + 0.06], wz + o + 0.03, 0.22, [0.72, 0.68, 0.64]);
    strip(P.B.trim, f, [xr - 0.09, h], [xr - 0.09, h + rise + 0.06], wz + o + 0.03, 0.2, [0.72, 0.68, 0.64]);
  }
  // The chimney: a tall square stack at the back corner, with a stone cap.
  box(P.B.brick, f, wx - 1.1, -0.9, -wz + 1.0, 1.15, 13.4, 1.15, [tint[0] * 0.92, tint[1] * 0.9, tint[2] * 0.9], 2);
  box(P.B.trim, f, wx - 1.1, 12.5, -wz + 1.0, 1.5, 0.3, 1.5, [0.66, 0.64, 0.64]);
  // Wide doors open on a warm glow; two small lit windows either side.
  const dw = 3.0, dh = 3.1;
  face(P.ember, f, [[-dw / 2, 0, wz + 0.03], [dw / 2, 0, wz + 0.03], [dw / 2, dh, wz + 0.03], [-dw / 2, dh, wz + 0.03]], [[0, 0], [1, 0], [1, 1], [0, 1]], [1, 1, 1]);
  box(P.B.trim, f, 0, dh, wz + 0.08, dw + 0.4, 0.25, 0.18, [0.7, 0.66, 0.62]);
  for (const side of [-1, 1]) {
    const lf = frameAt(...toWorld(f, side * (dw / 2 + 0.05), 0, wz + 0.05), Math.atan2(f.s, f.c) + side * 1.15);
    box(P.wood, lf, side * 0.72, -0.05, 0, 1.45, dh - 0.05, 0.1, [0.52, 0.4, 0.34], 1.5);
  }
  const [gx, gy, gz] = toWorld(f, 0, 1.4, wz + 0.6);
  P.glows.push({ position: new Vector3(gx, gy, gz), size: 2.4, color: "#ff9a4a" });
  for (const cx of [-wx + 1.4, wx - 1.4]) P.B.panes.push(pane(f, "front", w, d, cx, 2.0, 1.0, 1.3));
  for (const cz of [-1.6, 1.6]) for (const side of ["left", "right"] as const) P.B.panes.push(pane(f, side, w, d, cz, 2.0, 1.0, 1.3));
  // The yard: stacked timber, a log pile, a workbench and two barrels.
  const yf = frameAt(...toWorld(f, -wx - 1.6, 0, wz - 1.2), Math.atan2(f.s, f.c) + 0.15);
  for (let k = 0; k < 6; k++) box(P.wood, yf, (k % 3 - 1) * 0.42, k < 3 ? 0 : 0.26, 0, 0.36, 0.24, 3.0, [0.84, 0.66, 0.48], 1.5);
  for (let k = 0; k < 5; k++) {
    const [lx, ly, lz] = toWorld(f, wx + 1.4, 0.32 + (k > 2 ? 0.5 : 0), wz - 2.6 + (k % 3) * 0.6 + (k > 2 ? 0.3 : 0));
    tube(P.bark, [new Vector3(lx - 1.2, ly, lz), new Vector3(lx + 1.2, ly, lz)], [0.28, 0.26], 8, 0.4);
  }
  const bf = frameAt(...toWorld(f, dw / 2 + 1.6, 0, wz + 1.5), Math.atan2(f.s, f.c));
  box(P.wood, bf, 0, 0.82, 0, 1.9, 0.1, 0.7, [0.7, 0.54, 0.4], 1.2);
  for (const [lx, lz] of [[-0.85, -0.28], [0.85, -0.28], [0.85, 0.28], [-0.85, 0.28]] as const) box(P.wood, bf, lx, -0.05, lz, 0.1, 0.88, 0.1, [0.55, 0.42, 0.32], 1.2);
  for (const k of [0, 1]) {
    const [bx, by, bz] = toWorld(f, -dw / 2 - 1.3 - k * 0.9, 0, wz + 0.8 + k * 0.4);
    drum(P.wood, bx, by - 0.05, bz, 0.36, 1.0, 10, [0.66, 0.5, 0.38], 1.2);
    for (const hy of [0.2, 0.8]) hoop(P.iron, new Vector3(bx, by + hy, bz), new Vector3(1, 0, 0), new Vector3(0, 0, 1), 0.37, 0.02, 12, 3, [1, 1, 1]);
  }
  return { w, d, eaves: h, top: 13.2 };
}

function office(P: Parts, f: Frame, r: () => number): Built {
  const w = 7.8, d = 6.0, h = 9.3, rise = 1.3;
  house(P.B, f, { w, d, h, floors: 3, rise, wall: "plaster", tint: PLASTER_TINTS[1 + Math.floor(r() * 3)]!, roofTint: ROOF_TINTS[2]!, chimney: r() < 0.5 ? -1 : 1, door: true, sides: true });
  const wz = d / 2;
  // A canopy over the door, a plain plaque beside it, and two planters.
  box(P.B.trim, f, 0, 2.35, wz + 0.5, 1.9, 0.14, 1.0, [0.72, 0.7, 0.72]);
  for (const sx of [-0.85, 0.85]) tube(P.iron, [new Vector3(...toWorld(f, sx, 0, wz + 0.95)), new Vector3(...toWorld(f, sx, 2.36, wz + 0.95))], [0.035, 0.03], 5);
  box(P.B.trim, f, 1.05, 1.3, wz + 0.07, 0.42, 0.3, 0.04, [0.82, 0.66, 0.36]);
  for (const sx of [-1.35, 1.35]) {
    const [px, py, pz] = toWorld(f, sx, 0, wz + 0.7);
    drum(P.B.stone, px, py - 0.1, pz, 0.34, 0.62, 10, [0.7, 0.7, 0.74], 1.2);
    for (let k = 0; k < 6; k++) leafCard(P.leaves, px + (r() - 0.5) * 0.35, py + 0.8 + r() * 0.2, pz + (r() - 0.5) * 0.35, 0.55, r() * Math.PI, AUTUMN[Math.floor(r() * 2)]!, false);
  }
  return { w, d, eaves: h, top: h + rise + 1.4 };
}

const MAIN: Readonly<Record<string, (P: Parts, f: Frame, r: () => number) => Built>> = { cafe, shop, studio, workshop, office };

// ---------- people at work ----------

/** What one person works with, on the counter in front of them: the kind of work the setting is, never how much of it. */
function station(P: Parts, f: Frame, x: number, theme: Theme) {
  const top = 1.12;
  switch (theme) {
    case "cafe": {
      // An espresso machine with a cup tray, a small warm pilot light and a cup beside it.
      box(P.metal, f, x - 0.16, top, -0.1, 0.54, 0.44, 0.38, [0.94, 0.94, 0.98]);
      box(P.metal, f, x - 0.16, top + 0.44, -0.1, 0.46, 0.05, 0.32, [0.66, 0.66, 0.72]);
      box(P.metal, f, x - 0.16, top + 0.12, 0.1, 0.16, 0.12, 0.08, [0.4, 0.4, 0.46]);
      face(P.ember, f, [[x - 0.36, top + 0.3, 0.095], [x - 0.3, top + 0.3, 0.095], [x - 0.3, top + 0.36, 0.095], [x - 0.36, top + 0.36, 0.095]], [[0, 0], [1, 0], [1, 1], [0, 1]], [1, 1, 1]);
      const [cx, cy, cz] = toWorld(f, x + 0.3, top, 0.05);
      drum(P.B.trim, cx, cy, cz, 0.07, 0.12, 8, [1.08, 1.06, 1.02]);
      return;
    }
    case "shop":
      // Two crates of goods and a wrapped parcel.
      for (const [dx, tint] of [[-0.24, [0.8, 0.62, 0.46]], [0.22, [0.7, 0.54, 0.4]]] as const) box(P.wood, f, x + dx, top, -0.05, 0.4, 0.28, 0.4, tint, 1.2);
      box(P.B.trim, f, x + 0.02, top + 0.28, -0.05, 0.3, 0.16, 0.24, [0.96, 0.9, 0.78]);
      return;
    case "studio":
      // An easel with a blank canvas on it.
      box(P.wood, f, x - 0.05, top, -0.12, 0.06, 0.95, 0.06, [0.6, 0.44, 0.32], 1.2);
      box(P.B.trim, f, x - 0.05, top + 0.32, -0.08, 0.62, 0.5, 0.04, [1.05, 1.03, 0.98]);
      return;
    case "workshop":
      // A vice on the bench and a plank being worked.
      box(P.metal, f, x - 0.22, top, -0.05, 0.22, 0.26, 0.24, [0.42, 0.42, 0.48]);
      box(P.wood, f, x + 0.12, top, -0.02, 0.62, 0.08, 0.2, [0.84, 0.66, 0.48], 1.2);
      return;
    default:
      // Papers and a small screen.
      box(P.B.trim, f, x + 0.2, top, 0, 0.3, 0.05, 0.22, [1.0, 0.98, 0.94]);
      box(P.metal, f, x - 0.15, top, -0.12, 0.44, 0.3, 0.05, [0.34, 0.36, 0.42]);
  }
}

interface Crew {
  readonly extras: readonly Object3D[];
  readonly animate: (t: number) => void;
  readonly dispose: () => void;
}

/** The canopy of a person's cart: the other colourway from the main building's own awning, so carts read on their own. */
const CART_CANOPY: Readonly<Record<string, Awning>> = { cafe: "green", shop: "red", studio: "green", workshop: "red", office: "red" };

/** Places for `n` carts, either side of the street lamp in front of the main building (never in front of it). */
function cartPlaces(n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push((i % 2 === 0 ? -1 : 1) * (1.8 + Math.floor(i / 2) * 3.1));
  return out.sort((a, b) => a - b);
}

/**
 * People at work, one per person the path records (pathScenery: 1 to 6): each with a small cart of their own on the
 * pavement in front of the main building (a coffee cart, a stall, an easel, a bench, a desk), standing behind it. A
 * cart is large enough to see from the whole island's view, so the number of people is the number of carts. Carts
 * carry no lights, so more people never makes a brighter island. While the scene moves (never with reduced motion),
 * each figure steps from side to side behind its cart and a café's machines steam: activity, not a measure of anything.
 */
function workCrew(P: Parts, km: KitMaterials, s: IslandShape, theme: Theme, n: number, front: number): Crew {
  const z = front + 4.85, top = 1.12;
  const xs = cartPlaces(n);
  const frames = xs.map((x) => frameAt(x, s.height(x, z), z, 0));
  for (const cf of frames) {
    // The cart: a timber body with a pale top, two posts at the back and a striped canopy.
    box(P.wood, cf, 0, -0.25, 0, 2.4, 1.3, 1.0, [0.62, 0.44, 0.34], 1.2);
    box(P.B.trim, cf, 0, 1.05, 0, 2.56, 0.07, 1.12, [0.92, 0.88, 0.82]);
    for (const px of [-1.16, 1.16]) tube(P.iron, [new Vector3(...toWorld(cf, px, 1.08, -0.5)), new Vector3(...toWorld(cf, px, 3.12, -0.5))], [0.045, 0.035], 5);
    awning(P.canvas, cf, -1.4, 1.4, 3.15, -0.58, 1.65, 0.36, CART_CANOPY[theme] ?? "red");
    station(P, cf, 0, theme);
  }

  // The figures: one quad each from the atlas's "behind a counter" cell, facing the street, standing behind the counter.
  const w = 1.08, h = 2.55, y0 = -0.12, fz = -0.82;
  const u0 = 0, u1 = 1 / FIGURES;
  const pos = new Float32Array(n * 12);
  const figGeo = new BufferGeometry();
  const uv: number[] = [], nor: number[] = [], idx: number[] = [];
  for (let i = 0; i < n; i++) {
    uv.push(u0, 0, u1, 0, u1, 1, u0, 1);
    nor.push(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1);
    idx.push(4 * i, 4 * i + 1, 4 * i + 2, 4 * i, 4 * i + 2, 4 * i + 3);
  }
  const place = (shift: (i: number) => number) => {
    for (let i = 0; i < n; i++) {
      const [x, y, zz] = toWorld(frames[i]!, shift(i), y0, fz);
      pos.set([x - w / 2, y, zz, x + w / 2, y, zz, x + w / 2, y + h, zz, x - w / 2, y + h, zz], i * 12);
    }
  };
  place(() => 0);
  figGeo.setAttribute("position", new BufferAttribute(pos, 3));
  figGeo.setAttribute("uv", new BufferAttribute(new Float32Array(uv), 2));
  figGeo.setAttribute("normal", new BufferAttribute(new Float32Array(nor), 3));
  figGeo.setIndex(idx);
  const figures = new Mesh(figGeo, km.crew);
  figures.name = "people-at-work";
  figures.frustumCulled = false;
  const extras: Object3D[] = [figures];

  // Steam over each coffee machine: a few soft puffs that rise and fade (still puffs when nothing moves).
  const PUFFS = 3;
  let steamGeo: BufferGeometry | null = null;
  let puff: ((t: number) => void) | null = null;
  if (theme === "cafe") {
    const sp = new Float32Array(n * PUFFS * 3), sc = new Float32Array(n * PUFFS * 3);
    puff = (t: number) => {
      for (let i = 0; i < n; i++) {
        for (let k = 0; k < PUFFS; k++) {
          const j = i * PUFFS + k;
          const ph = (((t * 0.32 + k / PUFFS + i * 0.37) % 1) + 1) % 1;
          const [x, y, zz] = toWorld(frames[i]!, -0.16 + Math.sin(ph * 5 + i) * 0.05, top + 0.58 + ph * 0.85, -0.1);
          sp.set([x, y, zz], j * 3);
          const a = Math.sin(Math.PI * ph) * 0.55;
          sc.set([a, a, a], j * 3);
        }
      }
    };
    puff(0);
    steamGeo = new BufferGeometry();
    steamGeo.setAttribute("position", new BufferAttribute(sp, 3));
    steamGeo.setAttribute("color", new BufferAttribute(sc, 3));
    const steam = new Points(steamGeo, km.steam);
    steam.name = "steam";
    steam.frustumCulled = false;
    steam.renderOrder = 2;
    extras.push(steam);
  }
  return {
    extras,
    animate: (t) => {
      place((i) => Math.sin(t * 0.7 + i * 2.1) * 0.24);
      (figGeo.getAttribute("position") as BufferAttribute).needsUpdate = true;
      if (puff && steamGeo) {
        puff(t);
        (steamGeo.getAttribute("position") as BufferAttribute).needsUpdate = true;
        (steamGeo.getAttribute("color") as BufferAttribute).needsUpdate = true;
      }
    },
    dispose: () => {
      figGeo.dispose();
      steamGeo?.dispose();
    },
  };
}

// ---------- what a path decides ----------

/**
 * An office tower behind the main building: the current job continues on this path. Pale, flat-roofed and taller than
 * the street, so it reads as another workplace. Its windows have fixed cells, mostly dark, so the share of lit windows
 * on the rest of the island is untouched. Returns the height of its roof for the label.
 */
function dayJobTower(P: Parts, s: IslandShape, main: Built, zMain: number): number {
  const tw = 4.2, td = 3.4, th = 17.4;
  const z = zMain - main.d / 2 - 0.35 - td / 2;
  let x = -main.w / 2 + tw / 2 + 0.4;
  // Its back corners stay on the island: on a small island it moves in towards the middle.
  const inside = (cx: number) => [cx - tw / 2, cx + tw / 2].every((px) => Math.hypot(px, z - td / 2) < s.outline(Math.atan2(z - td / 2, px)) * 0.9);
  for (let k = 0; k < 8 && !inside(x); k++) x *= 0.7;
  const f = frameAt(x, s.height(x, z), z, 0);
  box(P.B.plaster, f, 0, -0.9, 0, tw, th + 0.9, td, [0.78, 0.82, 0.92], 2);
  for (const [cx, cz, sx, sz] of [[0, td / 2 - 0.12, tw, 0.24], [0, -td / 2 + 0.12, tw, 0.24], [tw / 2 - 0.12, 0, 0.24, td], [-tw / 2 + 0.12, 0, 0.24, td]] as const) box(P.B.trim, f, cx, th, cz, sx + 0.04, 0.55, sz + 0.04, [0.7, 0.72, 0.78]);
  box(P.B.trim, f, 0.7, th, -0.2, 1.5, 1.1, 1.3, [0.6, 0.62, 0.68]);
  const rows = 6, cols = 3, step = tw / cols;
  for (let row = 0; row < rows; row++) {
    const cy = 1.7 + row * 2.6;
    for (let c = 0; c < cols; c++) {
      const cell = (row * cols + c) % 7 === 3 ? CELL.cool : (row + c) % 2 ? CELL.darkA : CELL.darkB;
      P.B.panes.push(pane(f, "front", tw, td, -tw / 2 + step * (c + 0.5), cy, step * 0.66, 1.55, false, cell));
    }
    for (const side of ["left", "right"] as const) for (const cz of [-0.8, 0.8]) P.B.panes.push(pane(f, side, tw, td, cz, cy, 1.05, 1.55, false, (row + (cz > 0 ? 1 : 0)) % 2 ? CELL.darkA : CELL.darkB));
  }
  P.glows.push({ position: new Vector3(...toWorld(f, -tw / 2 + 0.45, th + 0.75, td / 2 - 0.45)), size: 0.36, color: "#ff5f52" });
  return s.height(x, z) + th + 1.6;
}

/** Scaffolding across the main building's front and a striped barrier before its door: the launch waits on this path. */
function scaffolding(P: Parts, f: Frame, main: Built) {
  const x0 = -main.w / 2 - 0.35, x1 = main.w / 2 + 0.35, xm = (x0 + x1) / 2;
  const zIn = main.d / 2 + 0.45, zOut = main.d / 2 + 1.3;
  const levels: number[] = [];
  for (let y = 3.2; y <= main.eaves + 0.3; y += 2.2) levels.push(y);
  if (!levels.length) levels.push(3.2);
  const top = levels.at(-1)! + 1.05;
  const at = (x: number, y: number, z: number) => new Vector3(...toWorld(f, x, y, z));
  for (const z of [zIn, zOut]) for (const x of [x0, xm, x1]) tube(P.iron, [at(x, -0.15, z), at(x, top, z)], [0.08, 0.08], 6);
  const lifts = [0.25, ...levels];
  for (let k = 0; k < lifts.length; k++) {
    const y = lifts[k]!;
    if (k > 0) {
      // Boards with a pale edge board on the outer side, so each lift reads as a band across the front.
      box(P.wood, f, xm, y, (zIn + zOut) / 2, x1 - x0 + 0.3, 0.12, zOut - zIn + 0.25, [1.05, 0.84, 0.52], 1.2);
      box(P.wood, f, xm, y, zOut + 0.12, x1 - x0 + 0.3, 0.32, 0.05, [1.1, 0.9, 0.58], 1.2);
      tube(P.iron, [at(x0, y + 1.0, zOut), at(x1, y + 1.0, zOut)], [0.05, 0.05], 5);
    }
    // A brace across each bay of the outer face, alternating direction.
    if (k + 1 < lifts.length) {
      const y1 = lifts[k + 1]!;
      tube(P.iron, [at(k % 2 ? xm : x0, y, zOut + 0.05), at(k % 2 ? x0 : xm, y1, zOut + 0.05)], [0.045, 0.045], 4);
      tube(P.iron, [at(k % 2 ? x1 : xm, y, zOut + 0.05), at(k % 2 ? xm : x1, y1, zOut + 0.05)], [0.045, 0.045], 4);
    }
  }
  // The barrier: a red and white striped board on two trestles, closing the way to the door.
  const bz = main.d / 2 + 3.2, bw = 3.6;
  for (const sx of [-1, 1]) {
    const lf = frameAt(...toWorld(f, sx * (bw / 2 - 0.15), 0, bz), Math.atan2(f.s, f.c));
    for (const lz of [-0.25, 0.25]) box(P.wood, lf, 0, -0.05, lz, 0.1, 1.3, 0.1, [0.55, 0.42, 0.32], 1.2);
  }
  face(P.canvas, f, [[-bw / 2, 0.75, bz + 0.03], [bw / 2, 0.75, bz + 0.03], [bw / 2, 1.25, bz + 0.03], [-bw / 2, 1.25, bz + 0.03]], [[0, 0.6], [bw / 0.9, 0.6], [bw / 0.9, 0.9], [0, 0.9]], [1, 1, 1]);
}

/** A string of plain coloured pennants from a to c (island coordinates), sagging a little, each turned to the street. */
function pennants(P: Parts, a: Vector3, c: Vector3, size: number) {
  const n = Math.max(6, Math.round(a.distanceTo(c) / (size * 1.15)));
  const sag = Math.min(0.6, a.distanceTo(c) * 0.05);
  const at = (t: number) => a.clone().lerp(c, t).add(new Vector3(0, -sag * 4 * t * (1 - t), 0));
  tube(P.iron, Array.from({ length: n + 1 }, (_, k) => at(k / n)), Array.from({ length: n + 1 }, () => 0.02), 3);
  const colours: readonly Col[] = [[1.45, 0.42, 0.38], [1.4, 1.15, 0.42], [0.5, 1.1, 0.72], [0.62, 0.8, 1.45]];
  for (let k = 0; k < n; k++) {
    const p0 = at((k + 0.1) / n), p1 = at((k + 0.9) / n), pm = at((k + 0.5) / n).add(new Vector3(0, -size * 1.2, 0));
    const col = colours[k % colours.length]!;
    const i0 = P.B.trim.vert(p0.x, p0.y, p0.z, 0, 1, col), i1 = P.B.trim.vert(pm.x, pm.y, pm.z, 0.5, 0, col), i2 = P.B.trim.vert(p1.x, p1.y, p1.z, 1, 1, col);
    // Wound so the pennant faces the street (+z), wherever the string runs.
    if ((pm.x - p0.x) * (p1.y - p0.y) - (pm.y - p0.y) * (p1.x - p0.x) > 0) P.B.trim.tri(i0, i1, i2);
    else P.B.trim.tri(i0, i2, i1);
  }
}

/**
 * Bunting for the launch: a string of pennants across the main building's front just below the eaves, and one from
 * each top corner down to the street lamps either side, over the pavement. Plain colours, no lights.
 */
function bunting(P: Parts, f: Frame, main: Built, lamps: readonly Vector3[]) {
  const y = Math.max(3.6, main.eaves - 0.55), z = main.d / 2 + 0.32;
  const corner = (side: number) => new Vector3(...toWorld(f, side * (main.w / 2 + 0.15), y, z));
  pennants(P, corner(-1), corner(1), 0.62);
  for (const head of lamps) pennants(P, corner(head.x < f.x ? -1 : 1), head.clone().add(new Vector3(0, -0.35, 0)), 0.62);
}

// ---------- the street ----------

/** A neighbour: an ordinary house, or (on a shop street) another shop with its own awning and fascia. */
function neighbour(P: Parts, f: Frame, r: () => number, w: number, asShop: boolean, colour: Awning): number {
  const floors = 2 + Math.floor(r() * 2);
  const h = floors * (2.85 + r() * 0.3);
  const rise = 1.8 + r();
  const brick = r() < 0.55;
  house(P.B, f, {
    w, d: 5.0, h, floors, rise, wall: brick ? "brick" : "plaster", tint: (brick ? BRICK_TINTS : PLASTER_TINTS)[Math.floor(r() * 4)]!, roofTint: ROOF_TINTS[Math.floor(r() * 3)]!,
    chimney: r() < 0.7 ? (r() < 0.5 ? -1 : 1) : 0, door: !asShop, sides: true,
    ...(asShop ? { front: { cell: CELL.shop, fascia: colour === "red" ? FASCIA.oxblood! : FASCIA.navy! } } : {}),
  });
  if (asShop) {
    const L = shopfrontLayout(w);
    awning(P.canvas, f, L.window.x0 - 0.1, L.window.x1 + 0.1, L.fasciaY - 0.04, 2.5 + 0.14, 1.3, 0.45, colour);
  }
  return h + rise + 1.2;
}

function dressStreet(s: IslandShape, gm: GenericMaterials, km: KitMaterials, theme: Theme, people: number, props: readonly Prop[]): Dressed {
  const { r, R, height, outline } = s;
  const P: Parts = {
    B: newBuilders(), iron: new Builder(), glass: new Builder(), wood: new Builder(), canvas: new Builder(), metal: new Builder(), ember: new Builder(),
    people: new Builder(), bark: new Builder(), leaves: new Builder(), glows: [],
  };
  const street = new Builder();
  // The main building at the back, square to the view; neighbours either side, a little set back and turned in.
  const zMain = -R * 0.3;
  const build = MAIN[theme] ?? office;
  const mf = frameAt(0, height(0, zMain), zMain, 0);
  const main = build(P, mf, r);
  const front = zMain + main.d / 2;
  const crew = people > 0 ? workCrew(P, km, s, theme, Math.min(6, people), front) : null;
  let topY = main.top;
  // What this path decides (pathScenery), drawn with no random numbers so nothing else on the island changes.
  if (props.includes("notyet")) scaffolding(P, mf, main);
  if (props.includes("dayjob")) topY = Math.max(topY, dayJobTower(P, s, main, zMain));
  const shopStreet = theme === "shop";
  for (const side of [-1, 1]) {
    const nw = 4.4 + r() * 1.2;
    const nx = side * (main.w / 2 + nw / 2 + 0.35);
    const nz = front - 2.5 - 0.25;
    const nf = frameAt(nx, height(nx, nz), nz, -side * 0.12);
    topY = Math.max(topY, neighbour(P, nf, r, nw, shopStreet, side < 0 ? "red" : "green"));
  }
  // The street: cobbles from the building line out across the island, curving towards the viewer at both ends, with a
  // kerb along its front edge.
  const zBack = front + 0.06;
  const zFront = (x: number) => front + 6.2 + 0.014 * x * x;
  const clamp = (x: number, z: number): [number, number] => {
    const a = Math.atan2(z, x), lim = outline(a) * 0.95, d = Math.hypot(x, z);
    return d > lim ? [(x / d) * lim, (z / d) * lim] : [x, z];
  };
  const rows: [number, number][] = [];
  const kerb: Vector3[] = [];
  for (let x = -R * 1.05; x <= R * 1.05; x += 0.7) {
    const [bx, bz] = clamp(x, zBack - (Math.abs(x) > main.w / 2 + 6 ? 1.2 : 0));
    const [fx, fz] = clamp(x, zFront(x));
    if (fz - bz < 0.4) continue;
    const tone = 0.95 + 0.1 * Math.sin(x * 1.7);
    rows.push([street.vert(bx, height(bx, bz) + 0.05, bz, bx / 3, bz / 3, [0.82 * tone, 0.76 * tone, 0.72 * tone]), street.vert(fx, height(fx, fz) + 0.05, fz, fx / 3, fz / 3, [0.82 * tone, 0.76 * tone, 0.72 * tone])]);
    if (Math.hypot(fx, fz) < outline(Math.atan2(fz, fx)) * 0.93) kerb.push(new Vector3(fx, height(fx, fz), fz));
  }
  for (let i = 0; i + 1 < rows.length; i++) street.quad(rows[i]![0], rows[i]![1], rows[i + 1]![1], rows[i + 1]![0]);
  for (let i = 0; i + 1 < kerb.length; i++) {
    const a = kerb[i]!, b = kerb[i + 1]!;
    const m = a.clone().add(b).multiplyScalar(0.5);
    box(P.B.trim, frameAt(m.x, m.y, m.z, Math.atan2(b.x - a.x, b.z - a.z) + Math.PI / 2), 0, -0.15, 0, a.distanceTo(b) + 0.02, 0.3, 0.26, [0.7, 0.68, 0.7]);
  }
  // Street lamps along the kerb; the middle one carries the light when the island is in focus.
  let lamp = new Vector3(0, height(0, zFront(0)) + 3.6, zFront(0) - 0.4);
  const sideLamps: Vector3[] = [];
  for (const fx of [-0.55, 0, 0.55]) {
    const x = fx * R, z = zFront(x) - 0.45;
    if (Math.hypot(x, z) > outline(Math.atan2(z, x)) * 0.9) continue;
    const head = lampPost(P.iron, P.glass, new Vector3(x, height(x, z), z), fx === 0 ? 3.5 : 3.2);
    P.glows.push({ position: head, size: 1.45 });
    if (fx === 0) lamp = head;
    else sideLamps.push(head);
  }
  if (props.includes("open") && !props.includes("notyet")) bunting(P, mf, main, sideLamps);
  // A bench on the far pavement, and a tree at each front corner of the island.
  const bx = -R * 0.28, bz = zFront(-R * 0.28) + 1.0;
  if (Math.hypot(bx, bz) < outline(Math.atan2(bz, bx)) * 0.86) {
    const bf = frameAt(bx, height(bx, bz), bz, Math.PI);
    box(P.wood, bf, 0, 0.42, 0, 1.6, 0.08, 0.45, [0.52, 0.38, 0.3], 1.2);
    box(P.wood, bf, 0, 0.5, -0.2, 1.6, 0.45, 0.07, [0.52, 0.38, 0.3], 1.2);
    for (const lx of [-0.7, 0.7]) box(P.iron, bf, lx, 0, 0, 0.07, 0.45, 0.42, [1, 1, 1]);
  }
  for (const side of [-1, 1]) {
    const tx = side * R * (0.5 + r() * 0.12), tz = zFront(side * R * 0.5) + 2.6 + r() * 1.5;
    if (Math.hypot(tx, tz) > outline(Math.atan2(tz, tx)) * 0.86) continue;
    topY = Math.max(topY, tree(P.bark, P.leaves, r, new Vector3(tx, 0, tz), height(tx, tz) - 0.1, AUTUMN, 0.78));
  }
  rimGreenery(P.leaves, s, Math.PI / 2);
  return {
    parts: [
      ...finish(P.B, km, r), [street, gm.plaza, true], [P.wood, km.wood, true], [P.canvas, km.awning, true], [P.metal, km.metal, true], [P.ember, km.ember, false],
      [P.people, km.figures, false], [P.iron, gm.iron, true], [P.glass, gm.glass, false], [P.bark, gm.bark, true], [P.leaves, gm.leaves, true],
    ],
    lamp, glows: P.glows, top: topY,
    ...(crew ? { extras: crew.extras, animate: crew.animate, dispose: crew.dispose } : {}),
  };
}

export function businessSite(theme: Theme, people: number, props: readonly Prop[] = []): Site {
  return { base: { dome: 0.18, bumps: 0.07, tint: [0.9, 0.96, 0.82], radius: [15.5, 17.5], boulders: 2 }, top: "grass", dress: (s, gm, km) => dressStreet(s, gm, km, theme, people, props) };
}
