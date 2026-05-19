import React, { useEffect, useState } from 'react';
import { getApiBaseUrl } from '../../services/apiClient';
import FeedbackCategoriesAdmin from './FeedbackCategoriesAdmin';

type Role = 'student' | 'ta' | 'instructor' | 'primary_instructor' | 'admin';
const ROLES: Role[] = ['student', 'ta', 'instructor', 'primary_instructor', 'admin'];
const WIDGET_STYLES: { value: string; label: string; description: string }[] = [
  { value: 'right_edge_tab', label: 'Right edge tab', description: 'Fixed vertical pill on the right side.' },
  { value: 'bottom_right_fab', label: 'Bottom-right FAB', description: 'Round floating button in the corner.' },
  { value: 'header_link', label: 'Header link', description: 'Text link in the header bar.' },
  { value: 'hidden', label: 'Hidden', description: 'No trigger; submissions disabled.' },
];

interface Model {
  model_id: string;
  enabled?: boolean | number;
}

function getActiveToken(): string | null {
  return localStorage.getItem('admin_auth_token') || localStorage.getItem('student_auth_token');
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

const FeedbackSettingsAdmin: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitterRoles, setSubmitterRoles] = useState<Record<Role, boolean>>({
    student: true, ta: true, instructor: true, primary_instructor: true, admin: true,
  });
  const [viewerRules, setViewerRules] = useState<Record<Role, Role[]>>({
    student: ['admin'], ta: ['admin'], instructor: ['admin'],
    primary_instructor: ['admin'], admin: ['admin'],
  });
  const [widgetStyle, setWidgetStyle] = useState<string>('right_edge_tab');
  const [summaryModelId, setSummaryModelId] = useState<string>('');
  const [models, setModels] = useState<Model[]>([]);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  useEffect(() => {
    const token = getActiveToken();
    if (!token) {
      setError('Not authenticated');
      setLoading(false);
      return;
    }
    Promise.all([
      fetch(`${getApiBaseUrl()}/feedback/settings`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
      fetch(`${getApiBaseUrl()}/models`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.ok ? r.json() : []),
    ])
      .then(([settingsResp, modelsResp]) => {
        const s = settingsResp?.settings || {};
        setSubmitterRoles(prev => ({ ...prev, ...parseJson(s['feedback.submitter_roles'], prev) }));
        setViewerRules(prev => ({ ...prev, ...parseJson(s['feedback.viewer_rules'], prev) }));
        if (typeof s['feedback.widget_style'] === 'string' && s['feedback.widget_style']) {
          setWidgetStyle(s['feedback.widget_style']);
        }
        setSummaryModelId(s['feedback.summary_model_id'] || '');
        const list = Array.isArray(modelsResp) ? modelsResp : (modelsResp?.data || modelsResp?.models || []);
        setModels(list.filter((m: Model) => m.enabled !== false && m.enabled !== 0));
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  const patchSetting = async (key: string, value: string) => {
    setError(null);
    setSavingKey(key);
    try {
      const token = getActiveToken();
      if (!token) throw new Error('Not authenticated');
      const response = await fetch(`${getApiBaseUrl()}/feedback/settings/${encodeURIComponent(key)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ value }),
      });
      if (!response.ok) {
        const d = await response.json().catch(() => ({}));
        throw new Error(d?.error || 'Save failed');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSavingKey(null);
    }
  };

  const setSubmitter = (role: Role, val: boolean) => {
    const next = { ...submitterRoles, [role]: val };
    setSubmitterRoles(next);
    patchSetting('feedback.submitter_roles', JSON.stringify(next));
  };

  const toggleViewer = (submitter: Role, viewer: Role) => {
    const current = viewerRules[submitter] || [];
    const next = current.includes(viewer)
      ? current.filter(r => r !== viewer)
      : [...current, viewer];
    const nextMap = { ...viewerRules, [submitter]: next };
    setViewerRules(nextMap);
    patchSetting('feedback.viewer_rules', JSON.stringify(nextMap));
  };

  const setStyle = (value: string) => {
    setWidgetStyle(value);
    patchSetting('feedback.widget_style', value);
  };

  const setModel = (value: string) => {
    setSummaryModelId(value);
    patchSetting('feedback.summary_model_id', value);
  };

  if (loading) return <div className="text-sm text-gray-500">Loading feedback settings…</div>;

  return (
    <div className="space-y-6">
      {error && <div className="text-sm text-red-700">{error}</div>}

      <section>
        <h4 className="text-sm font-semibold text-gray-900 mb-2">Who can submit feedback</h4>
        <div className="flex flex-wrap gap-3">
          {ROLES.map(role => (
            <label key={role} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={!!submitterRoles[role]}
                onChange={e => setSubmitter(role, e.target.checked)}
              />
              <span className="text-gray-800">{role}</span>
            </label>
          ))}
        </div>
      </section>

      <section>
        <h4 className="text-sm font-semibold text-gray-900 mb-2">Viewer rules</h4>
        <p className="text-xs text-gray-500 mb-2">
          For each <em>submitter</em> role (rows), check which <em>viewer</em> roles (columns) can see those submissions.
        </p>
        <div className="overflow-x-auto">
          <table className="text-sm border border-gray-200 rounded">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-2 py-1 text-left">Submitter ↓ / Viewer →</th>
                {ROLES.map(r => <th key={r} className="px-2 py-1 text-center">{r}</th>)}
              </tr>
            </thead>
            <tbody>
              {ROLES.map(submitter => (
                <tr key={submitter} className="border-t border-gray-100">
                  <td className="px-2 py-1 font-medium text-gray-800">{submitter}</td>
                  {ROLES.map(viewer => {
                    const checked = (viewerRules[submitter] || []).includes(viewer);
                    return (
                      <td key={viewer} className="px-2 py-1 text-center">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleViewer(submitter, viewer)}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h4 className="text-sm font-semibold text-gray-900 mb-2">Widget style</h4>
        <div className="space-y-2">
          {WIDGET_STYLES.map(opt => (
            <label key={opt.value} className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="widget-style"
                checked={widgetStyle === opt.value}
                onChange={() => setStyle(opt.value)}
                className="mt-1"
              />
              <span>
                <span className="font-medium text-gray-800">{opt.label}</span>
                <span className="block text-xs text-gray-500">{opt.description}</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      <section>
        <h4 className="text-sm font-semibold text-gray-900 mb-2">Summary model</h4>
        <select
          value={summaryModelId}
          onChange={e => setModel(e.target.value)}
          className="border border-gray-300 rounded px-2 py-1 text-sm"
        >
          <option value="">— Use default —</option>
          {models.map(m => <option key={m.model_id} value={m.model_id}>{m.model_id}</option>)}
        </select>
        <p className="text-xs text-gray-500 mt-1">
          Used when generating AI-summarized feedback digests. Empty falls back to the system default.
        </p>
      </section>

      <section>
        <h4 className="text-sm font-semibold text-gray-900 mb-2">Categories</h4>
        <FeedbackCategoriesAdmin />
      </section>

      {savingKey && (
        <div className="text-xs text-gray-500">Saving {savingKey}…</div>
      )}
    </div>
  );
};

export default FeedbackSettingsAdmin;
