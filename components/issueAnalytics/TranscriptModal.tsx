import React, { useEffect, useRef, useState } from 'react';
import { api } from '../../services/apiClient';

interface Piece { text: string; highlight: boolean }
interface Turn { role: 'student' | 'protagonist' | 'unknown'; speaker: string; pieces: Piece[] }
interface TranscriptData { student: string; changed_since_analysis: boolean; turns: Turn[] }

interface Props {
  runId: number;
  caseChatId: string;
  start: number | null;
  end: number | null;
  names: boolean;
  onClose: () => void;
}

/** The full transcript a quote came from, scrolled to the quoted passage. */
const TranscriptModal: React.FC<Props> = ({ runId, caseChatId, start, end, names, onClose }) => {
  const [data, setData] = useState<TranscriptData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const markRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const qs = new URLSearchParams();
    if (names) qs.set('names', '1');
    if (start != null && end != null) {
      qs.set('start', String(start));
      qs.set('end', String(end));
    }
    api.get<TranscriptData>(`/issue-analytics/runs/${runId}/transcript/${encodeURIComponent(caseChatId)}?${qs}`)
      .then(r => (r.error ? setError(r.error.message) : setData(r.data)))
      .catch(e => setError(e instanceof Error ? e.message : String(e)));
  }, [runId, caseChatId, start, end, names]);

  useEffect(() => {
    markRef.current?.scrollIntoView({ block: 'center' });
  }, [data]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}
        role="dialog" aria-modal="true" aria-label="Transcript">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <h3 className="font-semibold text-gray-900">Transcript — {data?.student ?? '…'}</h3>
          <button type="button" onClick={onClose} className="text-gray-500 hover:text-gray-800 text-xl leading-none" aria-label="Close">×</button>
        </div>
        {data?.changed_since_analysis && (
          <div className="mx-5 mt-3 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">
            This transcript was changed after it was analyzed, so the highlighted passage may be in the wrong place.
          </div>
        )}
        <div className="overflow-y-auto px-5 py-4 space-y-3 text-sm">
          {error && <p className="text-red-600">{error}</p>}
          {!data && !error && <p className="text-gray-500">Loading…</p>}
          {data?.turns.map((t, i) => (
            <div key={i} className={t.role === 'student' ? 'pl-3 border-l-2 border-blue-300' : 'pl-3 border-l-2 border-gray-200'}>
              {t.speaker && (
                <div className={`text-xs font-semibold mb-0.5 ${t.role === 'student' ? 'text-blue-700' : 'text-gray-500'}`}>{t.speaker}</div>
              )}
              <p className="whitespace-pre-wrap text-gray-800">
                {t.pieces.map((p, j) => p.highlight
                  ? <mark key={j} ref={el => { if (el) markRef.current = el; }} className="bg-yellow-200 rounded px-0.5">{p.text}</mark>
                  : <React.Fragment key={j}>{p.text}</React.Fragment>)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default TranscriptModal;
