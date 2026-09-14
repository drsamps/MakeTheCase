/**
 * Writes to a section's case SETTINGS (chat options, rubric, scenarios, positions, selection mode).
 *
 * A section's case can follow a course case version ("Main" or a semester copy); the server then
 * refuses direct edits with 409 CASE_FOLLOWS_VERSION, because the next edit to the version would
 * overwrite them. This wrapper turns that into a confirmation and, if the instructor agrees,
 * retries with ?detach=1 -- the section becomes "Customized" and keeps its current settings.
 *
 * Use it for every section-level settings write. Scheduling and activate/deactivate are not guarded.
 */
export async function fetchSectionCaseSetting(url: string, init: RequestInit): Promise<Response> {
  const response = await fetch(url, init);
  if (response.status !== 409) return response;

  const body = await response.clone().json().catch(() => null);
  if (body?.error?.code !== 'CASE_FOLLOWS_VERSION') return response;

  const label = body.error.version_label || 'course';
  const ok = window.confirm(
    `This section follows the course's "${label}" settings for this case.\n\n` +
    `Customize this section? It keeps its current settings, applies your change, and stops ` +
    `following "${label}". (To change every section that follows "${label}", edit it on Courses → Courses instead.)`
  );
  if (!ok) return response;

  const separator = url.includes('?') ? '&' : '?';
  return fetch(`${url}${separator}detach=1`, init);
}
