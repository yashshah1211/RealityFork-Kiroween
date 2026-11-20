/**
 * Which universe a map is drawn in, which setting within it, and what each path may show. Presentation only. It reads
 * the map and never changes it, and it is deterministic: the same map always gets the same scenery, with the words that
 * decided it. No AI request is made to choose scenery, and nothing here depends on which example a map came from.
 *
 * Rules:
 *  - The family (city, energy and environment, shops and studios, open sky) comes from the subject of the decision: the
 *    user's question first, then what the map records about it (assumption names, units and choices, calculation names,
 *    path names and descriptions, the user's answers to the context questions). Suggestions the AI wrote
 *    ("possibilities") are never read, and neither is a change the user described in words.
 *  - A family needs enough evidence and a clear lead over the others. Questions about policy, law, science, history or
 *    ideas lean to the open sky, which implies nothing about the future; so does anything uncertain.
 *  - Within a family, a setting (a theme: a café, a river, an observatory...) is chosen the same way from the same words.
 *    Themes are reusable modules, not one environment per topic; a family without a clear theme gets its own default.
 *  - A path's own scenery adds only what the path itself records: a choice that names a setting or a feature (a battery
 *    that is "yes", a system size of 0, "Approach: flood walls"), the number of people working there, the place it
 *    happens in. Without such a figure, the path's own name may say it ("Panels only", "No solar"), never the words of a
 *    change the user described. Nothing about how good, likely, wealthy or safe a future is ever changes the picture.
 *  - Shops and studios also show two decisions a path records in its own choices (yes/no or a choice), or in its own
 *    name or description when no choice records them: whether a current job continues (an office tower behind the
 *    street) and whether the business launches now or waits (bunting, or scaffolding). Never read from a number.
 *  - A change described in the user's own words is a what-if RealityFork does not interpret: such a path keeps its
 *    family's scenery, is marked as a what-if, and never gets a detailed place or a detail read from its words.
 */
import { isIntervention, type Branch, type Reality } from "@realityfork/core";
import { describedHere, lineOf, worldFor } from "../worlds";

export type Family = "urban" | "energy" | "business" | "neutral";
export const FAMILIES: readonly Family[] = ["urban", "energy", "business", "neutral"];

/** Settings within a family, built from shared modules (see scene/kit*.ts). */
export type Theme =
  | "city"
  | "home" | "wind" | "water" | "woodland" | "farm"
  | "cafe" | "shop" | "studio" | "workshop" | "office"
  | "sky" | "observatory" | "ruins" | "forum";
export const THEMES: Readonly<Record<Family, readonly Theme[]>> = {
  urban: ["city"],
  energy: ["home", "wind", "water", "woodland", "farm"],
  business: ["cafe", "shop", "studio", "workshop", "office"],
  neutral: ["sky", "observatory", "ruins", "forum"],
};
/** The setting of a family when nothing points to one of its themes. */
export const DEFAULT_THEME: Readonly<Record<Family, Theme>> = { urban: "city", energy: "woodland", business: "office", neutral: "sky" };
export const themeFamily = (t: Theme): Family => FAMILIES.find((f) => THEMES[f].includes(t)) ?? "neutral";

/** Names for the screen, in plain words. */
export const FAMILY_NAME: Readonly<Record<Family, string>> = {
  urban: "City at night",
  energy: "Energy and environment",
  business: "Shops and studios",
  neutral: "Open sky",
};
export const THEME_NAME: Readonly<Record<Theme, string>> = {
  city: "streets and squares",
  home: "a home and its energy", wind: "wind on the hills", water: "a river and its banks", woodland: "woodland", farm: "fields and a farm",
  cafe: "a café", shop: "a shop street", studio: "a studio", workshop: "a workshop", office: "a small business",
  sky: "open sky", observatory: "an observatory", ruins: "old ruins", forum: "a public forum",
};
/** "Shops and studios, a café"; a family with one setting (the city) or its plain default (open sky) is just its name. */
export const sceneryName = (f: Family, t: Theme): string => (THEMES[f].length === 1 || t === "sky" ? FAMILY_NAME[f] : `${FAMILY_NAME[f]}, ${THEME_NAME[t]}`);

interface Cue {
  readonly family: Family;
  readonly theme: Theme | null;
  readonly pattern: RegExp;
  readonly weight: number;
}

/** Whole words or phrases of the normalised text (words separated by single spaces; see norm). */
const wordsRe = (w: string) => new RegExp(`(?<= )(?:${w})(?= )`, "iu");
const cue = (family: Family, weight: number, words: readonly string[], theme: Theme | null = null): Cue[] =>
  words.map((w) => ({ family, theme, weight, pattern: wordsRe(w) }));

/** Major cities, matched as whole words. A city named in a question is evidence of a relocation or city-life decision. */
const CITIES = [
  "london", "paris", "new york", "tokyo", "berlin", "mumbai", "bombay", "delhi", "bangalore", "bengaluru", "chennai", "kolkata", "hyderabad", "pune",
  "toronto", "vancouver", "montreal", "sydney", "melbourne", "dubai", "singapore", "amsterdam", "barcelona", "madrid", "rome", "milan", "lisbon",
  "san francisco", "los angeles", "chicago", "boston", "seattle", "austin", "manchester", "edinburgh", "glasgow", "dublin", "hong kong", "shanghai",
  "beijing", "seoul", "bangkok", "jakarta", "manila", "nairobi", "lagos", "cairo", "istanbul", "mexico city", "são paulo", "sao paulo", "buenos aires",
  "vienna", "zurich", "zürich", "geneva", "munich", "copenhagen", "stockholm", "oslo", "helsinki", "prague", "warsaw", "budapest", "athens",
];

/**
 * Evidence, by family and (where the words name one) by setting. Weights are per word or phrase; each one counts once
 * per kind of place it appears in. Words for the open sky are what draws a decision symbolically (policy, science,
 * history, ideas); they do not make up a place.
 */
const CUES: readonly Cue[] = [
  // City life and relocation
  ...cue("urban", 2, ["relocat\\w*", "emigrat\\w*", "immigrat\\w*", "mov(?:e|ed|es|ing) (?:to|from|abroad|away|out|overseas|countr(?:y|ies)|cit(?:y|ies))", "abroad", "overseas", "expats?", "visas?", "another (?:city|country)", "new (?:city|country)", "cost of living", "(?:big|capital) cit(?:y|ies)"], "city"),
  ...cue("urban", 1.5, [...CITIES, "cit(?:y|ies)", "downtown", "suburbs?", "neighbou?rhoods?", "apartments?", "studio (?:flats?|apartments?)", "commut\\w*", "housing", "public transport", "skyscrapers?", "high rises?", "urban"], "city"),
  ...cue("urban", 1, ["live in", "living in", "travel\\w*", "flatshare", "flatmates?", "roommates?", "landlords?"], "city"),
  ...cue("urban", 0.5, ["rent"], "city"),
  // Energy and the environment
  ...cue("energy", 2.5, ["solar", "photovoltaics?", "pv", "heat pumps?", "insulation", "electricity", "kwh", "energy (?:bills?|suppliers?|providers?|prices?|costs?|use|usage|efficien\\w*)"], "home"),
  ...cue("energy", 2.5, ["wind (?:turbines?|farms?|power|energy)", "turbines?", "renewables?", "renewable energy"], "wind"),
  ...cue("energy", 2.5, ["flood\\w*", "drought\\w*", "sea levels?", "wetlands?"], "water"),
  ...cue("energy", 2.5, ["wildfires?", "deforestation", "reforest\\w*", "rewild\\w*", "plant(?:ed|ing|s)? (?:more |new |a |an )?(?:trees|forests?|woods?|woodlands?|hedges?|hedgerows?)"], "woodland"),
  ...cue("energy", 2.5, ["net zero", "emissions?", "carbon", "climate"]),
  ...cue("energy", 1.5, ["energy"]),
  ...cue("energy", 1.5, ["kw", "batter(?:y|ies)", "boilers?", "retrofit\\w*", "electric (?:car|cars|vehicles?)", "ev chargers?", "smart meters?", "double glazing"], "home"),
  ...cue("energy", 1.5, ["hydro\\w*", "rainwater", "reservoirs?", "dams?", "coast\\w*", "irrigation", "rivers?", "lakes?", "watersheds?", "marsh\\w*"], "water"),
  ...cue("energy", 1.5, ["forests?", "woodlands?", "trees", "biodiversity", "wildlife", "conservation", "nature reserves?", "national parks?"], "woodland"),
  ...cue("energy", 1.5, ["farm\\w*", "crops?", "agricultur\\w*", "orchards?", "vineyards?", "livestock", "organic", "harvests?", "greenhouses?", "allotments?"], "farm"),
  ...cue("energy", 1.5, ["environment\\w*", "sustainab\\w*", "recycl\\w*", "pollution", "plastics?", "air quality", "geothermal", "grid", "ecolog\\w*"]),
  ...cue("energy", 0.8, ["tariffs?", "roofs?"], "home"),
  ...cue("energy", 0.8, ["water", "rain\\w*"], "water"),
  ...cue("energy", 0.8, ["parks?"], "woodland"),
  ...cue("energy", 0.8, ["gardens?", "compost\\w*", "bees"], "farm"),
  // Shops, cafés, studios and workshops
  ...cue("business", 2, ["caf[eé]s?", "coffee", "coffee shops?", "restaurants?", "bistros?", "bars?(?! exams?)", "pubs?", "tea rooms?", "baristas?", "menus?", "brunch", "diners?", "food trucks?", "catering", "chefs?"], "cafe"),
  ...cue("business", 2, ["shops?", "bookshops?", "bookstores?", "boutiques?", "florists?", "bakery", "bakeries", "delis?", "grocer\\w*", "retail\\w*", "stores?", "market stalls?", "salons?", "barbers?", "galler(?:y|ies)", "online (?:shop|store)s?", "e ?commerce", "hairdress\\w*"], "shop"),
  ...cue("business", 2, ["gam(?:e|es|ing)", "video games?", "studios?(?! (?:flats?|apartments?))", "software", "apps?", "saas", "tech (?:start ?ups?|compan(?:y|ies))", "agency", "agencies", "youtube", "podcasts?", "esports", "developers?", "coding", "animation", "film ?making", "recording", "photography", "illustrat\\w*", "music (?:studio|label)s?"], "studio"),
  ...cue("business", 2, ["workshops?", "crafts?", "makers?", "furniture", "carpentry", "woodwork\\w*", "pottery", "ceramics", "3d print\\w*", "manufactur\\w*", "factory", "factories", "forge", "blacksmith\\w*", "brewer(?:y|ies)", "distiller(?:y|ies)", "repairs?"], "workshop"),
  ...cue("business", 1.5, ["offices?", "co ?working", "consultan\\w*", "accountan\\w*", "law firm"], "office"),
  ...cue("business", 1.5, ["business\\w*", "compan(?:y|ies)", "start ?ups?", "start(?:ed|ing|s)? (?:my|our|a|an) own", "start(?:ed|ing|s)? (?:a|an|my|our) (?:\\w+ )?(?:business|company|firm|consultancy|practice|agency|brand|label)", "open(?:ed|ing|s)? (?:a|an|my|our)", "launch\\w*", "entrepreneur\\w*", "side hustle", "freelanc\\w*", "self ?employ\\w*", "revenue", "profits?", "franchise", "investors?", "sole trader", "my own boss"]),
  ...cue("business", 1, ["customers?", "clients?", "sales", "hir(?:e|ed|es|ing)", "staff", "employees?", "payroll", "funding", "lease", "brand", "products?", "suppliers?"]),
  ...cue("business", 0.6, ["wages?", "price", "pricing", "market", "stock", "inventory"]),
  // Policy, law, science, history and ideas: drawn in the open sky rather than in any one kind of place
  ...cue("neutral", 1.5, ["polic(?:y|ies)", "laws?", "legislat\\w*", "government\\w*", "council\\w*", "vot(?:e|es|ed|ing)", "elections?", "referendum", "regulat\\w*", "parliament", "congress", "universal basic income", "mandates?", "ban(?:ned|ning|s)?", "society", "democra\\w*", "courts?", "taxation", "tax (?:polic(?:y|ies)|law|laws|reform)", "rights"], "forum"),
  ...cue("neutral", 1.5, ["science", "scientific", "scientists?", "physics", "astrophysic\\w*", "astronom\\w*", "space (?:travel|exploration|stations?)", "planets?", "mars", "stars", "galax\\w*", "universe", "quantum", "gravity", "time travel\\w*", "aliens?", "photosynthes\\w*", "evolution", "dinosaurs?", "telepath\\w*", "teleport\\w*", "immortal\\w*", "superpowers?", "invisib\\w*", "artificial intelligence", "robots?"], "observatory"),
  ...cue("neutral", 1.5, ["history", "historical", "ancient", "empires?", "medieval", "kingdoms?", "dynast(?:y|ies)", "civili[sz]ations?", "centur(?:y|ies)", "wars?", "revolutions?", "never (?:invented|happened|existed|fell|been)", "had never", "fall of", "invent(?:ed|ion|ions)", "pharaohs?", "romans?", "vikings?"], "ruins"),
  ...cue("neutral", 1, ["philosoph\\w*", "ethic\\w*", "meaning of life", "dreams?", "memor(?:y|ies)", "future self", "love", "friendships?", "relationships?", "music", "instruments?", "poetry", "novels?", "meditat\\w*", "spiritual\\w*", "purpose"], "sky"),
];

/** Where in the map a word was found, and how much a match there counts. The user's question counts most. */
const SOURCES = { question: 1, context: 0.5, description: 0.5, assumptions: 0.6, calculations: 0.4, paths: 0.4 } as const;
export type EvidenceSource = keyof typeof SOURCES;
const SOURCE_WORDS: Readonly<Record<EvidenceSource, string>> = {
  question: "your question",
  context: "what you told us",
  description: "the map's description",
  assumptions: "the map's assumptions",
  calculations: "the map's calculations",
  paths: "the paths' names",
};

export interface Evidence {
  /** The words as they are written in the map. */
  readonly words: string;
  readonly source: EvidenceSource;
  readonly weight: number;
  /** Where in its text the words start (to quote them in the order the user wrote them). */
  readonly at: number;
  readonly theme: Theme | null;
}

export interface SceneryChoice {
  readonly family: Family;
  /** The setting within the family. */
  readonly theme: Theme;
  /** False when the user chose this scenery themselves. */
  readonly automatic: boolean;
  /** What decided it, strongest first. Empty when nothing in the map points anywhere. */
  readonly evidence: readonly Evidence[];
  /** The total evidence for each family (the open sky's: policy, science, history, ideas), for tests and the explanation. */
  readonly scores: Readonly<Record<Family, number>>;
  /** The evidence for each setting, within every family. */
  readonly themeScores: Readonly<Partial<Record<Theme, number>>>;
  /** One sentence for the screen. */
  readonly why: string;
}

/** The user's own choice of scenery for a map: appearance only (see override.ts). A null theme: the family's best fit. */
export interface SceneryOverride {
  readonly family: Family;
  readonly theme: Theme | null;
}

/** Lower case; anything but letters, digits and apostrophes becomes a single space; padded so every word has spaces round it. */
const norm = (s: string) => ` ${s.toLowerCase().normalize("NFC").replace(/[^\p{L}\p{N}']+/gu, " ").trim()} `;
/** The matched words as the user wrote them (case and punctuation kept), for quoting. */
function original(text: string, matched: string): string {
  const pattern = matched.split(" ").map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^\\p{L}\\p{N}']+");
  return new RegExp(pattern, "iu").exec(text.normalize("NFC"))?.[0] ?? matched;
}

/**
 * What the resolver reads: the parts of a map (or of an example before it is built) that say what the decision is
 * about. A Reality is one; nothing else of it is read.
 */
export interface SceneryInput {
  readonly question: string;
  readonly description?: string;
  readonly context?: readonly { readonly answer: string }[];
  readonly variables: readonly { readonly label: string; readonly kind: string; readonly unit?: string; readonly options?: readonly string[] }[];
  readonly formulas: readonly { readonly label: string; readonly unit?: string }[];
  readonly branches: readonly { readonly name: string; readonly description: string }[];
}

function texts(r: SceneryInput): { source: EvidenceSource; text: string }[] {
  const out: { source: EvidenceSource; text: string }[] = [{ source: "question", text: r.question }];
  if (r.description) out.push({ source: "description", text: r.description });
  for (const f of r.context ?? []) out.push({ source: "context", text: f.answer });
  for (const v of r.variables) out.push({ source: "assumptions", text: `${v.label} ${v.unit ?? ""} ${v.kind === "category" ? (v.options ?? []).join(" ") : ""}` });
  for (const f of r.formulas) out.push({ source: "calculations", text: `${f.label} ${f.unit ?? ""}` });
  for (const b of r.branches) out.push({ source: "paths", text: `${b.name} ${b.description}` });
  return out;
}

/** Minimum evidence for a family, and the lead it needs over the next one. */
export const ENOUGH = 2;
export const LEAD = 1;

type Reason = "none" | "symbolic" | "close" | "clear";

function bestTheme(f: Family, themeScores: Partial<Record<Theme, number>>): Theme {
  let best: Theme = DEFAULT_THEME[f];
  let score = 0;
  for (const t of THEMES[f]) {
    const s = themeScores[t] ?? 0;
    if (s > score) [best, score] = [t, s];
  }
  return best;
}

/**
 * The scenery for a map. `override` is the user's own choice (appearance only); without it the map's words decide, and
 * anything uncertain is the open sky.
 */
export function resolveScenery(r: SceneryInput, override: SceneryOverride | Family | null = null): SceneryChoice {
  const scores: Record<Family, number> = { urban: 0, energy: 0, business: 0, neutral: 0 };
  const themeScores: Partial<Record<Theme, number>> = {};
  const found = new Map<string, Evidence & { readonly family: Family }>();
  for (const { source, text } of texts(r)) {
    const t = norm(text);
    for (const c of CUES) {
      const m = c.pattern.exec(t);
      if (!m) continue;
      // The same words count once per kind of source: "kW" in five assumptions is one piece of evidence there.
      const key = `${c.family}|${c.theme ?? ""}|${source}|${m[0]}`;
      if (found.has(key)) continue;
      const weight = c.weight * SOURCES[source];
      found.set(key, { words: original(text, m[0]), source, weight, at: m.index, family: c.family, theme: c.theme });
      scores[c.family] += weight;
      if (c.theme) themeScores[c.theme] = (themeScores[c.theme] ?? 0) + weight;
    }
  }
  for (const k of FAMILIES) scores[k] = Math.round(scores[k] * 100) / 100;
  for (const k of Object.keys(themeScores) as Theme[]) themeScores[k] = Math.round(themeScores[k]! * 100) / 100;

  const ranked = (["urban", "energy", "business"] as const).map((f) => [f, scores[f]] as const).sort((a, b) => b[1] - a[1]);
  const [best, second] = [ranked[0]!, ranked[1]!];
  let family: Family = "neutral";
  let reason: Reason = "none";
  if (best[1] >= ENOUGH) {
    if (scores.neutral >= best[1]) reason = "symbolic";
    else if (best[1] - second[1] < LEAD) reason = "close";
    else {
      family = best[0];
      reason = "clear";
    }
  }
  const theme = bestTheme(family, themeScores);
  const evidence = [...found.values()]
    .filter((e) => e.family === family)
    .sort((a, b) => b.weight - a.weight || a.at - b.at)
    .map(({ words, source, weight, at, theme: th }) => ({ words, source, weight, at, theme: th }));

  const wanted: SceneryOverride | null = typeof override === "string" ? { family: override, theme: null } : override;
  if (wanted && (wanted.family !== family || (wanted.theme !== null && wanted.theme !== theme))) {
    const f = wanted.family;
    const t = wanted.theme && THEMES[f].includes(wanted.theme) ? wanted.theme : f === family ? theme : bestTheme(f, themeScores);
    return {
      family: f, theme: t, automatic: false, evidence: [], scores, themeScores,
      why: `${sceneryName(f, t)}: you chose this scenery. It changes only the picture, never the map. Chosen automatically, it would be ${sceneryName(family, theme).toLowerCase()}.`,
    };
  }
  return { family, theme, automatic: wanted === null, evidence, scores, themeScores, why: explain(family, theme, reason, evidence, ranked) };
}

function quoteList(words: readonly string[]): string {
  const q = [...new Set(words)].map((w) => `“${w}”`);
  return q.length <= 1 ? q.join("") : `${q.slice(0, -1).join(", ")} and ${q[q.length - 1]}`;
}

function explain(family: Family, theme: Theme, reason: Reason, evidence: readonly Evidence[], ranked: readonly (readonly [Exclude<Family, "neutral">, number])[]): string {
  const symbolic = "so the scenery stays symbolic and shows no particular place.";
  const name = sceneryName(family, theme);
  if (family === "neutral") {
    if (reason === "close") return `${name}: the map's words point both to ${FAMILY_NAME[ranked[0]![0]].toLowerCase()} and to ${FAMILY_NAME[ranked[1]![0]].toLowerCase()}, ${symbolic}`;
    // Quote what the question is about (policy, science, history, ideas) when the map says it.
    const about = evidence.filter((e) => e.theme === theme || reason === "symbolic").slice(0, 2).map((e) => e.words);
    if (about.length) return `${name}: the question is about ${quoteList(about)}, ${symbolic}`;
    return `${name}: nothing in the map says what kind of place this decision is about, ${symbolic}`;
  }
  // Quote the user's own question first; otherwise the strongest words elsewhere in the map.
  const fromQuestion = evidence.filter((e) => e.source === "question").slice(0, 3).sort((a, b) => a.at - b.at).map((e) => e.words);
  const elsewhere = evidence.filter((e) => e.source !== "question");
  const because = fromQuestion.length
    ? `your question mentions ${quoteList(fromQuestion.slice(0, 3))}`
    : `${SOURCE_WORDS[elsewhere[0]!.source]} mention ${quoteList(elsewhere.slice(0, 2).map((e) => e.words))}`;
  return `${name}: ${because}.`;
}

// ---------- what one path shows ----------

/** Details a path's own figures (or its own name) can establish. */
export type Prop = "solar" | "battery" | "heatpump" | "levee" | "wetland" | "dayjob" | "open" | "notyet";
export interface PathScenery {
  readonly family: Family;
  /** The map's setting, or the one this path's own choice names. */
  readonly theme: Theme;
  /** A detailed hand-made place, only where the map says the path happens there (see worlds.ts). */
  readonly place: "london" | null;
  /** What this path's own figures say is there. */
  readonly props: readonly Prop[];
  /** People at work (shops, cafés, studios, workshops): only a number the path records, from 1 to 6; otherwise 0. */
  readonly people: number;
  /** The path explores a change the user described in words (a what-if). */
  readonly hypothetical: boolean;
  /** Plain sentences for the screen: why this picture. */
  readonly reasons: readonly string[];
}

interface Feature {
  readonly prop: Prop;
  /** The settings that can show it. */
  readonly themes: readonly Theme[];
  /** The map is about it: these words are in the question, or in an assumption's name or choices. */
  readonly subject: RegExp;
  /** Words that name it in a yes/no assumption, a choice, or a path's own name ("Panels only" on a solar map). */
  readonly words: RegExp;
  /** A number that records its size: the assumption's name and unit. */
  readonly size?: { readonly label: RegExp; readonly unit: RegExp };
  readonly yes: string;
  readonly no: string;
}
const w = (s: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${s})(?![\\p{L}\\p{N}])`, "iu");
const FLOOD_WALL = w("flood (?:walls?|defen[cs]es?|barriers?)|levees?|embankments?|sea walls?");
const WETLAND = w("wetlands?|marsh(?:es|land)?|reed ?beds?|floodplains?");
const FEATURES: readonly Feature[] = [
  { prop: "solar", themes: ["home"], subject: w("solar|photovoltaics?|pv"), words: w("solar|photovoltaics?|pv|panels?"), size: { label: w("solar|panels?|pv|array|system"), unit: w("kw") }, yes: "Solar panels", no: "No solar panels" },
  { prop: "battery", themes: ["home"], subject: w("batter(?:y|ies)"), words: w("batter(?:y|ies)"), size: { label: w("batter(?:y|ies)"), unit: w("kwh") }, yes: "A battery", no: "No battery" },
  { prop: "heatpump", themes: ["home"], subject: w("heat pumps?"), words: w("heat pumps?"), size: { label: w("heat pumps?"), unit: w("kw") }, yes: "A heat pump", no: "No heat pump" },
  { prop: "levee", themes: ["water"], subject: FLOOD_WALL, words: FLOOD_WALL, yes: "A flood wall", no: "No flood wall" },
  { prop: "wetland", themes: ["water"], subject: WETLAND, words: WETLAND, yes: "Wetland pools and reeds", no: "No wetland" },
];
/** What each detail looks like in words, there and not there (the same words as the reasons). */
export const PROP_WORDS: Readonly<Record<Prop, { readonly yes: string; readonly no: string }>> = {
  ...(Object.fromEntries(FEATURES.map((f) => [f.prop, { yes: f.yes, no: f.no }])) as Record<Prop, { yes: string; no: string }>),
  dayjob: { yes: "An office tower for the current job", no: "No office tower for a current job" },
  open: { yes: "Bunting for the launch", no: "No launch bunting" },
  notyet: { yes: "Scaffolding: the launch waits", no: "No scaffolding" },
};
/** Words before a mention that say it is not there: "No solar", "without a battery", "instead of flood walls". */
const NEGATION = /(?:^|[^\p{L}])(?:no|not|without|never|skip(?:ping)?|instead of|rather than|don'?t|doesn'?t|no new|remove|removing|scrap(?:ping)?)(?:\s+[\p{L}'-]+){0,2}\s*$/iu;
function mention(text: string, words: RegExp): { readonly yes: boolean; readonly words: string } | null {
  const m = words.exec(text);
  if (!m) return null;
  return { yes: !NEGATION.test(text.slice(0, m.index)), words: m[0] };
}

const plain = (v: unknown) => (typeof v === "number" ? String(v) : String(v ?? ""));
type Presence = { readonly present: boolean; readonly reason: string } | null;

/** Whether a path has a feature: from its own figures first, then from its own name (never a described change). */
function presence(r: Reality, b: Branch, f: Feature): Presence {
  for (const v of r.variables) {
    if (v.kind === "boolean" && f.words.test(v.label)) {
      const x = b.values[v.key];
      if (x === true) return { present: true, reason: `${f.yes}, because “${v.label}” is yes on this path.` };
      if (x === false) return { present: false, reason: `${f.no}: “${v.label}” is no on this path.` };
    } else if (v.kind === "number" && f.size && f.size.label.test(v.label) && f.size.unit.test(v.unit)) {
      if ((b.notApplicable ?? []).includes(v.key)) return { present: false, reason: `${f.no}: “${v.label}” is not part of this path.` };
      const x = b.values[v.key];
      if (typeof x === "number") return x > 0 ? { present: true, reason: `${f.yes}, because “${v.label}” is ${x} ${v.unit} on this path.` } : { present: false, reason: `${f.no}: “${v.label}” is 0 ${v.unit} on this path.` };
    } else if (v.kind === "category" && (f.words.test(v.label) || v.options.some((o) => f.words.test(o)))) {
      const x = b.values[v.key];
      if (typeof x !== "string" || !x.trim()) continue;
      const said = mention(x, f.words);
      return said?.yes ? { present: true, reason: `${f.yes}, because “${v.label}” is “${x}” on this path.` } : { present: false, reason: `${f.no}: “${v.label}” is “${x}” on this path.` };
    }
  }
  // No figure records it: the path's own name and description, or those of the path it continues. A change described in
  // words, here or earlier on the line, may change anything, so nothing is read from there on.
  for (const [i, x] of lineOf(r, b).entries()) {
    if (describedHere(r, x)) return null;
    for (const [part, text] of [["name", x.name], ["description", x.description]] as const) {
      const said = mention(text, f.words);
      if (!said) continue;
      const where = i === 0 ? (part === "name" ? `the path is called “${x.name.trim()}”` : `this path's description says “${said.words}”`) : `it continues “${x.name.trim()}”`;
      return said.yes ? { present: true, reason: `${f.yes}, because ${where}.` } : { present: false, reason: `${f.no}: ${where}.` };
    }
  }
  return null;
}

// ---------- what a path decides (shops and studios) ----------

const JOB = w("(?:day |current |main |regular |full[- ]time |part[- ]time |office |salaried )?jobs?|employ(?:ed|ment|er|ee)|salar(?:y|ied|ies)|careers?|9[- ]to[- ]5|nine[- ]to[- ]five");
const LEAVE = w("quit\\w*|leav(?:e|es|ing)|left|resign\\w*|stop(?:s|ped|ping)?|give up|gives up|giving up|gave up|drop(?:s|ped|ping)?|no longer|without");
const KEEP = w("keep\\w*|kept|stay\\w*|continu\\w*|remain\\w*|alongside|while|part[- ]time|full[- ]time|still|hold(?:s|ing)? on|employed|yes");
const LAUNCH = w("launch\\w*|go(?:es|ing)? live|(?:open|start)(?:s|ed|ing)?(?: up)? (?:the|a|an|my|our|your|this|that) \\p{L}+");
const LATER = w("delay\\w*|postpon\\w*|later|wait\\w*|defer\\w*|hold(?:s|ing)? off|not yet|push(?:ed)? back|next (?:week|month|year|quarter|spring|summer|autumn|fall|winter)|(?:in|until|till|by) (?:the )?(?:spring|summer|autumn|fall|winter)|in (?:\\d+|a|an|one|two|three|four|six|nine|twelve) (?:days?|weeks?|months?|years?)|after (?:saving|a|an|one|two|three|six|\\d+)|before (?:the )?(?:launch|start|open)\\w*");
const NOW = w("now|immediately|right away|straight away|today|this (?:week|month|year)|asap|yes|launch\\w*");

/**
 * A decision a path records: what it is about, the words that turn a mention of it around ("Quit my job", "Delay the
 * launch"), the words a short choice needs when the choice's own name says what it is about ("Current job: Keep it",
 * "When to launch: Now"), and the marker each answer shows (null: none; `instead` names the marker that is absent).
 * `symmetric`: "no" to one answer is the other (keeping or leaving a job), not just "no" (launching now or not).
 */
interface Decision {
  readonly about: RegExp;
  readonly turn: RegExp;
  readonly plainWords: RegExp;
  readonly symmetric: boolean;
  readonly plain: Prop | null;
  readonly turned: Prop | null;
  readonly instead: Prop;
}
const DECISIONS: readonly Decision[] = [
  { about: JOB, turn: LEAVE, plainWords: KEEP, symmetric: true, plain: "dayjob", turned: null, instead: "dayjob" },
  { about: LAUNCH, turn: LATER, plainWords: NOW, symmetric: false, plain: "open", turned: "notyet", instead: "open" },
];
type Answer = "plain" | "turned";
const CLAUSE_BREAK = /[,;.!?()]|(?<![\p{L}\p{N}])(?:and|but|then|so|or)(?![\p{L}\p{N}])/giu;
/** The stretch of `text` around [at, at + len], between clause breaks ("Launch | quit job", "Keep your job | start …"). */
function clauseAround(text: string, at: number, len: number): { readonly start: number; readonly end: number } {
  let start = 0;
  let end = text.length;
  for (const m of text.matchAll(CLAUSE_BREAK)) {
    if (m.index! + m[0].length <= at) start = m.index! + m[0].length;
    else if (m.index! >= at + len) { end = m.index!; break; }
  }
  return { start, end };
}
/**
 * How a value, a name or a description answers a decision, or null when it does not. Only the clause that mentions the
 * decision is read ("Keep your job, and start without a loan" keeps the job). `named`: the choice is named for it.
 */
function answerOf(d: Decision, text: string, named: boolean): Answer | null {
  const m = d.about.exec(text);
  const c = m ? clauseAround(text, m.index, m[0].length) : { start: 0, end: text.length };
  if (d.turn.test(text.slice(c.start, c.end)) || (m !== null && NEGATION.test(text.slice(c.start, m.index)))) return m !== null || named ? "turned" : null;
  if (m !== null) return "plain";
  return named && d.plainWords.test(text) ? "plain" : null;
}
const clip = (t: string) => (t.trim().length > 70 ? `${t.trim().slice(0, 67).trimEnd()}…` : t.trim());
/** What a path decides, from its own choices first, then its own name and description (never a described change). */
function decided(r: Reality, b: Branch, d: Decision): { readonly prop: Prop | null; readonly reason: string } | null {
  const said = (a: Answer, where: string) => {
    const prop = a === "plain" ? d.plain : d.turned;
    return { prop, reason: prop ? `${PROP_WORDS[prop].yes}, because ${where}.` : `${PROP_WORDS[d.instead].no}: ${where}.` };
  };
  for (const v of r.variables) {
    const x = b.values[v.key];
    if (v.kind === "boolean") {
      if (typeof x !== "boolean" || !d.about.test(v.label)) continue;
      const polarity = answerOf(d, v.label, true) ?? "plain";
      if (x) return said(polarity, `“${v.label}” is yes on this path`);
      if (d.symmetric) return said(polarity === "plain" ? "turned" : "plain", `“${v.label}” is no on this path`);
    } else if (v.kind === "category") {
      if (typeof x !== "string" || !x.trim()) continue;
      const named = d.about.test(v.label);
      if (!named && !d.about.test(x)) continue;
      const a = answerOf(d, x, named);
      if (a) return said(a, `“${v.label}” is “${x}” on this path`);
    }
  }
  for (const [i, x] of lineOf(r, b).entries()) {
    if (describedHere(r, x)) return null;
    for (const [part, text] of [["name", x.name], ["description", x.description]] as const) {
      const a = d.about.test(text) ? answerOf(d, text, false) : null;
      if (!a) continue;
      return said(a, i > 0 ? `it continues “${x.name.trim()}”` : part === "name" ? `the path is called “${x.name.trim()}”` : `this path's description says “${clip(text)}”`);
    }
  }
  return null;
}

const PEOPLE_LABEL = w("baristas?|staff|employees?|team(?: size| members?)?|workers?|cooks?|chefs?|waiters?|waitresses|servers?|helpers?|assistants?|bakers?|people (?:on duty|working|employed)|developers?|makers?");
const NOT_PEOPLE = w("customers?|visitors?|guests?|clients?|patients?|students?|queue|arriv\\w*|served|per");
const COUNT = ["", "One person", "Two people", "Three people", "Four people", "Five people", "Six people"];
/** "Two people": the people the picture draws at work (1 to 6), in words. */
export const peopleWords = (n: number): string => (n >= 1 && n < COUNT.length ? COUNT[n]! : "Nobody");
/** Where the picture draws them: behind the counter of a café or shop, at a bench or desk elsewhere. */
export const peopleWhere = (theme: Theme): string => (theme === "cafe" || theme === "shop" ? "at the counter" : "at work");
/** People working there: a number the path records for its staff or team (never customers), drawn only from 1 to 6. */
function peopleOf(r: Reality, b: Branch, theme: Theme): { readonly n: number; readonly reason: string | null } {
  const v = r.variables.find((x) => x.kind === "number" && PEOPLE_LABEL.test(x.label) && !NOT_PEOPLE.test(x.label) && !/per/i.test(x.unit));
  if (!v) return { n: 0, reason: null };
  const x = b.values[v.key];
  if (typeof x !== "number" || (b.notApplicable ?? []).includes(v.key)) return { n: 0, reason: null };
  if (!Number.isInteger(x) || x < 1 || x > 6) return { n: 0, reason: x === 0 ? null : `Nobody is drawn at work: “${v.label}” is ${x} on this path, which the picture does not show figure by figure.` };
  return { n: x, reason: `${COUNT[x]} ${peopleWhere(theme)}, because “${v.label}” is ${plain(x)} on this path.` };
}

/** Theme words, per theme, for reading a path's own choices ("Business type: furniture workshop"). */
const THEME_WORDS: ReadonlyMap<Theme, readonly RegExp[]> = (() => {
  const m = new Map<Theme, RegExp[]>();
  for (const c of CUES) if (c.theme) m.set(c.theme, [...(m.get(c.theme) ?? []), c.pattern]);
  return m;
})();
/** The setting a path's own choice names, within the map's family (shops and studios, energy and environment). */
function themeOf(r: Reality, b: Branch, family: Family): { readonly theme: Theme; readonly reason: string } | null {
  if (family !== "business" && family !== "energy") return null;
  for (const v of r.variables) {
    if (v.kind !== "category") continue;
    const x = b.values[v.key];
    if (typeof x !== "string" || !x.trim()) continue;
    const t = norm(x);
    for (const th of THEMES[family]) {
      // "No shop yet" names no setting: a mention after a negation does not count.
      const named = (THEME_WORDS.get(th) ?? []).some((p) => {
        const m = p.exec(t);
        return m !== null && !NEGATION.test(t.slice(0, m.index));
      });
      if (named) return { theme: th, reason: `Drawn as ${THEME_NAME[th]}, because “${v.label}” is “${x}” on this path.` };
    }
  }
  return null;
}

export function pathScenery(r: Reality, b: Branch, choice: SceneryChoice): PathScenery {
  const reasons: string[] = [];
  // Described changes are copied to the paths that continue one, so those are what-ifs too.
  const hypothetical = (b.facts ?? []).some(isIntervention);
  const where = worldFor(r, b);
  // A detailed place only where the map itself says so, and never for a change described in words (worlds.ts).
  const place = where.kind === "london" ? "london" : null;
  if (place) reasons.push(where.reason);
  else reasons.push(`Illustrative scenery (${FAMILY_NAME[choice.family].toLowerCase()}): nothing in the picture is a fact about this future.`);
  let theme = choice.theme;
  // The user's own choice of scenery is kept as it is; otherwise the path's own choice may name its setting.
  if (choice.automatic && !place) {
    const own = themeOf(r, b, choice.family);
    if (own && own.theme !== theme) {
      theme = own.theme;
      reasons.push(own.reason);
    }
  }
  const props: Prop[] = [];
  if (!place) {
    const about = `${r.question} ${r.variables.map((v) => `${v.label} ${v.options.join(" ")}`).join(" ")}`;
    for (const f of FEATURES) {
      if (!f.themes.includes(theme) || !f.subject.test(about)) continue;
      const p = presence(r, b, f);
      if (p?.present) props.push(f.prop);
      // Say when the subject of the question is not drawn, and why; other details are simply left out when absent.
      if (p) {
        if (p.present || f.subject.test(r.question)) reasons.push(p.reason);
      } else if (f.subject.test(r.question)) {
        reasons.push(`${f.no} shown: nothing recorded for this path says it has one.`);
      }
    }
    if (THEMES.business.includes(theme)) {
      for (const d of DECISIONS) {
        if (!d.about.test(about)) continue;
        const x = decided(r, b, d);
        if (!x) continue;
        if (x.prop) props.push(x.prop);
        if (x.prop || d.about.test(r.question)) reasons.push(x.reason);
      }
    }
  }
  let people = 0;
  if (choice.family === "business" && !place) {
    const p = peopleOf(r, b, theme);
    people = p.n;
    if (p.reason) reasons.push(p.reason);
  }
  if (hypothetical) reasons.push("This path explores a change you described in your own words. RealityFork does not interpret those words, so the picture is marked as a what-if and shows nothing they might mean.");
  return { family: choice.family, theme, place, props, people, hypothetical, reasons };
}
