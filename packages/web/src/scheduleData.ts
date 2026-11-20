// SYNTHETIC daily arrival log with a lunchtime peak (10 days, fixed UTC−05:00). Used to estimate the
// scheduling example's demand per 2-hour block in the browser, with full provenance.
import csv from "../../../data/synthetic/frontdesk-daily-SYNTHETIC.csv?raw";
import cardJson from "../../../data/synthetic/frontdesk-daily-SYNTHETIC.card.json";

export const SCHEDULE_CSV: string = csv;
export const SCHEDULE_CARD = cardJson as {
  readonly fileName: string;
  readonly synthetic: boolean;
  readonly observationWindow: { readonly start: string; readonly end: string };
  readonly generatorParameters: { readonly utcOffsetMinutes: number };
};
