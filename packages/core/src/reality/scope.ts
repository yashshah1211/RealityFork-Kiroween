/**
 * Where a figure belongs (R20A.1): which of the AI's futures a number the user wrote applies to.
 *
 * A number is a fact about the world as it is in SOME futures. "Rent there is £2,000" is true where the user moves, not
 * where they stay; "I have a budget of ₹500,000" is true wherever they end up. Copying every figure to every future would
 * put a false number on a path; copying none leaves comparisons empty. This module decides, from the user's own words and
 * the shape of the draft, and when it cannot decide it says so and the user chooses.
 *
 * It never guesses and it knows no subject matter. It uses only:
 *  - how the draft's futures read: one that reads as NOT doing what is asked ("Don't …", "Stay …", "Keep …", "Wait …",
 *    or a "no" on an assumption that names the asked action) is a baseline, and the others are the futures that do it;
 *  - what the figure's own clause says: it points back to what is asked ("there", "the new …"), to how things are today
 *    ("here", "now", "currently"), it is an expectation ("expect", "would", "if"), it is something the person has
 *    ("my budget", "I have …"), it counts down to a date ("four weeks away"), or it shares a distinctive word with some
 *    futures' names and not others;
 *  - whether "my" or "our" stands right before it ("my ₹80,000/month job"): it may describe how things are now, which
 *    the asked change may end in some futures and not in others, so it is never placed by what is asked alone;
 *  - whether the question compares other figures for one assumption (then this one is the same in each).
 * Evidence that points two ways, or none where a baseline makes it matter, means "unclear": the user is asked. Words that
 * name both a future that keeps things as they are and one that changes them point two ways.
 *
 * Pure and deterministic: no DOM, no Node modules, no AI.
 */

export type ScopeBasis =
  /** Another figure fits the same assumption, so each needs its own future (placed by the number in its name). */
  | "competing"
  /** The figure's own words name some futures and not the others. */
  | "named"
  /** It points back to what is asked about, or follows from it: it belongs to the futures that do it. */
  | "scenario"
  /** It points to how things are today: it belongs to the futures that keep things as they are. */
  | "current"
  /** Something the person has (a budget, savings, "I have …"): the same whichever future they choose. */
  | "personal"
  /** A countdown to a date ("four weeks away"): the same in every future. */
  | "calendar"
  /** The question compares other figures for one assumption, so this one is the same in each. */
  | "common"
  /** Nothing ties it to one future and none of them reads as not doing it, so it goes to all. */
  | "neutral"
  /** The wording points two ways, or says nothing where it matters: the user chooses. */
  | "unclear";

/** What a figure's own clause says about where it belongs. Read from the user's words only. */
export interface ScopeCues {
  /** A word that points back to what is asked about ("there", "the new job"), or null. */
  readonly deictic: string | null;
  /** A word that points to how things are today ("here", "now", "currently"), or null. */
  readonly current: string | null;
  /** A word that makes it an expectation or a possibility ("expect", "would", "if"), or null. */
  readonly expected: string | null;
  /** Something the person has: a budget, savings, funds, "I have …". */
  readonly personal: boolean;
  /** A countdown to a date: "four weeks away", "3 days left". */
  readonly calendar: boolean;
  /**
   * "my" or "our" written right before it ("my ₹80,000/month job"), or null. It may describe what the person has now, and
   * a future may keep or end that, so only another cue (a budget, "now", "there" …) places it.
   */
  readonly own: string | null;
  /** Written in the sentence that asks the question. */
  readonly asked: boolean;
  /** The meaning-carrying stems of its own clause (no numbers, units, hedges or function words), to match against future names. */
  readonly stems: readonly string[];
  /** The meaning-carrying stems of the sentence that asks the question, to see which futures it describes. */
  readonly askedStems: readonly string[];
}

/** A future as the draft describes it. */
export interface FutureLike {
  readonly name: string;
  readonly description: string;
  readonly settings: readonly { readonly variable: string; readonly value: string }[];
}
export interface VariableLike { readonly key: string; readonly label: string; readonly kind: string }

/** Whether a future reads as NOT doing what is asked, and the words that say so. */
export interface FutureRole {
  readonly index: number;
  readonly name: string;
  readonly baseline: boolean;
  readonly cue: string | null;
}

// ---------- how the futures read ----------

const L = String.raw`\p{L}\p{N}`;
const STOP = String.raw`(?![${L}])`;
/** A name that starts by refusing, keeping, staying or waiting. Only the start counts: "Open without a loan" is not a refusal. */
const NAME_START = new RegExp(
  String.raw`^\s*(?:(?:to|and|just|simply|then)\s+)*(don['’]?t|do\s+not|does\s+not|doesn['’]?t|did\s+not|not|no|never|nothing|stay(?:s|ed|ing)?|remain(?:s|ed|ing)?|keep(?:s|ing)?|continu(?:e|es|ed|ing)|maintain(?:s|ed|ing)?|retain(?:s|ed|ing)?|wait(?:s|ed|ing)?|delay(?:s|ed|ing)?|postpone(?:s|d)?|defer(?:s|red)?|current|existing|unchanged|original|baseline|today['’]?s)${STOP}`,
  "iu",
);
/** Phrases that mean "no change" wherever they sit in a name. */
const NAME_ANYWHERE = new RegExp(String.raw`(?:^|[^${L}])(status\s+quo|no\s+change|as\s+things\s+are|as\s+it\s+is|as\s+is|do\s+nothing|nothing\s+changes|hold\s+off|not\s+yet|business\s+as\s+usual)${STOP}`, "iu");
/** A description that begins by refusing, staying or waiting: "You keep things as they are.", "You do not start the store." */
const DESCRIPTION_START = new RegExp(
  String.raw`^\s*(?:you\s+)?(don['’]?t|do\s+not|does\s+not|stay(?:s)?|remain(?:s)?|wait(?:s)?|delay(?:s)?|postpone(?:s)?|defer(?:s)?|carry\s+on|continue\s+as|nothing|keep\s+(?:things|everything|it|them|the\s+current|your\s+current|the\s+same))${STOP}`,
  "iu",
);

/**
 * The role of each kept future. A future is a baseline when its name or description starts by refusing or keeping things
 * as they are, or when it sets a yes/no assumption that names the asked action to "no" (a real draft had "Opening the
 * physical store: no" on a future whose name did not say it). A cue verb that the question itself uses is not a cue: for
 * "What if I stayed in Mumbai?", a future named "Stay in Mumbai" is the thing being asked.
 */
export function futureRoles(
  futures: readonly FutureLike[],
  variables: readonly VariableLike[],
  kept: readonly boolean[],
  askedStems: ReadonlySet<string>,
  stem: (word: string) => string,
  stemsOf: (text: string) => readonly string[],
): FutureRole[] {
  const roles: FutureRole[] = [];
  futures.forEach((f, index) => {
    if (kept[index] === false) return;
    const asked = (word: string): boolean => askedStems.has(stem(word.split(/\s+/)[0] ?? word));
    const fromName = NAME_START.exec(f.name);
    const anywhere = NAME_ANYWHERE.exec(f.name);
    const fromDescription = DESCRIPTION_START.exec(f.description);
    let cue: string | null = null;
    if (fromName && !asked(fromName[1]!)) cue = fromName[1]!.toLowerCase();
    else if (anywhere) cue = anywhere[1]!.toLowerCase();
    else if (fromDescription && !asked(fromDescription[1]!)) cue = fromDescription[1]!.toLowerCase();
    if (cue === null) {
      for (const s of f.settings) {
        const v = variables.find((x) => x.key === s.variable);
        if (!v || v.kind !== "boolean" || s.value.trim().toLowerCase() !== "no") continue;
        // Only an assumption that names the asked action counts: "Hire staff: no" does not mean the shop is not opened.
        if (stemsOf(v.label).some((w) => askedStems.has(w))) { cue = `${v.label}: no`; break; }
      }
    }
    roles.push({ index, name: f.name, baseline: cue !== null, cue });
  });
  return roles;
}

// ---------- what a figure's own words say ----------

const WORD = String.raw`(?:^|[^${L}])`;
const word = (alts: string): RegExp => new RegExp(`${WORD}(${alts})${STOP}`, "iu");
const DEICTIC = word("there|thereafter|afterwards|new");
const CURRENT = word("here|now|nowadays|currently|current|existing|present|today|old|at\\s+the\\s+moment|right\\s+now|so\\s+far");
const EXPECTED = word("would|will|could|might|should|expect(?:s|ed|ing)?|estimat(?:e|es|ed|ing)|assum(?:e|es|ed|ing)|plan(?:s|ned|ning)?|likely|probably|hope[sd]?|anticipat(?:e|es|ed|ing)");
const CONTRACTION = /['’](?:d|ll)(?![\p{L}])/iu;
/** Lower case only: "May" is a month. */
const MAY = new RegExp(`${WORD}(may)${STOP}`, "u");
const CONDITIONAL = word("if|when|once|suppose|assuming|imagine|unless");
const POSSESSION = new RegExp(String.raw`${WORD}(?:i|we)(?:['’]ve|\s+(?:have|had|own|owe|got|hold|saved))${STOP}`, "iu");
const RESOURCE = word("budget|savings?|saved|funds?|capital");
/** "my" or "our" as the last word before a figure: "my ₹80,000/month job", not "my job pays ₹80,000". */
const OWN_BEFORE = new RegExp(`${WORD}(my|our)\\s*$`, "iu");

/**
 * What the clause of a figure says. `after` is the text right after the number, `before` the text of its sentence right
 * before it (or before its hedge); `sentence` is the sentence when it is not the asked one.
 */
export function readCues(
  clause: string, after: string, sentence: string | null, asked: boolean, stems: readonly string[], askedStems: readonly string[], timeWord: string,
  before: string,
): ScopeCues {
  const found = (re: RegExp): string | null => re.exec(clause)?.[1]?.toLowerCase().replace(/\s+/g, " ") ?? null;
  const modal = found(EXPECTED) ?? CONTRACTION.exec(clause)?.[0].toLowerCase() ?? MAY.exec(clause)?.[1] ?? null;
  const conditional = sentence !== null ? (CONDITIONAL.exec(sentence)?.[1]?.toLowerCase() ?? null) : null;
  return {
    deictic: found(DEICTIC),
    current: found(CURRENT),
    expected: modal ?? conditional,
    personal: RESOURCE.test(clause) || POSSESSION.test(clause),
    calendar: new RegExp(String.raw`^\s*(?:${timeWord})\s+(?:away|left|remaining|ahead)${STOP}`, "iu").test(after),
    own: OWN_BEFORE.exec(before)?.[1]?.toLowerCase() ?? null,
    asked,
    stems,
    askedStems,
  };
}

// ---------- the decision ----------

/** What the rest of the draft and question add to one figure's own cues. */
export interface ScopeContext {
  /** Futures whose names share a distinctive word with the figure's clause (a strict subset), or null. */
  readonly tie: readonly number[] | null;
  /** The same futures, even when that is every future or none (`tie` is null then): whom its words mention at all. */
  readonly touches: readonly number[];
  /** Futures that share a distinctive word with the sentence that asks the question (a strict subset), or null. */
  readonly anaphor: readonly number[] | null;
  /** The question compares other figures for one assumption. */
  readonly compares: boolean;
  /** Another figure in the question is named for one future. */
  readonly tiesElsewhere: boolean;
}

export interface ScopeDecision {
  readonly basis: ScopeBasis;
  /** The futures it belongs to (indexes into the draft, ascending), or null when the user has to choose. */
  readonly futures: readonly number[] | null;
  /** In plain words, why. */
  readonly why: string;
  /** The names of futures left out because they read as not doing it. */
  readonly except: readonly string[];
}

const list = (names: readonly string[]): string => (names.length <= 1 ? `“${names[0] ?? ""}”` : `${names.slice(0, -1).map((n) => `“${n}”`).join(", ")} and “${names.at(-1)!}”`);

/**
 * Place one figure that does not compete with another. First applicable rule wins; evidence that disagrees means "unclear".
 *  1. its words name some futures → those (unclear when "my" stands before it, or when the named futures include both one
 *     that keeps things as they are and one that changes them)
 *  2. it points back to what is asked ("there") → the future that shares the asked words, else the only future that does it
 *  3. it points to today ("here", "now") → the futures that keep things as they are
 *  4. something the person has → every future
 *  5. a countdown to a date → every future
 *  6. the question compares other figures → every future
 *  7. "my" or "our" right before it, and nothing above → unclear: it may be how things are now, which a future may change
 *  8. an expectation, or part of what is asked → the futures that do it (every future if none reads as not doing it);
 *     unclear when its words also mention a future that reads as not doing it
 *  9. nothing at all → every future if none reads as not doing it, otherwise unclear
 * Rule 7 and the "unclear when …" checks of rules 1 and 8 can only leave a figure for the user to place: they never move
 * it to other futures.
 */
export function decideScope(cues: ScopeCues, ctx: ScopeContext, roles: readonly FutureRole[]): ScopeDecision {
  const all = roles.map((r) => r.index);
  const baseline = roles.filter((r) => r.baseline);
  const change = roles.filter((r) => !r.baseline).map((r) => r.index);
  const nameOf = (i: number): string => roles.find((r) => r.index === i)?.name ?? `future ${i + 1}`;
  const names = (idx: readonly number[]): string[] => idx.map(nameOf);
  const left = (): string[] => baseline.map((r) => r.name);
  const reads = (r: FutureRole): string => `“${r.name}” reads as not doing it (${r.cue!.includes(":") ? `it sets “${r.cue}”` : `it starts with “${r.cue}”`})`;
  const notDoing = (): string => baseline.map(reads).join("; ");
  const unclear = (why: string): ScopeDecision => ({ basis: "unclear", futures: null, why, except: [] });
  const placed = (basis: ScopeBasis, futures: readonly number[], why: string, except: readonly string[] = []): ScopeDecision => ({ basis, futures: [...futures].sort((a, b) => a - b), why, except });
  const others = (idx: readonly number[]): string[] => roles.filter((r) => !idx.includes(r.index)).map((r) => r.name);
  // "my ₹80,000/month job": how things are now, which the asked change may end in some futures. Only another cue places it.
  const ownWhy = `You wrote “${cues.own ?? ""}”, so it may describe what you have now, which some futures could change. Choose where to use it.`;
  // Words that mention a future that keeps things as they are AND one that changes them point both ways.
  const keeping = (idx: readonly number[]): FutureRole[] => baseline.filter((r) => idx.includes(r.index));
  const mixed = (idx: readonly number[]): boolean => keeping(idx).length > 0 && idx.some((i) => change.includes(i));
  const mixedWhy = (idx: readonly number[]): string => {
    const kept = keeping(idx).map((r) => r.name);
    return `Your words mention ${list(kept)}, which ${kept.length === 1 ? "reads" : "read"} as keeping things as they are, and also futures that change them. Choose where to use it.`;
  };

  if (ctx.tie) {
    if (cues.personal || cues.current) return unclear(`It names ${list(names(ctx.tie))}, but its wording also reads as true for every future or for today. Choose where to use it.`);
    if (cues.own) return unclear(ownWhy);
    if (mixed(ctx.tie)) return unclear(mixedWhy(ctx.tie));
    return placed("named", ctx.tie, `Your words name ${list(names(ctx.tie))} and not the other ${all.length - ctx.tie.length === 1 ? "future" : "futures"}.`, others(ctx.tie));
  }
  if (cues.deictic) {
    if (cues.personal) return unclear(`“${cues.deictic}” points to what you ask about, but you also gave it as something you have. Choose where to use it.`);
    if (ctx.anaphor) return placed("scenario", ctx.anaphor, `“${cues.deictic}” points to what you ask about, which ${list(names(ctx.anaphor))} ${ctx.anaphor.length === 1 ? "describes" : "describe"}.`, others(ctx.anaphor));
    if (change.length === 1) return placed("scenario", change, `“${cues.deictic}” points to what you ask about, so it goes only to ${list(names(change))}${baseline.length ? `. ${notDoing()}, so it is not copied there` : ""}.`, left());
    return unclear(`“${cues.deictic}” could point to more than one future. Choose where to use it.`);
  }
  if (cues.current) {
    if (cues.personal) return unclear(`“${cues.current}” points to how things are today, but you also gave it as something you have. Choose where to use it.`);
    if (baseline.length > 0) return placed("current", baseline.map((r) => r.index), `“${cues.current}” points to how things are today, so it goes to ${list(left())}, which ${baseline.length === 1 ? "reads" : "read"} as keeping things as they are.`, change.map(nameOf));
    return unclear(`“${cues.current}” points to how things are today, but no future reads as keeping things as they are. Choose where to use it.`);
  }
  if (cues.personal) {
    if (cues.expected) return unclear(`You gave it as something you have, but also wrote “${cues.expected}”. Choose whether it is the same in every future.`);
    return placed("personal", all, "It is something you have (a budget, savings or what you said you have), so it is the same whichever future you choose.");
  }
  if (cues.calendar) return placed("calendar", all, "It counts down to a date, which is the same in every future.");
  if (ctx.compares) return placed("common", all, "Your question compares other figures, so this one is the same in each future.");
  if (cues.own) return unclear(ownWhy);
  if (cues.expected || cues.asked) {
    const because = cues.expected ? `You wrote “${cues.expected}”, so it follows from what you ask about` : "It is part of what you are asking about";
    if (baseline.length === 0) {
      if (ctx.tiesElsewhere && change.length >= 2) return unclear("Other figures in your question belong to one future each, so it is unclear whether this one is the same in all of them. Choose where to use it.");
      return placed("scenario", all, `${because}. No future reads as not doing it, so it goes to every future.`);
    }
    if (change.length === 0) return unclear("Every future reads as not doing what you ask about. Choose where to use it.");
    // Leaving out a future that its own words mention would contradict them.
    if (mixed(ctx.touches)) return unclear(mixedWhy(ctx.touches));
    return placed("scenario", change, `${because}. ${notDoing()}, so it is not copied there. Choose “every future” if it holds there too.`, left());
  }
  if (baseline.length === 0 && !ctx.tiesElsewhere) return placed("neutral", all, "Nothing in your question ties it to one future, and none reads as not doing what you ask about, so it goes to every future.");
  return unclear(baseline.length > 0 ? "Your question does not say whether it holds if you do it or not. Choose where to use it." : "Other figures in your question belong to one future each, so it is unclear whether this one is the same in all of them. Choose where to use it.");
}
