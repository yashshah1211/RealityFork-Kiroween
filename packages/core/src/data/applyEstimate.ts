/**
 * Turn an import report into a new fork. The user may accept each estimate or override it.
 * Full provenance goes into spec.dataProvenance, so it is part of the scenario fingerprint.
 */
import { fork, type IdGenerator, randomId } from "../scenario/scenario";
import { ScenarioError, type DataProvenance, type Scenario } from "../scenario/types";
import type { QueueImportReport } from "./queueInputs";

export interface ApplyEstimateOptions {
  readonly name: string;
  readonly id?: string;
  /** Undefined = use the estimate. A number = user override. */
  readonly arrivalRateOverride?: number;
  readonly serviceRateOverride?: number;
}

export function buildProvenance(report: QueueImportReport, applied: { arrival: number; service: number | null }, overrides: { arrival: boolean; service: boolean }): DataProvenance {
  if (!report.ok || !report.arrivalRate || !report.window) throw new ScenarioError("cannot build provenance from a failed import");
  const warnings = report.issues.filter((i) => i.severity === "warning");
  const p: Record<string, string | number | boolean> = {
    kind: "observation-log",
    estimator: report.estimator,
    fileName: report.file.name,
    sha256: report.file.sha256,
    synthetic: report.file.synthetic,
    dataRows: report.file.dataRows,
    windowStartUtc: report.window.startUtc,
    windowEndUtc: report.window.endUtc,
    windowHours: report.window.hours,
    arrivalColumn: report.options.mapping.arrivalTime,
    serviceColumn: report.options.mapping.serviceDuration ?? "",
    serviceDurationUnit: report.options.serviceDurationUnit,
    timezonePolicy: report.options.timezone,
    duplicateRows: report.options.duplicateRows,
    confidence: report.options.confidence,
    arrivalsInWindow: report.counts.arrivalsInWindow,
    serviceSamples: report.counts.serviceSamples,
    estimatedArrivalRatePerHour: report.arrivalRate.perHour,
    estimatedArrivalRateCiLow: report.arrivalRate.ciLow,
    estimatedArrivalRateCiHigh: report.arrivalRate.ciHigh,
    appliedArrivalRatePerHour: applied.arrival,
    arrivalRateOverridden: overrides.arrival,
    serviceRateOverridden: overrides.service,
    warningCount: warnings.length,
    warnings: warnings.map((w) => w.code).join(";"),
  };
  if (report.service) {
    p.estimatedMeanServiceHours = report.service.meanHours;
    p.estimatedServiceRatePerHour = report.service.ratePerHour;
    p.estimatedServiceRateCiLow = report.service.rateCiLow;
    p.estimatedServiceRateCiHigh = Number.isFinite(report.service.rateCiHigh) ? report.service.rateCiHigh : -1;
  }
  if (applied.service !== null) p.appliedServiceRatePerHour = applied.service;
  const f = report.fit;
  if (f.interarrivalCv) p.interarrivalCvStatus = f.interarrivalCv.status;
  if (f.serviceCv) p.serviceCvStatus = f.serviceCv.status;
  if (f.dispersion) p.dispersionStatus = f.dispersion.status;
  if (f.rateDrift) p.rateDriftStatus = f.rateDrift.status;
  return p;
}

export async function forkFromEstimate(parent: Scenario, report: QueueImportReport, options: ApplyEstimateOptions, idGenerator: IdGenerator = randomId): Promise<Scenario> {
  if (!report.ok || !report.arrivalRate) throw new ScenarioError("the import has errors; fix them before applying estimates", report.issues.filter((i) => i.severity === "error").map((i) => i.message));
  if (!("arrivalRatePerHour" in parent.spec.params) || !("serviceRatePerHour" in parent.spec.params)) {
    throw new ScenarioError(`model ${parent.spec.modelId} has no arrival/service rate parameters`);
  }
  const check = (v: number | undefined, what: string) => {
    if (v !== undefined && !(Number.isFinite(v) && v > 0)) throw new ScenarioError(`${what} override must be a positive number`);
  };
  check(options.arrivalRateOverride, "arrival rate");
  check(options.serviceRateOverride, "service rate");
  const arrival = options.arrivalRateOverride ?? report.arrivalRate.perHour;
  const service = report.service ? (options.serviceRateOverride ?? report.service.ratePerHour) : (options.serviceRateOverride ?? null);
  const params: Record<string, number> = { arrivalRatePerHour: arrival };
  if (service !== null) params.serviceRatePerHour = service;
  const dataProvenance = buildProvenance(report, { arrival, service }, {
    arrival: options.arrivalRateOverride !== undefined,
    service: options.serviceRateOverride !== undefined,
  });
  return fork(parent, { name: options.name, ...(options.id ? { id: options.id } : {}), params, dataProvenance }, idGenerator);
}
