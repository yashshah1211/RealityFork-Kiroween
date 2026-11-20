import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MathUtils } from "three";
import type { AtlasScene, LandingVisit, LandingVisitStats } from "../scene/AtlasScene";
import { HollowControls, type Capture, type Direction } from "./controls";
import type { InteractionView } from "./interactions";
import type { DoorwayEscape, HollowArea, HollowWorld } from "./world";
import { HOLLOW_ISLAND, LANDING_SECRET_ACTIONS } from "../scene/landingHaunt";
import { ChapterPanel, type Page } from "./story/ChapterPanel";
import { approachOf, begin, decide, switchTo, type Timeline } from "./story/timeline";
import { isApproach, rules } from "./story/mara";
import "./hollow.css";

type Phase = "closed" | "loading" | LandingVisitStats["phase"];
type Session = { visit?: LandingVisit; world?: HollowWorld; controls?: HollowControls; resize?: ResizeObserver };
const APPROACH_MS = 850;
const REVEAL_MS = 390;
// The landing and its renderer may remount during the same page visit.
let visitTimeline: Timeline | null = null;
const EMPTY_INTERACTION: InteractionView = { prompt: null, story: "" };
const DIRECTIONS: readonly [Direction, string, string][] = [
  ["ArrowLeft", "Step left", "←"], ["ArrowUp", "Walk forward", "↑"],
  ["ArrowDown", "Walk backward", "↓"], ["ArrowRight", "Step right", "→"],
];

function dispose(session: Session | null) {
  session?.controls?.dispose();
  session?.resize?.disconnect();
  session?.world?.dispose();
  session?.visit?.end();
}

export function HollowPortal({ scene, band, onPlanner }: { scene: AtlasScene; band: HTMLElement; onPlanner: () => void }) {
  const [phase, setPhase] = useState<Phase>("closed");
  const [interaction, setInteraction] = useState(EMPTY_INTERACTION);
  const [area, setArea] = useState<HollowArea>("courtyard");
  const [capture, setCapture] = useState<Capture>(null);
  const [doorwayEscape, setDoorwayEscape] = useState<DoorwayEscape>(null);
  const [failed, setFailed] = useState(false);
  const entry = useRef<HTMLButtonElement>(null);
  const returnButton = useRef<HTMLButtonElement>(null);
  const interactionButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const veil = useRef<HTMLDivElement>(null);
  const threshold = useRef<HTMLDivElement>(null);
  const current = useRef<Session | null>(null);
  const [book, setBook] = useState<Timeline>(() => visitTimeline ?? begin());
  const [started, setStarted] = useState(() => visitTimeline !== null);
  const [page, setPage] = useState<Page | null>(null);
  const chapter = useRef({ book, started });
  const node = book.nodes[book.active]!;
  const sold = node.state.shop === rules.sell.change.shop;
  const roomName = sold ? "Bookshop memory archive" : "The Whispering Bookshop";
  useLayoutEffect(() => {
    chapter.current = { book, started };
    if (started) visitTimeline = book;
    current.current?.world?.setChapter(node, approachOf(book));
  }, [book, started, node]);
  const showPage = (next: Page) => {
    current.current?.controls?.pause(true);
    setPage(next);
  };
  const closePage = () => {
    setPage(null);
    current.current?.controls?.pause(false);
    requestAnimationFrame(() => {
      if (current.current && !dialog.current?.querySelector(".chapter-page[open]")) {
        const mark = dialog.current?.querySelector<HTMLButtonElement>(".chapter-waypoint button");
        (mark ?? returnButton.current)?.focus({ preventScroll: true });
      }
    });
  };
  const title = useId();
  const guidance = useId();

  useEffect(() => () => {
    dispose(current.current);
    current.current = null;
  }, []);

  const close = () => {
    const session = current.current;
    current.current = null;
    dispose(session);
    setPage(null);
    viewport.current?.removeAttribute("data-drawn");
    veil.current?.style.removeProperty("opacity");
    threshold.current?.style.removeProperty("opacity");
    // Close the top modal first so the planner field can receive focus in this event.
    dialog.current?.querySelector<HTMLDialogElement>(".chapter-page[open]")?.close();
    dialog.current?.close();
    entry.current?.focus({ preventScroll: true });
    setPhase("closed");
  };

  const enter = async () => {
    const modal = dialog.current, surface = viewport.current, fog = veil.current;
    if (current.current || !modal || !surface || !fog) return;
    const session: Session = {};
    current.current = session;
    setFailed(false);
    setInteraction(EMPTY_INTERACTION);
    setArea("courtyard");
    setDoorwayEscape(null);
    setCapture(null);
    setPhase("loading");
    modal.showModal();
    const fail = () => {
      if (current.current !== session) return;
      close();
      setFailed(true);
    };
    try {
      const { HollowWorld } = await import("./world");
      if (current.current !== session) return;
      let stage: LandingVisitStats["phase"] = "approach";
      let started: number | undefined;
      let progress = 0;
      const visit = scene.beginLandingVisit(HOLLOW_ISLAND, (visit, now, step) => {
        try {
          started ??= now;
          const reduced = visit.reducedMotion();
          if (stage === "approach") {
            progress = reduced ? 1 : Math.min(1, (now - started) / APPROACH_MS);
            if (progress < 1) {
              const eased = MathUtils.smoothstep(progress, 0, 1);
              eye.position.lerpVectors(visit.camera.position, approachEnd, eased);
              eye.quaternion.slerpQuaternions(visit.camera.quaternion, aim.quaternion, eased);
              eye.fov = MathUtils.lerp(visit.camera.fov, 39, eased);
              if (eye.view && visit.camera.view) {
                eye.view.offsetX = visit.camera.view.offsetX * (1 - eased);
                eye.view.offsetY = visit.camera.view.offsetY * (1 - eased);
              }
              eye.updateProjectionMatrix();
              visit.drawApproach(eye);
              fog.style.opacity = String(MathUtils.smoothstep(progress, 0.46, 0.92));
              return;
            }
            // Move the retained canvas under the veil and draw the courtyard in this same frame.
            if (!reduced) fog.style.opacity = "1";
            visit.mount(surface);
            world.draw(visit.renderer, surface, step, reduced);
            surface.setAttribute("data-drawn", "");
            session.resize = new ResizeObserver(() => world.invalidate());
            session.resize.observe(surface);
            started = now;
            stage = "reveal";
            if (!reduced) setPhase("reveal");
          }
          if (stage === "reveal") {
            const reveal = reduced ? 1 : MathUtils.smoothstep((now - started) / REVEAL_MS, 0, 1);
            fog.style.opacity = String(1 - reveal);
            if (reveal < 1) {
              world.draw(visit.renderer, surface, step, reduced);
              return;
            }
            session.controls = new HollowControls(surface, modal, world, setCapture);
            stage = "exploring";
            setPhase("exploring");
          }
          session.controls?.step(step);
          world.draw(visit.renderer, surface, step, reduced);
        } catch {
          fail();
        }
      }, () => ({
        phase: stage, progress, approachEye: eye.position.toArray(),
        looking: session.controls?.looking ?? false, world: stage === "approach" ? null : world.stats(),
      }));
      if (!visit) {
        fail();
        return;
      }
      session.visit = visit;
      const world = new HollowWorld(visit.quality, (next) => {
        if (!next.prompt && interactionButton.current === document.activeElement) {
          returnButton.current?.focus({ preventScroll: true });
        }
        setInteraction(next);
      }, setArea, (opacity) => {
        if (threshold.current) threshold.current.style.opacity = String(opacity);
      }, setDoorwayEscape, id => {
        const saved = chapter.current;
        if (id === "forking-mirror") showPage("mirror");
        else if (saved.started && isApproach(saved.book.nodes[saved.book.active]!.choice)) showPage("choice");
        else if (saved.started && saved.book.nodes[saved.book.active]!.choice) showPage("ledger");
      });
      session.world = world;
      world.setChapter(chapter.current.book.nodes[chapter.current.book.active]!, approachOf(chapter.current.book));
      const eye = visit.camera.clone();
      const approachEnd = visit.camera.position.clone().lerp(visit.destination, 0.66);
      const aim = visit.camera.clone();
      aim.position.copy(approachEnd);
      aim.lookAt(visit.destination);
      if (!visit.reducedMotion()) setPhase("approach");
    } catch {
      fail();
    }
  };

  const enterAction = useRef(enter);
  useLayoutEffect(() => { enterAction.current = enter; });
  useLayoutEffect(() => {
    scene.setLandingEntry(entry.current, () => void enterAction.current());
    return () => scene.setLandingEntry(null);
  }, [scene]);

  function escapeWorld() {
    if (current.current?.controls?.cancelCapture()) return;
    if (!current.current?.world?.leaveBookshop()) close();
  }
  // Consume keyboard Escape before the browser initiates a second, native close.
  // Keep native cancel for other platform dismiss gestures.
  useLayoutEffect(() => {
    if (phase === "closed") return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing || !dialog.current?.open) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.type === "keyup" || event.repeat) return;
      if (page) closePage();
      else escapeWorld();
    };
    window.addEventListener("keydown", handleEscape, true);
    window.addEventListener("keyup", handleEscape, true);
    return () => {
      window.removeEventListener("keydown", handleEscape, true);
      window.removeEventListener("keyup", handleEscape, true);
    };
  }, [phase, page]);

  const escapeAction = capture === "look" ? "release look"
    : capture === "walk" ? "release movement"
    : doorwayEscape === "cancel-entry" ? "cancel entry to the bookshop"
    : area === "bookshop" ? "return to the courtyard" : "return to the Multiverse";

  return createPortal(
    <>
      <button className="hollow-hotspot" type="button" ref={entry} aria-label="Enter The Hollow"
        aria-haspopup="dialog" onClick={() => void enter()}>
        <span className="hollow-plaque" aria-hidden="true" data-testid="hollow-entry-label">
          <strong>The Hollow</strong>
          <span className="hollow-click-hint">Click to enter</span>
          <span className="hollow-tap-hint">Tap to enter</span>
          <span className="hollow-key-hint">Press Enter</span>
        </span>
      </button>
      <div className="hollow-landing-tools">
        {failed && <p className="hollow-entry-error" role="alert">The Hollow couldn’t open. You can try again.</p>}
        <details className="hollow-secrets">
          <summary>Find landing secrets</summary>
          <ul>
            {LANDING_SECRET_ACTIONS.map(([secret, label]) => (
              <li key={secret}><button type="button" onClick={() => scene.activateLandingSecret(secret)}>{label}</button></li>
            ))}
          </ul>
        </details>
      </div>
      <dialog
        className="hollow-dialog" ref={dialog} aria-labelledby={title} aria-describedby={phase === "exploring" ? guidance : undefined}
        data-phase={phase} data-area={area}
        onCancel={(event) => {
          event.preventDefault();
          if (event.target !== event.currentTarget) return;
          escapeWorld();
        }}
      >
        <div className="hollow-viewport" ref={viewport} aria-hidden="true" />
        <div className="hollow-veil" ref={veil} aria-hidden="true" />
        <div className="hollow-threshold" ref={threshold} aria-hidden="true" />
        <div className="hollow-header">
          <div className="chapter-place">
            <h2 id={title}>{area === "bookshop" ? roomName : "The Hollow"}</h2>
            {phase === "exploring" && <aside className="chapter-waypoint" aria-label="Mara’s story">
              {started ? <><button type="button" disabled={!!doorwayEscape} onClick={() => showPage("ledger")}>Mara’s ledger</button>
                <details className="chapter-directions"><summary>Find a landmark</summary>
                  <p>{!node.choice ? "The Keeper’s Desk is beyond the lectern, on the right."
                    : isApproach(node.choice) ? "Find the Whispering Well in the courtyard, across from the bell pull."
                    : "Find the Forking Mirror on the bookshop’s back wall, left of the desk."}
                    {sold && " The old shop door opens its fictional memory archive."}</p>
                </details></>
                : <p>{area === "bookshop" ? "Mara’s notes lie on the desk beyond the lectern." : "An optional story awaits at the bookshop desk."}</p>}
            </aside>}
          </div>
          <button type="button" ref={returnButton} onClick={close} className="hollow-return" autoFocus>Return to Multiverse</button>
        </div>
        {phase !== "exploring" && phase !== "closed" && (
          <p className="hollow-opening" role="status">Entering The Hollow… <span className="hollow-key-guide"><kbd>Esc</kbd> to cancel.</span></p>
        )}
        {phase === "exploring" && page && (
          <ChapterPanel book={book} page={page} onPage={showPage} onClose={closePage}
            onDecide={(from, choice) => { setBook(previous => decide(previous, from, choice)); setPage("ledger"); }}
            onSwitch={(id, next) => { setBook(previous => switchTo(previous, id)); setPage(next); }}
            onWell={() => { closePage(); current.current?.world?.visitWell(); }}
            onPlanner={() => { close(); onPlanner(); }} />
        )}
        {phase === "exploring" && (
          <div className="hollow-footer">
            <div className="hollow-landmark">
              {interaction.prompt && (
                <button type="button" ref={interactionButton} aria-keyshortcuts="F"
                  onClick={() => current.current?.world?.interact()}>
                  <kbd aria-hidden="true" className="hollow-prompt-key">F</kbd>{sold && interaction.prompt === "Enter Bookshop"
                    ? "Enter bookshop memory archive" : interaction.prompt}
                </button>
              )}
              <div className="hollow-story" role="status" aria-atomic="true">
                <p>{interaction.story}</p>
                {interaction.notes && (
                  <div className="hollow-desk-notes" role="group" aria-label="Mara’s three choices">
                    {interaction.notes.map((note) => (
                      <article key={note.title}>
                        <h3>{note.title}</h3>
                        <span>{note.consequence}</span>
                      </article>
                    ))}
                  </div>
                )}
              </div>
              {interaction.notes && !started && <button type="button" onClick={() => {
                setStarted(true);
                showPage("choice");
              }}>Begin Mara’s Story</button>}
            </div>
            <p id={guidance} className="hollow-guide">
              <span className="hollow-key-guide">
                <kbd>WASD</kbd> / <kbd>arrows</kbd> to walk <b>·</b> <kbd>Q</kbd> / <kbd>E</kbd> to turn <b>·</b> Drag to look <b>·</b>{" "}
                {doorwayEscape === "wait" && !capture ? "Wait for the doorway to clear"
                  : <><kbd>Esc</kbd> to {escapeAction}</>}
              </span>
              <span className="hollow-touch-guide">Drag to look. Hold an arrow to walk.</span>
            </p>
            <div className="hollow-move" role="group" aria-label={area === "bookshop" ? "Walk around the bookshop" : "Walk around the courtyard"}>
              {DIRECTIONS.map(([code, label, arrow]) => (
                <button key={code} type="button" aria-label={label}
                  onPointerDown={(event) => current.current?.controls?.hold(event.currentTarget, event.nativeEvent, code)}
                  onClick={() => current.current?.controls?.nudge(code)}
                >{arrow}</button>
              ))}
            </div>
          </div>
        )}
      </dialog>
    </>,
    band,
  );
}
