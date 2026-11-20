import { describe, expect, it } from "vitest";
import { begin, branchTips, compare, decide, history, options, switchTo } from "./timeline";
import { dimensions, opening, rules, type Choice, type Dimension } from "./mara";

describe("Mara’s ledger", () => {
  function record(choices: Choice[]) {
    return choices.reduce((book, id) => decide(book, book.active, id), begin());
  }
  it("reproduces all six endings and ties every changed dimension to a recorded decision", () => {
    const root = begin();
    const endings = new Set<string>();
    for (const first of options(root.nodes.start!)) {
      const fork = record([first]);
      const seconds = options(fork.nodes[fork.active]!);
      expect(seconds).toHaveLength(2);
      for (const second of seconds) {
        const book = record([first, second]);
        expect(book).toEqual(record([first, second]));
        const node = book.nodes[book.active]!;
        expect(options(node)).toEqual([]);
        expect(history(book, node.id).map(n => n.choice)).toEqual([first, second]);
        expect(node.state).toEqual({ ...opening, ...rules[first].change, ...rules[second].change });
        endings.add(JSON.stringify(node.state));
        const diff = compare(book, "start", node.id);
        for (const k of Object.keys(dimensions) as Dimension[]) {
          const row = diff.find(r => r.key === k);
          if (opening[k] === node.state[k]) expect(row).toBeUndefined();
          else expect(row?.right).toEqual({ value: node.state[k], source: rules[k in rules[second].change ? second : first].label });
        }
      }
    }
    expect(endings.size).toBe(6);
  });
  it("keeps each ending’s consequences when compared with every other ending", () => {
    let book = begin();
    for (const [first, second, location, debt, access, work, village] of [
      ["sell", "hall", "Village hall", "Overdue bill paid", "Weekly public lending", "Shop hours released", "Hall stewards unpack each week"],
      ["sell", "school", "Schoolroom", "Overdue bill paid", "Pupils on school days", "No lending shifts", "Teacher tends the shelf"],
      ["keep", "hours", "Bookshop", "Costs eased, bill outstanding", "Shortened public week", "Part-week shop days", "No shared duties"],
      ["keep", "lessons", "Bookshop", "Repayments begun", "Daily browsing", "Days and teaching evenings", "Paying learners"],
      ["share", "dues", "Bookshop", "Repayments begun", "Public browsing, member loans", "Convening the circle", "Household pledges"],
      ["share", "rota", "Bookshop", "Bill carried forward", "Open village lending", "Time freed by volunteers", "Volunteer shifts"],
    ] as const) {
      book = decide(switchTo(book, "start"), "start", first);
      book = decide(book, book.active, second);
      expect(book.nodes[book.active]!.state).toMatchObject({ location, debt, access, work, village });
    }
    const tips = branchTips(book);
    expect(tips).toHaveLength(6);
    for (const [i, left] of tips.entries()) {
      for (const right of tips.slice(i + 1)) {
        const rows = compare(book, left.id, right.id);
        const keys = (Object.keys(dimensions) as Dimension[]).filter(key => left.state[key] !== right.state[key]);
        expect(rows.map(row => row.key)).toEqual(keys);
        for (const row of rows) {
          expect(row.left.value).toBe(left.state[row.key]);
          expect(row.right.value).toBe(right.state[row.key]);
        }
      }
    }
  });
  it("preserves both forks, both parents and the old book when switching or replaying", () => {
    const original = record(["sell", "school"]);
    const originalText = JSON.stringify(original);
    const rewind = switchTo(original, "start/sell");
    const sibling = decide(rewind, rewind.active, "hall");
    const other = decide(switchTo(sibling, "start"), "start", "share");
    const final = decide(other, other.active, "rota");
    expect(branchTips(final).map(n => n.choice)).toEqual(["school", "hall", "rota"]);
    expect(final.nodes[original.active]).toBe(original.nodes[original.active]);
    expect(final.nodes["start/sell"]).toBe(original.nodes["start/sell"]);
    expect(JSON.stringify(original)).toBe(originalText);
    expect(Object.isFrozen(original.nodes[original.active]!.state)).toBe(true);
    const replay = decide(switchTo(final, "start/sell"), "start/sell", "school");
    expect(replay.active).toBe(original.active);
    expect(replay.nodes).toBe(final.nodes);
  });
  it("ignores stale confirmations, unknown targets, out-of-order and post-ending choices", () => {
    const start = begin();
    expect(decide(start, "start", "dues")).toBe(start);
    const first = record(["keep"]);
    expect(decide(first, "start", "keep")).toBe(first);
    expect(decide(first, first.active, "school")).toBe(first);
    expect(switchTo(first, "missing")).toBe(first);
    const end = record(["keep", "hours"]);
    expect(decide(end, end.active, "lessons")).toBe(end);
  });
});
