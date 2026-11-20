import {
  CanvasTexture, Color, DoubleSide, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, SRGBColorSpace, Vector3,
} from "three";
import { assemble, Builder, lampPost, rng, tube } from "../scene/generic";
import { box, cone, dome, drum, face, frameAt, hoop, strip, toWorld, type Frame, type V3 } from "../scene/kitParts";
import { BOOKSHOP, COURTYARD, type Footprint } from "./navigation";

const tint = (hex: string): V3 => {
  const { r, g, b } = new Color(hex);
  return [r, g, b];
};
const STONE = ["#30324a", "#3d3c53", "#48465b", "#595569", "#666172", "#403a4b"].map(tint);
const PAVERS = ["#3b3d51", "#45475b", "#4a495c", "#525264", "#57556a", "#454150"].map(tint);
const TIMBER = tint("#2d2029"), IRON = tint("#222435"), SLATE = ["#343046", "#44425b", "#514860"].map(tint);
const DARK = tint("#171825"), GOLD = tint("#a98a62"), BEAM = tint("#523a38");
const UV = [[0, 0], [1, 0], [1, 1], [0, 1]] as const;
const ground = frameAt(0, 0, 0, 0);
const TAU = 2 * Math.PI;

type Building = Footprint & { readonly turn: number; readonly h: number; readonly wall: string; readonly rise: number; readonly ridge?: number };
const SHOP: Building = { ...BOOKSHOP, turn: 0, h: 5.15, wall: "#515358", rise: 2.15, ridge: -0.57 };
const HALL: Building = { x: -7.8, z: -9.6, w: 4.9, d: 4.8, turn: 0, h: 5.9, wall: "#785e60", rise: 1.75 };
const SCHOOL: Building = { x: 4.55, z: -9.8, w: 5.25, d: 4.2, turn: 0, h: 4.75, wall: "#817260", rise: 2.05 };
const BUILDINGS: Building[] = [
  SHOP, HALL, SCHOOL,
  { x: 9.65, z: -9.9, w: 4.6, d: 4.5, turn: 0, h: 4.05, wall: "#575669", rise: 2.1 },
  { x: -11.6, z: -4.55, w: 5.2, d: 5.0, turn: Math.PI / 2, h: 4.6, wall: "#6c606b", rise: 1.8 },
  { x: 11.35, z: -3.65, w: 6.5, d: 4.6, turn: -Math.PI / 2, h: 5.7, wall: "#716376", rise: 2.45, ridge: 0.34 },
  { x: -11.65, z: 3.4, w: 7.6, d: 4.6, turn: Math.PI / 2, h: 5.3, wall: "#807265", rise: 2.25, ridge: -0.32 },
  { x: 12.2, z: 4.15, w: 6.8, d: 4.7, turn: -Math.PI / 2, h: 4.9, wall: "#555568", rise: 2.1 },
];
const LAMPS = [[-5.25, 7.25], [5.35, 6.25], [-6.25, -3.55], [5.45, -4.25]] as const;
export const WELL = { x: -3.95, z: 0.55, w: 2.5, d: 2.5 };
export const BELL = { x: 2.35, z: -15.8, w: 3.65, d: 3.65 };
export const BELL_PULL = { x: 0.82, z: -0.5, w: 0.54, d: 0.36 };
const CRATES = { x: -6.28, z: -6.7, w: 0.88, d: 0.57 };

function paving(b: Builder, detail: boolean) {
  const random = rng(5081);
  box(b, ground, 0, -0.35, -1.55, 124, 0.2, 124, STONE[0]!);
  box(b, ground, 0, -0.23, -1.55, 32, 0.2, 33, STONE[0]!);
  const row = 0.47, step = 0.63;
  const end = COURTYARD.z + COURTYARD.d / 2 + 0.75;
  for (let iz = 0; iz < 55; iz++) {
    const z = end - iz * row;
    for (let ix = -21; ix <= 21; ix++) {
      const x = (ix + (iz % 2) * 0.5) * step + (random() - 0.5) * 0.035;
      const w = 0.25 + random() * 0.055, d = 0.181 + random() * 0.037;
      const level = 0.014 + random() * 0.031;
      const shade = PAVERS[Math.floor(random() ** 1.45 * PAVERS.length)]!;
      const lane = Math.abs(z - 8.3) < row || Math.abs(z + 5.8) < row || Math.abs(Math.abs(x) - 6.5) < step * 0.45;
      const color = lane ? PAVERS[3 + (iz + ix + 42) % 2]! : shade;
      const skew = (random() - 0.5) * 0.07;
      const corners = [[-w + skew, d], [w, d - skew], [w - skew, -d], [-w, -d + skew]] as const;
      const top = corners.map(([a, c]) => b.vert(x + a * 0.87, level, z + c * 0.83, 0, 0, color));
      b.quad(top[0]!, top[1]!, top[2]!, top[3]!);
      if (detail) {
        const base = corners.map(([a, c]) => b.vert(x + a, -0.023, z + c, 0, 0, color));
        for (let i = 0; i < 4; i++) {
          const next = (i + 1) % 4;
          b.quad(base[i]!, base[next]!, top[next]!, top[i]!);
        }
      }
    }
  }
}

function arch(surface: Builder, trim: Builder, f: Frame, x: number, y: number, z: number, w: number, h: number, color: V3, frame: V3, lattice = true) {
  const shoulder = y + h * 0.72;
  const outline = [
    [x - w / 2, y], [x + w / 2, y], [x + w / 2, shoulder],
    [x + w * 0.31, y + h * 0.91], [x, y + h], [x - w * 0.31, y + h * 0.91], [x - w / 2, shoulder],
  ] as const;
  const center = surface.vert(...toWorld(f, x, y + h * 0.45, z), 0, 0, color);
  const points = outline.map(([a, b]) => surface.vert(...toWorld(f, a, b, z), 0, 0, color));
  for (let i = 0; i < points.length; i++) {
    const next = (i + 1) % points.length;
    surface.tri(center, points[i]!, points[next]!);
    strip(trim, f, outline[i]!, outline[next]!, z + 0.045, 0.09, frame);
  }
  if (lattice) {
    strip(trim, f, [x, y], [x, y + h * 0.97], z + 0.047, 0.045, TIMBER);
    strip(trim, f, [x - w / 2, y + h * 0.53], [x + w / 2, y + h * 0.53], z + 0.047, 0.05, TIMBER);
  }
}

function colorFrom(b: Builder, start: number, color: V3) {
  for (let i = start; i < b.col.length; i += 3) {
    b.col[i] = color[0];
    b.col[i + 1] = color[1];
    b.col[i + 2] = color[2];
  }
}

function facade(b: Builder, light: Builder, magic: Builder, building: Building, index: number, detail: boolean) {
  const f = frameAt(building.x, 0, building.z, building.turn);
  const { w, d, h, rise, ridge = 0 } = building;
  const wx = w / 2, z = d / 2, color = tint(building.wall);
  const shop = building === SHOP;
  const random = rng(912 + index * 271);
  box(b, f, 0, -0.1, 0, w, h + 0.1, d, color);
  box(b, f, 0, 0, 0, w + 0.15, 0.42, d + 0.15, STONE[1]!);
  for (let j = 0; j < (detail ? 8 : 4); j++) {
    const x = (random() - 0.5) * (w - 0.8), y = 0.55 + random() * (h - 0.75);
    for (const [shift, height] of [[-0.24, 0], [0.09, 0.02], [-0.07, 0.15]] as const) {
      const aging = 0.67 + random() * 0.45;
      box(b, f, x + shift, y + height, z, 0.26 + random() * 0.13, 0.088, 0.018,
        [color[0] * aging, color[1] * aging, color[2] * aging]);
    }
  }
  for (const side of [-1, 1]) {
    const peak = [ridge, h + rise, side * z] as const;
    const a = [-wx, h, side * z] as const, c = [wx, h, side * z] as const;
    face(b, f, side > 0 ? [a, c, peak] : [c, a, peak], UV, color);
  }
  // Individual slate strips across each roof slope, with a bowed ridge on the older buildings.
  for (const side of [-1, 1]) {
    const eave = side * (wx + 0.28);
    const ridgeHeight = (z: number) => h + rise - 0.26 * (1 - (z / (d / 2 + 0.3)) ** 2);
    const edge = d / 2 + 0.3;
    const deck = [[eave, h - 0.18, -edge], [eave, h - 0.18, edge], [ridge, h + rise - 0.28, edge], [ridge, h + rise - 0.28, -edge]] as V3[];
    face(b, f, side < 0 ? deck : deck.reverse(), UV, SLATE[0]!);
    const rows = detail ? 9 : 5;
    for (let i = 0; i < rows; i++) {
      const lo = i / rows, hi = (i + 1) / rows;
      const span = d / 2 + 0.31, start = -span + (i % 2) * 0.27;
      for (let l = -span; l < span - 0.01;) {
        const r = Math.min(span, l === -span && start > l ? start : l + 0.54);
        const vertex = (t: number, depth: number, lip = 0): V3 => [
          eave + t * (ridge - eave), h - 0.16 + t * (ridgeHeight(depth) - h + 0.16) + lip, depth,
        ];
        const pts = [vertex(lo, l, 0.034), vertex(lo, r, 0.034), vertex(hi, r), vertex(hi, l)];
        face(b, f, side < 0 ? pts : pts.reverse(), UV, SLATE[Math.floor(random() * SLATE.length)]!);
        l = r;
      }
    }
    strip(b, f, [side * (wx + 0.22), h - 0.16], [ridge, h + rise - 0.025], z + 0.31, 0.17, TIMBER);
    box(b, f, side * (wx - 0.19), 0.41, z + 0.065, 0.22, h - 0.27, 0.22, BEAM);
    if (shop || index % 3 === 1) strip(b, f, [side * wx * 0.69, h + 0.14], [ridge, h + rise * 0.77], z + 0.038, 0.11, BEAM);
  }
  box(b, f, w * 0.27, h - 0.73, -d * 0.28, 0.78, rise + 1.4, 0.84, tint("#58434d"));
  box(b, f, w * 0.27, h + rise + 0.61, -d * 0.28, 0.95, 0.17, 0.99, STONE[1]!);
  for (const x of [-wx + 0.22, wx - 0.22]) {
    for (let y = 0.65; y < h - 0.22; y += 0.43) {
      box(b, f, x, y, z + 0.024, 0.32 + 0.18 * (Math.round(y / 0.43) % 2), 0.31, 0.11, STONE[(index + Math.round(y)) % 3 + 1]!);
    }
  }
  box(b, f, 0, shop ? 3.4 : 2.73, z + 0.065, w + 0.04, 0.18, 0.25, BEAM);
  if (shop || index % 3 === 1) {
    box(b, f, ridge, h - 0.05, z + 0.04, 0.13, rise - 0.12, 0.11, BEAM);
    box(b, f, 0, h - 0.14, z + 0.06, w + 0.14, 0.16, 0.17, BEAM);
  }
  for (const [j, x] of [-0.28 * w, 0, 0.28 * w].entries()) {
    const glow = (index + j) % 4 !== 2;
    arch(glow ? light : b, b, f, x, h - 1.95 + 0.07 * j, z + 0.018, 0.76, 1.39, glow ? tint(j === 1 ? "#b47757" : "#ecad6b") : DARK, BEAM);
    box(b, f, x, h - 2.06 + 0.07 * j, z + 0.15, 0.98, 0.11, 0.3, STONE[3]!);
  }
  arch(b, b, f, 0, 0.13, z + 0.038, 1.04, 2.14, tint(shop ? "#473339" : "#302732"), BEAM, false);
  for (const x of [-0.24, 0, 0.24]) box(b, f, x, 0.33, z + 0.049, 0.025, 1.48, 0.025, BEAM);
  for (const side of [-1, 1]) {
    box(b, f, side * 0.59, 0.13, z + 0.055, 0.14, 1.55, 0.17, STONE[2]!);
    for (const y of [0.26, 0.79, 1.31]) box(b, f, side * 0.59, y, z + 0.096, 0.17, 0.065, 0.12, STONE[4]!);
  }
  box(b, f, 0.31, 1.03, z + 0.08, 0.065, 0.085, 0.055, GOLD);
  box(b, f, 0, -0.04, z + 0.19, 1.45, 0.17, 0.44, STONE[4]!);
  for (const side of [-1, 1]) {
    const x = side * w * 0.285;
    const width = shop ? 1.45 : 0.83;
    arch(shop ? magic : light, b, f, x, 0.76, z + 0.026, width, 1.66, shop ? tint("#d39fae") : tint("#ab7354"), BEAM, !shop);
    box(b, f, x, 0.66, z + 0.14, width + 0.24, 0.13, 0.3, STONE[3]!);
    if (shop) {
      for (const shelf of [0.89, 1.44]) {
        box(b, f, x, shelf, z + 0.074, 1.43, 0.073, 0.065, TIMBER);
        for (let i = 0; i < 8; i++) {
          const color = [DARK, tint("#664047"), tint("#575071"), GOLD][i % 4]!;
          box(b, f, x - 0.61 + i * 0.163, shelf + 0.07, z + 0.068, 0.092 + random() * 0.045, 0.17 + random() * 0.25, 0.045, color);
        }
      }
      strip(b, f, [x, 0.75], [x, 2.38], z + 0.108, 0.046, TIMBER);
    } else {
      const shutter = x + side * 0.61;
      for (const slat of [-1, 0, 1]) {
        box(b, f, shutter + 0.103 * slat, 0.81, z + 0.062, 0.096, 1.18, 0.075, slat === 0 ? BEAM : TIMBER);
      }
      for (const y of [1.01, 1.67]) box(b, f, shutter, y, z + 0.104, 0.32, 0.055, 0.034, STONE[2]!);
    }
  }
  if (shop) {
    box(b, f, 0, 2.58, z + 0.12, 5.94, 0.72, 0.23, GOLD);
    box(b, f, 0, 2.61, z + 0.233, 5.86, 0.66, 0.02, tint("#392c41"));
    const awning: V3[] = [[-2.99, 2.57, z + 0.25], [-2.99, 2.43, z + 0.65], [2.99, 2.43, z + 0.65], [2.99, 2.57, z + 0.25]];
    face(b, f, awning, UV, SLATE[1]!);
    box(b, f, 0, 2.38, z + 0.65, 5.98, 0.08, 0.11, BEAM);
  }
}

function bellTower(b: Builder, light: Builder) {
  const f = frameAt(BELL.x, 0, BELL.z, 0);
  box(b, f, 0, 0, 0, 3.65, 9.35, 3.65, STONE[2]!);
  for (const y of [4.3, 6.95, 9.22, 9.62]) box(b, f, 0, y, 0, 3.98, 0.21, 3.98, STONE[3]!);
  for (const turn of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const side = frameAt(BELL.x, 0, BELL.z, turn);
    arch(b, b, side, 0, 7.2, 1.837, 1.38, 1.95, DARK, STONE[4]!, false);
    arch(light, b, side, 0, 5.1, 1.84, 0.44, 1.12, tint("#b68b70"), STONE[4]!, false);
    const bell = frameAt(side.x + side.s * 1.92, 0, side.z + side.c * 1.92, turn);
    if (turn !== 0) {
      dome(b, bell.x, 7.44, bell.z, 0.39, 0.93, 10, GOLD, 5);
      drum(b, bell.x, 7.34, bell.z, 0.45, 0.10, 10, GOLD);
    }
  }
  cone(b, BELL.x, 9.82, BELL.z, 2.34, 5.12, 8, SLATE[0]!);
  drum(b, BELL.x, 14.6, BELL.z, 0.06, 1.07, 6, GOLD);
  box(b, f, 0, 15.25, 0, 0.54, 0.077, 0.07, GOLD);
}

function courtyardDetails(b: Builder) {
  // A roster board and pull in the square serve the belfry without opening the rear lane.
  const pull = frameAt(BELL_PULL.x, 0, BELL_PULL.z, 0);
  box(b, pull, 0, 0.03, 0, 0.65, 0.24, 0.43, STONE[2]!);
  box(b, pull, 0, 0.19, 0, 0.26, 2.05, 0.26, TIMBER);
  box(b, pull, 0, 1.89, 0.09, 0.63, 0.26, 0.16, BEAM);
  cone(b, BELL_PULL.x, 2.19, BELL_PULL.z, 0.24, 0.26, 4, SLATE[1]!);
  drum(b, BELL_PULL.x, 0.82, BELL_PULL.z + 0.19, 0.026, 1.08, 6, GOLD);
  hoop(b, new Vector3(BELL_PULL.x, 0.76, BELL_PULL.z + 0.22),
    new Vector3(1, 0, 0), new Vector3(0, 1, 0), 0.096, 0.021, 10, 5, GOLD);
  // Delivery crates, book bundles and a wax seal outside the shop.
  const crates = frameAt(CRATES.x, 0, CRATES.z, 0);
  box(b, crates, 0, 0.04, 0, 0.88, 0.48, 0.57, TIMBER);
  for (const x of [-0.33, 0.33]) box(b, crates, x, 0.06, 0.285, 0.086, 0.48, 0.048, BEAM);
  for (const [i, cover] of ["#724353", "#696582", "#695447"].entries()) {
    const book = frameAt(CRATES.x + i * 0.044 - 0.1, 0.51 + i * 0.081, CRATES.z, i * 0.17);
    box(b, book, 0, 0, 0, 0.45, 0.084, 0.32, tint(cover));
    box(b, book, 0.11, 0.015, 0.16, 0.22, 0.054, 0.019, GOLD);
  }
  for (const side of [-1, 1]) {
    const x = side * 11.95;
    for (const z of [8.3, 11.2]) {
      box(b, ground, x, 0.03, z, 0.47, 1.34, 0.46, STONE[2]!);
      cone(b, x, 1.36, z, 0.34, 0.28, 4, STONE[3]!);
    }
    box(b, ground, x, 1.16, 9.75, 0.073, 0.07, 2.88, IRON);
    for (let i = 1; i <= 10; i++) {
      const z = 8.3 + i * 0.26;
      box(b, ground, x, 0.69, z, 0.063, 0.59, 0.055, IRON);
      cone(b, x, 1.28, z, 0.061, 0.12, 4, IRON);
    }
  }
}

function square(b: Builder, light: Builder, detail: boolean) {
  const random = rng(0x507a);
  const { x, z } = WELL;
  drum(b, x, 0, z, 1.25, 0.18, 12, STONE[2]!);
  drum(b, x, 0.16, z, 1.08, 0.76, 12, STONE[3]!, 2, false);
  for (let ring = 0; ring < 3; ring++) {
    const y = 0.22 + ring * 0.22;
    for (let i = 0; i < 12; i++) {
      const point = (angle: number, y: number): V3 => [x + 1.1 * Math.cos(angle), y, z + 1.1 * Math.sin(angle)];
      const a = TAU * (i + 0.025) / 12, c = TAU * (i + 0.975) / 12;
      face(b, ground, [point(c, y), point(a, y), point(a, y + 0.19), point(c, y + 0.19)], UV, STONE[2 + (ring + 2 * i) % 3]!);
    }
  }
  drum(b, x, 0.89, z, 1.16, 0.16, 12, STONE[4]!);
  drum(b, x, 1.054, z, 0.88, 0.012, 12, DARK);
  hoop(b, new Vector3(x, 1.055, z), new Vector3(1, 0, 0), new Vector3(0, 0, 1), 0.95, 0.1, 12, 5, STONE[3]!);
  const well = frameAt(x, 0, z, 0);
  for (const s of [-1, 1]) box(b, well, s * 0.96, 0.06, 0, 0.16, 2.43, 0.18, TIMBER);
  box(b, well, 0, 2.29, 0, 2.15, 0.18, 0.21, BEAM);
  drum(b, x, 1.12, z, 0.028, 1.17, 5, GOLD);
  for (const [x, z] of LAMPS) {
    const height = 2.62 + random() * 0.24;
    drum(b, x, 0, z, 0.26, 0.18, 8, STONE[3]!);
    const f = frameAt(x, 0, z, 0);
    const start = b.col.length;
    const head = lampPost(b, light, new Vector3(x, 0.18, z), height, 0.19, 0.29);
    for (const a of [-1, 1]) for (const c of [-1, 1]) {
      tube(b, [new Vector3(x + a * 0.19, head.y - 0.29, z + c * 0.19), new Vector3(x + a * 0.227, head.y + 0.29, z + c * 0.227)], [0.025, 0.019], 4);
    }
    colorFrom(b, start, IRON);
    box(b, f, 0, head.y - 0.35, 0, 0.49, 0.059, 0.49, IRON);
    cone(b, x, head.y + 0.47, z, 0.073, 0.3, 5, IRON);
  }
  // A closed entrance gate and low perimeter walls explain the limits of the public square.
  const back = 12.1;
  for (const side of [-1, 1]) {
    box(b, ground, side * 7.86, -0.05, back, 8.23, 1.18, 0.52, STONE[1]!);
    box(b, ground, side * 7.86, 1.09, back, 8.42, 0.15, 0.66, STONE[2]!);
    box(b, ground, side * 3.65, -0.05, back, 0.82, 2.85, 0.83, STONE[3]!);
    cone(b, side * 3.65, 2.76, back, 0.68, 0.57, 4, STONE[2]!);
    box(b, ground, side * 11.95, 0, 0.55, 0.38, 0.73, 23.07, STONE[1]!);
  }
  for (let i = -13; i <= 13; i++) {
    const h = 2.63 + 0.46 * (1 - Math.abs(i) / 13);
    box(b, ground, i * 0.25, 0, back, 0.06, h, 0.08, IRON);
    cone(b, i * 0.25, h, back, 0.067, 0.17, 4, IRON);
  }
  for (const y of [0.35, 1.66, 2.17]) box(b, ground, 0, y, back, 6.81, 0.08, 0.09, IRON);
  box(b, ground, 0, 0, -11.14, 23.8, 1.03, 0.42, STONE[1]!);
  // Pollarded trees frame the view along the terraces.
  for (const [x, z, side] of [[-8.9, 8.65, -1], [8.95, 8.6, 1], [-7.8, -7.03, -1], [7.95, -7.53, 1]] as const) {
    const start = b.col.length;
    const end = new Vector3(x + side * 0.82, 4.5 + random() * 1.4, z - 0.2);
    const fork = new Vector3(x + side * 0.31, 2.3, z - 0.09);
    tube(b, [new Vector3(x, 0, z), new Vector3(x - side * 0.17, 0.8, z + 0.13), fork, end], [0.27, 0.23, 0.16, 0.033], 7);
    for (let i = 0; i < (detail ? 5 : 3); i++) {
      const base = fork.clone().lerp(end, random() * 0.7);
      const tip = base.clone().add(new Vector3((random() - 0.5) * 2.45, 0.65 + random() * 1.05, (random() - 0.5) * 1.9));
      const mid = base.clone().lerp(tip, 0.58).add(new Vector3(-0.2, -0.17, 0.14));
      tube(b, [base, mid, tip], [0.098, 0.063, 0.012], 6);
      const twig = mid.clone().add(new Vector3(side * 0.63, 0.44, -0.53));
      tube(b, [mid, twig], [0.045, 0.008], 5);
    }
    colorFrom(b, start, TIMBER);
  }
}

function pumpkins(b: Builder, light: Builder) {
  const random = rng(13973);
  const rind = [tint("#a7481c"), tint("#cf701f")];
  for (const [x, z, count] of [[-5.12, -6.48, 4], [1.19, -6.51, 3], [-5.55, 7.15, 3], [6.15, 6.77, 2], [-4.95, 0.5, 2]] as const) {
    for (let i = 0; i < count; i++) {
      const px = x + i * 0.39, pz = z + (random() - 0.4) * 0.69;
      const size = 0.17 + random() * 0.145;
      const y = size * 0.77;
      const points: number[][] = [];
      for (let j = 0; j <= 6; j++) {
        const a = Math.PI * j / 6;
        points.push(Array.from({ length: 16 }, (_, k) => {
          const t = TAU * k / 16, radius = size * Math.sin(a) * (k % 2 ? 1 : 0.9);
          return b.vert(px + Math.cos(t) * radius, y + Math.cos(a) * y * 0.94 + 0.05, pz + Math.sin(t) * radius, 0, 0, rind[k % 2]!);
        }));
      }
      for (let j = 0; j < 6; j++) for (let k = 0; k < 16; k++) {
        b.quad(points[j]![k]!, points[j]![(k + 1) % 16]!, points[j + 1]![(k + 1) % 16]!, points[j + 1]![k]!);
      }
      const f = frameAt(px, 0.055, pz, (random() - 0.5) * 0.65);
      const start = b.col.length;
      tube(b, [new Vector3(px, y * 1.84, pz), new Vector3(px + 0.044, y * 1.96 + 0.077, pz + 0.032)], [size * 0.17, size * 0.105], 6);
      colorFrom(b, start, tint("#555039"));
      for (const s of [-1, 1]) {
        face(light, f, [[s * size * 0.31 - size * 0.14, y * 1.09, size * 0.955], [s * size * 0.31 + size * 0.14, y * 1.09, size * 0.955], [s * size * 0.31, y * 1.43, size * 0.921]], UV, tint("#ffbd53"));
      }
      face(light, f, [[-size * 0.34, y * 0.82, size * 0.955], [0, y * 0.55, size * 0.927], [size * 0.34, y * 0.82, size * 0.955], [0, y * 0.68, size * 0.963]], UV, tint("#ffb245"));
    }
  }
}

export function modelSign(label: string, width: number, height: number) {
  const bitmap = document.createElement("canvas");
  bitmap.height = 84;
  bitmap.width = Math.round(bitmap.height * width / height);
  const ink = bitmap.getContext("2d")!;
  const texture = new CanvasTexture(bitmap);
  let inscription = label;
  function write(text: string) {
    inscription = text;
    ink.fillStyle = "#342638";
    ink.fillRect(0, 0, bitmap.width, bitmap.height);
    ink.strokeStyle = "#896a52";
    ink.lineWidth = 2;
    ink.strokeRect(5, 5, bitmap.width - 10, bitmap.height - 10);
    ink.fillStyle = "#f4d6a5";
    ink.textAlign = "center";
    ink.textBaseline = "middle";
    ink.font = "600 42px Georgia, serif";
    ink.fillText(text, bitmap.width / 2, bitmap.height / 2, bitmap.width - 24);
    texture.needsUpdate = true;
  }
  write(label);
  texture.colorSpace = SRGBColorSpace;
  const material = new MeshBasicMaterial({ map: texture, color: "#c6acb9" });
  const mesh = new Mesh(new PlaneGeometry(width, height), material);
  return { mesh, texture, material, write, get text() { return inscription; } };
}

export function buildCourtyard(detail: boolean) {
  const stone = new Builder(), pavers = new Builder(), lanterns = new Builder(), magic = new Builder();
  paving(pavers, detail);
  BUILDINGS.forEach((building, i) => facade(stone, lanterns, magic, building, i, detail));
  bellTower(stone, lanterns);
  square(stone, lanterns, detail);
  courtyardDetails(stone);
  pumpkins(stone, lanterns);
  const solid = new MeshStandardMaterial({ vertexColors: true, roughness: 0.88 });
  const light = new MeshBasicMaterial({ vertexColors: true, color: "#ffc880", side: DoubleSide });
  const windows = new MeshBasicMaterial({ vertexColors: true, color: "#79728a" });
  const batch = assemble("The Hollow courtyard", [[stone, solid, false], [pavers, solid, false], [lanterns, light, false], [magic, windows, false]]);
  const bellBuilder = new Builder();
  dome(bellBuilder, 0, -0.86, 0, 0.39, 0.93, 10, GOLD, 5);
  drum(bellBuilder, 0, -0.96, 0, 0.45, 0.1, 10, GOLD);
  const bell = new Mesh(bellBuilder.geometry(), solid);
  bell.position.set(BELL.x, 8.8, BELL.z + 1.98);
  const sign = modelSign("The Whispering Bookshop", 5.71, 0.625);
  sign.mesh.position.set(BOOKSHOP.x, 2.94, BOOKSHOP.z + BOOKSHOP.d / 2 + 0.25);
  const pullSign = modelSign("Bell pull", 0.55, 0.17);
  pullSign.mesh.position.set(BELL_PULL.x, 2.02, BELL_PULL.z + 0.18);
  const boards = new Builder();
  const front = frameAt(BOOKSHOP.x, 0, BOOKSHOP.z + BOOKSHOP.d / 2, 0);
  for (const side of [-1, 1]) {
    const x = side * BOOKSHOP.w * 0.285;
    for (const slat of [-1, 0, 1]) box(boards, front, x + slat * 0.50, 0.78, 0.19, 0.49, 1.67, 0.08, TIMBER);
    for (const y of [1.06, 2.01]) box(boards, front, x, y, 0.25, 1.52, 0.10, 0.06, BEAM);
  }
  const shutters = new Mesh(boards.geometry(), solid);
  shutters.visible = false;
  const lending = modelSign("", 4.15, 0.64);
  lending.mesh.visible = false;
  const signs = [sign, pullSign, lending];
  batch.group.add(...signs.map(sign => sign.mesh), shutters, bell);
  const obstacles: Footprint[] = BUILDINGS.map(({ x, z, w, d, turn }) => ({ x, z, w: turn === 0 ? w : d, d: turn === 0 ? d : w }));
  obstacles.push(WELL, BELL_PULL, CRATES, ...LAMPS.map(([x, z]) => ({ x, z, w: 0.5, d: 0.5 })));
  return {
    group: batch.group,
    sign, lending, shutters,
    markLending(site: "hall" | "school" | null, label: string) {
      lending.mesh.visible = site !== null;
      if (!site) return;
      const building = site === "hall" ? HALL : SCHOOL;
      // Only the eastern bay of the hall clears the projecting terrace on its left.
      const hall = site === "hall";
      lending.mesh.scale.x = hall ? 0.74 : 1;
      lending.mesh.position.set(hall ? CRATES.x - 0.50 : building.x, 2.46, building.z + building.d / 2 + 0.25);
      lending.write(label);
    },
    lamps: LAMPS,
    obstacles,
    sightlines: obstacles.filter((obstacle) => obstacle !== CRATES),
    windows,
    light,
    bell,
    dispose() {
      batch.group.clear();
      for (const geometry of [...batch.geoms, shutters.geometry, bell.geometry]) geometry.dispose();
      for (const material of [solid, light, windows]) material.dispose();
      for (const sign of signs) {
        sign.mesh.geometry.dispose();
        sign.material.dispose();
        sign.texture.dispose();
      }
    },
  };
}
