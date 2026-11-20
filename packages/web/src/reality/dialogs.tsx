/**
 * Shared overlays: the confirmation asked before anything is removed, a short guide to the kinds of content, and
 * quiet confirmations after an action (toasts). They are drawn by the app, in its own night, so a destructive step
 * never jumps to a plain browser box. Confirmations use the native <dialog> element: it keeps keyboard focus inside,
 * closes on Escape (as "keep"), and hands focus back to the control that opened it.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

export interface ConfirmRequest {
  readonly title: string;
  readonly body: ReactNode;
  /** The destructive action, said as what it does: "Remove 3 maps". */
  readonly confirm: string;
  /** The safe choice; focused first. */
  readonly cancel?: string;
}
type Ask = (req: ConfirmRequest) => Promise<boolean>;
type Toast = (message: string) => void;
interface Overlays {
  readonly ask: Ask;
  readonly toast: Toast;
  readonly help: () => void;
}
const OverlayContext = createContext<Overlays | null>(null);

/** Outside the host (nothing in the app today), the browser's own confirmation keeps a removal from happening unasked. */
const fallback: Overlays = {
  ask: async (r) => window.confirm(`${r.title}\n\n${typeof r.body === "string" ? r.body : ""}`.trim()),
  toast: () => undefined,
  help: () => undefined,
};
export const useConfirm = (): Ask => (useContext(OverlayContext) ?? fallback).ask;
export const useToast = (): Toast => (useContext(OverlayContext) ?? fallback).toast;
export const useHelp = (): (() => void) => (useContext(OverlayContext) ?? fallback).help;

type Pending = ConfirmRequest & { readonly resolve: (ok: boolean) => void; readonly opener: HTMLElement | null };

/** Show `children`, plus whichever overlay is asked for. One confirmation at a time; a toast replaces the one before. */
export function OverlayHost({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [helpOpen, setHelpOpen] = useState<HTMLElement | null>(null);
  const [toast, setToast] = useState<{ readonly id: number; readonly text: string } | null>(null);
  const ask = useCallback<Ask>((req) => new Promise<boolean>((resolve) => {
    setPending((p) => {
      p?.resolve(false);
      return { ...req, resolve, opener: document.activeElement instanceof HTMLElement ? document.activeElement : null };
    });
  }), []);
  const say = useCallback<Toast>((text) => setToast({ id: Date.now(), text }), []);
  const help = useCallback(() => setHelpOpen(document.activeElement instanceof HTMLElement ? document.activeElement : document.body), []);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast((x) => (x?.id === toast.id ? null : x)), 6000);
    return () => window.clearTimeout(t);
  }, [toast]);
  const done = (ok: boolean) => {
    if (!pending) return;
    pending.resolve(ok);
    const opener = pending.opener;
    setPending(null);
    // Back to where the user was, if that control is still on screen.
    requestAnimationFrame(() => (opener?.isConnected ? opener : document.querySelector<HTMLElement>("[data-stage-focus]"))?.focus({ preventScroll: true }));
  };
  return (
    <OverlayContext.Provider value={{ ask, toast: say, help }}>
      {children}
      {pending && <ConfirmDialog req={pending} onDone={done} />}
      {helpOpen && <HelpDialog onClose={() => { const o = helpOpen; setHelpOpen(null); requestAnimationFrame(() => o?.isConnected && o.focus({ preventScroll: true })); }} />}
      <div className="rf-toasts" aria-live="polite" role="status">
        {toast && (
          <p key={toast.id} className="rf-toast" data-testid="toast">
            <span aria-hidden="true" className="toast-mark" />
            <span>{toast.text}</span>
            <button type="button" className="toast-close" onClick={() => setToast(null)} aria-label="Dismiss">×</button>
          </p>
        )}
      </div>
    </OverlayContext.Provider>
  );
}

/** Open a native dialog as modal once it is in the page; "cancel" (Escape) and closing go through `onClose`. */
function useModal(onCancel: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) {
      try {
        d.showModal();
      } catch {
        d.setAttribute("open", "");
      }
    }
  }, []);
  return {
    ref,
    onCancel: (e: React.SyntheticEvent) => {
      e.preventDefault();
      onCancel();
    },
  };
}

function ConfirmDialog({ req, onDone }: { req: ConfirmRequest; onDone: (ok: boolean) => void }) {
  const m = useModal(() => onDone(false));
  return (
    <dialog ref={m.ref} className="rf-dialog confirm" aria-labelledby="rf-confirm-title" aria-describedby="rf-confirm-body" onCancel={m.onCancel} data-testid="confirm-dialog">
      <div className="dialog-mark" aria-hidden="true" />
      <h2 id="rf-confirm-title" className="dialog-title">{req.title}</h2>
      <div id="rf-confirm-body" className="dialog-body">{req.body}</div>
      <div className="dialog-actions">
        <button type="button" className="btn" autoFocus onClick={() => onDone(false)} data-testid="confirm-cancel">{req.cancel ?? "Keep them"}</button>
        <button type="button" className="btn btn-danger" onClick={() => onDone(true)} data-testid="confirm-accept">{req.confirm}</button>
      </div>
    </dialog>
  );
}

/** What each kind of content means, in the same words and colours as everywhere in the app. */
function HelpDialog({ onClose }: { onClose: () => void }) {
  const m = useModal(onClose);
  return (
    <dialog ref={m.ref} className="rf-dialog help" aria-labelledby="rf-help-title" onCancel={m.onCancel} data-testid="help-dialog">
      <div className="dialog-head">
        <h2 id="rf-help-title" className="dialog-title">How RealityFork works</h2>
        <button type="button" className="dialog-close" onClick={onClose} aria-label="Close" data-testid="help-close">×</button>
      </div>
      <ol className="help-steps">
        <li><strong>Ask</strong> a what-if question in your own words.</li>
        <li><strong>Choose</strong> one of a few possible futures the AI guide drafts. Nothing is saved before you choose.</li>
        <li><strong>Explore</strong> it: answer one question at a time, add what you know, branch into another path.</li>
        <li><strong>Compare</strong> two futures side by side, then continue with either.</li>
      </ol>
      <h3 className="help-h">What each kind of content means</h3>
      <dl className="help-kinds">
        <div><dt><span className="badge known">Known</span></dt><dd>What you told RealityFork: your answers, figures and notes.</dd></div>
        <div><dt><span className="badge calc">Calculated</span></dt><dd>Arithmetic on your own figures with a formula you can inspect. Shown only when every input is known.</dd></div>
        <div><dt><span className="badge sim">Simulated</span></dt><dd>A validated model run many times with a fixed seed, with its 95% interval. A model estimate, not a prediction.</dd></div>
        <div><dt><span className="badge possible">Possible</span></dt><dd>Things that could happen, to think with. Never predictions or probabilities.</dd></div>
        <div><dt><span className="badge ai">AI-suggested</span></dt><dd>Written by the AI guide. It never sets a number, and nothing it suggests changes a path until you approve it.</dd></div>
        <div><dt><span className="help-unknown">Still unknown</span></dt><dd>Figures nobody has given yet. They stay unknown; RealityFork never fills them in with zero.</dd></div>
        <div><dt><span className="help-na">Doesn't apply</span></dt><dd>Something you said has no place on a path. It is not zero, and nothing is worked out from it there.</dd></div>
      </dl>
      <p className="help-note small muted">Your maps are saved in this browser as you work. Save them to a file to keep a copy or move them to another browser. The 3D scenery is illustrative: nothing in the picture is a fact about any future. Results are model estimates under the assumptions you set; they are not predictions, and real-world causes are not tested here.</p>
      <div className="dialog-actions">
        <button type="button" className="btn" autoFocus onClick={onClose}>Close</button>
      </div>
    </dialog>
  );
}
