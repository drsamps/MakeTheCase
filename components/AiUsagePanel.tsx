/**
 * AiUsagePanel
 *
 * Cost-first dashboard for AI spend, served from /api/usage. Replaces the
 * token-count view of CacheMetrics with a dollar-centric layout: weekly cap
 * bar at top, then totals + by-purpose / by-model / by-section / daily
 * breakdowns, plus an admin-only "all instructors" leaderboard.
 *
 * Scope: respects the instructor identity on the JWT (instructors see only
 * their rows; admins see everything unless impersonating).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, getApiBaseUrl } from '../services/apiClient';

type Period = 'this_week' | 'last_week' | 'last_7_days' | 'last_30_days' | 'last_90_days';

interface ByPurpose { purpose: string; calls: number; cost: number; }
interface ByModel { model_id: string; provider: string; calls: number; cost: number; }
interface BySection { section_id: string; section_title: string | null; course_name: string | null; calls: number; cost: number; }
interface DailyPoint { day: string; calls: number; cost: number; }
interface ByInstructor { instructor_id: string | null; email: string | null; full_name: string | null; calls: number; cost: number; }

interface UsageDetail {
  scope: 'instructor' | 'global';
  instructorId: string | null;
  period: Period;
  periodLabel: string;
  start: string;
  end: string;
  totals: {
    callCount: number;
    cost: number;
    cacheHits: number;
    cacheHitRate: number;
    unpricedCalls: number;
  };
  byPurpose: ByPurpose[];
  byModel: ByModel[];
  bySection: BySection[];
  daily: DailyPoint[];
  byInstructor: ByInstructor[] | null;
}

interface WeeklyStatus {
  scope: 'instructor' | 'global';
  instructorId?: string | null;
  costUsed: number;
  callCount?: number;
  cap: number | null;
  warnPct: number | null;
  warnThreshold: number | null;
  capActive: boolean;
  overWarning: boolean;
  overCap: boolean;
  useSystemKey?: boolean;
  weekStart: string;
  weekEnd: string;
}

const PERIODS: { value: Period; label: string }[] = [
  { value: 'this_week', label: 'This week' },
  { value: 'last_week', label: 'Last week' },
  { value: 'last_7_days', label: 'Last 7 days' },
  { value: 'last_30_days', label: 'Last 30 days' },
  { value: 'last_90_days', label: 'Last 90 days' },
];

function fmtUsd(n: number): string {
  if (n == null || !Number.isFinite(n)) return '$0.00';
  if (Math.abs(n) >= 1) return `$${n.toFixed(2)}`;
  if (Math.abs(n) >= 0.01) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(5)}`;
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parseDayLabel(dayStr: string): { weekday: string; day: number; month: string } | null {
  if (!dayStr) return null;
  // dayStr is 'YYYY-MM-DD' from the server; treat as UTC to avoid TZ drift.
  const [y, m, d] = dayStr.split('-').map(Number);
  if (!y || !m || !d) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  return {
    weekday: WEEKDAYS[date.getUTCDay()],
    day: d,
    month: MONTHS[m - 1],
  };
}

const PURPOSE_LABELS: Record<string, string> = {
  student_chat: 'Student chats',
  evaluation: 'Evaluations',
  case_writer: 'Case Writer',
  case_prep: 'Case Prep',
  position_inference: 'Position inference',
  feedback_summary: 'Feedback summaries',
  model_test: 'Model tests',
};

interface InstructorOption {
  id: string;
  full_name: string | null;
  email: string | null;
}

const AiUsagePanel: React.FC = () => {
  const [period, setPeriod] = useState<Period>('this_week');
  const [instructorFilter, setInstructorFilter] = useState<string>(''); // '' = All instructors
  const [instructors, setInstructors] = useState<InstructorOption[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [detail, setDetail] = useState<UsageDetail | null>(null);
  const [status, setStatus] = useState<WeeklyStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const q = instructorFilter ? `&instructor_id=${encodeURIComponent(instructorFilter)}` : '';
    const statusPath = instructorFilter
      ? `/usage/weekly-status?instructor_id=${encodeURIComponent(instructorFilter)}`
      : '/usage/weekly-status';
    const [statusRes, detailRes] = await Promise.all([
      api.get<WeeklyStatus>(statusPath),
      api.get<UsageDetail>(`/usage?period=${period}${q}`),
    ]);
    setLoading(false);
    if (statusRes.error) { setError(statusRes.error.message || String(statusRes.error)); return; }
    if (detailRes.error) { setError(detailRes.error.message || String(detailRes.error)); return; }
    setStatus(statusRes.data);
    setDetail(detailRes.data);
    // Detect admin: only admins-not-impersonating get scope='global' with no filter.
    if (!instructorFilter && (statusRes.data?.scope === 'global' || detailRes.data?.scope === 'global')) {
      setIsAdmin(true);
    }
  }, [period, instructorFilter]);

  useEffect(() => { load(); }, [load]);

  // Load instructor list once admin is detected.
  useEffect(() => {
    if (!isAdmin || instructors.length > 0) return;
    (async () => {
      const { data } = await api.get<InstructorOption[]>('/instructors');
      if (Array.isArray(data)) {
        setInstructors(data.slice().sort((a, b) =>
          (a.full_name || a.email || '').localeCompare(b.full_name || b.email || '')
        ));
      }
    })();
  }, [isAdmin, instructors.length]);

  const dailyTrimmed = useMemo(() => {
    if (!detail) return [];
    return detail.daily.slice(-30);
  }, [detail]);

  const maxDaily = useMemo(() => {
    if (dailyTrimmed.length === 0) return 0;
    return Math.max(0.0001, ...dailyTrimmed.map(d => d.cost));
  }, [dailyTrimmed]);

  const handleExport = () => {
    const url = `${getApiBaseUrl()}/usage/export?period=${period}`;
    const token = localStorage.getItem('admin_auth_token') || localStorage.getItem('student_auth_token');
    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(r => r.blob())
      .then(blob => {
        const dlUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = dlUrl;
        a.download = `ai-usage-${period}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(dlUrl);
      });
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">AI Usage</h2>
          <p className="text-sm text-gray-500 mt-1">
            Dollar-based spend across all AI features. Costs are computed at request time from provider pricing.
          </p>
        </div>
        <div className="flex gap-2">
          {isAdmin && (
            <select
              value={instructorFilter}
              onChange={(e) => setInstructorFilter(e.target.value)}
              className="text-sm border border-gray-300 rounded px-2 py-1.5"
              title="Filter by instructor"
            >
              <option value="">for Everyone</option>
              {instructors.map(i => (
                <option key={i.id} value={i.id}>{i.full_name || i.email || i.id}</option>
              ))}
            </select>
          )}
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as Period)}
            className="text-sm border border-gray-300 rounded px-2 py-1.5"
          >
            {PERIODS.map(p => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
          <button
            onClick={load}
            disabled={loading}
            title="Refresh results"
            aria-label="Refresh results"
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-40"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
          <button
            onClick={handleExport}
            className="text-sm px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded border border-gray-300"
          >
            Export CSV
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded border border-red-200">
          {error}
        </div>
      )}

      {/* Weekly cap bar */}
      {status && status.scope === 'instructor' && (
        <div className="mb-6 bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex items-baseline justify-between mb-2">
            <div className="text-sm font-medium text-gray-700">
              This week ({new Date(status.weekStart).toLocaleDateString()} – {new Date(status.weekEnd).toLocaleDateString()})
            </div>
            <div className="text-sm text-gray-600">
              <span className="font-mono">{fmtUsd(status.costUsed)}</span>
              {status.cap != null && (
                <span className="text-gray-400"> / <span className="font-mono">${status.cap.toFixed(2)}</span></span>
              )}
            </div>
          </div>
          {status.capActive && status.cap != null ? (
            <div className="h-3 bg-gray-100 rounded overflow-hidden">
              <div
                className={
                  status.overCap ? 'h-full bg-red-500' :
                  status.overWarning ? 'h-full bg-yellow-500' :
                  'h-full bg-green-500'
                }
                style={{ width: `${Math.min(100, (status.costUsed / status.cap) * 100)}%` }}
              />
            </div>
          ) : (
            <div className="text-xs text-gray-500">
              {status.useSystemKey === false
                ? 'You are using your own API keys — no cap enforced.'
                : 'No cap is set for this account.'}
            </div>
          )}
          {status.overCap && (
            <div className="mt-2 text-sm text-red-700">
              You have reached your weekly cap. Student chats and feature calls are blocked until the cap resets Monday 00:00 (America/Denver).
            </div>
          )}
          {!status.overCap && status.overWarning && status.warnThreshold != null && (
            <div className="mt-2 text-sm text-yellow-700">
              You have used over {status.warnPct}% of this week's cap ({fmtUsd(status.warnThreshold)}).
            </div>
          )}
        </div>
      )}
      {status && status.scope === 'global' && (
        <div className="mb-6 bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-sm font-medium text-gray-700">
            Site-wide this week ({new Date(status.weekStart).toLocaleDateString()} – {new Date(status.weekEnd).toLocaleDateString()})
          </div>
          <div className="text-2xl font-mono mt-1">{fmtUsd(status.costUsed)}</div>
          <div className="text-xs text-gray-500">{status.callCount?.toLocaleString() ?? 0} LLM calls</div>
        </div>
      )}

      {loading && !detail && (
        <div className="text-center text-gray-500 py-8">Loading…</div>
      )}

      {detail && (
        <>
          {/* Totals strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <Stat label="Total cost" value={fmtUsd(detail.totals.cost)} sub={detail.periodLabel} mono />
            <Stat label="LLM calls" value={detail.totals.callCount.toLocaleString()} sub={`${detail.totals.unpricedCalls} unpriced`} />
            <Stat label="Cache hits" value={detail.totals.cacheHits.toLocaleString()} sub={fmtPct(detail.totals.cacheHitRate)} />
            <Stat label="Avg cost / call" value={fmtUsd(detail.totals.callCount > 0 ? detail.totals.cost / detail.totals.callCount : 0)} mono />
          </div>

          {/* Daily bar chart */}
          <div className="mb-6 bg-white border border-gray-200 rounded-lg p-4">
            <div className="text-sm font-medium text-gray-700 mb-3 flex items-baseline justify-between">
              <span>Daily spend <span className="text-xs text-gray-400 font-normal">(UTC)</span></span>
              {detail.daily.length > 30 && (
                <span className="text-xs text-gray-400 font-normal">last 30 days</span>
              )}
            </div>
            {dailyTrimmed.length === 0 ? (
              <div className="text-sm text-gray-400 py-8 text-center">No usage in this period.</div>
            ) : (
              <div className="flex items-end gap-1 h-32">
                {dailyTrimmed.map(d => {
                  const heightPct = maxDaily > 0 ? (d.cost / maxDaily) * 100 : 0;
                  const parsed = parseDayLabel(d.day);
                  return (
                    <div
                      key={d.day || Math.random()}
                      className="flex-1 flex flex-col items-center justify-end h-full min-w-0"
                      title={`${d.day || 'unknown'}: ${fmtUsd(d.cost)} (${d.calls} calls)`}
                    >
                      <div
                        className="w-full bg-blue-500 rounded-t min-h-[2px]"
                        style={{ height: `${Math.max(2, heightPct)}%` }}
                      />
                      <div className="text-[10px] leading-tight text-gray-500 mt-1 w-full text-center">
                        {parsed ? (
                          <>
                            <div>{parsed.weekday} {parsed.day}</div>
                            <div className="text-gray-400">{parsed.month}</div>
                          </>
                        ) : (
                          <div>?</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Breakdown tables */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <BreakdownTable
              title="By purpose"
              rows={detail.byPurpose.map(r => ({
                key: r.purpose,
                label: PURPOSE_LABELS[r.purpose] || r.purpose,
                calls: r.calls,
                cost: r.cost,
              }))}
              totalCost={detail.totals.cost}
            />
            <BreakdownTable
              title="By model"
              rows={detail.byModel.map(r => ({
                key: r.model_id,
                label: r.model_id,
                sub: r.provider,
                calls: r.calls,
                cost: r.cost,
              }))}
              totalCost={detail.totals.cost}
            />
            <BreakdownTable
              title="By section"
              rows={detail.bySection.map(r => ({
                key: r.section_id,
                label: r.section_title || r.section_id,
                sub: r.course_name || undefined,
                calls: r.calls,
                cost: r.cost,
              }))}
              totalCost={detail.totals.cost}
              emptyText="No section-scoped activity in this period."
            />
            {detail.byInstructor && (
              <BreakdownTable
                title="By instructor (admin)"
                rows={detail.byInstructor.map(r => ({
                  key: r.instructor_id || '(system)',
                  label: r.full_name || r.email || r.instructor_id || '(system)',
                  sub: r.email || undefined,
                  calls: r.calls,
                  cost: r.cost,
                }))}
                totalCost={detail.totals.cost}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
};

interface StatProps { label: string; value: string; sub?: string; mono?: boolean; }
const Stat: React.FC<StatProps> = ({ label, value, sub, mono }) => (
  <div className="bg-white border border-gray-200 rounded-lg p-3">
    <div className="text-xs text-gray-500 uppercase tracking-wide">{label}</div>
    <div className={`text-2xl mt-1 ${mono ? 'font-mono' : 'font-semibold'} text-gray-900`}>{value}</div>
    {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
  </div>
);

interface BreakdownRow { key: string; label: string; sub?: string; calls: number; cost: number; }
interface BreakdownProps { title: string; rows: BreakdownRow[]; totalCost: number; emptyText?: string; }
const BreakdownTable: React.FC<BreakdownProps> = ({ title, rows, totalCost, emptyText }) => (
  <div className="bg-white border border-gray-200 rounded-lg p-4">
    <div className="text-sm font-medium text-gray-700 mb-2">{title}</div>
    {rows.length === 0 ? (
      <div className="text-sm text-gray-400 py-4">{emptyText || 'No data.'}</div>
    ) : (
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-gray-500 uppercase">
            <th className="text-left font-medium pb-1"></th>
            <th className="text-right font-medium pb-1">Calls</th>
            <th className="text-right font-medium pb-1">Cost</th>
            <th className="text-right font-medium pb-1 w-12">%</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const pct = totalCost > 0 ? (r.cost / totalCost) * 100 : 0;
            return (
              <tr key={r.key} className="border-t border-gray-100">
                <td className="py-1.5">
                  <div className="text-gray-900 truncate" title={r.label}>{r.label}</div>
                  {r.sub && <div className="text-xs text-gray-400">{r.sub}</div>}
                </td>
                <td className="text-right font-mono text-gray-600">{r.calls.toLocaleString()}</td>
                <td className="text-right font-mono">{fmtUsd(r.cost)}</td>
                <td className="text-right text-xs text-gray-400">{pct.toFixed(0)}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    )}
  </div>
);

export default AiUsagePanel;
