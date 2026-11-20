import { Component, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { contextFacts, type PlanState, type RealityStore } from "./store";
import { Imagine } from "./Imagine";
import { Discover } from "./Discover";
import { Explore } from "./Explore";
import { CompareView } from "./CompareView";
import { Library, downloadAll, useRemoveAll } from "./Library";
import { OverlayHost, useConfirm, useHelp, useToast } from "./dialogs";
import { NavContext } from "./SavedNote";
import { AtlasGate } from "../atlas/AtlasGate";
import { useSceneryOverride } from "../atlas/environment/override";
import { resolveScenery, type SceneryInput } from "../atlas/environment/resolve";
import { UNIVERSES } from "../atlas/environment/universes";
import { universeStyle } from "../atlas/environment/useScenery";

type Stage = "imagine" | "discover" | "explore" | "compare" | "library";

/** What a draft says about its subject, read for the sky only (see resolveScenery). Null when there is no draft. */
function planScenery(plan: PlanState): SceneryInput | null {
  switch (plan.status) {
    case "idle": return null;
    case "ready": return { question: plan.question, context: contextFacts(plan.round), variables: plan.proposal.variables, formulas: plan.proposal.formulas, branches: plan.proposal.branches };
    case "context": return { question: plan.question, variables: plan.draft.proposal.variables, formulas: plan.draft.proposal.formulas, branches: plan.draft.proposal.branches };
    default: return { question: plan.question, variables: [], formulas: [], branches: [] };
  }
}

/** The mark: one line that forks into two, lit where it splits. Decorative (the button has its own name). */
function ForkMark() {
  return (
    <svg className="fork-mark" viewBox="0 0 34 22" width="34" height="22" aria-hidden="true" focusable="false">
      <path d="M2 11 H13 C19 11 21 4 31 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M13 11 C19 11 21 18 31 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.55" />
      <circle cx="13" cy="11" r="2.6" className="fork-mark-light" />
    </svg>
  );
}

/**
 * Secondary actions live in one quiet menu so every stage keeps a single obvious next step. A disclosure, so it works
 * without script; the arrow keys move between its items, Escape and a click elsewhere close it.
 */
function MoreMenu({ store, onImport, onLibrary }: { store: RealityStore; onImport: () => void; onLibrary: () => void }) {
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const ref = useRef<HTMLDetailsElement>(null);
  const toast = useToast();
  const help = useHelp();
  const removeAll = useRemoveAll(store);
  const close = () => ref.current?.removeAttribute("open");
  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (ref.current?.open && !ref.current.contains(e.target as Node)) close();
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, []);
  const download = () => {
    const n = downloadAll(store);
    close();
    toast(`Saved ${n} ${n === 1 ? "map" : "maps"} to a file (realityfork-realities.json, in your downloads).`);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDetailsElement>) => {
    if (e.key === "Escape" && ref.current?.open) {
      close();
      ref.current.querySelector("summary")?.focus();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = [...(ref.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    if (!items.length) return;
    e.preventDefault();
    if (!ref.current?.open) ref.current?.setAttribute("open", "");
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "ArrowDown" ? (i + 1) % items.length : (i <= 0 ? items.length : i) - 1;
    items[next]?.focus();
  };
  const n = state.realities.length;
  return (
    <details className="more" ref={ref} onKeyDown={onKeyDown}>
      <summary data-testid="more-menu" aria-haspopup="menu">More</summary>
      <div className="more-panel" role="menu" aria-label="More">
        <p className="more-group" aria-hidden="true">Your maps</p>
        <button role="menuitem" onClick={() => { close(); onLibrary(); }} data-testid="more-library">
          <span>Your maps</span>{n > 0 && <span className="more-count">{n}</span>}
        </button>
        {n > 0 && <button role="menuitem" onClick={download} data-testid="export-realities">Save all maps to a file</button>}
        <button role="menuitem" onClick={() => { close(); onImport(); }} data-testid="import-realities">Open a saved file</button>
        <p className="more-group" aria-hidden="true">Help and tools</p>
        <button role="menuitem" onClick={() => { close(); help(); }} data-testid="more-help">How RealityFork works</button>
        <a role="menuitem" href="#staffing" data-testid="open-staffing" onClick={close}>Staffing simulator (specialised tool)</a>
        {n > 0 && (
          <>
            <hr className="more-rule" />
            <button role="menuitem" className="danger" onClick={() => { close(); void removeAll(); }} data-testid="reset-realities">Remove all maps from this browser</button>
          </>
        )}
      </div>
    </details>
  );
}

/**
 * If a screen fails to draw, say so in the app's own words and offer the way back. Saved maps are untouched: they are
 * written on every change, before anything is drawn.
 */
class StageBoundary extends Component<{ onHome: () => void; children: ReactNode }, { failed: string | null }> {
  override state = { failed: null as string | null };
  static getDerivedStateFromError(e: unknown) {
    return { failed: e instanceof Error ? e.message : String(e) };
  }
  override render() {
    if (this.state.failed === null) return this.props.children;
    return (
      <main className="stage stage-failed" role="alert" data-testid="stage-error">
        <h1 className="question" tabIndex={-1} data-stage-focus>This screen could not be shown</h1>
        <p>Something went wrong while drawing it. Your maps are saved in this browser and were not changed.</p>
        <p className="small muted">What went wrong: {this.state.failed}</p>
        <div className="actions-row">
          <button type="button" className="btn btn-primary" onClick={() => { this.setState({ failed: null }); this.props.onHome(); }} data-testid="stage-error-home">Back to the start</button>
        </div>
      </main>
    );
  }
}

/** A notice in the app's voice, with its own way to close. */
function Banner({ kind, testid, children, action }: { kind: "error" | "info"; testid?: string; children: ReactNode; action: ReactNode }) {
  return (
    <div className={`banner ${kind}`} role={kind === "error" ? "alert" : "status"} data-testid={testid}>
      <span className="banner-mark" aria-hidden="true" />
      <span className="banner-text">{children}</span>
      {action}
    </div>
  );
}

/** What happened, from the store: a saved bundle that could not be checked, an error, a notice (after opening a file). */
function Banners({ store }: { store: RealityStore }) {
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const confirm = useConfirm();
  const startFresh = async () => {
    const ok = await confirm({
      title: "Start fresh in this browser?",
      body: <p>The saved maps that could not be checked are removed from this browser, so new maps can be saved. If you have a file you saved earlier, you can open it afterwards.</p>,
      confirm: "Start fresh",
      cancel: "Not now",
    });
    if (ok) store.reset();
  };
  return (
    <div className="rf-banners">
      {state.loadError && <Banner kind="error" action={<button onClick={() => void startFresh()} data-testid="start-fresh">Start fresh</button>}>{state.loadError}</Banner>}
      {state.error && <Banner kind="error" testid="error" action={<button onClick={store.dismiss}>Dismiss</button>}>{state.error}</Banner>}
      {state.notice && <Banner kind="info" testid="notice" action={<button onClick={store.dismiss}>OK</button>}>{state.notice}</Banner>}
    </div>
  );
}

function Shell({ store }: { store: RealityStore }) {
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const fileRef = useRef<HTMLInputElement>(null);
  const active = store.active();
  const [library, setLibrary] = useState(false);
  // Opening a map (from anywhere) leaves the library.
  useEffect(() => {
    if (active) setLibrary(false);
  }, [active?.id]);
  const stage: Stage = active ? (state.view === "compare" ? "compare" : "explore") : library ? "library" : state.plan.status === "idle" ? "imagine" : "discover";
  const plan = state.plan;
  const step = stage === "discover" ? `${plan.status}${plan.status === "context" ? plan.step : ""}` : "";
  const focusKey = `${stage}|${stage === "explore" ? state.selectedId : step}`;
  // An open map's universe colours the page's sky too, so every stage of one map stands under the same night. While a
  // draft is on screen, its own words choose the night it will open into (the same resolver; nothing is saved).
  const [override] = useSceneryOverride(active?.id ?? "");
  const sky = useMemo(() => {
    if (active) return universeStyle(UNIVERSES[resolveScenery(active, override).family]);
    const draft = planScenery(plan);
    return draft ? universeStyle(UNIVERSES[resolveScenery(draft).family]) : undefined;
  }, [active, override, plan]);
  const home = useCallback(() => {
    setLibrary(false);
    store.home();
  }, [store]);
  // The library is a place in the app (like the start), not a saved state: going there leaves a draft or open map
  // exactly as the wordmark does (open maps are saved; a draft is discarded).
  const openLibrary = useCallback(() => {
    if (store.active() || store.getState().plan.status !== "idle") store.home();
    setLibrary(true);
  }, [store]);
  const openFile = useCallback(() => fileRef.current?.click(), []);
  const nav = useMemo(() => ({ openLibrary, openFile }), [openLibrary, openFile]);
  // Move keyboard and screen-reader focus to the new stage's heading when the stage or its step changes (not on
  // first load). A step inside a stage (a context question) may name its own heading with data-step-focus.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const el = document.querySelector<HTMLElement>("[data-step-focus]") ?? document.querySelector<HTMLElement>("[data-stage-focus]");
    el?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, [focusKey]);

  return (
    <NavContext.Provider value={nav}>
      <div className={`rf stage-${stage}`} style={sky as CSSProperties | undefined}>
        <OverlayHost>
        <a className="skip-link" href="#rf-main">Skip to content</a>
        <header className="rf-top">
          <button className="wordmark" onClick={home} data-testid="home" aria-label="RealityFork: back to the start">
            <ForkMark />
            <span className="wordmark-text">RealityFork</span>
          </button>
          <MoreMenu store={store} onImport={openFile} onLibrary={openLibrary} />
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            data-testid="import-realities-file"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) await store.importText(await f.text());
              e.target.value = "";
            }}
          />
        </header>
        <Banners store={store} />
        <div id="rf-main" className="rf-main" key={stage}>
          <StageBoundary onHome={home}>
            {stage === "imagine" && <Imagine store={store} />}
            {stage === "discover" && <Discover store={store} />}
            {/* The 3D Explore preview is opt-in (?preview=atlas); without the flag this is exactly the standard view. */}
            {stage === "explore" && <AtlasGate store={store}><Explore store={store} /></AtlasGate>}
            {stage === "compare" && <CompareView store={store} />}
            {stage === "library" && <Library store={store} onHome={home} onImport={openFile} />}
          </StageBoundary>
        </div>
        </OverlayHost>
      </div>
    </NavContext.Provider>
  );
}

export function RealityApp({ store }: { store: RealityStore }) {
  return <Shell store={store} />;
}
