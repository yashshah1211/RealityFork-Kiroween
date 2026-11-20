import { lazy, Suspense, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { EXAMPLES, MAX_QUESTION_LENGTH, type Reality, type RealityTemplate } from "@realityfork/core";
import { asWhatIf, savedMaps, type RealityStore } from "./store";
import { atlasRequested, webglAvailable } from "../atlas/flag";
import { resolveScenery, type Family } from "../atlas/environment/resolve";
import { UNIVERSES } from "../atlas/environment/universes";
import { useNav } from "./SavedNote";

const RECENT = 4;
const when = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const Backdrop = lazy(() => import("../atlas/AtlasBackdrop"));

/**
 * One saved map: its question, its paths, and when it was last edited if that was recorded. `reference` adds the end of
 * the map's id, so two maps with the same question can still be told apart.
 */
function MapLink({ store, reality: r, edited, testid, reference }: { store: RealityStore; reality: Reality; edited: string | null; testid: string; reference?: boolean }) {
  const names = r.branches.map((b) => b.name);
  const listed = names.slice(0, 3).join(", ") + (names.length > 3 ? ` and ${names.length - 3} more` : "");
  const family = useMemo(() => resolveScenery(r).family, [r]);
  return (
    <button type="button" className="continue-link" onClick={() => store.open(r.id)} data-testid={testid}>
      <WorldDot family={family} />
      <span className="continue-body">
        <span className="continue-q">{r.question}</span>
        <span className="continue-meta">
          {r.branches.length} {r.branches.length === 1 ? "path" : "paths"}: {listed}
          {edited && <> · edited {when.format(new Date(edited))}</>}
          {reference && <> · map {r.id.slice(-6)}</>}
        </span>
      </span>
    </button>
  );
}

/** A small disc in a universe's own sky colours: which kind of world a map opens into. Decorative. */
function WorldDot({ family }: { family: Family }) {
  const u = UNIVERSES[family];
  return <span className="world-dot" aria-hidden="true" data-family={family} style={{ background: `radial-gradient(circle at 70% 28%, ${u.sky.moon} 0 9%, transparent 11%), linear-gradient(180deg, ${u.css.top}, ${u.css.mid} 55%, ${u.css.horizon})` }} />;
}

/** The painted world: one path that forks into three, lit where it splits. Shown without WebGL and until the 3D world arrives. */
function PathsMotif() {
  return (
    <svg className="motif" viewBox="0 0 800 600" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <path className="motif-line" d="M40 430 C 170 430, 260 430, 330 430 C 470 430, 540 210, 760 150" />
      <path className="motif-line" d="M40 430 C 170 430, 260 430, 330 430 C 480 430, 560 360, 760 330" />
      <path className="motif-line" d="M40 430 C 170 430, 260 430, 330 430 C 470 430, 560 510, 760 540" />
      <circle className="motif-dot" cx="330" cy="430" r="6" />
      {[[760, 150], [760, 330], [760, 540]].map(([x, y]) => <circle key={y} className="motif-end" cx={x} cy={y} r="4" />)}
    </svg>
  );
}

/** The landing world: the 3D scene when it is available (the 3D preview flag and WebGL), the painted one otherwise. */
function ImagineWorld({ formRef, bandRef, live, onFailed, onDiscovery }: { formRef: RefObject<HTMLElement>; bandRef: RefObject<HTMLElement>; live: boolean; onFailed: () => void; onDiscovery: (count: number) => void }) {
  return (
    <div className="im-world">
      <PathsMotif />
      {live && (
        <Suspense fallback={null}>
          <Backdrop formRef={formRef} bandRef={bandRef} onFailed={onFailed} onDiscovery={onDiscovery} />
        </Suspense>
      )}
    </div>
  );
}

/** Which world an example opens into, read by the same rules as any map (no example ids). */
const exampleFamily = (t: RealityTemplate): Family =>
  resolveScenery({ question: t.question, description: t.description, variables: t.variables, formulas: t.formulas, branches: [{ name: t.startName, description: "" }, ...t.branches] }).family;

/** Stage 1: one question, one action. */
export function Imagine({ store }: { store: RealityStore }) {
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const nav = useNav();
  const maps = savedMaps(state);
  // Maps that share a question also show the end of their id, so each one can be told apart.
  const sameQuestion = (r: Reality) => maps.filter((m) => m.reality.question === r.question).length > 1;
  const [text, setText] = useState(state.lastQuestion);
  const [hint, setHint] = useState(false);
  const hero = useRef<HTMLElement>(null);
  const main = useRef<HTMLElement>(null);
  const band = useRef<HTMLDivElement>(null);
  // Without the 3D world (no flag, no WebGL, or it failed) the page is laid out tighter: the question comes first.
  const [want] = useState(() => typeof window !== "undefined" && atlasRequested(window.location.search) && webglAvailable());
  const [failed, setFailed] = useState(false);
  const [discoveries, setDiscoveries] = useState(0);
  const live = want && !failed;
  // In the stacked layout, the question comes first and the futures float in a band of sky below it. The world scrolls with the page,
  // from behind the header down to just past that band (reality.css), so it is measured here.
  useLayoutEffect(() => {
    const m = main.current, b = band.current;
    if (!live || !m || !b) return;
    const measure = () => {
      const top = m.getBoundingClientRect().top + window.scrollY;
      const bottom = b.getBoundingClientRect().bottom + window.scrollY;
      m.style.setProperty("--im-world-top", `${-Math.round(top)}px`);
      m.style.setProperty("--im-world-h", `${Math.round(Math.max(window.innerHeight, bottom + 32))}px`);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(m);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [live]);
  // Counted as it will be asked ("What if" included), the same way the server counts it. Checked here, before anything
  // is sent or the page changes; the text is never cut, so the user can shorten it themselves.
  const length = text.trim() ? asWhatIf(text.trim()).length : 0;
  const tooLong = length > MAX_QUESTION_LENGTH;
  const [showLimit, setShowLimit] = useState(false);
  const check = () => {
    if (!text.trim()) return setHint(true), false;
    if (tooLong) return setShowLimit(true), false;
    return true;
  };
  const explore = () => {
    if (check()) void store.requestPlan(text);
  };
  const blank = () => {
    if (check()) void store.create(text);
  };
  return (
    <main className={`stage imagine ${live ? "with-world" : "flat"}`} ref={main} data-testid="imagine">
      <ImagineWorld formRef={hero} bandRef={band} live={live} onFailed={() => setFailed(true)} onDiscovery={setDiscoveries} />
      <div className="im-grid">
        <section className="hero" ref={hero} aria-label="Your question">
          <form className="whatif" onSubmit={(e) => { e.preventDefault(); explore(); }}>
            <label htmlFor="whatif-input" className="whatif-lead">What if</label>
            {/* A field you can see: a frame, a caption in the plain type, and a caret that waits in it. */}
            <div
              className={`whatif-field ${text ? "filled" : ""}`}
              onMouseDown={(e) => {
                const field = e.currentTarget.querySelector("textarea");
                if (field && e.target !== field) { e.preventDefault(); field.focus(); }
              }}
            >
              <span className="whatif-caption" aria-hidden="true"><span className="whatif-pen" />{text ? "Your question" : "Type your own question"}</span>
              <textarea
                id="whatif-input"
                data-stage-focus
                className="whatif-input"
                value={text}
                rows={2}
                placeholder="…I opened a bookshop in my town?"
                onChange={(e) => { setText(e.target.value); setHint(false); }}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); explore(); } }}
                aria-describedby="whatif-help whatif-count"
                aria-invalid={tooLong || undefined}
                data-testid="whatif-input"
              />
            </div>
            <div className="whatif-actions">
              <button className="btn btn-primary btn-big" type="submit" data-testid="explore-possibilities">Explore possibilities</button>
              <p id="whatif-count" className={`whatif-count ${tooLong ? "warn" : ""}`} aria-live="polite" data-testid="whatif-count">
                {length} of {MAX_QUESTION_LENGTH} characters
              </p>
            </div>
            <p id="whatif-help" className={`whatif-help ${hint || (tooLong && showLimit) ? "hint" : ""}`} role={hint || (tooLong && showLimit) ? "alert" : undefined} data-testid="whatif-help">
              {hint
                ? "Type a situation first, for example “…I moved to another city?”"
                : tooLong && showLimit
                  ? `That is ${length} characters; questions can be up to ${MAX_QUESTION_LENGTH}. Shorten it by ${length - MAX_QUESTION_LENGTH} to explore. Your text is kept.`
                  : "Describe any decision, large or small. RealityFork drafts a few possible futures for you to explore, change and compare: possibilities to think with, never predictions."}
            </p>
          </form>
        </section>
        {live && (
          <div className="im-band" ref={band} data-testid="imagine-band">
            <p className="im-discovery" role="status" aria-atomic="true">{discoveries > 0 ? `Secrets discovered · ${discoveries}/5` : ""}</p>
          </div>
        )}

        <section className="quiet" aria-label="Other ways to start">
          <div className="examples-block">
            <h2 className="im-h">Or open an example</h2>
            <ul className="examples">
              {EXAMPLES.map((t) => (
                <li key={t.id}>
                  <button type="button" className="example" onClick={() => void store.loadExample(t.id)} data-testid={`example-${t.id}`} title="Opens a new copy of the example; your saved maps are kept.">
                    <WorldDot family={exampleFamily(t)} />
                    <span className="example-text">
                      <span className="example-title">{t.title}</span>
                      <span className="example-q">{t.question}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="im-note">Each example opens as a new copy. Its figures are illustrative, not data.</p>
          </div>
          {maps.length > 0 && (
            <div className="continue">
              <div className="continue-head">
                <h2 className="im-h">Continue exploring</h2>
                {nav && <button type="button" className="link-btn" onClick={nav.openLibrary} data-testid="open-library">All your maps ({maps.length}) →</button>}
              </div>
              <p className="im-note continue-note">Each map opens where it starts. Every change is saved in this browser.</p>
              <ul>
                {maps.slice(0, RECENT).map(({ reality: r, edited }) => (
                  <li key={r.id}><MapLink store={store} reality={r} edited={edited} testid={`open-${r.question}`} reference={sameQuestion(r)} /></li>
                ))}
              </ul>
              {maps.length > RECENT && (
                <details className="all-maps" data-testid="all-maps">
                  <summary>All your maps ({maps.length})</summary>
                  <p className="im-note">
                    Every map saved in this browser, most recently edited first.
                    {maps.some((m) => m.edited === null) && " Maps without an edit time were saved before RealityFork recorded it, or came from a file, and follow newest first."}
                    {" "}The path you were on and any comparison are not saved, so each map opens where it starts.
                  </p>
                  <ul>
                    {maps.map(({ reality: r, edited }) => (
                      <li key={r.id}><MapLink store={store} reality={r} edited={edited} testid={`open-map-${r.id}`} reference={sameQuestion(r)} /></li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
          <p className="quiet-line">
            <span>Prefer to set it up yourself?</span>{" "}
            <button type="button" className="link-btn" onClick={blank} data-testid="start-blank">Start a blank map</button>
            {nav && maps.length === 0 && (
              <>
                <span aria-hidden="true">·</span>
                <button type="button" className="link-btn" onClick={nav.openFile} data-testid="imagine-open-file">Open a saved file</button>
              </>
            )}
          </p>
        </section>
      </div>
    </main>
  );
}
