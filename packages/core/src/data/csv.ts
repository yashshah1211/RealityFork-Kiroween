/**
 * Minimal RFC 4180 CSV parser: comma separator, double-quoted fields, "" escapes,
 * CRLF/LF line endings, optional UTF-8 BOM. Returns raw strings; no type coercion.
 */
export interface ParsedCsv {
  readonly header: readonly string[];
  /** Data rows (header excluded). Row i corresponds to file line number lineNumbers[i]. */
  readonly rows: readonly (readonly string[])[];
  readonly lineNumbers: readonly number[];
}

export class CsvError extends Error {
  constructor(message: string, readonly line: number) {
    super(`CSV line ${line}: ${message}`);
    this.name = "CsvError";
  }
}

export function parseCsv(text: string): ParsedCsv {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: string[][] = [];
  const starts: number[] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  let fieldStarted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else {
        if (ch === "\n") line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      if (fieldStarted && field.length > 0) throw new CsvError("quote inside an unquoted field", line);
      inQuotes = true;
      fieldStarted = true;
    } else if (ch === ",") {
      record.push(field);
      field = "";
      fieldStarted = false;
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      record.push(field);
      records.push(record);
      starts.push(recordLine);
      record = [];
      field = "";
      fieldStarted = false;
      line++;
      recordLine = line;
    } else {
      field += ch;
      fieldStarted = true;
    }
  }
  if (inQuotes) throw new CsvError("unterminated quoted field", recordLine);
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
    starts.push(recordLine);
  }
  if (records.length === 0) throw new CsvError("file is empty", 1);
  const header = records[0]!.map((h) => h.trim());
  if (header.every((h) => h === "")) throw new CsvError("header row is empty", 1);
  const dup = header.find((h, i) => h !== "" && header.indexOf(h) !== i);
  if (dup !== undefined) throw new CsvError(`duplicate column name "${dup}"`, 1);
  return { header, rows: records.slice(1), lineNumbers: starts.slice(1) };
}
