import React, { useEffect, useState } from 'react';
import { caseWriterApi, CaseWriterProjectSummary, PrincipleCandidate } from '../../services/caseWriter/api';

interface Props {
  onOpenProject: (projectId: string) => void;
}

const STATUS_BADGE: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  reviewed: 'bg-blue-100 text-blue-700',
  exported: 'bg-purple-100 text-purple-700',
  published: 'bg-green-100 text-green-700',
  archived: 'bg-yellow-100 text-yellow-700'
};

const CaseWriterHome: React.FC<Props> = ({ onOpenProject }) => {
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

  const handleDelete = async (projectId: string) => {
    if (!confirm('Delete this project? This cannot be undone.')) return;
    const { error } = await caseWriterApi.deleteProject(projectId);
    if (error) { setErr(error.message); return; }
    setProjects(prev => prev.filter(p => p.project_id !== projectId));
  };

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Case Writer</h2>
          <p className="text-sm text-gray-600 mt-1">AI-assisted business case authoring. Wizard-driven from teaching principle to publishable case.</p>
        </div>
        <button
          onClick={() => setShowNew(s => !s)}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        >
          {showNew ? 'Cancel' : 'New Project'}
        </button>
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
          <div className="mb-3 border-t border-gray-100 pt-3">
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
                      const { data, error } = await caseWriterApi.extractPrinciples({ content: suggestText });
                      setSuggesting(false);
                      if (error || !data) { setErr(error?.message || 'Could not extract principles'); return; }
                      setSuggestions(data.principles || []);
                    }}
                    className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50"
                  >
                    {suggesting ? 'Thinking…' : 'Suggest principles from text'}
                  </button>
                  <span className="text-xs text-gray-500">or</span>
                  <label className={`px-3 py-1.5 text-sm rounded cursor-pointer ${suggesting ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}>
                    {suggesting ? 'Thinking…' : 'Upload PDF / DOCX'}
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
                        const { data, error } = await caseWriterApi.extractPrinciplesFromFile(file);
                        setSuggesting(false);
                        if (error || !data) { setErr(error?.message || 'Could not extract principles'); return; }
                        setSuggestions(data.principles || []);
                      }}
                      className="hidden"
                    />
                  </label>
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
          <div className="flex gap-2 justify-end">
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
        </form>
      )}

      {loading ? (
        <div className="text-gray-500 text-sm">Loading projects…</div>
      ) : projects.length === 0 ? (
        <div className="bg-white border border-dashed border-gray-300 rounded-lg p-10 text-center text-gray-500">
          No projects yet. Click <span className="font-semibold">New Project</span> to start one.
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-700">
              <tr>
                <th className="text-left px-4 py-2 font-semibold">Title</th>
                <th className="text-left px-4 py-2 font-semibold">Teaching Principle</th>
                <th className="text-left px-4 py-2 font-semibold">Status</th>
                <th className="text-left px-4 py-2 font-semibold">Updated</th>
                <th className="text-right px-4 py-2 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {projects.map(p => (
                <tr key={p.project_id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-2">
                    <button
                      onClick={() => onOpenProject(p.project_id)}
                      className="text-blue-600 hover:underline font-medium"
                    >
                      {p.title || <span className="text-gray-500 italic">Untitled</span>}
                    </button>
                  </td>
                  <td className="px-4 py-2 text-gray-700">{p.teaching_principle || '—'}</td>
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
                      onClick={() => handleDelete(p.project_id)}
                      className="text-xs text-red-600 hover:text-red-800 hover:underline"
                    >Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default CaseWriterHome;
