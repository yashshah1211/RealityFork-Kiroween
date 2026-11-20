import type { Landmark } from "./interactions";
import { rules } from "./story/mara";
import type { Footprint } from "./navigation";

export const SHOP_ROOM: Footprint = { x: 0, z: 0, w: 7.8, d: 9.2 };
export const SHOP_ARRIVAL = { x: 0, z: 3.48, yaw: 0, pitch: 0.07 };
export const LECTERN: Footprint = { x: 0, z: -0.25, w: 0.94, d: 0.88 };
export const SHELF: Footprint = { x: -3.49, z: -0.52, w: 0.82, d: 3.9 };
export const EAST_SHELF: Footprint = { x: 3.49, z: 0.76, w: 0.82, d: 3.65 };
export const DESK: Footprint = { x: 1.79, z: -2.81, w: 1.75, d: 1.02 };
export const CHAIR: Footprint = { x: 1.80, z: -3.81, w: 0.65, d: 0.64 };
export const WEST_STACK: Footprint = { x: -2.71, z: -4.20, w: 1.72, d: 0.8 };
export const EAST_STACK: Footprint = { x: 2.77, z: -4.23, w: 1.61, d: 0.74 };
export const CRATE: Footprint = { x: 2.83, z: 3.67, w: 0.95, d: 0.72 };
export const CANDLE_STANDS = [[-2.72, 2.67], [2.79, 2.70], [-1.36, -3.81]] as const;
export const SHOP_OBSTACLES = [LECTERN, SHELF, EAST_SHELF, DESK, CHAIR, WEST_STACK, EAST_STACK, CRATE,
  ...CANDLE_STANDS.map(([x, z]) => ({ x, z, w: 0.32, d: 0.32 }))];

export const FLOATING_BOOK: Landmark = {
  id: "floating-book", x: LECTERN.x, z: LECTERN.z, owner: LECTERN, range: 2.05,
  label: "Open the Floating Book", seconds: 5.6,
  story: "On one page, I left the Hollow. On the next, I stayed. Both pages remember the same morning.",
};
export const SHOP_LANDMARKS = [
  { id: "forking-mirror", x: -0.95, z: -4.41, range: 2.0, label: "Look into the Forking Mirror", story: "", seconds: 0 },
  { id: "leave-shop", x: 0, z: 4.56, range: 1.6, label: "Return to the courtyard", story: "", seconds: 0 },
  FLOATING_BOOK,
  { id: "whispering-shelf", x: -3.05, z: -0.54, owner: SHELF, range: 1.7,
    label: "Search the Whispering Shelf", seconds: 7.4,
    story: "Behind the false spines lies a key. Its tag reads, “For the door we never chose to open.”" },
  { id: "keepers-desk", x: DESK.x, z: -2.31, owner: DESK, range: 1.8, label: "Read the Keeper’s Desk", seconds: 7.2,
    story: "Three possibilities in Mara’s notes.",
    notes: Object.values(rules).filter(rule => rule.from === "start")
      .map(rule => ({ title: rule.label, consequence: rule.cost })) },
] satisfies readonly Landmark[];
