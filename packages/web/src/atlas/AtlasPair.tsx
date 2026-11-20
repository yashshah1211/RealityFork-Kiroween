/**
 * Compare's two worlds: future A and future B side by side, drawn by the same renderer, kits and universe as Explore,
 * so the comparison starts from the places the user has been exploring. The figures below stay the focus; this band is
 * hidden from assistive technology (the A and B headings name the futures), and choosing a world opens it in Explore.
 */
import { useEffect, useMemo, useRef } from "react";
import type { Reality } from "@realityfork/core";
import type { Slot } from "./layout";
import { treeOf } from "./layout";
import { atlasOption } from "./flag";
import { nodeViews } from "./AtlasExplore";
import { useScenery } from "./environment/useScenery";
import { AtlasScene, guessQuality } from "./scene/AtlasScene";
import "./atlas.css";

const pairSlot = (x: number): Slot => ({ role: "other", position: [x, 0, 0], scale: 1, visible: true, emphasis: 0.8, onPath: false });

export default function AtlasPair({ r, aId, bId, onOpen, onFailed }: { r: Reality; aId: string; bId: string; onOpen: (id: string) => void; onFailed: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<AtlasScene | null>(null);
  const scenery = useScenery(r);
  const nodes = useMemo(() => treeOf(r), [r]);
  // Only the two futures are drawn: the others wait out of sight (a map can be large).
  const views = useMemo(() => nodeViews(nodes, scenery).filter((n) => n.id === aId || n.id === bId).map((n) => ({ ...n, parentId: null })), [nodes, scenery, aId, bId]);
  const slots = useMemo(() => new Map<string, Slot>([[aId, pairSlot(-23)], [bId, pairSlot(23)]]), [aId, bId]);
  const open = useRef(onOpen);
  open.current = onOpen;
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let s: AtlasScene;
    try {
      s = new AtlasScene(el, {
        reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        quality: guessQuality(atlasOption(window.location.search, "atlasQuality")),
        universe: scenery.universe,
        londonDetail: "full",
        distantWorlds: false,
        onSelect: (id) => open.current(id),
        onContextLost: onFailed,
      });
    } catch {
      onFailed();
      return;
    }
    scene.current = s;
    if (atlasOption(window.location.search, "atlasDebug") === "1") window.__rfAtlas = { stats: () => s.stats(), reset: () => s.resetFrameTimes(), memory: () => s.memoryEstimate() };
    return () => {
      s.dispose();
      scene.current = null;
      delete window.__rfAtlas;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    scene.current?.setUniverse(scenery.universe);
  }, [scenery.universe]);
  useEffect(() => {
    // The camera frames both islands. Neither is "selected": both get the same light (no focus rig) and full detail.
    scene.current?.update(views, slots, "", "overview");
  }, [views, slots]);
  return <div className="cmp-scene" ref={host} aria-hidden="true" data-testid="compare-worlds" />;
}
