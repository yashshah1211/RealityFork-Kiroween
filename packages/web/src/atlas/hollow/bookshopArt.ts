import {
  AdditiveBlending, CanvasTexture, Color, DirectionalLight, DoubleSide, HemisphereLight, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, PlaneGeometry, PointLight, Scene, SRGBColorSpace, Vector3,
} from "three";
import { assemble, Builder, glowTexture, rng } from "../scene/generic";
import { box, cone, drum, frameAt, hoop, strip, type Frame, type V3 } from "../scene/kitParts";
import { CANDLE_STANDS, CHAIR, CRATE, DESK, EAST_SHELF, EAST_STACK, LECTERN, SHELF, SHOP_ROOM, WEST_STACK } from "./bookshopLayout";

export const pigment = (hex: string): V3 => {
  const { r, g, b } = new Color(hex);
  return [r, g, b];
};
const WOOD = pigment("#432c29"), JOINERY = pigment("#281d24"), INLAY = pigment("#926045");
const BRASS = pigment("#b99251"), PAPER = pigment("#d8b890"), WALL = pigment("#5d5262");
const NIGHT = pigment("#1a263d"), MOON = pigment("#a7b9ee");
export const BOOK_COLORS = ["#713d42", "#60507b", "#3d5c60", "#877047", "#564053", "#46605b"].map(pigment);
const ground = frameAt(0, 0, 0, 0);

/** Reused woodwork rhythm, with a pointed crown and square pilasters at eye level. */
function gothic(b: Builder, f: Frame, x: number, y: number, z: number, width: number, height: number, color: V3, line = 0.08) {
  const w = width / 2, shoulder = y + height * 0.76;
  const run = [[x - w, y], [x - w, shoulder], [x - w * 0.65, y + height * 0.90], [x, y + height],
    [x + w * 0.65, y + height * 0.90], [x + w, shoulder], [x + w, y]] as const;
  for (let i = 1; i < run.length; i++) strip(b, f, run[i - 1]!, run[i]!, z, line, color);
}

export function bookRow(b: Builder, f: Frame, center: number, y: number, z: number, width: number, seed: number) {
  const random = rng(seed);
  let x = center - width / 2;
  while (x + 0.13 < center + width / 2) {
    const w = 0.075 + random() * 0.087;
    const h = 0.19 + random() * 0.24;
    const color = BOOK_COLORS[Math.floor(random() * BOOK_COLORS.length)]!;
    box(b, f, x + w / 2, y, z + random() * 0.06, w, h, 0.19, color);
    if (random() > 0.46) box(b, f, x + w / 2, y + h * 0.71, z + 0.151, w * 0.85, 0.013, 0.012, BRASS);
    x += w + 0.021;
  }
}

function cabinet(b: Builder, f: Frame, width: number, seed: number, secret: boolean) {
  const front = 0.40, w = width / 2;
  box(b, f, 0, 0.04, -0.33, width, 3.57, 0.14, JOINERY);
  box(b, f, 0, 0.07, 0, width, 0.17, 0.82, JOINERY);
  for (const side of [-1, 1]) {
    box(b, f, side * (w - 0.075), 0.14, 0, 0.16, 3.48, 0.81, WOOD);
    box(b, f, side * (w - 0.085), 0.23, front, 0.12, 3.2, 0.077, INLAY);
  }
  for (const [i, y] of [0.42, 1.02, 1.60, 2.2, 2.76].entries()) {
    box(b, f, 0, y - 0.075, 0, width, 0.079, 0.80, WOOD);
    box(b, f, 0, y - 0.078, front - 0.015, width, 0.044, 0.067, INLAY);
    if (secret && i === 2) {
      // Leave a recessed bay for the movable spines and the key behind them.
      for (const s of [-1, 1]) bookRow(b, f, s * width * 0.35, y, 0.14, width * 0.21, seed + i * 71 + s);
      continue;
    }
    bookRow(b, f, (i % 2 ? 1 : -1) * width * 0.05, y, 0.16, width * (i % 3 === 0 ? 0.67 : 0.83), seed + i * 31);
  }
  box(b, f, 0, 3.05, 0, width, 0.49, 0.77, JOINERY);
  gothic(b, f, 0, 2.25, front + 0.027, width * 0.82, 1.19, INLAY, 0.065);
  box(b, f, 0, 3.52, 0, width + 0.06, 0.12, 0.85, INLAY);
}

function manuscript(b: Builder, x: number, y: number, z: number, turn: number, scale = 1) {
  const f = frameAt(x, y, z, turn);
  box(b, f, 0, 0, 0, 0.235 * scale, 0.006, 0.34 * scale, PAPER);
  for (let i = 0; i < 5; i++) {
    box(b, f, -0.02, 0.006, (i - 2) * 0.035 * scale, (0.13 - (i === 4 ? 0.04 : 0)) * scale, 0.001, 0.006, INLAY);
  }
}

function candle(b: Builder, light: Builder, x: number, y: number, z: number, height: number) {
  drum(b, x, y, z, 0.103, 0.04, 8, BRASS);
  drum(b, x, y + 0.034, z, 0.037, height, 7, PAPER);
  cone(light, x, y + 0.037 + height, z, 0.032, 0.078, 6, pigment("#ffd492"));
}

function floor(b: Builder) {
  const random = rng(0x2a193);
  const boards = ["#513a35", "#674937", "#584038", "#755340", "#63473b"].map(pigment);
  box(b, ground, 0, -0.21, 0, SHOP_ROOM.w + 0.3, 0.20, SHOP_ROOM.d + 0.3, JOINERY);
  for (let ix = 0; ix < 23; ix++) {
    const x = (ix - 11) * 0.345;
    for (let iz = -2; iz <= 2; iz++) {
      const z = iz * 2.10 + (ix % 2 - 0.5) * 0.84;
      box(b, ground, x, -0.039, z, 0.335, 0.039, 2.08, boards[Math.floor(random() * boards.length)]!);
    }
  }
  const rug = frameAt(0, 0.004, 0.85, 0);
  box(b, rug, 0, 0, 0, 3.28, 0.014, 5.5, pigment("#663949"));
  for (const side of [-1, 1]) {
    box(b, rug, side * 1.50, 0.014, 0, 0.055, 0.002, 5.25, BRASS);
    box(b, rug, 0, 0.014, side * 2.60, 3.02, 0.002, 0.055, BRASS);
    for (let i = -6; i <= 6; i++) {
      const diamond = frameAt(side * 1.27, 0.015, 0.85 + i * 0.36, Math.PI / 4);
      box(b, diamond, 0, 0, 0, 0.085, 0.001, 0.085, pigment("#b07964"));
    }
  }
  hoop(b, new Vector3(LECTERN.x, 0.021, LECTERN.z), new Vector3(1, 0, 0), new Vector3(0, 0, 1),
    1.10, 0.014, 24, 4, BRASS);
}

function walls(b: Builder, light: Builder) {
  const half = SHOP_ROOM.w / 2, depth = SHOP_ROOM.d / 2;
  for (const side of [-1, 1]) {
    box(b, ground, side * (half + 0.09), 0, 0, 0.18, 4.55, 9.44, WALL);
    box(b, ground, side * (half - 0.052), 0, 0, 0.11, 1.12, 9.15, WOOD);
    box(b, ground, side * (half - 0.07), 1.12, 0, 0.14, 0.067, 9.16, INLAY);
  }
  box(b, ground, 0, 0, depth + 0.08, 8.0, 4.56, 0.16, WALL);
  box(b, ground, 0, 0, -depth - 0.08, 8.0, 4.56, 0.16, WALL);
  box(b, ground, 0, 4.48, 0, 8.0, 0.14, 9.4, JOINERY);
  for (const z of [-4.49, -2.44, -0.23, 2.02, 4.43]) {
    box(b, ground, 0, 4.26, z, 7.85, 0.24, 0.20, WOOD);
    const truss = frameAt(0, 2.86, z, 0);
    gothic(b, truss, 0, 0, 0, 7.65, 1.52, INLAY, 0.14);
    for (const x of [-3.73, 3.73]) box(b, truss, x, 0, 0, 0.22, 1.32, 0.26, WOOD);
  }
  const outside = frameAt(0, 0, depth - 0.04, Math.PI);
  box(b, outside, 0, 0.015, 0.02, 1.34, 2.44, 0.12, JOINERY);
  gothic(b, outside, 0, 0.05, 0.11, 1.53, 2.62, BRASS, 0.105);
  for (const x of [-0.45, -0.16, 0.16, 0.45]) box(b, outside, x, 0.14, 0.098, 0.032, 2.23, 0.042, INLAY);
  box(b, outside, -0.38, 0.97, 0.13, 0.115, 0.054, 0.07, BRASS);
  const back = frameAt(0.05, 0, -depth + 0.042, 0);
  box(b, back, 0, 1.28, 0.10, 2.12, 0.16, 0.34, WOOD);
  box(b, back, 0, 1.44, 0, 1.84, 2.22, 0.05, NIGHT);
  gothic(b, back, 0, 1.43, 0.059, 1.93, 2.59, INLAY, 0.107);
  gothic(b, back, 0, 1.44, 0.07, 1.70, 2.39, MOON, 0.041);
  const center = new Vector3(0.26, 3.16, -depth + 0.096);
  const radius = 0.33;
  const mid = light.vert(center.x, center.y, center.z, 0, 0, pigment("#c4d5ff"));
  for (let i = 0; i < 22; i++) {
    const point = (n: number) => light.vert(center.x + Math.cos(n * Math.PI / 11) * radius,
      center.y + Math.sin(n * Math.PI / 11) * radius, center.z, 0, 0, MOON);
    light.tri(mid, point(i), point(i + 1));
  }
  for (const y of [1.65, 2.29, 2.93]) {
    strip(b, back, [-0.85, y], [0.85, y + 0.62], 0.11, 0.028, INLAY);
    strip(b, back, [0.85, y], [-0.85, y + 0.62], 0.11, 0.028, INLAY);
  }
  strip(b, back, [0, 1.45], [0, 3.78], 0.112, 0.043, INLAY);
}

function furniture(b: Builder, light: Builder) {
  cabinet(b, frameAt(SHELF.x, 0, SHELF.z, Math.PI / 2), SHELF.d, 812, true);
  cabinet(b, frameAt(EAST_SHELF.x, 0, EAST_SHELF.z, -Math.PI / 2), EAST_SHELF.d, 416, false);
  cabinet(b, frameAt(WEST_STACK.x, 0, WEST_STACK.z, 0), WEST_STACK.w, 912, false);
  cabinet(b, frameAt(EAST_STACK.x, 0, EAST_STACK.z, 0), EAST_STACK.w, 319, false);

  const { x, z } = LECTERN;
  drum(b, x, 0.022, z, 0.46, 0.16, 8, JOINERY);
  drum(b, x, 0.16, z, 0.32, 0.76, 8, WOOD);
  drum(b, x, 0.9, z, 0.46, 0.10, 8, INLAY);
  drum(b, x, 1.0, z, 0.44, 0.075, 8, JOINERY);
  for (const angle of [0, 90, 180, 270]) {
    const f = frameAt(x, 0, z, angle * Math.PI / 180);
    gothic(b, f, 0, 0.24, 0.324, 0.29, 0.58, BRASS, 0.028);
  }
  const desk = frameAt(DESK.x, 0, DESK.z, 0);
  box(b, desk, 0, 0.87, 0, DESK.w, 0.13, DESK.d, WOOD);
  box(b, desk, 0, 0.90, DESK.d / 2, 1.74, 0.043, 0.038, INLAY);
  for (const dx of [-0.69, 0.69]) for (const dz of [-0.37, 0.37]) box(b, desk, dx, 0, dz, 0.13, 0.91, 0.14, JOINERY);
  for (const dx of [-0.51, 0, 0.51]) {
    box(b, desk, dx, 0.67, 0.42, 0.48, 0.21, 0.15, JOINERY);
    box(b, desk, dx, 0.76, 0.51, 0.085, 0.03, 0.052, BRASS);
  }
  drum(b, DESK.x, 1.004, DESK.z, 0.23, 0.075, 10, BRASS);
  candle(b, light, DESK.x + 0.68, 1, DESK.z - 0.31, 0.14);
  candle(b, light, DESK.x + 0.46, 1, DESK.z - 0.28, 0.20);
  manuscript(b, DESK.x - 0.47, 1.002, DESK.z - 0.14, 0.34, 1.12);
  manuscript(b, DESK.x - 0.55, 1.011, DESK.z + 0.09, -0.18, 0.92);
  const chair = frameAt(CHAIR.x, 0, CHAIR.z, 0);
  box(b, chair, 0, 0.5, 0, CHAIR.w, 0.085, CHAIR.d, WOOD);
  box(b, chair, 0, 0.51, -0.25, CHAIR.w, 0.94, 0.13, JOINERY);
  gothic(b, chair, 0, 0.62, -0.174, 0.48, 0.74, INLAY, 0.045);
  for (const dx of [-0.24, 0.24]) for (const dz of [-0.23, 0.23]) box(b, chair, dx, 0, dz, 0.08, 0.55, 0.09, WOOD);
  const crate = frameAt(CRATE.x, 0, CRATE.z, 0);
  box(b, crate, 0, 0.01, 0, CRATE.w, 0.49, CRATE.d, WOOD);
  for (const dx of [-0.35, 0.35]) box(b, crate, dx, 0.06, 0.36, 0.09, 0.38, 0.042, INLAY);
  manuscript(b, CRATE.x, 0.503, CRATE.z + 0.12, 0.39);
  manuscript(b, -1.94, 0.006, 0.71, -0.43, 1.2);
  manuscript(b, -1.81, 0.016, 0.55, 0.31);
  for (const [x, z] of CANDLE_STANDS) {
    drum(b, x, 0.04, z, 0.16, 0.74, 8, JOINERY);
    candle(b, light, x, 0.78, z, 0.24);
  }
}

export function inkTexture(width: number, height: number, paint: (ink: CanvasRenderingContext2D) => void) {
  const bitmap = document.createElement("canvas");
  bitmap.width = width;
  bitmap.height = height;
  paint(bitmap.getContext("2d")!);
  const map = new CanvasTexture(bitmap);
  map.colorSpace = SRGBColorSpace;
  return map;
}

export function buildBookshopScene(detail: boolean) {
  const scene = new Scene();
  scene.background = new Color("#13101d");
  const solid = new MeshStandardMaterial({ vertexColors: true, roughness: 0.88 });
  const luminous = new MeshBasicMaterial({ vertexColors: true });
  const shell = new Builder(), light = new Builder();
  floor(shell);
  walls(shell, light);
  furniture(shell, light);
  const batch = assemble("Whispering Bookshop", [[shell, solid, false], [light, luminous, false]]);
  scene.add(batch.group);
  const dusk = new HemisphereLight("#ddd0ff", "#b99489", 1.65);
  const moon = new DirectionalLight("#a5baff", 1.72);
  moon.position.set(-1.6, 3.6, -4);
  const candlelight = new PointLight("#ffb76c", detail ? 38 : 30, 11, 2);
  candlelight.position.set(-1.8, 2.75, 1.35);
  const deskLight = new PointLight("#edab66", 15, 5.7, 2);
  deskLight.position.set(2.2, 2.05, -2.7);
  scene.add(dusk, moon, candlelight, deskLight);

  const soft = glowTexture(64, 0.77);
  const plane = new PlaneGeometry(1, 1);
  const spillMaterial = new MeshBasicMaterial({
    color: "#819bff", map: soft, blending: AdditiveBlending, transparent: true, opacity: 0.30, depthWrite: false,
  });
  const spill = new Mesh(plane, spillMaterial);
  spill.position.set(0.08, 0.023, -3.08);
  spill.rotation.x = -Math.PI / 2;
  spill.scale.set(3.4, 5.3, 1);
  const moonHalo = new Mesh(plane, spillMaterial);
  moonHalo.position.set(0.26, 3.16, -4.49);
  moonHalo.scale.setScalar(1.87);
  const signMap = inkTexture(240, 70, (ink) => {
    ink.fillStyle = "#2e202c"; ink.fillRect(0, 0, 240, 70);
    ink.strokeStyle = "#ac8057"; ink.lineWidth = 2; ink.strokeRect(4, 4, 232, 62);
    ink.textAlign = "center"; ink.font = "30px Georgia"; ink.fillStyle = "#f1cb90"; ink.fillText("Courtyard", 120, 45);
  });
  const signMaterial = new MeshBasicMaterial({ map: signMap, side: DoubleSide });
  const sign = new Mesh(plane, signMaterial);
  sign.position.set(0, 2.82, 4.47);
  sign.rotation.y = Math.PI;
  sign.scale.set(1.13, 0.32, 1);
  scene.add(spill, moonHalo, sign);
  return { scene, solid, soft, dispose() {
    for (const geometry of batch.geoms) geometry.dispose();
    plane.dispose();
    for (const material of [solid, luminous, spillMaterial, signMaterial]) material.dispose();
    for (const map of [soft, signMap]) map.dispose();
    scene.clear();
  } };
}
