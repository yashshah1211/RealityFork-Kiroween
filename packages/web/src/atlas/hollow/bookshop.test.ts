import { describe, expect, it, vi } from "vitest";
import { DESK, LECTERN, SHELF, SHOP_ARRIVAL, SHOP_LANDMARKS, SHOP_OBSTACLES, SHOP_ROOM } from "./bookshopLayout";
import { HollowInteractions } from "./interactions";
import { HollowNavigation } from "./navigation";

describe("bookshop floor plan", () => {
  it("uses the shared movement and stops at the lectern, desk, shelf and wall", () => {
    const nav = new HollowNavigation(SHOP_OBSTACLES, SHOP_ROOM, SHOP_ARRIVAL);
    const walk = () => { for (let frame = 0; frame < 65; frame++) nav.walk(1, 0, 0.05); };
    walk();
    expect(nav.z).toBeGreaterThanOrEqual(LECTERN.z + LECTERN.d / 2 + 0.32);
    expect(nav.z).toBeLessThan(0.7);
    nav.place({ x: DESK.x, z: 0.7, yaw: 0, pitch: 0 });
    walk();
    expect(nav.z).toBeGreaterThanOrEqual(DESK.z + DESK.d / 2 + 0.32);
    expect(nav.z).toBeLessThan(-1.8);
    nav.place({ x: -1, z: SHELF.z, yaw: Math.PI / 2, pitch: 0 });
    walk();
    expect(nav.x).toBeGreaterThanOrEqual(SHELF.x + SHELF.w / 2 + 0.32);
    expect(nav.x).toBeLessThan(-2.55);
    nav.place({ ...SHOP_ARRIVAL, yaw: Math.PI });
    walk();
    expect(nav.z).toBeCloseTo(SHOP_ROOM.d / 2 - 0.32);
  });

  it("keeps the exit available from the inside doorstep and routes all props through contextual targeting", () => {
    const interactions = new HollowInteractions(SHOP_LANDMARKS, SHOP_OBSTACLES, vi.fn());
    const door = { ...SHOP_ARRIVAL, yaw: Math.PI };
    expect(interactions.activate(SHOP_ARRIVAL)).toBeNull();
    expect(interactions.activate(door)).toBe("leave-shop");
    expect(interactions.eventId).toBeNull();
    for (const [id, x, z, yaw] of [
      ["floating-book", 0, 1, 0],
      ["whispering-shelf", -2, SHELF.z, Math.PI / 2],
      ["keepers-desk", DESK.x, -1.15, 0],
    ] as const) {
      const view = { x, z, yaw };
      expect(interactions.activate(view)).toBe(id);
      expect(interactions.activate(view)).toBeNull();
      interactions.clear();
    }
  });
});
