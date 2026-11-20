import type { HollowWorld } from "./world";

export type Direction = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";
export type Capture = "look" | "walk" | null;
const MOVEMENT = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyQ", "KeyE"]);
const LOOK_SPEED = 0.0041;

/** Input belongs to the open courtyard and is released as one unit when it closes. */
export class HollowControls {
  private readonly listeners = new AbortController();
  private readonly keys = new Set<string>();
  private paused = false;
  private readonly holds = new Map<number, { target: HTMLElement; code: Direction }>();
  private drag: { id: number; x: number; y: number } | null = null;

  constructor(private readonly surface: HTMLElement, dialog: HTMLDialogElement, private readonly world: HollowWorld,
    private readonly onCapture: (capture: Capture) => void) {
    const options = { signal: this.listeners.signal };
    window.addEventListener("keydown", this.keyDown, options);
    window.addEventListener("keyup", ({ code }) => this.keys.delete(code), options);
    window.addEventListener("blur", this.clear, options);
    document.addEventListener("visibilitychange", this.clear, options);
    dialog.addEventListener("lostpointercapture", this.lostCapture, options);
    surface.addEventListener("pointerdown", this.pointerDown, options);
    surface.addEventListener("pointermove", this.pointerMove, options);
  }

  step(seconds: number) {
    if (!this.keys.size && !this.holds.size) return;
    const turn = Number(this.keys.has("KeyQ")) - Number(this.keys.has("KeyE"));
    if (turn) this.world.look(turn * Math.min(seconds, 0.05) * 1.55, 0);
    const forward = Number(this.held("KeyW", "ArrowUp")) - Number(this.held("KeyS", "ArrowDown"));
    const strafe = Number(this.held("KeyD", "ArrowRight")) - Number(this.held("KeyA", "ArrowLeft"));
    this.world.move(forward, strafe, seconds);
  }

  private held(key: string, direction: Direction) {
    if (this.keys.has(key) || this.keys.has(direction)) return true;
    for (const hold of this.holds.values()) if (hold.code === direction) return true;
    return false;
  }

  pause(value: boolean) {
    this.paused = value;
    if (value) this.clear();
  }

  hold(target: HTMLElement, event: PointerEvent, code: Direction) {
    if (event.button !== 0) return;
    target.setPointerCapture(event.pointerId);
    this.holds.set(event.pointerId, { target, code });
    this.publishCapture();
  }

  nudge(code: Direction) {
    this.world.move(Number(code === "ArrowUp") - Number(code === "ArrowDown"), Number(code === "ArrowRight") - Number(code === "ArrowLeft"), 0.05);
  }

  get looking() {
    return this.drag !== null;
  }

  cancelCapture() {
    if (!this.looking && !this.holds.size) return false;
    if (this.drag && this.surface.hasPointerCapture(this.drag.id)) this.surface.releasePointerCapture(this.drag.id);
    for (const [id, { target }] of this.holds) {
      if (target.hasPointerCapture(id)) target.releasePointerCapture(id);
    }
    this.drag = null;
    this.keys.clear();
    this.holds.clear();
    this.publishCapture();
    return true;
  }

  dispose() {
    this.clear();
    this.listeners.abort();
  }

  private readonly clear = () => {
    this.keys.clear();
    this.cancelCapture();
  };

  private readonly keyDown = (event: KeyboardEvent) => {
    if (this.paused || event.defaultPrevented) return;
    // HollowPortal owns Escape for every layer of the visit.
    if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const target = event.target;
    if (target instanceof HTMLElement && (target.isContentEditable || target.closest("input, textarea, select, [role=textbox]"))) return;
    if (event.key.toLowerCase() === "f") {
      if (!event.repeat && this.world.interact()) event.preventDefault();
      return;
    }
    if (!MOVEMENT.has(event.code)) return;
    event.preventDefault();
    this.keys.add(event.code);
  };

  private readonly pointerDown = (event: PointerEvent) => {
    if (this.paused || event.button !== 0 || this.drag) return;
    event.preventDefault();
    this.surface.setPointerCapture(event.pointerId);
    this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    this.publishCapture();
  };

  private readonly pointerMove = (event: PointerEvent) => {
    if (this.drag?.id !== event.pointerId) return;
    const { clientX: x, clientY: y } = event;
    const bound = (delta: number) => Math.max(-90, Math.min(90, delta)) * LOOK_SPEED;
    this.world.look(bound(this.drag.x - x), bound(y - this.drag.y));
    this.drag.x = x;
    this.drag.y = y;
  };

  private readonly lostCapture = (event: PointerEvent) => {
    const wasHeld = this.holds.delete(event.pointerId);
    if (this.drag?.id === event.pointerId) this.drag = null;
    else if (!wasHeld) return;
    this.publishCapture();
  };

  private publishCapture() {
    this.surface.toggleAttribute("data-looking", this.looking);
    this.onCapture(this.looking ? "look" : this.holds.size ? "walk" : null);
  }
}
