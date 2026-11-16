import type { ColumnDataType } from '@prisma/client';
import { parse } from 'csv-parse/sync';

export const CSV_LIMITS = { minRows: 10, maxRows: 200_000, minColumns: 2, maxColumns: 300, maxHeaderLength: 200, maxCellLength: 10_000 };

/** Same tokens pandas treats as missing, so Node-side and ML-side profiles agree. */
const MISSING = new Set(['', 'NA', 'N/A', 'NaN', 'nan', 'null', 'NULL', 'None', '#N/A']);
const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
const BOOLEAN_WORDS = new Set(['true', 'false', 'yes', 'no']);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const FORMULA_PREFIX = /^[=+\-@\t\r]/;
const HISTOGRAM_BINS = 10;
const TOP_VALUES = 10;

export interface CsvIssue {
  line?: number;
  column?: string;
  message: string;
}

export class CsvValidationError extends Error {
  constructor(public readonly issues: CsvIssue[]) {
    super(issues[0]?.message ?? 'Invalid CSV file');
    this.name = 'CsvValidationError';
  }
}

export interface CsvColumn {
  name: string;
  position: number;
  dataType: ColumnDataType;
  missingCount: number;
  uniqueCount: number;
  stats: Record<string, unknown>;
}

export interface CsvAnalysis {
  headers: string[];
  rows: string[][];
  rowCount: number;
  columnCount: number;
  missingCellCount: number;
  duplicateRowCount: number;
  columns: CsvColumn[];
  warnings: string[];
}

const round = (v: number, d = 4) => Number(v.toFixed(d));

/** Decodes strict UTF-8 text and rejects binary content disguised as CSV. */
export function decodeCsv(buffer: Buffer): string {
  if (buffer.length === 0) throw new CsvValidationError([{ message: 'The file is empty' }]);
  if (buffer.subarray(0, 8192).includes(0)) throw new CsvValidationError([{ message: 'The file contains binary data; upload a UTF-8 CSV file' }]);
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(buffer);
  } catch {
    throw new CsvValidationError([{ message: 'The file is not valid UTF-8 text' }]);
  }
}

function parseRecords(text: string): string[][] {
  try {
    return parse(text, {
      bom: true,
      skip_empty_lines: true,
      relax_column_count: false,
      trim: true,
      max_record_size: CSV_LIMITS.maxCellLength * CSV_LIMITS.maxColumns,
      to: CSV_LIMITS.maxRows + 2,
    }) as string[][];
  } catch (err) {
    const e = err as { message: string; lines?: number };
    throw new CsvValidationError([{ line: e.lines, message: e.message.replace(/^Invalid Record Length:/, 'Inconsistent number of columns:') }]);
  }
}

function inferType(values: string[], unique: number): ColumnDataType {
  if (values.length === 0) return 'CATEGORICAL';
  if (values.every((v) => NUMBER.test(v))) {
    return unique <= 2 && values.every((v) => Number(v) === 0 || Number(v) === 1) ? 'BOOLEAN' : 'NUMERIC';
  }
  const lowered = new Set(values.map((v) => v.toLowerCase()));
  if (lowered.size <= 2 && [...lowered].every((v) => BOOLEAN_WORDS.has(v))) return 'BOOLEAN';
  const sample = values.slice(0, 200);
  if (sample.filter((v) => ISO_DATE.test(v)).length / sample.length > 0.9) return 'DATETIME';
  const avgLength = values.reduce((n, v) => n + v.length, 0) / values.length;
  if (unique > 50 && (avgLength > 30 || unique === values.length)) return 'TEXT';
  return 'CATEGORICAL';
}

function numericStats(values: string[]) {
  const xs = values.map(Number);
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const x of xs) {
    if (x < min) min = x;
    if (x > max) max = x;
    sum += x;
  }
  const mean = sum / xs.length;
  const std = Math.sqrt(xs.reduce((a, x) => a + (x - mean) ** 2, 0) / Math.max(1, xs.length - 1));
  const width = (max - min) / HISTOGRAM_BINS || 1;
  const histogram = Array.from({ length: HISTOGRAM_BINS }, (_, b) => ({ start: round(min + b * width, 4), end: round(min + (b + 1) * width, 4), count: 0 }));
  for (const x of xs) histogram[Math.min(HISTOGRAM_BINS - 1, Math.floor((x - min) / width))].count++;
  return { min, max, mean: round(mean), std: round(std), histogram };
}

function topValues(values: string[]) {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_VALUES)
    .map(([value, count]) => ({ value, count }));
}

/**
 * Validates CSV text and computes an aggregate per-column profile.
 * Throws CsvValidationError listing every structural problem found.
 */
export function analyzeCsv(text: string): CsvAnalysis {
  const records = parseRecords(text);
  if (records.length === 0) throw new CsvValidationError([{ message: 'The file has no header row' }]);
  const [rawHeaders, ...rows] = records;
  const headers = rawHeaders.map((h) => h.trim());
  const issues: CsvIssue[] = [];

  if (headers.length < CSV_LIMITS.minColumns) issues.push({ line: 1, message: `At least ${CSV_LIMITS.minColumns} columns are required` });
  if (headers.length > CSV_LIMITS.maxColumns) issues.push({ line: 1, message: `At most ${CSV_LIMITS.maxColumns} columns are supported` });
  const seen = new Set<string>();
  headers.forEach((h, i) => {
    if (!h) issues.push({ line: 1, message: `Column ${i + 1} has no header name` });
    else if (h.length > CSV_LIMITS.maxHeaderLength) issues.push({ line: 1, column: h.slice(0, 40), message: 'Header name is too long' });
    else if (seen.has(h)) issues.push({ line: 1, column: h, message: `Duplicate column name "${h}"` });
    seen.add(h);
  });
  if (rows.length < CSV_LIMITS.minRows) issues.push({ message: `At least ${CSV_LIMITS.minRows} data rows are required; found ${rows.length}` });
  if (rows.length > CSV_LIMITS.maxRows) issues.push({ message: `At most ${CSV_LIMITS.maxRows.toLocaleString('en')} data rows are supported` });
  if (issues.length) throw new CsvValidationError(issues);

  const warnings: string[] = [];
  let formulaCells = 0;
  const columns: CsvColumn[] = headers.map((name, position) => {
    const present: string[] = [];
    for (const row of rows) {
      const v = row[position];
      if (!MISSING.has(v)) present.push(v);
    }
    const unique = new Set(present).size;
    const dataType = inferType(present, unique);
    if (dataType !== 'NUMERIC' && dataType !== 'BOOLEAN') formulaCells += present.filter((v) => FORMULA_PREFIX.test(v)).length;
    const stats =
      dataType === 'NUMERIC'
        ? numericStats(present)
        : dataType === 'TEXT'
          ? { sampleSuppressed: true }
          : { topValues: topValues(present) };
    return { name, position, dataType, missingCount: rows.length - present.length, uniqueCount: unique, stats };
  });

  const keys = new Set<string>();
  let duplicateRowCount = 0;
  for (const row of rows) {
    const key = row.join('\u0001');
    if (keys.has(key)) duplicateRowCount++;
    keys.add(key);
  }

  if (formulaCells) warnings.push(`${formulaCells} cell(s) begin with spreadsheet formula characters; they are treated strictly as text.`);
  if (duplicateRowCount) warnings.push(`${duplicateRowCount} duplicate row(s) found.`);
  for (const c of columns) {
    if (c.missingCount / rows.length > 0.3) warnings.push(`Column "${c.name}" is ${Math.round((100 * c.missingCount) / rows.length)}% empty.`);
    if (c.uniqueCount <= 1) warnings.push(`Column "${c.name}" has a single value.`);
  }

  return {
    headers,
    rows,
    rowCount: rows.length,
    columnCount: headers.length,
    missingCellCount: columns.reduce((n, c) => n + c.missingCount, 0),
    duplicateRowCount,
    columns,
    warnings,
  };
}

/** RFC 4180 escaping plus neutralisation of spreadsheet formula injection (numbers are left intact). */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = value instanceof Date ? value.toISOString() : String(value);
  if (FORMULA_PREFIX.test(s) && !NUMBER.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
