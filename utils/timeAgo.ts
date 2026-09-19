/**
 * Compact elapsed time since `start`, e.g. "3d 2h 34m", "2h 5m", "4m", "<1m".
 * Leading zero units are dropped; inner ones are kept ("1d 0h 5m") so columns read alike.
 * Returns '-' for a missing or unparseable start time.
 */
export function formatAgo(start: string | Date | null | undefined, now: number = Date.now()): string {
  if (!start) return '-';
  const t = new Date(start).getTime();
  if (Number.isNaN(t)) return '-';
  const totalMins = Math.floor(Math.max(0, now - t) / 60000);
  if (totalMins < 1) return '<1m';
  const days = Math.floor(totalMins / 1440);
  const hours = Math.floor((totalMins % 1440) / 60);
  const mins = totalMins % 60;
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}
