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
  /** Transcripts drawn; null = every usable transcript. */
  sample_size: number | null;
  sample_seed: string | null;
  /** Usable transcripts the sample was drawn from. */
  sample_pool: number | null;
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
  sample_requested: number | null;
  /** Null when every usable transcript is analyzed (no sample asked, or N >= pool). */
  sample_size: number | null;
  sample_seed: string;
  sample_pool: number;
  sample_by_section: Record<string, { drawn: number; usable: number }> | null;
  pool_chats_skipped: number;
  full_chats_to_process: number;
  full_chats_cached: number;
  full_est_cost_usd: number | null;
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

export function isSampled(run: Pick<RunSummary, 'sample_size'>): boolean {
  return run.sample_size != null;
}

/**
 * Approximate 95% margin of error, in percentage points, for a share measured on a sample
 * (worst case p = 0.5, with the finite-population correction). Null for a full run.
 */
export function marginOfError(run: Pick<RunSummary, 'sample_size' | 'sample_pool' | 'chats_done'>): number | null {
  if (run.sample_size == null || !run.sample_pool) return null;
  const n = run.chats_done || run.sample_size;
  const N = run.sample_pool;
  if (n <= 0 || N <= 1 || n >= N) return null;
  return 100 * 1.96 * Math.sqrt(0.25 / n) * Math.sqrt((N - n) / (N - 1));
}

/**
 * Completed chats in scope whose transcript could not be analysed (missing or unparseable),
 * so they were never eligible for the sample. On a full run these are the run's skipped
 * chats; on a sampled run the undrawn chats are deliberately not written to
 * `issue_analysis_run_chats`, so `chats_skipped` is 0 and this is the only way to see them.
 */
export function unusableInScope(run: Pick<RunSummary, 'sample_size' | 'sample_pool' | 'chats_completed_in_scope'>): number {
  if (run.sample_size == null || run.sample_pool == null) return 0;
  return Math.max(0, run.chats_completed_in_scope - run.sample_pool);
}

/** "40 sampled of 144 completed chats · percentages ±13 points" */
export function coverageText(run: RunSummary): string {
  if (!isSampled(run)) return `${run.chats_done} of ${run.chats_completed_in_scope} completed chats analyzed`;
  const moe = marginOfError(run);
  return `${run.chats_done} sampled of ${run.chats_completed_in_scope} completed chats analyzed`
    + (moe != null ? ` · percentages ±${Math.round(moe)} points` : '');
}

/** "19 students · 41% of 47 analyzed (of 52 completed)"; "… of 40 sampled …" on a sampled run. */
export function prevalenceText(theme: ThemeView, run: RunSummary): string {
  const pct = theme.prevalence_pct == null ? '—' : `${Math.round(theme.prevalence_pct)}%`;
  const of = run.chats_completed_in_scope !== run.chats_done ? ` (of ${run.chats_completed_in_scope} completed)` : '';
  const verb = isSampled(run) ? 'sampled' : 'analyzed';
  return `${theme.students} student${theme.students === 1 ? '' : 's'} · ${pct} of ${run.chats_done} ${verb}${of}`;
}

export function money(v: number | null | undefined): string {
  if (v == null) return 'unpriced';
  return v < 0.01 ? `<$0.01` : `$${v.toFixed(2)}`;
}
