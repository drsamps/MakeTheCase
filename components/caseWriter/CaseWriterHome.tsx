import React, { useEffect, useMemo, useState } from 'react';
import { caseWriterApi, CaseWriterProjectSummary, PrincipleCandidate } from '../../services/caseWriter/api';
import { getApiBaseUrl } from '../../services/apiClient';
import { useGenerationTimer } from './useGenerationTimer';
import PromptInfoButton from './PromptInfoButton';

type SortKey = 'title' | 'teaching_principle' | 'industry' | 'owner_name' | 'status' | 'updated_at';
type SortDir = 'asc' | 'desc';

interface ModelOption {
  model_id: string;
  display_name?: string;
  vendor?: string;
}

interface Props {
  onOpenProject: (projectId: string) => void;
  user?: { full_name?: string; email?: string; role?: string } | null;
}

const STATUS_BADGE: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  reviewed: 'bg-blue-100 text-blue-700',
  exported: 'bg-purple-100 text-purple-700',
  published: 'bg-green-100 text-green-700',
  archived: 'bg-yellow-100 text-yellow-700'
};

const CaseWriterHome: React.FC<Props> = ({ onOpenProject, user }) => {
  const isAdmin = user?.role === 'admin';
  const [projects, setProjects] = useState<CaseWriterProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [title, setTitle] = useState('');
  const [principle, setPrinciple] = useState('');
  const [creating, setCreating] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestText, setSuggestText] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<PrincipleCandidate[]>([]);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [suggestModelOverride, setSuggestModelOverride] = useState<string>('');
  const [showSuggestModelPicker, setShowSuggestModelPicker] = useState(false);
  const suggestTimerText = useGenerationTimer(suggesting);
  const [searchText, setSearchText] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('updated_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  useEffect(() => {
    (async () => {
      try {
        const t = localStorage.getItem('admin_auth_token');
        const res = await fetch(`${getApiBaseUrl()}/models?enabled=true`, {
          headers: t ? { Authorization: `Bearer ${t}` } : {}
        });
        if (!res.ok) return;
        const json = await res.json();
        const list: any[] = json?.data || json || [];
        setModels(list.map(m => ({
          model_id: m.model_id,
          display_name: m.model_name || m.display_name || m.model_id,
          vendor: m.vendor
        })));
      } catch { /* non-fatal */ }
    })();
  }, []);

  const reload = async () => {
    setLoading(true);
    const { data, error } = await caseWriterApi.listProjects();
    if (error) setErr(error.message);
    else setProjects(data || []);
    setLoading(false);
  };

  useEffect(() => { reload(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!principle.trim()) { setErr('Teaching principle is required'); return; }
    setCreating(true);
    setErr(null);
    const { data, error } = await caseWriterApi.createProject({
      title: title.trim() || undefined,
      teaching_principle: principle.trim()
    });
    setCreating(false);
    if (error || !data) { setErr(error?.message || 'Failed to create project'); return; }
    setShowNew(false);
    setTitle('');
    setPrinciple('');
    onOpenProject(data.project_id);
  };

  const distinctOwners = useMemo(() => {
    const set = new Set<string>();
    projects.forEach(p => { if (p.owner_name) set.add(p.owner_name); });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [projects]);

  const filteredSortedProjects = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    let out = projects.filter(p => {
      if (ownerFilter && (p.owner_name || '') !== ownerFilter) return false;
      if (q) {
        const t = (p.title || '').toLowerCase();
        const tp = (p.teaching_principle || '').toLowerCase();
        if (!t.includes(q) && !tp.includes(q)) return false;
      }
      return true;
    });
    const dir = sortDir === 'asc' ? 1 : -1;
    out = [...out].sort((a, b) => {
      let va: any;
      let vb: any;
      if (sortKey === 'updated_at') {
        va = new Date(a.updated_at).getTime();
        vb = new Date(b.updated_at).getTime();
      } else {
        va = (a[sortKey] || '').toString().toLowerCase();
        vb = (b[sortKey] || '').toString().toLowerCase();
      }
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
    return out;
  }, [projects, searchText, ownerFilter, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'updated_at' ? 'desc' : 'asc');
    }
  }

  function sortIndicator(key: SortKey): string {
    if (sortKey !== key) return '';
    return sortDir === 'asc' ? ' ▲' : ' ▼';
  }

  const handleDelete = async (project: { project_id: string; title?: string | null }) => {
    if (!confirm(`Delete project "${project.title || 'Untitled'}"? This cannot be undone.`)) return;
    const { error } = await caseWriterApi.deleteProject(project.project_id);
    if (error) { setErr(error.message); return; }
    setProjects(prev => prev.filter(p => p.project_id !== project.project_id));
  };

  const handleClone = async (projectId: string) => {
    setErr(null);
    const { data, error } = await caseWriterApi.cloneProject(projectId);
    if (error || !data) { setErr(error?.message || 'Clone failed'); return; }
    await reload();
    onOpenProject(data.project_id);
  };

  return (
    <div className="max-w-7xl mx-auto p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Case Writer</h2>
          <p className="text-sm text-gray-600 mt-1">AI-assisted business case authoring. Wizard-driven from teaching principle to publishable case.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={reload}
            disabled={loading}
            aria-label="Refresh projects"
            title="Refresh projects"
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-40"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
          <button
            onClick={() => setShowNew(s => !s)}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          >
            {showNew ? 'Cancel' : 'New Project'}
          </button>
        </div>
      </div>

      {err && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">{err}</div>
      )}

      {showNew && (
        <form onSubmit={handleCreate} className="bg-white border border-gray-200 rounded-lg p-4 mb-6 shadow-sm">
          <h3 className="font-semibold text-gray-900 mb-3">Start a new case</h3>
          <div className="mb-3">
            <label className="block text-sm font-medium text-gray-700 mb-1">Working title (optional)</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Summit Roast's Supermarket Dilemma"
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
            />
          </div>
          <div className="mb-3">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Teaching principle <span className="text-red-600">*</span>
            </label>
            <input
              type="text"
              value={principle}
              onChange={e => setPrinciple(e.target.value)}
              placeholder="e.g. Channel conflict, Sunk cost fallacy, Pricing strategy"
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
              required
            />
            <p className="text-xs text-gray-500 mt-1">The single concept this case should teach. The brief and scenarios are generated from this.</p>
          </div>
          <div className="flex gap-2 justify-end mb-3">
            <button
              type="button"
              onClick={() => setShowNew(false)}
              className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded"
            >Cancel</button>
            <button
              type="submit"
              disabled={creating}
              className="bg-blue-600 text-white px-4 py-2 text-sm rounded hover:bg-blue-700 disabled:opacity-50"
            >{creating ? 'Creating…' : 'Create'}</button>
          </div>
          <div className="border-t border-gray-100 pt-3">
            <button
              type="button"
              onClick={() => setSuggestOpen(o => !o)}
              className="text-sm text-blue-600 hover:underline"
            >
              {suggestOpen ? '− Hide' : '+ Suggest principles from source material'}
            </button>
            {suggestOpen && (
              <div className="mt-2 space-y-2">
                <textarea
                  placeholder="Paste a chapter, article, or notes here. The AI will suggest candidate teaching principles."
                  value={suggestText}
                  onChange={e => setSuggestText(e.target.value)}
                  className="w-full min-h-[120px] px-2 py-1 border border-gray-300 rounded text-sm"
                />
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    disabled={suggesting || !suggestText.trim()}
                    onClick={async () => {
                      setSuggesting(true);
                      setErr(null);
                      const { data, error } = await caseWriterApi.extractPrinciples({
                        content: suggestText,
                        model_id: suggestModelOverride || undefined
                      });
                      setSuggesting(false);
                      if (error || !data) { setErr(error?.message || 'Could not extract principles'); return; }
                      setSuggestions(data.principles || []);
                    }}
                    className={`px-3 py-1.5 text-sm rounded disabled:opacity-50 ${
                      suggesting
                        ? 'bg-green-500 text-white animate-pulse cursor-wait'
                        : 'bg-blue-600 hover:bg-blue-700 text-white'
                    }`}
                  >
                    {suggesting ? `Thinking… ${suggestTimerText}` : 'Suggest principles from text'}
                  </button>
                  <span className="text-xs text-gray-500">or</span>
                  <label className={`px-3 py-1.5 text-sm rounded cursor-pointer ${
                    suggesting
                      ? 'bg-green-500 text-white animate-pulse cursor-wait'
                      : 'bg-blue-600 hover:bg-blue-700 text-white'
                  }`}>
                    {suggesting ? `Thinking… ${suggestTimerText}` : 'Upload PDF / DOCX'}
                    <input
                      type="file"
                      accept=".pdf,.docx,.doc,.md,.txt"
                      disabled={suggesting}
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (!file) return;
                        setSuggesting(true);
                        setErr(null);
                        const { data, error } = await caseWriterApi.extractPrinciplesFromFile(file, {
                          model_id: suggestModelOverride || undefined
                        });
                        setSuggesting(false);
                        if (error || !data) { setErr(error?.message || 'Could not extract principles'); return; }
                        setSuggestions(data.principles || []);
                      }}
                      className="hidden"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowSuggestModelPicker(s => !s)}
                    title="Choose a different model for this generation"
                    className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50"
                  >
                    ⚙ {suggestModelOverride ? suggestModelOverride : 'model'}
                  </button>
                  {showSuggestModelPicker && models.length > 0 && (
                    <select
                      value={suggestModelOverride}
                      onChange={(e) => setSuggestModelOverride(e.target.value)}
                      className="text-xs px-2 py-1 border border-gray-300 rounded"
                    >
                      <option value="">(use default)</option>
                      {models.map(m => (
                        <option key={m.model_id} value={m.model_id}>
                          {m.display_name || m.model_id}
                        </option>
                      ))}
                    </select>
                  )}
                  {isAdmin && (
                    <PromptInfoButton use="case_writer.principle_extraction" isAdmin={isAdmin} />
                  )}
                </div>
                {suggestions.length > 0 && (
                  <ul className="space-y-1 mt-2">
                    {suggestions.map((s, i) => (
                      <li key={i} className="border border-gray-200 rounded p-2 bg-gray-50">
                        <button
                          type="button"
                          onClick={() => setPrinciple(s.principle)}
                          className="text-sm font-semibold text-blue-700 hover:underline text-left"
                        >
                          {s.principle}
                        </button>
                        <p className="text-xs text-gray-600 mt-1">{s.rationale}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </form>
      )}

      {loading ? (
        <div className="text-gray-500 text-sm">Loading projects…</div>
      ) : projects.length === 0 ? (
        <div className="bg-white border border-dashed border-gray-300 rounded-lg p-10 text-center text-gray-500">
          No projects yet. Click <span className="font-semibold">New Project</span> to start one.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search title or teaching principle…"
              className="flex-1 min-w-[220px] border border-gray-300 rounded px-3 py-1.5 text-sm"
            />
            {distinctOwners.length > 1 && (
              <select
                value={ownerFilter}
                onChange={(e) => setOwnerFilter(e.target.value)}
                className="border border-gray-300 rounded px-2 py-1.5 text-sm"
              >
                <option value="">All owners</option>
                {distinctOwners.map(o => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            )}
            <span className="text-xs text-gray-500">
              {filteredSortedProjects.length} of {projects.length}
            </span>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-700">
                <tr>
                  <th className="text-left px-4 py-2 font-semibold cursor-pointer select-none" onClick={() => toggleSort('title')}>
                    Title{sortIndicator('title')}
                  </th>
                  <th className="text-left px-4 py-2 font-semibold cursor-pointer select-none" onClick={() => toggleSort('teaching_principle')}>
                    Teaching Principle{sortIndicator('teaching_principle')}
                  </th>
                  <th className="text-left px-4 py-2 font-semibold cursor-pointer select-none" onClick={() => toggleSort('industry')}>
                    Industry{sortIndicator('industry')}
                  </th>
                  <th className="text-left px-4 py-2 font-semibold cursor-pointer select-none" onClick={() => toggleSort('owner_name')}>
                    Owner{sortIndicator('owner_name')}
                  </th>
                  <th className="text-left px-4 py-2 font-semibold cursor-pointer select-none" onClick={() => toggleSort('status')}>
                    Status{sortIndicator('status')}
                  </th>
                  <th className="text-left px-4 py-2 font-semibold cursor-pointer select-none" onClick={() => toggleSort('updated_at')}>
                    Updated{sortIndicator('updated_at')}
                  </th>
                  <th className="text-right px-4 py-2 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredSortedProjects.map(p => (
                  <tr key={p.project_id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-2">
                      <button
                        onClick={() => onOpenProject(p.project_id)}
                        className="text-blue-600 hover:underline font-medium"
                      >
                        {p.title || <span className="text-gray-500 italic">Untitled</span>}
                      </button>
                    </td>
                    <td className="px-4 py-2 text-gray-700">
                      {p.teaching_principle
                        ? (p.teaching_principle.length > 50
                            ? <span title={p.teaching_principle}>{p.teaching_principle.slice(0, 50)}…</span>
                            : p.teaching_principle)
                        : '—'}
                    </td>
                    <td className="px-4 py-2 text-gray-700">{p.industry || '—'}</td>
                    <td className="px-4 py-2 text-gray-700">
                      <span title={p.owner_type}>{p.owner_name || '—'}</span>
                    </td>
                    <td className="px-4 py-2">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STATUS_BADGE[p.status] || 'bg-gray-100 text-gray-700'}`}>
                        {p.status}
                      </span>
                      {p.published_case_id && (
                        <span className="ml-2 text-xs text-gray-500">→ {p.published_case_id}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-gray-500">{new Date(p.updated_at).toLocaleString()}</td>
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={() => handleClone(p.project_id)}
                        title="Make a private copy you can edit"
                        className="text-xs text-blue-600 hover:text-blue-800 hover:underline mr-3"
                      >Clone</button>
                      {p.can_edit && (
                        <button
                          onClick={() => handleDelete(p)}
                          className="text-xs text-red-600 hover:text-red-800 hover:underline"
                        >Delete</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};

export default CaseWriterHome;
