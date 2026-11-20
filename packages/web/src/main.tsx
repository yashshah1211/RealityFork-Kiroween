import { StrictMode, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import "@realityfork/core";
import { App } from "./App";
import { createWorkerEngine } from "./engine";
import { Workspace } from "./state/workspace";
import { RealityStore } from "./reality/store";
import { RealityApp } from "./reality/RealityApp";
import "./styles.css";
// The RealityFork design system (scoped to .rf): typefaces, tokens and shared primitives, then the stage layouts.
import "./design/fonts.css";
import "./design/tokens.css";
import "./design/base.css";
import "./reality/reality.css";

const engine = createWorkerEngine();
// Specialized staffing tool (validated queue models), reachable at #staffing.
const workspace = new Workspace(engine, window.localStorage);
void workspace.restore();
// Universal realities: the default experience.
const realities = new RealityStore(engine, window.localStorage);
void realities.restore();

const subscribeHash = (fn: () => void) => {
  window.addEventListener("hashchange", fn);
  return () => window.removeEventListener("hashchange", fn);
};

function Root() {
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash);
  return hash === "#staffing" ? <App ws={workspace} /> : <RealityApp store={realities} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
