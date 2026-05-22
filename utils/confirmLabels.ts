const FALLBACK = '(unknown)';

function clean(s: string | null | undefined): string {
  return (s ?? '').trim();
}

export function quote(s: string | null | undefined, max = 60): string {
  const text = clean(s) || FALLBACK;
  const truncated = text.length > max ? `${text.slice(0, max)}…` : text;
  return `"${truncated}"`;
}

export function personLabel(opts: {
  name?: string | null;
  email?: string | null;
}): string {
  const name = clean(opts.name);
  const email = clean(opts.email);
  if (name && email) return `${quote(name)} (${email})`;
  if (name) return quote(name);
  if (email) return quote(email);
  return quote(null);
}

export function caseLabel(
  title?: string | null,
  caseId?: string | null
): string {
  const t = clean(title);
  if (t) return quote(t);
  const id = clean(caseId);
  return quote(id || '(untitled case)');
}
