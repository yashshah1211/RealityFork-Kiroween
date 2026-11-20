/**
 * Strict ISO 8601 timestamp parsing to absolute instants.
 *
 * Accepted: YYYY-MM-DDTHH:MM[:SS[.fraction]] followed by Z, ±HH:MM or ±HHMM (a space may
 * replace "T"). A timestamp without an offset is rejected unless the caller explicitly
 * supplies an offset to assume. Local time zone names (e.g. "America/New_York") and
 * daylight-saving rules are not interpreted. Leap seconds (:60) are rejected.
 */
export interface TimezonePolicy {
  /** null: every timestamp must carry an explicit offset. Otherwise minutes east of UTC to assume. */
  readonly assumeOffsetMinutes: number | null;
}

export type TimestampResult =
  | { readonly ok: true; readonly ms: number; readonly assumedOffset: boolean; readonly offsetMinutes: number }
  | { readonly ok: false; readonly code: "malformed" | "missing-timezone" | "out-of-range"; readonly message: string };

const RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d{1,9})?)?\s*(Z|z|[+-]\d{2}:?\d{2})?$/;

export function parseTimestamp(raw: string, policy: TimezonePolicy): TimestampResult {
  const s = raw.trim();
  const m = RE.exec(s);
  if (!m) return { ok: false, code: "malformed", message: `"${raw}" is not an ISO 8601 date-time (expected e.g. 2026-03-02T08:15:00Z)` };
  const [, y, mo, d, hh, mi, ss, frac, off] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(hh);
  const minute = Number(mi);
  const second = ss === undefined ? 0 : Number(ss);
  const millis = frac === undefined ? 0 : Math.round(Number(`0${frac}`) * 1000);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) {
    return { ok: false, code: "out-of-range", message: `"${raw}" has an out-of-range field` };
  }
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCDate() !== day || probe.getUTCMonth() !== month - 1) {
    return { ok: false, code: "out-of-range", message: `"${raw}" is not a real calendar date` };
  }
  let offsetMinutes: number;
  let assumedOffset = false;
  if (off === undefined) {
    if (policy.assumeOffsetMinutes === null) {
      return { ok: false, code: "missing-timezone", message: `"${raw}" has no time zone offset; add one (e.g. Z or -05:00) or choose an offset to assume` };
    }
    offsetMinutes = policy.assumeOffsetMinutes;
    assumedOffset = true;
  } else if (off === "Z" || off === "z") {
    offsetMinutes = 0;
  } else {
    const sign = off[0] === "-" ? -1 : 1;
    const digits = off.slice(1).replace(":", "");
    const oh = Number(digits.slice(0, 2));
    const om = Number(digits.slice(2));
    if (oh > 14 || om > 59) return { ok: false, code: "out-of-range", message: `"${raw}" has an invalid offset` };
    offsetMinutes = sign * (oh * 60 + om);
  }
  const ms = Date.UTC(year, month - 1, day, hour, minute, second, millis) - offsetMinutes * 60_000;
  return { ok: true, ms, assumedOffset, offsetMinutes };
}

/** Format an instant as local wall-clock time at a fixed UTC offset, e.g. 2026-03-02T08:15:00.000-05:00. */
export function formatWithOffset(ms: number, offsetMinutes: number): string {
  const local = new Date(ms + offsetMinutes * 60_000).toISOString().slice(0, 23);
  const sign = offsetMinutes < 0 ? "-" : "+";
  const a = Math.abs(offsetMinutes);
  return `${local}${sign}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
}

export function formatUtc(ms: number): string {
  return new Date(ms).toISOString();
}
