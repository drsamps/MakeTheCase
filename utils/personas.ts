export interface PersonaRow {
  persona_id: string;
  persona_name: string;
  description?: string | null;
  instructions?: string;
  is_system_default?: boolean | number;
  created_by?: string | null;
  visibility?: string;
  enabled?: boolean | number;
  sort_order?: number;
}

export interface PersonaAccessContext {
  superuser?: boolean;
  role?: string;
  effectiveInstructorId?: string | null;
}

export function isAllowedPersonasUnrestricted(raw: string | null | undefined): boolean {
  if (raw === null || raw === undefined) return true;
  return raw.trim() === '';
}

export function parseAllowedPersonaIds(raw: string | null | undefined): string[] | null {
  if (isAllowedPersonasUnrestricted(raw)) return null;
  return raw!
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function formatAllowedPersonas(ids: string[] | null): string {
  if (ids === null) return '';
  return ids.join(',');
}

export function resolveAllowedPersonasForForm(
  allowedPersonas: string | null | undefined,
  enabledPersonas: Array<{ persona_id: string }>
): { allowAll: boolean; selectedIds: string[] } {
  const parsed = parseAllowedPersonaIds(allowedPersonas);
  if (parsed === null) {
    return { allowAll: true, selectedIds: enabledPersonas.map((p) => p.persona_id) };
  }
  return { allowAll: false, selectedIds: parsed };
}

export function personaApiErrorMessage(code?: string, message?: string): string {
  if (code === 'SYSTEM_DEFAULT_READONLY' || message === 'system_readonly') {
    return 'Built-in personas are read-only. Use Clone to create your own editable copy.';
  }
  if (message === 'not_owner') {
    return 'You can only edit personas you own or that your team shared with edit access.';
  }
  return message || 'Request failed';
}

export function isSystemPersona(p: PersonaRow): boolean {
  return p.is_system_default === 1 || p.is_system_default === true;
}

export function canEditPersona(p: PersonaRow, ctx: PersonaAccessContext): boolean {
  if (isSystemPersona(p)) return Boolean(ctx.superuser);
  if (ctx.role === 'admin' && !ctx.effectiveInstructorId) return true;
  if (ctx.effectiveInstructorId && p.created_by === ctx.effectiveInstructorId) return true;
  return false;
}

export function canDeletePersona(p: PersonaRow, ctx: PersonaAccessContext): boolean {
  if (isSystemPersona(p)) return false;
  return canEditPersona(p, ctx);
}

export function canTogglePersonaEnabled(p: PersonaRow, ctx: PersonaAccessContext): boolean {
  return canEditPersona(p, ctx);
}

export function sortPersonasList<T extends PersonaRow>(personas: T[]): T[] {
  return [...personas].sort((a, b) => {
    const aSys = isSystemPersona(a) ? 1 : 0;
    const bSys = isSystemPersona(b) ? 1 : 0;
    if (aSys !== bSys) return bSys - aSys;
    const aOrder = a.sort_order ?? 0;
    const bOrder = b.sort_order ?? 0;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return a.persona_id.localeCompare(b.persona_id);
  });
}

export function visibilityLabel(visibility?: string): string {
  if (visibility === 'public') return 'Public';
  if (visibility === 'team') return 'Team';
  return 'Private';
}

export function ownerLabel(p: PersonaRow, ctx: PersonaAccessContext): string {
  if (isSystemPersona(p)) return 'Platform';
  if (ctx.effectiveInstructorId && p.created_by === ctx.effectiveInstructorId) return 'You';
  if (p.created_by) return 'Instructor';
  return '—';
}

export function personasForDefaultDropdown(
  enabledPersonas: PersonaRow[],
  allowedPersonasRaw: string | null | undefined
): PersonaRow[] {
  const { allowAll, selectedIds } = resolveAllowedPersonasForForm(allowedPersonasRaw, enabledPersonas);
  if (allowAll) return enabledPersonas;
  return enabledPersonas.filter((p) => selectedIds.includes(p.persona_id));
}
