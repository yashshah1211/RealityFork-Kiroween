/**
 * Example realities. They are DATA built with the same generic operations a user has in the UI
 * (createReality, addVariable, addFormula, forkBranch, updateBranch). There is no example-specific
 * code path. All values are illustrative, not research or advice; each says so in its source note.
 */
import {
  addFormula,
  addSimulation,
  addVariable,
  createReality,
  forkBranch,
  randomRealityId,
  updateBranch,
  updateRealityText,
  type AssumptionValue,
  type IdGen,
  type NewFormula,
  type NewVariable,
  type Possibility,
  type Reality,
  type SimulationLink,
} from "./reality";

export interface RealityTemplate {
  readonly id: string;
  readonly title: string;
  readonly question: string;
  readonly description: string;
  readonly questions: readonly string[];
  readonly variables: readonly (NewVariable & { readonly key: string; readonly start: AssumptionValue })[];
  readonly formulas: readonly (NewFormula & { readonly key: string })[];
  readonly simulations?: readonly (Omit<SimulationLink, "key"> & { readonly key: string })[];
  readonly startName: string;
  readonly startPossibilities?: readonly Omit<Possibility, "id">[];
  /** Branches in order; `from` names an earlier branch (or the start). */
  readonly branches: readonly {
    readonly name: string;
    readonly from?: string;
    readonly description: string;
    readonly values: Readonly<Record<string, AssumptionValue>>;
    readonly possibilities?: readonly Omit<Possibility, "id">[];
  }[];
}

const ILLUSTRATIVE = "Illustrative example value, not data. Replace it with your own.";

export const MOVE_CITY: RealityTemplate = {
  id: "move-city",
  title: "Moving to another city",
  question: "What if I moved from Mumbai to London?",
  description: "Money and everyday life in two cities. Amounts are per month in one currency (£, converted).",
  questions: ["Would I save more or less each month?", "What would daily life feel like?"],
  startName: "Stay in Mumbai",
  variables: [
    { key: "city", label: "City", kind: "category", options: ["Mumbai", "London"], source: "", uncertainty: "", start: "Mumbai" },
    { key: "netIncome", label: "Take-home pay", kind: "number", unit: "£ per month", source: ILLUSTRATIVE, uncertainty: "Depends on the job offer.", start: 1400 },
    { key: "rent", label: "Rent", kind: "number", unit: "£ per month", source: ILLUSTRATIVE, uncertainty: "Varies a lot by area.", start: 350 },
    { key: "livingCosts", label: "Food, transport and bills", kind: "number", unit: "£ per month", source: ILLUSTRATIVE, uncertainty: "Rough guess.", start: 400 },
    { key: "remoteWork", label: "Work from home", kind: "boolean", source: "", uncertainty: "", start: false },
    { key: "commuteMinutes", label: "Commute each way", kind: "number", unit: "minutes", source: ILLUSTRATIVE, uncertainty: "", start: 50 },
    { key: "movingCost", label: "One-off moving and visa costs", kind: "number", unit: "£", source: "Unknown until I get quotes.", uncertainty: "Unknown", start: 0 },
  ],
  formulas: [
    { key: "monthlySavings", label: "Saved each month", expression: "netIncome - rent - livingCosts", unit: "£ per month", reviewed: false },
    { key: "yearlySavings", label: "Saved in the first year", expression: "monthlySavings * 12 - movingCost", unit: "£", reviewed: false },
    { key: "savingsRate", label: "Share of pay saved", expression: "round(monthlySavings / netIncome * 100, 1)", unit: "%", condition: "netIncome > 0", reviewed: false },
    { key: "commuteHours", label: "Commuting per week", expression: "if(remoteWork, 0, commuteMinutes * 2 * 5 / 60)", unit: "hours", reviewed: false },
  ],
  startPossibilities: [{ text: "Close to family and friends", likelihood: "likely", note: "" }],
  branches: [
    {
      name: "Move to London", description: "Same kind of job, London salary and rent.",
      values: { city: "London", netIncome: 3100, rent: 1500, livingCosts: 900, commuteMinutes: 40, movingCost: null },
      possibilities: [
        { text: "Faster career growth", likelihood: "possible", note: "My hope, not evidence." },
        { text: "Lonely for the first year", likelihood: "possible", note: "" },
      ],
    },
    {
      name: "London, remote job", from: "Move to London", description: "As above, but working from home.",
      values: { remoteWork: true, rent: 1250, netIncome: 2900 },
    },
  ],
};

export const SOLAR: RealityTemplate = {
  id: "solar",
  title: "Household solar panels",
  question: "What if our household installed solar panels?",
  description: "Yearly money flows and payback. Payback is only calculated when the yearly savings are positive.",
  questions: ["How many years until the panels pay for themselves?", "What if electricity prices change?"],
  startName: "4 kW system, today's prices",
  variables: [
    { key: "systemKw", label: "System size", kind: "number", unit: "kW", source: ILLUSTRATIVE, uncertainty: "", start: 4 },
    { key: "installCost", label: "Installation cost", kind: "number", unit: "£", source: ILLUSTRATIVE, uncertainty: "Get quotes.", start: 6000 },
    { key: "yieldPerKw", label: "Electricity generated per kW", kind: "number", unit: "kWh per year", source: ILLUSTRATIVE, uncertainty: "Depends on roof direction and weather.", start: 900 },
    { key: "selfUsePercent", label: "Share used at home", kind: "number", unit: "%", source: ILLUSTRATIVE, uncertainty: "Higher with a battery or daytime use.", start: 50 },
    { key: "importPrice", label: "Price we pay for electricity", kind: "number", unit: "£ per kWh", source: ILLUSTRATIVE, uncertainty: "Prices change.", start: 0.28 },
    { key: "exportPrice", label: "Price paid for exported electricity", kind: "number", unit: "£ per kWh", source: ILLUSTRATIVE, uncertainty: "Depends on the tariff.", start: 0.12 },
    { key: "battery", label: "Battery included", kind: "boolean", source: "", uncertainty: "", start: false },
  ],
  formulas: [
    { key: "generation", label: "Electricity generated", expression: "systemKw * yieldPerKw", unit: "kWh per year", reviewed: false },
    { key: "annualSavings", label: "Saved per year", expression: "generation * selfUsePercent / 100 * importPrice + generation * (1 - selfUsePercent / 100) * exportPrice", unit: "£ per year", reviewed: false },
    { key: "paybackYears", label: "Years to pay back", expression: "round(installCost / annualSavings, 1)", unit: "years", condition: "annualSavings > 0", reviewed: false },
  ],
  startPossibilities: [{ text: "Roof may need repairs first", likelihood: "not-judged", note: "Ask an installer." }],
  branches: [
    { name: "Electricity prices rise 30%", description: "Import price up by 30%.", values: { importPrice: 0.364 } },
    { name: "Add a battery", description: "More used at home, higher cost.", values: { battery: true, selfUsePercent: 80, installCost: 9500 }, possibilities: [{ text: "Backup power during outages", likelihood: "likely", note: "" }] },
    { name: "Shaded roof, no export payments", description: "Lower yield and nothing paid for exports.", values: { yieldPerKw: 500, exportPrice: 0, selfUsePercent: 0 } },
  ],
};

/** Optional third example: the validated queue simulator through the simulation adapter. */
export const CAFE_QUEUE: RealityTemplate = {
  id: "cafe-queue",
  title: "Café queue (validated simulator)",
  question: "What if our café hired a second barista for the morning rush?",
  description: "Uses RealityFork's validated queue simulator for the wait, and plain arithmetic for wages.",
  questions: ["How long would customers wait?", "What does the extra barista cost?"],
  startName: "One barista",
  variables: [
    { key: "baristas", label: "Baristas on duty", kind: "number", unit: "people", source: "", uncertainty: "", start: 1 },
    { key: "customersPerHour", label: "Customers arriving", kind: "number", unit: "per hour", source: ILLUSTRATIVE, uncertainty: "Count them for a week.", start: 24 },
    { key: "drinksPerBaristaHour", label: "Customers one barista can serve", kind: "number", unit: "per hour", source: ILLUSTRATIVE, uncertainty: "", start: 30 },
    { key: "wage", label: "Barista wage", kind: "number", unit: "£ per hour", source: ILLUSTRATIVE, uncertainty: "", start: 12 },
  ],
  formulas: [
    { key: "wageCost", label: "Wages for a 3-hour rush", expression: "baristas * wage * 3", unit: "£", reviewed: false },
    { key: "busyShare", label: "Share of time baristas are busy (expected)", expression: "round(customersPerHour / (baristas * drinksPerBaristaHour) * 100, 1)", unit: "%", condition: "baristas > 0", reviewed: false },
  ],
  simulations: [
    {
      key: "queueWait", label: "Average wait before being served", modelId: "queue.mmc", modelVersion: "1.1.0",
      params: { servers: "baristas", arrivalRatePerHour: "customersPerHour", serviceRatePerHour: "drinksPerBaristaHour", serverCostPerHour: "wage", waitingCostPerHour: 0 },
      metric: "meanWait", settings: { warmup: 100, horizon: 1100 }, masterSeed: 1, replications: 30,
    },
  ],
  branches: [{ name: "Two baristas", description: "Hire a second barista for the rush.", values: { baristas: 2 } }],
};

export const EXAMPLES: readonly RealityTemplate[] = [MOVE_CITY, SOLAR, CAFE_QUEUE];

/** Possibilities an example comes with are recorded as the example's, never as the user's. */
const withIds = (ps: readonly Omit<Possibility, "id">[] | undefined, idGen: IdGen): Possibility[] => (ps ?? []).map((p) => ({ ...p, id: idGen(), source: "example" as const }));

/** The example's own figures are recorded as such, so they are never presented as the user's numbers. */
const exampleSources = (values: Readonly<Record<string, AssumptionValue>>) =>
  Object.fromEntries(Object.entries(values).flatMap(([k, x]) => (x === null ? [] : [[k, "example" as const]])));

/** Build a reality from a template using only the public generic operations. */
export async function buildFromTemplate(t: RealityTemplate, idGen: IdGen = randomRealityId): Promise<Reality> {
  let r = await createReality({ question: t.question, description: t.description, startName: t.startName }, idGen);
  r = await updateRealityText(r, { questions: t.questions });
  for (const v of t.variables) r = await addVariable(r, v, v.start, "example");
  for (const f of t.formulas) r = await addFormula(r, f);
  for (const s of t.simulations ?? []) r = await addSimulation(r, s);
  const root = r.branches[0]!;
  r = await updateBranch(r, root.id, { possibilities: withIds(t.startPossibilities, idGen) });
  const byName = new Map<string, string>([[t.startName, root.id]]);
  for (const b of t.branches) {
    const parentId = byName.get(b.from ?? t.startName);
    if (!parentId) throw new Error(`template "${t.id}": unknown parent "${b.from}"`);
    const f = await forkBranch(r, parentId, { name: b.name, description: b.description }, idGen);
    r = await updateBranch(f.reality, f.branch.id, {
      values: b.values, sources: exampleSources(b.values),
      ...(b.possibilities ? { possibilities: [...f.branch.possibilities, ...withIds(b.possibilities, idGen)] } : {}),
    });
    byName.set(b.name, f.branch.id);
  }
  return r;
}
