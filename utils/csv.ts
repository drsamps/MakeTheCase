/**
 * CSV building and download, shared by the dashboard's export buttons.
 *
 * Written because the hand-rolled builders it replaces interpolated values
 * straight into `"${value}"` templates, which silently corrupted two kinds of
 * row: a `"` inside a student name ended the field early, and a date rendered
 * with `toLocaleString()` ("9/19/2026, 6:04:10 PM") carried a comma that shifted
 * every column to its right by one. Quote and escape every cell instead of
 * guessing which ones need it.
 */

import { saveBlob } from '../components/caseWriter/download';

/**
 * One RFC-4180 field: always quoted, embedded quotes doubled.
 *
 * Newlines are folded to " | " rather than kept inside the quoted field.
 * They are legal in RFC 4180, but the values that carry them here are free-text
 * survey answers (`liked` / `improve`), and a multi-line cell makes the file
 * unreadable in a spreadsheet and unusable with line-oriented tools.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  const text = String(value).replace(/\r?\n/g, ' | ').replace(/"/g, '""');
  return `"${text}"`;
}

/** A header row plus data rows, as one CSV string. CRLF per RFC 4180. */
export function buildCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvCell).join(',')];
  rows.forEach(row => lines.push(row.map(csvCell).join(',')));
  return lines.join('\r\n');
}

/**
 * `YYYY-MM-DD HH:mm` in local time, for a CSV timestamp cell.
 *
 * Deliberately not `toLocaleString()`: that emits a comma in en-US, and it
 * sorts lexicographically wrong in a spreadsheet.
 */
export function csvDateTime(value: string | Date | null | undefined): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Hand a CSV string to the browser as a file save.
 *
 * The leading U+FEFF is what makes Excel read the file as UTF-8; without it
 * Excel falls back to the system codepage and mangles accented names.
 */
export function saveCsv(csv: string, filename: string): void {
  saveBlob(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }), filename);
}
