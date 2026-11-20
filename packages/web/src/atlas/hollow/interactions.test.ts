import { describe, expect, it, vi } from "vitest";
import { HollowInteractions, type Landmark } from "./interactions";

const well: Landmark = { id: "well", x: 0, z: 0, label: "Examine the well", story: "A vision", range: 4, seconds: 4.8 };
const bell: Landmark = { id: "bell", x: 2, z: 0, label: "Ring the tower bell", story: "A visitor", range: 3, seconds: 4.5 };

describe("Hollow landmark interactions", () => {
  it("checks range, facing, and obstruction before choosing the nearest visible landmark", () => {
    const onView = vi.fn();
    const wall = { x: 0, z: 1.5, w: 0.9, d: 0.2 };
    const system = new HollowInteractions([well, bell], [wall], onView);
    expect(system.activate({ x: 0, z: 8, yaw: 0 })).toBeNull();
    system.update({ x: 0, z: 2.8, yaw: 0 });
    expect(system.targetId).toBeNull();
    system.update({ x: 0, z: 1.7, yaw: Math.PI });
    expect(system.targetId).toBeNull();
    system.update({ x: 0.45, z: 1.75, yaw: -0.6 });
    expect(system.targetId).toBe("bell");
    expect(onView).toHaveBeenLastCalledWith({ prompt: bell.label, story: "" });
    system.update({ x: 1, z: 1.0, yaw: 0.1 });
    expect(system.targetId).toBe("well");
    system.update({ x: 1, z: 1.0, yaw: 0.1, pitch: 1.18 });
    expect(system.targetId).toBeNull();
  });

  it("keeps a running event exclusive, resets after it settles, and permits replay", () => {
    const viewer = { x: 0, z: 2, yaw: 0 };
    const onView = vi.fn();
    const system = new HollowInteractions([well], [], onView);
    expect(system.activate(viewer)).toBe("well");
    expect(onView).toHaveBeenLastCalledWith({ prompt: null, story: well.story });
    system.advance(2.4, viewer);
    expect(system.progress).toBe(0.5);
    expect(system.activate(viewer)).toBeNull();
    expect(system.progress).toBe(0.5);
    system.advance(2.4, viewer);
    expect(system.eventId).toBeNull();
    expect(onView).toHaveBeenLastCalledWith({ prompt: well.label, story: well.story });
    expect(system.activate(viewer)).toBe("well");
    system.advance(8, { ...viewer, z: 8 });
    expect(onView).toHaveBeenLastCalledWith({ prompt: null, story: "" });
  });

  it("allows aiming at an object's own surface and remembers one-time interactions", () => {
    const body = { x: 0, z: 0, w: 2, d: 2 };
    const viewer = { x: 0, z: 2, yaw: 0 };
    const system = new HollowInteractions([{ ...well, owner: body, once: true }], [body], vi.fn());
    expect(system.activate(viewer)).toBe("well");
    system.advance(well.seconds, viewer);
    expect(system.activate(viewer)).toBeNull();
  });
});
