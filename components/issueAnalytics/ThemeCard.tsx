import React, { useState } from 'react';
import LeanBar from './LeanBar';
import { LeanAxis, Quote, RunSummary, ThemeView, TYPE_META, money, prevalenceText } from './types';

interface Props {
  theme: ThemeView;
  run: RunSummary;
  axis: LeanAxis;
  otherThemes: ThemeView[];
  editable: boolean;
  busy: boolean;
  onPatch: (patch: Partial<Pick<ThemeView, 'label' | 'description' | 'selected'>>) => void;
  onMergeInto: (targetId: number) => void;
  onDelete: () => void;
  onRescan: () => void;
  rescanEstimate?: { chats: number; est_cost_usd: number | null; exceeds_cap: boolean } | null;
  onOpenQuote: (q: Quote) => void;
}

const QUOTES_SHOWN = 3;

const ThemeCard: React.FC<Props> = ({
  theme, run, axis, otherThemes, editable, busy,
  onPatch, onMergeInto, onDelete, onRescan, rescanEstimate, onOpenQuote,
}) => {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(theme.label);
  const [description, setDescription] = useState(theme.description || '');
  const [showAll, setShowAll] = useState(false);
  const [quotesOpen, setQuotesOpen] = useState(false);

  const save = () => {
    const patch: Partial<Pick<ThemeView, 'label' | 'description'>> = {};
    if (label.trim() && label.trim() !== theme.label) patch.label = label.trim();
    if (description !== (theme.description || '')) patch.description = description;
    if (Object.keys(patch).length) onPatch(patch);
    setEditing(false);
  };

  const quotes = showAll ? theme.quotes : theme.quotes.slice(0, QUOTES_SHOWN);
  const rescanning = theme.rescan_status === 'pending' || theme.rescan_status === 'running';
  const needsRescan = theme.origin === 'instructor' && theme.rescan_status === 'none';

  return (
    <div className={`ia-theme rounded-lg border p-4 bg-white ${theme.selected ? 'border-gray-200' : 'border-dashed border-gray-300 opacity-60 ia-unselected'}`}>
      <div className="flex items-start gap-3">
        {editable && (
          <input type="checkbox" checked={theme.selected} disabled={busy}
            onChange={e => onPatch({ selected: e.target.checked })}
            className="mt-1 w-4 h-4 ia-no-print" aria-label={`Include "${theme.label}"`} />
        )}
        <div className="flex-1 min-w-0">
          {editing ? (
            <div className="space-y-2 ia-no-print">
              <input value={label} onChange={e => setLabel(e.target.value)} maxLength={200}
                className="w-full border border-gray-300 rounded px-2 py-1 text-sm font-semibold" aria-label="Theme name" />
              <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} maxLength={2000}
                className="w-full border border-gray-300 rounded px-2 py-1 text-sm" aria-label="Theme description" />
              <div className="flex gap-2">
                <button type="button" onClick={save} className="px-3 py-1 text-xs rounded bg-blue-600 text-white">Save</button>
                <button type="button" onClick={() => { setEditing(false); setLabel(theme.label); setDescription(theme.description || ''); }}
                  className="px-3 py-1 text-xs rounded border border-gray-300">Cancel</button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="font-semibold text-gray-900">{theme.label}</h4>
                {theme.origin === 'instructor' && (
                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-800">added by you</span>
                )}
              </div>
              {theme.description && <p className="text-sm text-gray-600 mt-0.5">{theme.description}</p>}
            </>
          )}

          <p className="mt-2 text-sm font-medium text-gray-800">{prevalenceText(theme, run)}</p>
          <div className="mt-1.5 max-w-xl"><LeanBar theme={theme} axis={axis} /></div>

          {needsRescan && editable && (
            <div className="mt-3 rounded-md bg-purple-50 border border-purple-200 px-3 py-2 text-sm ia-no-print">
              <p className="text-purple-900">
                No students are counted for this theme until the transcripts are checked for it.
                {rescanEstimate && <> That means {rescanEstimate.chats} AI calls, about <strong>{money(rescanEstimate.est_cost_usd)}</strong>.</>}
              </p>
              {rescanEstimate?.exceeds_cap && (
                <p className="text-red-700 mt-1">That is more than is left of this week’s AI budget.</p>
              )}
              <button type="button" disabled={busy || !!rescanEstimate?.exceeds_cap} onClick={onRescan}
                className="mt-2 px-3 py-1 text-xs rounded bg-purple-600 text-white disabled:opacity-50">
                Check {rescanEstimate ? rescanEstimate.chats : ''} transcripts for this theme
              </button>
            </div>
          )}
          {rescanning && (
            <p className="mt-2 text-sm text-purple-800">Checking transcripts… {theme.rescan_done} of {run.chats_done}</p>
          )}
          {theme.rescan_status === 'failed' && (
            <p className="mt-2 text-sm text-red-700">
              Re-scan stopped: {theme.rescan_error}
              {editable && <button type="button" onClick={onRescan} disabled={busy} className="ml-2 underline ia-no-print">Try again</button>}
            </p>
          )}
          {theme.rescan_status === 'done' && theme.rescan_error && (
            <p className="mt-2 text-xs text-amber-700">{theme.rescan_error}</p>
          )}

          {theme.quotes.length > 0 && (
            <div className="mt-3">
              <button type="button" onClick={() => setQuotesOpen(o => !o)}
                className="text-sm text-blue-700 hover:underline ia-no-print" aria-expanded={quotesOpen}>
                {quotesOpen ? '▾' : '▸'} {theme.quotes.length} quote{theme.quotes.length === 1 ? '' : 's'}
              </button>
              <ul className={`mt-2 space-y-2 ${quotesOpen ? '' : 'hidden ia-print-show'}`}>
                {quotes.map(q => (
                  <li key={q.mention_id} className="border-l-2 border-gray-300 pl-3 text-sm">
                    <span className="text-gray-800">“{q.quote}”</span>
                    <span className="text-gray-500"> — {q.student}</span>
                    {q.quote_start != null && (
                      <button type="button" onClick={() => onOpenQuote(q)}
                        className="ml-2 text-xs text-blue-700 hover:underline ia-no-print">in transcript</button>
                    )}
                  </li>
                ))}
              </ul>
              {quotesOpen && theme.quotes.length > QUOTES_SHOWN && (
                <button type="button" onClick={() => setShowAll(s => !s)} className="mt-1 text-xs text-blue-700 hover:underline ia-no-print">
                  {showAll ? 'Show fewer' : `Show all ${theme.quotes.length}`}
                </button>
              )}
            </div>
          )}
        </div>

        {editable && !editing && (
          <div className="flex flex-col items-end gap-1 text-xs ia-no-print">
            <button type="button" onClick={() => setEditing(true)} disabled={busy} className="text-blue-700 hover:underline">Rename</button>
            {otherThemes.length > 0 && (
              <select value="" disabled={busy || rescanning}
                onChange={e => { if (e.target.value) onMergeInto(Number(e.target.value)); }}
                className="border border-gray-300 rounded px-1 py-0.5 text-xs max-w-[10rem]" aria-label="Merge into another theme">
                <option value="">Merge into…</option>
                {otherThemes.map(o => (
                  <option key={o.id} value={o.id}>{TYPE_META[o.theme_type].label}: {o.label}</option>
                ))}
              </select>
            )}
            <button type="button" onClick={onDelete} disabled={busy || rescanning} className="text-red-700 hover:underline">Remove</button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ThemeCard;
