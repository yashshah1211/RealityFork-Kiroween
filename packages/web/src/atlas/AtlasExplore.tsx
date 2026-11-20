/**
 * Explore in 3D: the real map (RealityStore) drawn as floating islands in its own universe, with a compact card for
 * the selected future. A presentation layer only: selecting, branching, answering and comparing go through the
 * store's own operations, and every word or number comes from core views (see AtlasPanel). The scenery comes from
 * the map's own words (environment/resolve.ts) and changes only the picture.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent } from "react";
import { changesFromParent, type Branch, type Reality } from "@realityfork/core";
import type { RealityState, RealityStore } from "../reality/store";
import { changeCaption } from "../reality/format";
import { AtlasPanel, type Sheet } from "./AtlasPanel";
import { atlasOption } from "./flag";
import { focusLayout, lineage, neighbour, overviewLayout, treeOf, type Mode, type Slot, type TreeNode } from "./layout";
import { FAMILIES, FAMILY_NAME, sceneryName, THEME_NAME, THEMES, type Family, type Theme } from "./environment/resolve";
import { universeStyle, useScenery, type MapScenery } from "./environment/useScenery";
import { sceneView, type SceneView } from "./environment/difference";
import { AtlasScene, guessQuality, type AtlasNodeView, type ModelStatus, type Quality } from "./scene/AtlasScene";
import { seedOf } from "./scene/generic";
import "./atlas.css";

type Unavailable = "unavailable" | "lost" | "failed";
type NavKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown" | "Home";
const NAV_KEYS = new Set<string>(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home"]);

export function useMedia(query: string): boolean {
  const subscribe = useCallback((fn: () => void) => {
    const m = window.matchMedia(query);
    m.addEventListener("change", fn);
    return () => m.removeEventListener("change", fn);
  }, [query]);
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}

declare global {
  interface Window {
    __rfAtlas?: { readonly stats: () => ReturnType<AtlasScene["stats"]>; readonly reset: () => void; readonly memory: () => ReturnType<AtlasScene["memoryEstimate"]> };
  }
}

export default function AtlasExplore({ store, onClassic, onUnavailable }: { store: RealityStore; onClassic: () => void; onUnavailable: (why: Unavailable) => void }) {
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const r = store.active();
  const b = store.selected();
  if (!r || !b) return null;
  return <AtlasView store={store} state={state} r={r} b={b} onClassic={onClassic} onUnavailable={onUnavailable} />;
}

/** Short words for how an island relates to the selected future. */
function roleWords(slot: Slot, n: TreeNode, selected: TreeNode | undefined, mode: Mode): string {
  if (mode === "overview") return slot.role === "selected" ? "you are here" : n.parentId === null ? "where you start" : "";
  switch (slot.role) {
    case "selected": return "you are here";
    case "ancestor": return selected && n.depth === selected.depth - 1 ? "came from" : "earlier";
    case "sibling": return "another path";
    case "child": return "continues from here";
    default: return "";
  }
}

/** The islands for a map: each path's place and scenery, from the map's scenery (nothing else is read). */
export function nodeViews(nodes: readonly TreeNode[], scenery: MapScenery): AtlasNodeView[] {
  return nodes.map((n) => {
    const p = scenery.paths.get(n.id);
    return {
      id: n.id, parentId: n.parentId, seed: seedOf(n.id), place: p?.place ?? null,
      kit: { family: p?.family ?? "neutral", theme: p?.theme ?? "sky", props: p?.props ?? [], people: p?.people ?? 0, hypothetical: p?.hypothetical ?? false },
    };
  });
}

/** "Scenery": what the picture is drawn as and why, and the user's own choice of scenery (appearance only). */
function SceneryControl({ scenery, reasons, path }: { scenery: MapScenery; reasons: readonly string[]; path: string }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const close = () => ref.current?.removeAttribute("open");
  const auto = scenery.override === null;
  const { family, theme } = scenery.choice;
  const pick = (f: Family | null) => {
    scenery.setOverride(f ? { family: f, theme: null } : null);
    close();
  };
  // A setting within the family drawn now; "best fit" leaves the setting to the map's words.
  const pickTheme = (t: Theme | null) => {
    scenery.setOverride(t === null && auto ? null : { family, theme: t });
    close();
  };
  const themeChosen = scenery.override?.theme ?? null;
  return (
    <details className="atlas-scenery" ref={ref} onKeyDown={(e) => { if (e.key === "Escape") { close(); (ref.current?.querySelector("summary") as HTMLElement | null)?.focus(); } }} data-testid="atlas-scenery">
      <summary aria-label={`Scenery: ${sceneryName(family, theme)}. Change how this map is drawn`}>
        <span className="sc-dot" aria-hidden="true" data-family={family} />
        <span className="sc-name" data-testid="atlas-scenery-name">{sceneryName(family, theme)}</span>
        {!auto && <span className="sc-chosen">your choice</span>}
      </summary>
      <div className="sc-panel">
        <p className="sc-why" data-testid="atlas-scenery-why">{scenery.choice.why}</p>
        <div className="sc-path">
          <p className="sc-path-name">“{path}”</p>
          <p data-testid="atlas-world">{reasons.join(" ")}</p>
        </div>
        <fieldset>
          <legend>Draw this map as</legend>
          <label className={auto ? "on" : ""}>
            <input type="radio" name="scenery" checked={auto} onChange={() => pick(null)} data-testid="atlas-scenery-auto" />
            <span>Chosen from the map's words</span>
          </label>
          {FAMILIES.map((f) => (
            <label key={f} className={!auto && scenery.override?.family === f ? "on" : ""}>
              <input type="radio" name="scenery" checked={!auto && scenery.override?.family === f} onChange={() => pick(f)} data-testid={`atlas-scenery-${f}`} />
              <span>{FAMILY_NAME[f]}</span>
            </label>
          ))}
        </fieldset>
        {THEMES[family].length > 1 && (
          <fieldset className="sc-themes">
            <legend>Setting</legend>
            <label className={themeChosen === null ? "on" : ""}>
              <input type="radio" name="scenery-theme" checked={themeChosen === null} onChange={() => pickTheme(null)} data-testid="atlas-scenery-theme-auto" />
              <span>Best fit</span>
            </label>
            {THEMES[family].map((t) => (
              <label key={t} className={themeChosen === t ? "on" : ""}>
                <input type="radio" name="scenery-theme" checked={themeChosen === t} onChange={() => pickTheme(t)} data-testid={`atlas-scenery-theme-${t}`} />
                <span>{THEME_NAME[t]}</span>
              </label>
            ))}
          </fieldset>
        )}
        <p className="sc-note">Changes only the picture. The map, its figures and its paths stay exactly as they are.</p>
      </div>
    </details>
  );
}

function AtlasView({ store, state, r, b, onClassic, onUnavailable }: { store: RealityStore; state: RealityState; r: Reality; b: Branch; onClassic: () => void; onUnavailable: (why: Unavailable) => void }) {
  // Phones and portrait screens: the card becomes a sheet at the bottom and the world keeps the top of the screen.
  const narrow = useMedia("(max-width: 700px), (max-aspect-ratio: 9/10)");
  const reduced = useMedia("(prefers-reduced-motion: reduce)");
  const [mode, setMode] = useState<Mode>("focus");
  const [sheet, setSheet] = useState<Sheet>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [model, setModel] = useState<ModelStatus>({ state: "idle" });
  const [quality, setQuality] = useState<{ readonly q: Quality; readonly why: string } | null>(null);
  const [hover, setHover] = useState<string | null>(null);

  const scenery = useScenery(r);
  const nodes = useMemo(() => treeOf(r), [r]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const views = useMemo(() => nodeViews(nodes, scenery), [nodes, scenery]);
  const slots = useMemo(() => (mode === "focus" ? focusLayout(nodes, b.id, { narrow }) : overviewLayout(nodes, b.id, { narrow })), [nodes, b.id, mode, narrow]);
  const path = useMemo(() => lineage(nodes, b.id), [nodes, b.id]);
  const planned = scenery.paths.get(b.id);
  // Say what is actually drawn: while the London model loads or if it failed, London paths are drawn as their family's scenery.
  const reasons = !planned ? [] : planned.place !== "london" || model.state === "ready" ? planned.reasons
    : model.state === "failed" ? ["The detailed London model could not be loaded, so this path is drawn as a city island instead.", ...planned.reasons.slice(1)]
    : ["Loading the detailed London model; this path is drawn as a city island until it arrives.", ...planned.reasons.slice(1)];
  // What the card says the picture shows differently from the parent: the same scenery the islands are drawn from.
  const scene = useMemo((): SceneView => {
    const v = sceneView(scenery.paths.get(b.id), b.parentId ? scenery.paths.get(b.parentId) : undefined);
    if (model.state === "ready" || planned?.place !== "london") return v;
    const drawn = model.state === "failed" ? "A city island: the London model could not be loaded" : "A city island until the London model loads";
    return { changes: v.changes.map((c) => (c.key === "place" ? { ...c, now: drawn } : c)), items: v.items.map((t) => (t === "The detailed London model" ? drawn : t)) };
  }, [scenery, b.id, b.parentId, model.state, planned]);

  const host = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<AtlasScene | null>(null);
  const labels = useRef(new Map<string, HTMLElement>());
  const labelRefs = useRef(new Map<string, (el: HTMLElement | null) => void>());
  const refFor = (id: string) => {
    let f = labelRefs.current.get(id);
    if (!f) {
      f = (el) => {
        if (el) labels.current.set(id, el);
        else labels.current.delete(id);
        sceneRef.current?.setLabel(id, el);
      };
      labelRefs.current.set(id, f);
    }
    return f;
  };
  // Choosing a future in the overview also brings it into focus.
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const pick = useCallback((id: string) => {
    const fromLabel = document.activeElement instanceof HTMLElement && document.activeElement.closest(".atlas-labels") !== null;
    store.select(id);
    if (modeRef.current === "overview") setMode("focus");
    // The future in focus carries no label, so the one just used goes away: keyboard focus moves to its heading.
    if (fromLabel) requestAnimationFrame(() => document.querySelector<HTMLElement>(".atlas-root [data-stage-focus]")?.focus({ preventScroll: true }));
  }, [store]);
  const select = useRef(pick);
  select.current = pick;

  // The scene lives as long as this view; selecting a path only updates it.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let scene: AtlasScene;
    try {
      scene = new AtlasScene(el, {
        reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        quality: guessQuality(atlasOption(window.location.search, "atlasQuality")),
        universe: scenery.universe,
        foreground: window.matchMedia("(max-width: 700px), (max-aspect-ratio: 9/10)").matches ? null : "auto",
        onSelect: (id) => select.current(id),
        onHover: setHover,
        onModel: setModel,
        onQuality: (q, why) => setQuality({ q, why }),
        onContextLost: () => onUnavailable("lost"),
      });
    } catch {
      onUnavailable("unavailable");
      return;
    }
    sceneRef.current = scene;
    for (const [id, label] of labels.current) scene.setLabel(id, label);
    if (atlasOption(window.location.search, "atlasDebug") === "1") window.__rfAtlas = { stats: () => scene.stats(), reset: () => scene.resetFrameTimes(), memory: () => scene.memoryEstimate() };
    return () => {
      scene.dispose();
      sceneRef.current = null;
      delete window.__rfAtlas;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    sceneRef.current?.setUniverse(scenery.universe);
  }, [scenery.universe]);
  useEffect(() => {
    sceneRef.current?.update(views, slots, b.id, mode);
  }, [views, slots, b.id, mode]);
  useEffect(() => {
    sceneRef.current?.setReducedMotion(reduced);
  }, [reduced]);
  // The ledge in the foreground only where the card is beside the world, not under it.
  useEffect(() => {
    sceneRef.current?.setForeground(narrow ? null : "auto");
  }, [narrow]);
  useEffect(() => {
    setSheet(null);
  }, [b.id]);
  // Keyboard users start on the selected future (the heading the app focuses after every move).
  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body) document.querySelector<HTMLElement>(".atlas-root [data-stage-focus]")?.focus({ preventScroll: true });
  }, []);

  // The camera frames the free part of the screen: measure what the title, card and controls cover.
  const top = useRef<HTMLDivElement>(null);
  // On phones the trail scrolls sideways: keep the current path's name in view.
  const crumbs = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = crumbs.current;
    if (el && el.scrollWidth > el.clientWidth) el.scrollLeft = el.scrollWidth;
  }, [path, narrow]);
  const panel = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const measure = () => {
      const s = sceneRef.current;
      if (!s) return;
      const W = window.innerWidth;
      const H = window.innerHeight;
      const t = top.current?.getBoundingClientRect();
      const p = panel.current?.getBoundingClientRect();
      const c = bar.current?.getBoundingClientRect();
      if (narrow) s.setInsets({ top: t ? Math.min(t.bottom, H * 0.24) : 0, right: 0, left: 0, bottom: p ? Math.max(0, H - p.top) : 0 });
      else s.setInsets({ top: t ? Math.min(t.bottom, H * 0.22) : H * 0.1, right: p && panelOpen ? Math.max(0, W - p.left) : 0, bottom: c ? Math.max(0, H - c.top) : 0, left: 0 });
      // Labels stay clear of the title, the controls and the card (only the small button when it is hidden).
      const pb = panelOpen ? panel.current?.querySelector(".atlas-panel")?.getBoundingClientRect() ?? p : panel.current?.firstElementChild?.getBoundingClientRect();
      s.setBlockers([t, pb, c].filter((x): x is DOMRect => x !== undefined));
    };
    measure();
    const ro = new ResizeObserver(measure);
    for (const el of [top.current, panel.current, bar.current]) if (el) ro.observe(el);
    const card = panel.current?.querySelector(".atlas-panel");
    if (card) ro.observe(card);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [narrow, panelOpen, b.id, sheet]);

  const go = (key: NavKey) => {
    const next = neighbour(nodes, b.id, key);
    if (next) store.select(next);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (t.closest("input, textarea, select, [contenteditable='true'], .atlas-scenery")) return;
    // Inside the card's text, arrows scroll as usual; on its heading (where focus lands after a move) they navigate.
    if (t.closest(".ap-scroll") && !t.matches("[data-stage-focus]")) return;
    if (NAV_KEYS.has(e.key) && !e.altKey && !e.ctrlKey && !e.metaKey) {
      const next = neighbour(nodes, b.id, e.key as NavKey);
      if (next) {
        e.preventDefault();
        store.select(next);
      }
    } else if (e.key === "o" || e.key === "O") {
      setMode((m) => (m === "overview" ? "focus" : "overview"));
    } else if (e.key === "Escape") {
      if (sheet) setSheet(null);
      else if (mode === "overview") setMode("focus");
    }
  };

  const ai = r.origin?.kind === "ai";
  const examples = r.branches.some((x) => Object.values(x.sources ?? {}).includes("example"));
  const sel = byId.get(b.id);
  const parentId = sel?.parentId ?? null;
  // Every visible island is named in the scene, so the world explains itself. In the overview the selected one says
  // "you are here"; in focus it is the island in the middle and the card names it, so it carries no box over the world.
  const visibleLabels = nodes.filter((n) => slots.get(n.id)?.visible && (mode === "overview" || n.id !== b.id));

  return (
    <div
      className={`atlas-root ${narrow ? "narrow" : ""} ${panelOpen ? "panel-open" : "panel-closed"} mode-${mode}`}
      style={universeStyle(scenery.universe) as CSSProperties}
      data-family={scenery.choice.family}
      data-testid="atlas"
      onKeyDown={onKeyDown}
    >
      <div className="atlas-stage" ref={host} />
      <div className="atlas-vignette" aria-hidden="true" />

      <div className="atlas-top" ref={top}>
        <p className="atlas-kind" data-testid="atlas-kind">{ai ? "A map the AI drafted and you accepted" : examples ? "Your copy of an example: its figures are illustrative" : "Your map"}</p>
        <h1 className="atlas-question" data-testid="atlas-question">{r.question}</h1>
        <nav className="atlas-crumbs" aria-label="Where this future came from">
          <ol ref={crumbs}>
            {path.map((id, i) => {
              const n = byId.get(id);
              if (!n) return null;
              const last = i === path.length - 1;
              return (
                <li key={id}>
                  {last ? <span aria-current="location" data-testid="atlas-crumb-current">{n.name}</span> : <button type="button" onClick={() => store.select(id)} data-testid={`atlas-crumb-${n.name}`}>{n.name}</button>}
                </li>
              );
            })}
          </ol>
        </nav>
      </div>

      <div className="atlas-labels" role="group" aria-label={mode === "overview" ? "Every path on this map" : "Paths near this future"}>
        {visibleLabels.map((n) => {
          const s = slots.get(n.id)!;
          const x = r.branches.find((y) => y.id === n.id);
          const words = roleWords(s, n, sel, mode);
          const caption = x ? changeCaption(changesFromParent(r, x), x.parentId === null) : "";
          const whatIf = scenery.paths.get(n.id)?.hypothetical === true;
          return (
            <button
              key={n.id}
              ref={refFor(n.id)}
              type="button"
              className={`atlas-label role-${s.role} ${s.onPath ? "on-path" : ""} ${hover === n.id ? "hover" : ""} ${whatIf ? "what-if" : ""}`}
              style={{ opacity: 0 }}
              onClick={() => pick(n.id)}
              aria-label={`${n.name}${words ? `. ${words[0]!.toUpperCase()}${words.slice(1)}` : ""}${whatIf ? ". A what-if you described" : ""}. ${caption}`}
              aria-current={n.id === b.id ? "location" : undefined}
              title={caption}
              data-testid={`atlas-node-${n.name}`}
            >
              {words && <span className="al-role">{words}</span>}
              <span className="al-name">{n.name}</span>
            </button>
          );
        })}
      </div>

      <div className="atlas-panel-wrap" ref={panel}>
        {panelOpen ? (
          <div className="atlas-card">
            <AtlasPanel store={store} state={state} r={r} b={b} sheet={sheet} setSheet={setSheet} onClassic={onClassic} headingId="atlas-heading" scene={scene} />
            <button type="button" className="atlas-collapse" onClick={() => setPanelOpen(false)} aria-label="Hide the card and look at the world" data-testid="atlas-hide-panel">
              <span aria-hidden="true">{narrow ? "Hide" : "–"}</span>
            </button>
          </div>
        ) : (
          <button type="button" className="atlas-reopen" onClick={() => setPanelOpen(true)} data-testid="atlas-show-panel">
            <span className="atlas-reopen-name">{b.name}</span>
            <span className="atlas-reopen-hint">Show this future</span>
          </button>
        )}
      </div>

      <div className="atlas-bottom">
        <div className="atlas-status" role="status" aria-live="polite" data-testid="atlas-status">
          {model.state === "loading" && <span>Loading the London model{model.total ? `: ${Math.round((100 * model.loaded) / model.total)}%` : "…"}</span>}
          {model.state === "failed" && (
            <span data-testid="atlas-model-failed">
              The detailed London model could not be loaded, so London is drawn as a city island.{" "}
              <button type="button" className="atlas-link" onClick={() => sceneRef.current?.retryLondon()} data-testid="atlas-model-retry">Try again</button>
            </span>
          )}
          {quality?.q === "low" && <span data-testid="atlas-simplified">Simplified for this device</span>}
          {mode === "overview" && nodes.length < 3 && (
            <span data-testid="atlas-few-paths">
              This map has {nodes.length === 1 ? "one path, so the world shows one island" : `${nodes.length} paths, so the world shows ${nodes.length} islands`}. To add one, pick a future and use “Explore another path from here”: nothing is created until you choose.
            </span>
          )}
        </div>
        <div className="atlas-bar" role="toolbar" aria-label="Move between futures" ref={bar}>
          <div className="atlas-seg" role="group" aria-label="View">
            <button type="button" aria-pressed={mode === "focus"} onClick={() => setMode("focus")} data-testid="atlas-focus">Focus</button>
            <button type="button" aria-pressed={mode === "overview"} onClick={() => setMode("overview")} aria-label={`Overview: every path on this map (${nodes.length})`} data-testid="atlas-overview">Overview<span className="atlas-seg-count" aria-hidden="true">{nodes.length}</span></button>
          </div>
          <div className="atlas-nav" role="group" aria-label="Neighbouring futures">
            <button type="button" onClick={() => go("ArrowUp")} disabled={!parentId} aria-label="The future this one came from" data-testid="atlas-up"><span aria-hidden="true">↑</span><span className="atlas-nav-text">Came from</span></button>
            <button type="button" onClick={() => go("ArrowLeft")} disabled={!neighbour(nodes, b.id, "ArrowLeft")} aria-label="Previous path from the same place" data-testid="atlas-prev"><span aria-hidden="true">←</span></button>
            <button type="button" onClick={() => go("ArrowRight")} disabled={!neighbour(nodes, b.id, "ArrowRight")} aria-label="Next path from the same place" data-testid="atlas-next"><span aria-hidden="true">→</span></button>
            <button type="button" onClick={() => go("ArrowDown")} disabled={!sel?.children.length} aria-label="A future that continues from this one" data-testid="atlas-down"><span aria-hidden="true">↓</span><span className="atlas-nav-text">Continues</span></button>
          </div>
          <button type="button" className="atlas-recenter" onClick={() => sceneRef.current?.recenter()} data-testid="atlas-recenter">Recenter</button>
          <SceneryControl scenery={scenery} reasons={reasons} path={b.name} />
        </div>
        <p className="atlas-note" data-testid="atlas-illustrative">The scenery is illustrative: nothing in the picture is a fact about any future.<span className="atlas-hint" aria-hidden="true"> Drag to look around; arrow keys move between futures; O shows every path.</span></p>
      </div>
    </div>
  );
}
