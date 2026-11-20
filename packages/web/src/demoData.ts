// Front-desk synthetic log (constant 16 arrivals/h, 6-minute mean service). The older clinic
// fixture (data/synthetic/clinic-arrivals-SYNTHETIC.csv) is kept unchanged for core tests.
import csv from "../../../data/synthetic/frontdesk-arrivals-SYNTHETIC.csv?raw";
import cardJson from "../../../data/synthetic/frontdesk-arrivals-SYNTHETIC.card.json";
import type { DatasetCard } from "@realityfork/core";

export const DEMO_CSV: string = csv;
export const DEMO_CARD = cardJson as DatasetCard;
