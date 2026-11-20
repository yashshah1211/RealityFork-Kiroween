import { describe, expect, it } from "vitest";
import { ARRIVAL, BOOKSHOP, BOOKSHOP_DOOR, COURTYARD, HollowNavigation } from "./navigation";

describe("Hollow navigation", () => {
  it("moves relative to the view and normalizes diagonal walking", () => {
    const straight = new HollowNavigation([]);
    const diagonal = new HollowNavigation([]);
    straight.walk(1, 0, 0.05);
    diagonal.walk(1, 1, 0.05);
    const distance = (position: HollowNavigation) => Math.hypot(position.x - ARRIVAL.x, position.z - ARRIVAL.z);
    expect(distance(straight)).toBeCloseTo(0.17);
    expect(distance(diagonal)).toBeCloseTo(distance(straight));
    straight.yaw = Math.PI / 2;
    straight.walk(1, 0, 0.05);
    expect(straight.x).toBeCloseTo(ARRIVAL.x - 0.17 * (1 + Math.sin(ARRIVAL.yaw)));
  });

  it("stops at the bookshop and slides along the facade", () => {
    const walker = new HollowNavigation([BOOKSHOP]);
    walker.x = BOOKSHOP.x;
    walker.yaw = 0;
    for (let frame = 0; frame < 150; frame++) walker.walk(1, 0, 1);
    expect(walker.z).toBeGreaterThanOrEqual(BOOKSHOP_DOOR.z + 0.32);
    expect(walker.z).toBeLessThan(BOOKSHOP_DOOR.z + 0.51);
    walker.walk(1, 1, 0.05);
    expect(walker.x).toBeGreaterThan(BOOKSHOP.x);
    expect(walker.z).toBeGreaterThanOrEqual(BOOKSHOP_DOOR.z + 0.32);
    for (let frame = 0; frame < 40; frame++) walker.walk(-1, 0, 0.05);
    expect(walker.z).toBeGreaterThan(BOOKSHOP_DOOR.z + 3.25);
  });

  it("bounds the camera at every edge and clamps extreme look angles", () => {
    const walker = new HollowNavigation([]);
    walker.yaw = 0;
    for (const [forward, strafe] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      for (let frame = 0; frame < 220; frame++) walker.walk(forward, strafe, 0.05);
      expect(Math.abs(walker.x)).toBeLessThan(COURTYARD.w / 2);
      expect(Math.abs(walker.z - COURTYARD.z)).toBeLessThan(COURTYARD.d / 2);
    }
    walker.look(40, 40);
    expect(walker.yaw).toBeGreaterThanOrEqual(0);
    expect(walker.yaw).toBeLessThan(2 * Math.PI);
    expect(walker.pitch).toBe(1.18);
    walker.look(-40, -40);
    expect(walker.pitch).toBe(-0.95);
  });
});
