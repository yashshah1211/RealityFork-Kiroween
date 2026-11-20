import { dimensions, isApproach, opening, rules, type Choice, type Dimension, type StoryState } from "./mara";

export interface StoryNode {
  readonly id: string;
  readonly parent: string | null;
  readonly choice: Choice | null;
  readonly state: StoryState;
}
export interface Timeline {
  readonly active: string;
  readonly nodes: Readonly<Record<string, StoryNode>>;
}
export function begin(): Timeline {
  const root = Object.freeze({ id: "start", parent: null, choice: null, state: Object.freeze({ ...opening }) });
  return Object.freeze({ active: root.id, nodes: Object.freeze({ [root.id]: root }) });
}
export function options(node: StoryNode) {
  return (Object.keys(rules) as Choice[]).filter(choice => rules[choice].from === (node.choice ?? "start"));
}
export function switchTo(book: Timeline, id: string): Timeline {
  if (!Object.hasOwn(book.nodes, id) || id === book.active) return book;
  return Object.freeze({ active: id, nodes: book.nodes });
}
/** Bind the command to the page the reader confirmed. A stale confirmation is harmless. */
export function decide(book: Timeline, from: string, choice: Choice): Timeline {
  const parent = book.nodes[from];
  if (from !== book.active || !parent || !options(parent).includes(choice)) return book;
  const id = from + "/" + choice;
  if (book.nodes[id]) return switchTo(book, id);
  const state = Object.freeze({ ...parent.state, ...rules[choice].change });
  const child = Object.freeze({ id, parent: from, choice, state });
  return Object.freeze({ active: id, nodes: Object.freeze({ ...book.nodes, [id]: child }) });
}
export function history(book: Timeline, id: string) {
  const path: StoryNode[] = [];
  let node = book.nodes[id];
  while (node?.parent) {
    path.unshift(node);
    node = book.nodes[node.parent];
  }
  return path;
}
export function branchTips(book: Timeline) {
  const nodes = Object.values(book.nodes);
  const parents = new Set(nodes.map(node => node.parent));
  return nodes.filter(node => !parents.has(node.id));
}
export function approachOf(book: Timeline) {
  const first = history(book, book.active)[0]?.choice ?? null;
  return isApproach(first) ? first : null;
}
/** Attribute a visible difference to the latest rule on each path that wrote that dimension. */
export function compare(book: Timeline, left: string, right: string) {
  function reading(id: string, key: Dimension) {
    const value = book.nodes[id]!.state[key];
    const author = history(book, id).reverse().find(node => node.choice && key in rules[node.choice].change)?.choice;
    return { value, source: author ? rules[author].label : "Opening situation" };
  }
  return (Object.keys(dimensions) as Dimension[])
    .filter(key => book.nodes[left]!.state[key] !== book.nodes[right]!.state[key])
    .map(key => ({ key, left: reading(left, key), right: reading(right, key) }));
}
