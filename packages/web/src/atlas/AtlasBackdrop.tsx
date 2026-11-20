/**
 * The landing page's world: where you stand now and a few futures floating away from it, each in a different kind of
 * scenery, drawn by the same renderer and kits as Explore. The Hollow's entry control is separate from the canvas,
 * which is hidden from assistive technology.
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import type { Slot } from "./layout";
import { UNIVERSES } from "./environment/universes";
import { atlasOption } from "./flag";
import { AtlasScene, guessQuality, type AtlasNodeView } from "./scene/AtlasScene";
import type { KitView } from "./scene/kit";
import { HollowPortal } from "./hollow/HollowPortal";
import "./atlas.css";

const kit = (family: KitView["family"], theme: KitView["theme"], props: KitView["props"] = []): KitView => ({ family, theme, props, people: 0, hypothetical: false });
const NODES: readonly AtlasNodeView[] = [
  { id: "now", parentId: null, place: null, seed: 0x5f3759df, kit: kit("neutral", "sky") },
  { id: "city", parentId: "now", place: null, seed: 0x2545f491, kit: kit("urban", "city") },
  { id: "energy", parentId: "now", place: null, seed: 0x9e3779b9, kit: kit("energy", "home", ["solar"]) },
  { id: "open", parentId: "now", place: null, seed: 0x7f4a7c15, kit: kit("business", "cafe") },
];

const slot = (role: Slot["role"], x: number, y: number, depth: number, size: number, visible = true): Slot => ({ role, position: [0, 0, 0], screen: { x, y, depth, size }, scale: 1, visible, emphasis: role === "selected" ? 1 : 0.5, onPath: false });
const STACKED = "(max-width: 979.98px)";
/** Composition: the present low on the left of the free area, futures rising to the right and further back. */
const WIDE = new Map<string, Slot>([
  ["now", slot("selected", -0.3, -0.1, 0, 0.42)],
  ["city", slot("child", 0.52, 0.5, 170, 0.27)],
  ["energy", slot("child", 0.7, -0.14, 80, 0.29)],
  ["open", slot("child", 0.06, 0.68, 330, 0.16)],
]);
const NARROW = new Map<string, Slot>([
  ["now", slot("selected", -0.42, -0.08, 0, 0.5)],
  ["city", slot("child", 0.5, 0.46, 140, 0.31)],
  ["energy", slot("child", 0.56, -0.42, 70, 0.31)],
  ["open", slot("child", 0, 0.7, 320, 0.18, false)],
]);

export default function AtlasBackdrop({ formRef, bandRef, onFailed, onDiscovery }: { formRef: RefObject<HTMLElement>; bandRef?: RefObject<HTMLElement>; onFailed: () => void; onDiscovery: (count: number) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<AtlasScene | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let s: AtlasScene;
    try {
      s = new AtlasScene(el, {
        reducedMotion: motion.matches,
        quality: guessQuality(atlasOption(window.location.search, "atlasQuality")),
        interactive: false,
        landingEffects: { onDiscovery, onReady: () => setReady(true) },
        universe: UNIVERSES.neutral,
        foreground: window.matchMedia("(max-width: 760px)").matches ? null : "landing",
        ambienceBias: window.matchMedia(STACKED).matches ? "even" : "right",
        onSelect: () => undefined,
        onContextLost: onFailed,
      });
    } catch {
      onFailed();
      return;
    }
    scene.current = s;
    const updateMotion = () => s.setReducedMotion(motion.matches);
    motion.addEventListener("change", updateMotion);
    if (atlasOption(window.location.search, "atlasDebug") === "1") window.__rfAtlas = { stats: () => s.stats(), reset: () => s.resetFrameTimes(), memory: () => s.memoryEstimate() };
    return () => {
      motion.removeEventListener("change", updateMotion);
      s.dispose();
      scene.current = null;
      delete window.__rfAtlas;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // The free area: right of the question on wide screens, otherwise the band of sky below the question (measured
  // against the scene itself, which scrolls with the page there).
  useEffect(() => {
    const measure = () => {
      const s = scene.current;
      const f = formRef.current?.getBoundingClientRect();
      const b = bandRef?.current?.getBoundingClientRect();
      const box = host.current?.getBoundingClientRect();
      if (!s) return;
      const narrow = window.matchMedia(STACKED).matches;
      s.setForeground(window.matchMedia("(max-width: 760px)").matches ? null : "landing");
      if (narrow && b && box && b.height > 0) s.setInsets({ top: Math.max(0, b.top - box.top), left: 0, right: 0, bottom: Math.max(0, box.bottom - b.bottom) });
      else if (narrow) s.setInsets({ top: 56, left: 0, right: 0, bottom: f ? Math.max(0, window.innerHeight - f.top + 8) : window.innerHeight * 0.55 });
      else s.setInsets({ top: 64, left: Math.max(window.innerWidth * 0.42, b?.left ?? 0), right: 0, bottom: 0 });
      // In the stacked layout the moon rises in the clear sky right of "What if".
      const lead = formRef.current?.querySelector(".whatif-lead")?.getBoundingClientRect();
      if (narrow && b && box && lead && b.height > 0) {
        // The words, not the label box (which spans the column).
        const range = document.createRange();
        range.selectNodeContents(formRef.current!.querySelector(".whatif-lead")!);
        const words = range.getBoundingClientRect();
        const x = Math.min(box.right - 44, words.right + (box.right - words.right) * 0.5);
        s.setMoonAt({ x: (x - box.left) / box.width, y: (words.top + words.height * 0.45 - box.top) / box.height }, 0.62, 0.3);
      } else s.setMoonAt(null);
      s.update(NODES, narrow ? NARROW : WIDE, "now", "focus");
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (formRef.current) ro.observe(formRef.current);
    if (bandRef?.current) ro.observe(bandRef.current);
    if (host.current) ro.observe(host.current);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [formRef, bandRef]);
  return (
    <>
      <div className="im-scene" ref={host} aria-hidden="true" data-testid="imagine-world" />
      {ready && scene.current && bandRef?.current && <HollowPortal scene={scene.current} band={bandRef.current}
        onPlanner={() => formRef.current?.querySelector("textarea")?.focus()} />}
    </>
  );
}
