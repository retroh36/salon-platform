// CSV for spreadsheets and other systems (payroll, data exports): quoted
// where needed, and safe to open (a cell starting =, +, - or @ that isn't a
// number gets a leading apostrophe, so it isn't run as a formula).

export type Cell = string | number | boolean | null | undefined;

export function csvCell(value: Cell): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  const safe = /^[=+\-@\t\r]/.test(s) && Number.isNaN(Number(s)) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export const csvLine = (cells: readonly Cell[]) => cells.map(csvCell).join(",");

// A header and rows, CRLF line endings, ending with one.
export const csvTable = (header: readonly string[], rows: readonly (readonly Cell[])[]) => [header, ...rows].map(csvLine).join("\r\n") + "\r\n";

export const dollars = (cents: number | null | undefined) => (cents === null || cents === undefined ? "" : (cents / 100).toFixed(2));
