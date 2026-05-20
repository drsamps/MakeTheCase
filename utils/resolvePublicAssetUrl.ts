/**
 * Prefix root-relative public asset paths with Vite BASE_URL (e.g. /makethecase/ in production).
 */
export function resolvePublicAssetUrl(src: string | undefined): string | undefined {
  if (!src) return src;
  if (/^(https?:|data:|mailto:|#)/i.test(src)) return src;

  const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '') || '';
  if (src.startsWith('/')) {
    if (base && base !== '/' && src.startsWith(`${base}/`)) return src;
    return base && base !== '/' ? `${base}${src}` : src;
  }
  return `${base}/${src}`.replace(/\/+/g, '/').replace(':/', '://');
}
