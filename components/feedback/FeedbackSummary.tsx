import React, { useEffect, useState } from 'react';
import { getApiBaseUrl } from '../../services/apiClient';
import MarkdownPreview from '../caseWriter/MarkdownPreview';

interface Category {
  id: number;
  name: string;
}

interface SummaryRow {
  id: number;
  scope_type: 'case' | 'category' | 'all';
  scope_id: string | null;
  summary_text: string;
  model_id: string | null;
  created_at: string;
  source_count: number;
}

function getActiveToken(): string | null {
  return localStorage.getItem('admin_auth_token') || localStorage.getItem('student_auth_token');
}

const FeedbackSummary: React.FC = () => {
  const [categories, setCategories] = useState<Category[]>([]);
  const [scopeType, setScopeType] = useState<'all' | 'case' | 'category'>('all');
  const [scopeId, setScopeId] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<SummaryRow | null>(null);
  const [history, setHistory] = useState<SummaryRow[]>([]);

  const loadHistory = () => {
    const token = getActiveToken();
    if (!token) return;
    fetch(`${getApiBaseUrl()}/feedback/summaries`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => (r.ok ? r.json() : { items: [] }))
      .then(d => setHistory(d.items || []))
      .catch(() => setHistory([]));
  };

  useEffect(() => {
    const token = getActiveToken();
    if (!token) return;
    fetch(`${getApiBaseUrl()}/feedback/categories`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => (r.ok ? r.json() : { categories: [] }))
      .then(d => setCategories(d.categories || []))
      .catch(() => setCategories([]));
    loadHistory();
  }, []);

  const handleGenerate = async () => {
    setError(null);
    const token = getActiveToken();
    if (!token) {
      setError('Not authenticated');
      return;
    }
    if (scopeType !== 'all' && !scopeId) {
      setError('Pick a scope value.');
      return;
    }
    setGenerating(true);
    try {
      const response = await fetch(`${getApiBaseUrl()}/feedback/summarize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          scope_type: scopeType,
          scope_id: scopeType === 'all' ? null : scopeId,
        }),
      });
      if (!response.ok) {
        const d = await response.json().catch(() => ({}));
        throw new Error(d?.error || 'Failed to generate summary');
      }
      const data = await response.json();
      setCurrent(data);
      loadHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate summary');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-lg font-semibold text-gray-900">Feedback Summary</h2>

      <div className="border border-gray-200 rounded-lg p-4 bg-white space-y-3">
        <div className="flex flex-wrap items-end gap-2 text-sm">
          <div>
            <label className="block text-xs text-gray-600">Scope</label>
            <select
              value={scopeType}
              onChange={e => { setScopeType(e.target.value as any); setScopeId(''); }}
              className="border border-gray-300 rounded px-2 py-1"
            >
              <option value="all">All feedback</option>
              <option value="category">By category</option>
              <option value="case">By case</option>
            </select>
          </div>
          {scopeType === 'category' && (
            <div>
              <label className="block text-xs text-gray-600">Category</label>
              <select
                value={scopeId}
                onChange={e => setScopeId(e.target.value)}
                className="border border-gray-300 rounded px-2 py-1"
              >
                <option value="">— Select —</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}
          {scopeType === 'case' && (
            <div>
              <label className="block text-xs text-gray-600">Case ID</label>
              <input
                type="text"
                value={scopeId}
                onChange={e => setScopeId(e.target.value)}
                placeholder="e.g. malawis-001"
                className="border border-gray-300 rounded px-2 py-1"
              />
            </div>
          )}
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="px-3 py-1.5 text-sm font-semibold rounded text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
          >
            {generating ? 'Generating…' : 'Generate summary'}
          </button>
        </div>
        {error && <div className="text-sm text-red-700">{error}</div>}
      </div>

      {current && (
        <div className="border border-gray-200 rounded-lg p-4 bg-white">
          <div className="text-xs text-gray-500 mb-2">
            {current.model_id} · {current.source_count} item{current.source_count === 1 ? '' : 's'}
          </div>
          <MarkdownPreview markdown={current.summary_text} />
        </div>
      )}

      {history.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-900">Recent summaries</h3>
          <div className="space-y-2">
            {history.map(row => (
              <details key={row.id} className="border border-gray-200 rounded bg-white">
                <summary className="cursor-pointer px-3 py-2 text-sm text-gray-700">
                  <span className="font-medium">{row.scope_type}</span>
                  {row.scope_id ? <span className="text-gray-500"> · {row.scope_id}</span> : null}
                  <span className="text-gray-500"> · {new Date(row.created_at).toLocaleString()}</span>
                  <span className="text-gray-500"> · {row.source_count} items</span>
                </summary>
                <div className="px-3 py-2 border-t border-gray-100">
                  <MarkdownPreview markdown={row.summary_text} />
                </div>
              </details>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default FeedbackSummary;
