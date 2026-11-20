/**
 * Your maps: every map saved in this browser, to open, continue, save to a file, open from a file or remove. It uses
 * the store's own operations (open, exportText, importText, removeReality, reset) and its saved order (savedMaps), so
 * the storage key, the bundle format and import's merge rules are exactly as before. The picture on each map is its
 * scenery (the same resolver as Explore): illustrative, never a fact about any future.
 */
import { useMemo, useSyncExternalStore } from "react";
import type { Reality } from "@realityfork/core";
import { savedMaps, type RealityStore } from "./store";
import { resolveScenery, sceneryName } from "../atlas/environment/resolve";
import { UNIVERSES } from "../atlas/environment/universes";
import { Isle } from "./Discover";
import { useConfirm, useToast } from "./dialogs";
import { whenText } from "./SavedNote";

/** Save every map to a file with the existing export (the format import reads). Returns how many were saved. */
export function downloadAll(store: RealityStore): number {
  const n = store.getState().realities.length;
  const blob = new Blob([store.exportText()], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "realityfork-realities.json";
  a.click();
  URL.revokeObjectURL(a.href);
  return n;
}

/** Ask before removing every map, then remove them (store.reset: this browser's copy only). */
export function useRemoveAll(store: RealityStore) {
  const confirm = useConfirm();
  const toast = useToast();
  return async () => {
    const n = store.getState().realities.length;
    const ok = await confirm({
      title: n === 1 ? "Remove your map from this browser?" : `Remove all ${n} maps from this browser?`,
      body: <p>Every map and path saved in this browser is removed. Files you saved are not affected: save your maps to a file first if you may want them back. This cannot be undone.</p>,
      confirm: n === 1 ? "Remove the map" : `Remove all ${n} maps`,
    });
    if (!ok) return false;
    store.reset();
    toast(n === 1 ? "Your map was removed from this browser." : `All ${n} maps were removed from this browser.`);
    return true;
  };
}

/** A window onto the map's own night, with one engraved island: which kind of world it opens into. Decorative. */
export function WorldWindow({ r }: { r: Reality }) {
  const choice = useMemo(() => resolveScenery(r), [r]);
  const u = UNIVERSES[choice.family];
  return (
    <span className="world-window" aria-hidden="true" data-family={choice.family} style={{ background: `radial-gradient(circle at 78% 24%, ${u.sky.moon} 0 6%, transparent 7.5%), radial-gradient(ellipse 90% 60% at 50% 110%, ${u.css.horizon}, transparent 70%), linear-gradient(180deg, ${u.css.top}, ${u.css.mid} 60%, ${u.css.horizon})` }}>
      <Isle variant={r.branches.length} className="ww-isle" />
    </span>
  );
}

function MapCard({ store, r, edited, reference }: { store: RealityStore; r: Reality; edited: string | null; reference: boolean }) {
  const confirm = useConfirm();
  const toast = useToast();
  const choice = useMemo(() => resolveScenery(r), [r]);
  const names = r.branches.map((b) => b.name);
  const listed = names.slice(0, 3).join(", ") + (names.length > 3 ? ` and ${names.length - 3} more` : "");
  const kind = r.origin?.kind === "ai" ? "AI-drafted, accepted by you" : r.branches.some((b) => Object.values(b.sources ?? {}).includes("example")) ? "A copy of an example" : "Mapped by you";
  const remove = async () => {
    const ok = await confirm({
      title: "Remove this map from this browser?",
      body: (
        <>
          <p className="dialog-quote">{r.question}</p>
          <p>Its {r.branches.length} {r.branches.length === 1 ? "path is" : "paths are"} removed from this browser. Files you saved are not affected. This cannot be undone unless you saved it to a file.</p>
        </>
      ),
      confirm: "Remove this map",
      cancel: "Keep it",
    });
    if (!ok) return;
    store.removeReality(r.id);
    toast("The map was removed from this browser.");
  };
  return (
    <li className="map-card" data-testid={`library-map-${r.id}`}>
      <WorldWindow r={r} />
      <div className="map-card-body">
        <p className="map-card-kind">{kind}</p>
        <h2 className="map-card-q">{r.question}</h2>
        <p className="map-card-meta">{r.branches.length} {r.branches.length === 1 ? "path" : "paths"}: {listed}</p>
        <p className="map-card-meta">
          {edited ? <>Last change {whenText(edited)}</> : "No edit time recorded (saved before RealityFork kept one, or opened from a file)"}
          {reference && <> · map {r.id.slice(-6)}</>}
        </p>
        <p className="map-card-world small">Drawn as {sceneryName(choice.family, choice.theme).toLowerCase()} <span className="muted">(illustrative)</span></p>
      </div>
      <div className="map-card-actions">
        <button type="button" className="btn pill accent" onClick={() => store.open(r.id)} data-testid={`library-open-${r.id}`} aria-label={`Open: ${r.question}`}>Open</button>
        <button type="button" className="btn pill btn-quiet-danger" onClick={() => void remove()} data-testid={`library-remove-${r.id}`} aria-label={`Remove from this browser: ${r.question}`}>Remove</button>
      </div>
    </li>
  );
}

export function Library({ store, onHome, onImport }: { store: RealityStore; onHome: () => void; onImport: () => void }) {
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const maps = savedMaps(state);
  const toast = useToast();
  const removeAll = useRemoveAll(store);
  const sameQuestion = (r: Reality) => maps.filter((m) => m.reality.question === r.question).length > 1;
  const save = () => {
    const n = downloadAll(store);
    toast(`Saved ${n} ${n === 1 ? "map" : "maps"} to a file (realityfork-realities.json, in your downloads).`);
  };
  return (
    <main className="stage library" data-testid="library">
      <header className="stage-head library-head">
        <p className="eyebrow">Your maps</p>
        <h1 className="question" tabIndex={-1} data-stage-focus>Every future you have mapped</h1>
        <p className="library-lede">Saved in this browser as you work. Save them to a file to keep a copy or to move them to another browser; opening a file adds its maps and never replaces one you have.</p>
      </header>
      <div className="library-tools" role="group" aria-label="Saving and opening maps">
        {maps.length > 0 && <button type="button" className="btn pill" onClick={save} data-testid="library-export">Save all maps to a file</button>}
        <button type="button" className="btn pill" onClick={onImport} data-testid="library-import">Open a saved file</button>
        {maps.length > 0 && <button type="button" className="btn pill btn-quiet-danger" onClick={() => void removeAll()} data-testid="library-reset">Remove all…</button>}
      </div>
      {state.loadError && (
        <section className="library-problem" role="alert" data-testid="library-load-error">
          <h2>Your saved maps could not be opened</h2>
          <p>{state.loadError}</p>
          <p className="muted small">Nothing was changed. If you have a file you saved earlier, you can open it after starting fresh.</p>
        </section>
      )}
      {maps.length === 0 ? (
        <section className="library-empty" data-testid="library-empty">
          <Isle variant={2} className="empty-isle" />
          <h2>No maps in this browser yet</h2>
          <p className="muted">A map is saved here when you choose a future to explore, open an example or start a blank map.</p>
          <div className="actions-row">
            <button type="button" className="btn btn-primary" onClick={onHome} data-testid="library-ask">Ask a what-if question</button>
            <button type="button" className="link-btn" onClick={onImport}>Open a saved file</button>
          </div>
        </section>
      ) : (
        <>
          <p className="library-count small muted">{maps.length} {maps.length === 1 ? "map" : "maps"}, most recently changed first. The path you were on and any comparison are not saved, so each map opens where it starts.</p>
          <ul className="map-cards">
            {maps.map(({ reality: r, edited }) => <MapCard key={r.id} store={store} r={r} edited={edited} reference={sameQuestion(r)} />)}
          </ul>
        </>
      )}
    </main>
  );
}
