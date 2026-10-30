/**
 * The activity types the dashboard knows about: the built-ins at once (utils/activityTypes.js),
 * then every published type from GET /api/activity-types (types defined as data, StudyChat
 * Phase 2). Labels, the case form's type picker and the persona-kind checks read this, never a
 * type key: a custom type can offer audiences or protagonists like either built-in.
 *
 * Staff only. The student page reads its activity's traits from the student view instead
 * (services/activityCopy.ts).
 */

import { useEffect, useState } from 'react';
import { ACTIVITY_TYPES, DEFAULT_ACTIVITY_TYPE } from '../utils/activityTypes.js';
import { api } from './apiClient';

export interface ActivityTypeInfo {
  id: string;
  label: string;
  summary: string;
  personaKind: 'protagonist' | 'audience';
  characterFrom: 'scenario' | 'persona';
  usesPositions: boolean;
  /** The greeting uses openings saved per audience in the scenario editor (Teach-back). */
  savedOpenings: boolean;
  /** Published and enabled: cases can be set to it and chats can start. */
  enabled: boolean;
  tier: 'builtin' | 'system' | 'custom';
  /** False for a type this server does not have (a case left on a deleted or unpublished type). */
  known: boolean;
}

const fromBuiltin = (t: (typeof ACTIVITY_TYPES)[keyof typeof ACTIVITY_TYPES]): ActivityTypeInfo => ({
  id: t.id,
  label: t.label,
  summary: t.summary,
  personaKind: t.personaKind as ActivityTypeInfo['personaKind'],
  characterFrom: t.characterFrom as ActivityTypeInfo['characterFrom'],
  usesPositions: t.usesPositions,
  savedOpenings: t.personaKind === 'audience',
  enabled: true,
  tier: 'builtin',
  known: true,
});

let types = new Map<string, ActivityTypeInfo>(Object.values(ACTIVITY_TYPES).map((t) => [t.id, fromBuiltin(t)]));
let loading: Promise<void> | null = null;
let revision = 0;
const listeners = new Set<(rev: number) => void>();

interface ServerType {
  key: string; label: string; summary: string; tier: ActivityTypeInfo['tier']; enabled: boolean;
  traits: { character: ActivityTypeInfo['characterFrom']; persona_kind: ActivityTypeInfo['personaKind']; positions: string };
  saved_openings: boolean;
}

/** Fetch the published types (once; `force` to refresh after an admin change). */
export function loadActivityTypeList(force = false): Promise<void> {
  if (loading && !force) return loading;
  loading = api.get<ServerType[]>('/activity-types').then(({ data }) => {
    if (!data) return;
    const next = new Map(types);
    for (const t of data) {
      next.set(t.key, {
        id: t.key,
        label: t.label,
        summary: t.summary,
        personaKind: t.traits.persona_kind,
        characterFrom: t.traits.character,
        usesPositions: t.traits.positions !== 'off',
        savedOpenings: Boolean(t.saved_openings),
        enabled: Boolean(t.enabled),
        tier: t.tier,
        known: true,
      });
    }
    types = next;
    revision++;
    listeners.forEach((fn) => fn(revision));
  }).catch(() => { loading = null; });
  return loading;
}

/** What the dashboard knows about a type. A missing type is case chat; an unknown one says so. */
export function activityTypeInfo(key?: string | null): ActivityTypeInfo {
  const id = key || DEFAULT_ACTIVITY_TYPE;
  return types.get(id) ?? {
    id, label: 'Unknown type', summary: 'This server has no published activity type with this key', personaKind: 'protagonist',
    characterFrom: 'scenario', usesPositions: true, savedOpenings: false, enabled: false, tier: 'custom', known: false,
  };
}

/** Types a case can be set to (published and enabled), built-ins first. */
export const usableActivityTypes = (): ActivityTypeInfo[] =>
  [...types.values()].filter((t) => t.enabled).sort((a, b) => Number(b.tier === 'builtin') - Number(a.tier === 'builtin'));

/** True when the type offers audience personas (`audience-*`) rather than protagonist personalities. */
export const usesAudiencePersonas = (key?: string | null): boolean => activityTypeInfo(key).personaKind === 'audience';

/** Load the list on mount and re-render when it arrives or changes. */
export function useActivityTypeList(): number {
  const [rev, setRev] = useState(revision);
  useEffect(() => {
    listeners.add(setRev);
    loadActivityTypeList();
    return () => { listeners.delete(setRev); };
  }, []);
  return rev;
}
