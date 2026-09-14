/**
 * Date inputs for DATETIME columns (section_cases.open_date / close_date).
 *
 * The dashboard sends ISO strings ('2026-09-14T15:00:00.000Z'). MySQL 8 in strict mode refuses
 * those for DATETIME ("Incorrect datetime value"), so they must not be passed through as
 * strings. A JS Date is serialised by mysql2 in the server's local time zone and read back the
 * same way, so the instant round-trips.
 */

/**
 * null / '' / undefined -> null; a parseable date string, number or Date -> Date.
 * Throws Error('Invalid date: …') for anything else.
 */
export function parseDateInput(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${String(value)}`);
  }
  return date;
}

/** Date + minutes, preserving null. */
export function addMinutes(date, minutes) {
  if (!date) return null;
  return new Date(date.getTime() + Number(minutes || 0) * 60_000);
}
