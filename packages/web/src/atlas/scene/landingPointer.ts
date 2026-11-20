/** Observe exposed parts of the landing backdrop without taking over the page's inputs. */
export class LandingPointer {
  private readonly listeners = new AbortController();
  private press: { id: number; x: number; y: number; time: number } | null = null;
  hover: { x: number; y: number } | null = null;
  readonly taps: { x: number; y: number; pointerType: string }[] = [];

  constructor(private readonly disarm: () => void) {
    const options = { passive: true, capture: true, signal: this.listeners.signal };
    window.addEventListener("pointerdown", this.down, options);
    window.addEventListener("pointermove", this.move, options);
    window.addEventListener("pointerup", this.up, options);
    window.addEventListener("pointercancel", this.clear, options);
    window.addEventListener("pointerout", this.out, options);
    window.addEventListener("scroll", this.clear, options);
    // Capture would also see the question blur when the user presses scenery.
    window.addEventListener("blur", this.clear, { passive: true, signal: this.listeners.signal });
    document.addEventListener("visibilitychange", this.clear, options);
  }

  private isScenery(target: EventTarget | null) {
    return target instanceof Element && !target.closest(
      "nav, dialog, button, a, input, textarea, select, label, summary, [contenteditable], [role=button], [role=dialog], .more, .whatif-field, .whatif-actions, .whatif-help, .quiet",
    );
  }

  private closeToPress(e: PointerEvent) {
    const p = this.press;
    return p?.id === e.pointerId && Math.hypot(e.clientX - p.x, e.clientY - p.y) <= 8;
  }

  private readonly down = (e: PointerEvent) => {
    this.hover = null;
    const scenery = this.isScenery(e.target);
    if (e.isPrimary && !scenery) this.disarm();
    this.press = e.isPrimary && e.button === 0 && scenery
      ? { id: e.pointerId, x: e.clientX, y: e.clientY, time: e.timeStamp }
      : null;
  };

  private readonly move = (e: PointerEvent) => {
    if (this.press && !this.closeToPress(e)) this.press = null;
    this.hover = e.isPrimary && e.pointerType !== "touch" && !e.buttons && this.isScenery(e.target)
      ? { x: e.clientX, y: e.clientY }
      : null;
  };

  private readonly up = (e: PointerEvent) => {
    // Touch can implicitly capture the pointer. Check what is actually under the release.
    const exposed = this.isScenery(document.elementFromPoint(e.clientX, e.clientY));
    if (e.isPrimary && e.button === 0 && this.press && this.closeToPress(e) && e.timeStamp - this.press.time < 650 && exposed) {
      if (this.taps.length === 4) this.taps.shift();
      this.taps.push({ x: e.clientX, y: e.clientY, pointerType: e.pointerType });
    }
    this.press = null;
    this.hover = e.isPrimary && e.pointerType !== "touch" && exposed ? { x: e.clientX, y: e.clientY } : null;
  };

  private readonly out = (e: PointerEvent) => {
    // A touch pointer exits after release, before the next frame can consume the tap.
    if (e.pointerType !== "touch" && !e.relatedTarget) this.clear();
  };

  readonly clear = () => {
    this.press = this.hover = null;
    this.taps.length = 0;
    this.disarm();
  };

  dispose() {
    this.listeners.abort();
    this.clear();
  }
}
