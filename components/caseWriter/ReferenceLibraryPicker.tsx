import React, { useEffect, useMemo, useRef, useState } from 'react';
import { caseWriterApi, ReferenceLibraryItem } from '../../services/caseWriter/api';
import MarkdownPreview from './MarkdownPreview';
import { TYPE_LABEL, displayTitle, fmt } from './referenceDisplay';

interface Props {
  projectId: string;
  onClose: () => void;
  /** Called after a successful copy with the number of rows added. */
  onImported: (count: number) => void;
  onError: (message: string) => void;
}

const VISIBILITY_BADGE: Record<string, string> = {
  private: 'bg-gray-100 text-gray-700 border-gray-300',
  team: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  public: 'bg-emerald-50 text-emerald-700 border-emerald-200'
};

/**
 * Browse source material on other projects and copy it into this one.
 *
 * Everything listed here was already readable by this instructor — the reference
 * routes require only 'view' on the owning project — but a picker makes that
 * concrete, which is why the project visibility control now states plainly what
 * team/public sharing exposes.
 */
const ReferenceLibraryPicker: React.FC<Props> = ({ projectId, onClose, onImported, onError }) => {
  const [items, setItems] = useState<ReferenceLibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [serverQuery, setServerQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);

  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewText, setPreviewText] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  // Identifies the in-flight preview request. Responses arrive out of order and
  // the panel is keyed on previewId, so a slow first response would otherwise
  // overwrite a fast second one and show reference A's text under reference B.
  const previewSeq = useRef(0);

  const loadedOnce = useRef(false);

  // The list route caps at 500 rows, so filtering only on the client cannot see
  // past that — an admin's scope is every reference on the platform. Search is
  // sent to the server, debounced; the client filter below then narrows whatever
  // came back so typing stays responsive between ticks.
  useEffect(() => {
    const t = setTimeout(() => setServerQuery(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    if (loadedOnce.current) setSearching(true); else setLoading(true);
    caseWriterApi.listReferenceLibrary(projectId, serverQuery).then(({ data, error }) => {
      if (cancelled) return;
      loadedOnce.current = true;
      setLoading(false);
      setSearching(false);
      if (error) { onError(error.message); return; }
      setItems(data || []);
    });
    return () => { cancelled = true; };
  }, [projectId, serverQuery]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(i =>
      (i.title || '').toLowerCase().includes(q)
      || (i.project_title || '').toLowerCase().includes(q)
      || (i.link_url || '').toLowerCase().includes(q)
      || (i.owner_name || '').toLowerCase().includes(q)
    );
  }, [items, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, { item: ReferenceLibraryItem; rows: ReferenceLibraryItem[] }>();
    for (const r of filtered) {
      if (!map.has(r.project_id)) map.set(r.project_id, { item: r, rows: [] });
      map.get(r.project_id)!.rows.push(r);
    }
    return [...map.values()];
  }, [filtered]);

  function toggle(refId: string) {
    setSelected(s => {
      const next = new Set(s);
      if (next.has(refId)) next.delete(refId); else next.add(refId);
      return next;
    });
  }

  async function openPreview(r: ReferenceLibraryItem) {
    // Bumping the token on close too, so a request still in flight cannot
    // re-open the panel the instructor just dismissed.
    const seq = ++previewSeq.current;
    if (previewId === r.reference_id) { setPreviewId(null); return; }
    setPreviewId(r.reference_id);
    setPreviewText('');
    setPreviewLoading(true);
    const { data, error } = await caseWriterApi.getReferenceContent(r.project_id, r.reference_id);
    if (seq !== previewSeq.current) return;   // superseded — this response is stale
    setPreviewLoading(false);
    if (error) { onError(error.message); setPreviewId(null); return; }
    setPreviewText(data?.content || '');
  }

  async function doImport() {
    const picks = items
      .filter(i => selected.has(i.reference_id))
      .map(i => ({ project_id: i.project_id, reference_id: i.reference_id }));
    if (picks.length === 0) return;

    setImporting(true);
    const { data, error } = await caseWriterApi.importReferences(projectId, picks);
    setImporting(false);
    if (error) { onError(error.message); return; }
    if (data?.skipped?.length) {
      onError(`${data.skipped.length} reference(s) were skipped: ${data.skipped.map(s => s.reason).join('; ')}`);
    }
    onImported(data?.imported?.length || 0);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">

        <div className="flex items-start justify-between px-4 py-3 border-b border-gray-200">
          <div>
            <div className="text-sm font-semibold text-gray-900">Copy source material from another project</div>
            <div className="text-xs text-gray-500">
              Projects you own, plus any shared with your teams or made public.
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none px-2" aria-label="Close">×</button>
        </div>

        <div className="px-4 py-2 border-b border-gray-200 flex items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by reference, project, owner, or URL…"
            className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm"
          />
          {searching && <span className="text-xs text-gray-500 flex-shrink-0">Searching…</span>}
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-4">
          {loading && <div className="text-sm text-gray-500">Loading…</div>}

          {!loading && grouped.length === 0 && (
            <div className="text-sm text-gray-500 italic">
              {query.trim()
                ? 'Nothing matches that search.'
                : 'No other projects you can see have source material attached.'}
            </div>
          )}

          {grouped.map(({ item, rows }) => (
            <div key={item.project_id}>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-semibold text-gray-700">{item.project_title || 'Untitled project'}</span>
                <span className={`text-[11px] px-1.5 py-0.5 rounded border ${VISIBILITY_BADGE[item.visibility] || VISIBILITY_BADGE.private}`}>
                  {/* Never infer the tier from "not mine" — an admin can see other
                      people's private projects, and labelling one "Team" would be
                      a plain lie about how it is shared. */}
                  {item.is_own ? 'Mine' : item.visibility === 'public' ? 'Public' : item.visibility === 'team' ? 'Team' : 'Private'}
                </span>
                {!item.is_own && item.owner_name && (
                  <span className="text-xs text-gray-500">{item.owner_name}</span>
                )}
              </div>

              <ul className="space-y-1">
                {rows.map(r => (
                  <li key={r.reference_id} className="border border-gray-200 rounded px-2 py-1.5">
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={selected.has(r.reference_id)}
                        onChange={() => toggle(r.reference_id)}
                        className="mt-0.5"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-gray-900 break-words">{displayTitle(r)}</div>
                        <div className="text-xs text-gray-500">
                          {TYPE_LABEL[r.type] || r.type}
                          {' · '}
                          {r.content_length ? `${fmt(r.content_length)} chars` : 'no stored text'}
                          {r.has_summary ? ' · summarized' : ''}
                        </div>
                      </div>
                      <button
                        onClick={() => openPreview(r)}
                        disabled={!r.content_length}
                        className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40 flex-shrink-0"
                      >
                        {previewId === r.reference_id ? 'Hide' : 'Preview'}
                      </button>
                    </div>

                    {previewId === r.reference_id && (
                      <div className="mt-2">
                        {previewLoading
                          ? <div className="text-xs text-gray-500">Loading text…</div>
                          : (
                            <MarkdownPreview
                              markdown={previewText.slice(0, 20000)}
                              className="max-h-[35vh] overflow-auto p-2 border border-gray-200 rounded bg-gray-50"
                            />
                          )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 gap-3">
          <div className="text-xs text-gray-500">
            Copies arrive <strong>unapproved</strong> so you can review them. Section selections are
            preserved.
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="text-sm px-3 py-1.5 border border-gray-300 rounded">Cancel</button>
            <button
              onClick={doImport}
              disabled={importing || selected.size === 0}
              className="text-sm px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50"
            >
              {importing
                ? 'Copying…'
                : selected.size === 0
                  ? 'Copy references'
                  : `Copy ${selected.size} reference${selected.size === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReferenceLibraryPicker;
