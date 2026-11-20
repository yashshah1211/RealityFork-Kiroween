import { useEffect, useRef, useState } from "react";
import { dilemmas, dimensions, isApproach, rules, type Choice } from "./mara";
import { branchTips, compare, history, options, type StoryNode, type Timeline } from "./timeline";
import "./chapter.css";

export type Page = "ledger" | "choice" | "mirror";
interface Props {
  book: Timeline;
  page: Page;
  onPage: (page: Page) => void;
  onDecide: (from: string, choice: Choice) => void;
  onSwitch: (id: string, page: Page) => void;
  onClose: () => void;
  onWell: () => void;
  onPlanner: () => void;
}
const nameOf = (node: StoryNode) => node.choice ? rules[node.choice].title : "Before the decision";

function Mirror({ book, onSwitch }: Pick<Props, "book" | "onSwitch">) {
  const tips = branchTips(book);
  const [left, setLeft] = useState(tips.find(n => n.id === book.active)?.id ?? tips[0]!.id);
  const [right, setRight] = useState(tips.find(n => n.id !== left)?.id ?? left);
  const pair = tips.length > 1;
  if (!tips[0]?.choice) return <p>The silver is still. Read the notes on the Keeper’s Desk to begin Mara’s story. The mirror remembers each decision you confirm.</p>;
  function reflection(id: string, side: "Left" | "Right") {
    const node = book.nodes[id]!;
    function select(next: string) {
      if (side === "Left") {
        if (next === right) setRight(left);
        setLeft(next);
      } else {
        if (next === left) setLeft(right);
        setRight(next);
      }
    }
    return <section className="mirror-leaf">
      <label>{side} timeline<select value={id} onChange={event => select(event.target.value)}>
        {tips.map(tip => <option key={tip.id} value={tip.id}>{nameOf(tip)}</option>)}
      </select></label>
      <ol>{history(book, id).map(n => <li key={n.id}><strong>{rules[n.choice!].label}</strong><small>{rules[n.choice!].cause}</small></li>)}</ol>
      <button type="button" onClick={() => onSwitch(node.id, "ledger")}>Open {side.toLowerCase()} timeline</button>
    </section>;
  }
  return <>
    <p>{pair ? "Choose two paths. Each reflection traces a different entry in Mara’s ledger." : "The glass holds one path. Rewind and confirm another choice to see a second reflection."}</p>
    <div className="mirror-leaves">{reflection(left, "Left")}{pair && reflection(right, "Right")}</div>
    {pair && <><h3>What changed, and why?</h3>
      <div className="mirror-identities"><b>{nameOf(book.nodes[left]!)}</b><b>{nameOf(book.nodes[right]!)}</b></div>
      <dl className="mirror-differences">
      {compare(book, left, right).map(row => <div key={row.key}><dt>{dimensions[row.key]}</dt><dd>
        <span><b>Left</b> {row.left.value}<small>{row.left.source}</small></span>
        <span><b>Right</b> {row.right.value}<small>{row.right.source}</small></span>
      </dd></div>)}
    </dl></>}
    <button type="button" onClick={() => onSwitch("start", "choice")}>Fork at the first decision</button>
  </>;
}

export function ChapterPanel({ book, page, onPage, onDecide, onSwitch, onClose, onWell, onPlanner }: Props) {
  const modal = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [selected, setSelected] = useState<Choice | null>(null);
  const node = book.nodes[book.active]!;
  const path = history(book, node.id);
  const choice = node.choice;
  const first = isApproach(choice);
  const report = choice !== null && !first;
  const dilemma = dilemmas[first ? choice : "start"];
  const choosing = page !== "mirror" && (!choice || (page === "choice" && first));
  const title = page === "mirror" ? "The Forking Mirror" : choosing ? dilemma.title : report ? "Your Reality Report" : nameOf(node);
  useEffect(() => {
    const dialog = modal.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  useEffect(() => {
    setSelected(null);
    heading.current?.focus();
    modal.current?.querySelector("article")?.scrollTo(0, 0);
  }, [node.id, page]);
  return <dialog ref={modal} className={'chapter-page' + (page === "mirror" ? " chapter-mirror" : "")}
    aria-labelledby="chapter-title" onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }}>
    <header>
      <span>{page === "mirror" ? "Reflections from the bookshop" : "Mara’s choice · Fictional chapter"}</span>
      <button type="button" onClick={onClose} aria-label="Close chapter and explore">Close</button>
    </header>
    <article>
      <h2 id="chapter-title" tabIndex={-1} ref={heading}>{title}</h2>
      {page === "mirror" ? <Mirror book={book} onSwitch={onSwitch} /> : choosing ? <>
        <p>{dilemma.scene}</p><p className="chapter-constraint">{dilemma.constraint}</p>
        <fieldset><legend>{first ? "Decision 2 at the well" : "Decision 1 at the desk"}</legend>
          {options(node).map(id => <label className="chapter-option" key={id}>
            <input type="radio" name="mara-choice" value={id} checked={selected === id} onChange={() => setSelected(id)} />
            <span><strong>{rules[id].label}</strong><small>{rules[id].cost}</small></span>
          </label>)}
        </fieldset>
        <button type="button" className="chapter-primary" disabled={!selected} onClick={() => selected && onDecide(node.id, selected)}>Confirm decision</button>
        {first && <details><summary>Earlier decision</summary><p>{rules[choice].label}. {rules[choice].cause}</p></details>}
      </> : choice && <>
        {report && <><h3>What happened?</h3><p className="chapter-outcome">{nameOf(node)}</p></>}
        <h3>{report ? "Why did it happen?" : "The consequence"}</h3>
        <ol className="chapter-history">{path.map(n => <li key={n.id}><strong>{rules[n.choice!].label}</strong><p>{rules[n.choice!].cause}</p></li>)}</ol>
        {report && <><h3>What this path preserved or cost</h3>
          <p>{rules[choice].cost}</p>
          <dl className="chapter-state">{Object.entries(dimensions).map(([key, label]) =>
            <div key={key}><dt>{label}</dt><dd>{node.state[key as keyof typeof dimensions]}</dd></div>)}</dl>
          <h3>What could have been different?</h3>
          {options(book.nodes[node.parent!]!).filter(id => id !== choice).map(id => <p key={id}><b>{rules[id].label}.</b> {rules[id].cause}</p>)}
        </>}
        <h3>Still uncertain</h3><p>{rules[choice].unknown}</p>
        {first && <><p>Take this decision to the Whispering Well in the courtyard, across from the bell pull.</p>
          <button type="button" className="chapter-primary" onClick={onWell}>Visit the Whispering Well</button></>}
        {report && <p>The Forking Mirror hangs on the bookshop’s back wall, left of the Keeper’s Desk.
          {node.state.shop === rules.sell.change.shop && " Enter the memory of the bookshop at its old door."}</p>}
        <div className="chapter-actions">
          <button type="button" onClick={() => onSwitch("start", "choice")}>Rewind to decision 1</button>
          {report && <button type="button" onClick={() => onSwitch(node.parent!, "choice")}>Fork at decision 2</button>}
          <button type="button" onClick={() => onPage("mirror")}>Compare timelines</button>
          <button type="button" onClick={onClose}>Return to the village</button>
        </div>
        {report && <footer><p>The Hollow explores fictional choices. Bring your own decision to the RealityFork planner.</p>
          <button type="button" className="chapter-primary" onClick={onPlanner}>Explore Your Own What-If</button></footer>}
      </>}
    </article>
  </dialog>;
}
