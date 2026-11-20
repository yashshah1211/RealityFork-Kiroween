/** The ledger describes one fictional season. Qualitative constraints are authored, never estimated. */
export const dimensions = {
  shop: "Stewardship", location: "Home of the books", debt: "Debt pressure", access: "Reading access",
  work: "Mara’s time", village: "Village commitments",
} as const;
export type Dimension = keyof typeof dimensions;
export type StoryState = Readonly<Record<Dimension, string>>;
export const opening: StoryState = {
  shop: "Mara holds the keys", location: "Bookshop", debt: "Payment due", access: "Daily browsing",
  work: "Full shop days", village: "No shared duties",
};

export const dilemmas = {
  start: {
    title: "Who will hold the keys?",
    scene: "At closing time, Mara sets the last bookshop’s ledger on the desk. A payment is due. Across the street, children are waiting for tomorrow’s reading hour.",
    constraint: "A buyer will cover the immediate debt. Mara can keep trading on credit. The village hall can host books or help run the shop.",
  },
  sell: {
    title: "Where will the books go?",
    scene: "Mara has handed over the keys. Beside the well sit two crates of books she kept from the sale.",
    constraint: "The hall offers one room on market day. The school has a permanent shelf, but only pupils can use it.",
  },
  keep: {
    title: "Which hours can Mara spare?",
    scene: "The sign still says open. Mara brings the week’s timetable to the well, looking for a way to keep her promise to readers.",
    constraint: "Evening lessons have paying students. Shorter opening hours would save on fuel. Mara can adopt one timetable this season.",
  },
  share: {
    title: "Who takes the next shift?",
    scene: "Three neighbours meet Mara at the well. They have agreed to share the keys. Now someone must put their name beside each shift.",
    constraint: "Some households can pledge dues. Others can offer time. The first charter can rely on one kind of contribution.",
  },
} as const;

interface Rule {
  from: keyof typeof dilemmas;
  label: string;
  cost: string;
  title: string;
  cause: string;
  change: Partial<StoryState>;
  unknown: string;
}
export const rules = {
  sell: {
    from: "start", label: "Sell the bookshop", cost: "Pay the overdue bill and give up the premises.",
    title: "The keys change hands",
    cause: "The buyer covers the overdue bill in exchange for the building. Mara keeps two crates, so the collection now needs a home.",
    change: { shop: "Sold to the buyer", location: "Awaiting a home", debt: "Overdue bill paid", access: "Books in crates", work: "Shop hours released" },
    unknown: "The buyer has made no promise about the future use of the building.",
  },
  keep: {
    from: "start", label: "Keep the shop open", cost: "Protect daily browsing and carry the outstanding bill.",
    title: "Tomorrow’s reading hour stays",
    cause: "The supplier extends credit for the season. Mara keeps the shop and its hours, with the payment deferred.",
    change: { debt: "Payment deferred", work: "Shop days and accounts" },
    unknown: "Next season’s credit terms are still unwritten.",
  },
  share: {
    from: "start", label: "Share the keys with the community", cost: "Invite village support and give neighbours a vote.",
    title: "A charter lies on the counter",
    cause: "Mara gives the neighbours a say in the shop. Their agreement keeps the shelves open while they organise support.",
    change: { shop: "Village stewardship", village: "Founding circle", work: "Convening the circle" },
    unknown: "The founding circle has only committed for this season.",
  },
  hall: {
    from: "sell", label: "Open a market-day library", cost: "Welcome all readers for one day each week.",
    title: "A library for market day",
    cause: "The hall lends a room on market day. Stewards unpack the crates each week, so any visitor can borrow during that shift.",
    change: { location: "Village hall", access: "Weekly public lending", village: "Hall stewards unpack each week" },
    unknown: "The hall has yet to decide how winter markets will run.",
  },
  school: {
    from: "sell", label: "Give the crates to the school", cost: "Give pupils daily access and leave other readers without a shelf.",
    title: "Two crates in the schoolroom",
    cause: "The teacher takes custody of the books. Pupils can read each school day, and Mara can step away from lending.",
    change: { location: "Schoolroom", access: "Pupils on school days", village: "Teacher tends the shelf", work: "No lending shifts" },
    unknown: "Whether the school can later admit other readers is open.",
  },
  lessons: {
    from: "keep", label: "Teach evening classes", cost: "Use fees for repayments and give up free evenings.",
    title: "Lamplight after closing",
    cause: "Enrolled learners pay for evening lessons. Their fees start repaying the bill while ordinary browsing continues by day.",
    change: { debt: "Repayments begun", work: "Days and teaching evenings", village: "Paying learners" },
    unknown: "The learners have enrolled for one term.",
  },
  hours: {
    from: "keep", label: "Open on fewer days", cost: "Save fuel and keep evenings free, with fewer chances to browse.",
    title: "A shorter week on the door",
    cause: "Mara heats the shop on fewer days. The fuel saving slows new costs, but the old bill still stands.",
    change: { debt: "Costs eased, bill outstanding", access: "Shortened public week", work: "Part-week shop days" },
    unknown: "Which readers can adapt to the shorter week is unknown.",
  },
  dues: {
    from: "share", label: "Collect members’ dues", cost: "Fund repayments and reserve borrowing for members.",
    title: "The members’ lending ledger",
    cause: "Households pledge dues in return for borrowing rights. The treasurer can begin repayments, while non-members can still browse.",
    change: { debt: "Repayments begun", access: "Public browsing, member loans", village: "Household pledges" },
    unknown: "The charter does not guarantee that every household can afford dues.",
  },
  rota: {
    from: "share", label: "Draw up a volunteer rota", cost: "Keep borrowing open and carry the unpaid bill.",
    title: "Many hands at the counter",
    cause: "Neighbours cover the counter in shifts. Mara gains time and everyone can borrow, but donated hours bring in no repayment.",
    change: { access: "Open village lending", village: "Volunteer shifts", work: "Time freed by volunteers", debt: "Bill carried forward" },
    unknown: "Coverage after this first rota has yet to be agreed.",
  },
} as const satisfies Record<string, Rule>;
export type Choice = keyof typeof rules;
export type Approach = Exclude<keyof typeof dilemmas, "start">;
export function isApproach(id: Choice | null): id is Approach {
  return id === "sell" || id === "keep" || id === "share";
}
