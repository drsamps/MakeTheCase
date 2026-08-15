/**
 * Browser download helpers shared by the Case Writer export pane and the
 * source-material detail screen.
 */

/** Hand a Blob to the browser as a file save. */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Save a string as a UTF-8 text/markdown file. */
export function saveText(text: string, filename: string) {
  saveBlob(new Blob([text], { type: 'text/markdown;charset=utf-8' }), filename);
}

/**
 * Turn a reference title into a safe file basename. Mirrors the intent of
 * `sanitizeForFilename()` in server/routes/caseWriter.js.
 */
export function filenameSlug(s: string | null | undefined, fallback = 'reference'): string {
  const cleaned = String(s || '')
    .replace(/[\\/:*?"<>|]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80);
  return cleaned || fallback;
}
