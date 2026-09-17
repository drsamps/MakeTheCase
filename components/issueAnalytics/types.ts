// Shapes returned by /api/issue-analytics (server/services/issueAnalytics/view.js).

export type ThemeType = 'topic' | 'argument' | 'friction';
export type RunStatus = 'running' | 'clustering' | 'completed' | 'stopped' | 'interrupted' | 'failed';
export type RescanStatus = 'none' | 'pending' | 'running' | 'done' | 'failed';

export interface RunSummary {
  id: number;
  case_id: string;
  case_title: string;
  scenario_id: number | null;
  scenario_name: string | null;
  section_ids: string[];
  semester_id: number | null;
  semester_label: string | null;
  status: RunStatus;
  stop_reason: string | null;
  stale_reason: 'transcript_changed' | 'chat_removed' | null;
  model_id: string;
  theme_target_min: number;
  theme_target_max: number;
  chats_completed_in_scope: number;
  chats_total: number;
  chats_done: number;
  chats_skipped: number;
  chats_failed: number;
  est_cost_usd: number | null;
  billed_instructor_id: string | null;
  billed_instructor_name?: string | null;
  theme_count: number;
  theme_note: string | null;
  created_by_user_id: string | null;
  created_at: string;
  completed_at: string | null;
  active_here?: boolean;
}

export interface Estimate {
  case_id: string;
  scenario_id: number | null;
  section_ids: string[];
  chats_completed: number;
  chats_total: number;
  chats_cached: number;
  chats_skipped: number;
  chats_to_process: number;
  est_cost_usd: number | null;
  model_id: string;
  model_name: string;
  model_priced: boolean;
  billed_instructor_id: string | null;
  billed_instructor_name: string | null;
  cap_active: boolean;
  cap_usd: number | null;
  cap_used_usd: number | null;
  cap_remaining_usd: number | null;
  exceeds_cap: boolean;
  skip_reasons: Record<string, number>;
}

export interface Quote {
  mention_id: number;
  case_chat_id: string;
  student: string;
  section_id: string | null;
  lean: string | null;
  gist: string | null;
  quote: string;
  quote_start: number | null;
  quote_end: number | null;
}

export interface ThemeView {
  id: number;
  label: string;
  description: string | null;
  theme_type: ThemeType;
  origin: 'ai' | 'instructor';
  selected: boolean;
  sort_order: number;
  rescan_status: RescanStatus;
  rescan_done: number;
  rescan_error: string | null;
  students: number;
  prevalence_pct: number | null;
  lean: Record<string, number>;
  no_lean: number;
  quotes: Quote[];
}

export interface LeanAxis {
  mode: 'positions' | 'fallback';
  leans: { key: string; label: string; detail: string | null }[];
}

export interface RunView {
  run: RunSummary;
  axis: LeanAxis;
  themes: ThemeView[];
  skipped: { state: 'skipped' | 'failed'; reason: string | null; count: number }[];
  names: boolean;
}

export interface RunStatusPoll {
  id: number;
  status: RunStatus;
  stop_reason: string | null;
  chats_total: number;
  chats_done: number;
  chats_skipped: number;
  chats_failed: number;
  rescans: { id: number; rescan_status: RescanStatus; rescan_done: number; rescan_error: string | null }[];
}

export const TYPE_META: Record<ThemeType, { label: string; hint: string; badge: string }> = {
  topic: {
    label: 'Topics',
    hint: 'Raised by students on their own initiative',
    badge: 'bg-sky-100 text-sky-800',
  },
  argument: {
    label: 'Arguments',
    hint: 'Reasoning students gave for or against a course of action',
    badge: 'bg-emerald-100 text-emerald-800',
  },
  friction: {
    label: 'Friction',
    hint: 'Where students got stuck, pushed back, or were confused',
    badge: 'bg-amber-100 text-amber-800',
  },
};

export const ACTIVE_STATUSES: RunStatus[] = ['running', 'clustering'];

// Lean colours: fixed order, readable in both the dashboard and print.
export const LEAN_COLORS = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#0891b2', '#dc2626', '#65a30d', '#db2777'];
export const NO_LEAN_COLOR = '#d1d5db';

/** "19 students · 41% of 47 analyzed (of 52 completed)" */
export function prevalenceText(theme: ThemeView, run: RunSummary): string {
  const pct = theme.prevalence_pct == null ? '—' : `${Math.round(theme.prevalence_pct)}%`;
  const of = run.chats_completed_in_scope !== run.chats_done ? ` (of ${run.chats_completed_in_scope} completed)` : '';
  return `${theme.students} student${theme.students === 1 ? '' : 's'} · ${pct} of ${run.chats_done} analyzed${of}`;
}

export function money(v: number | null | undefined): string {
  if (v == null) return 'unpriced';
  return v < 0.01 ? `<$0.01` : `$${v.toFixed(2)}`;
}
