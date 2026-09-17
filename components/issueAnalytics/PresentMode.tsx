import React, { useEffect, useState } from 'react';
import LeanBar from './LeanBar';
import { RunView, TYPE_META, prevalenceText } from './types';

/**
 * Full-screen, one theme per slide, for projecting in class. Uses whatever the screen
 * shows: selected themes only, and names only if "Show names" is on (off by default).
 */
const PresentMode: React.FC<{ view: RunView; onClose: () => void }> = ({ view, onClose }) => {
  const themes = view.themes.filter(t => t.selected);
  const [i, setI] = useState(0);
  const theme = themes[i];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') setI(n => Math.min(n + 1, themes.length - 1));
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') setI(n => Math.max(n - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, themes.length]);

  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col" role="dialog" aria-modal="true" aria-label="Present themes">
      <div className="flex items-center justify-between px-8 py-3 border-b border-gray-200 text-sm text-gray-500">
        <span>{view.run.case_title}{view.run.scenario_name ? ` — ${view.run.scenario_name}` : ''}</span>
        <span className="flex items-center gap-4">
          {themes.length > 0 && <span>{i + 1} / {themes.length}</span>}
          <button type="button" onClick={onClose} className="px-3 py-1 rounded border border-gray-300 hover:bg-gray-50">Exit (Esc)</button>
        </span>
      </div>

      {!theme ? (
        <div className="flex-1 flex items-center justify-center text-gray-500 text-xl">No themes are selected.</div>
      ) : (
        <div className="flex-1 overflow-y-auto px-12 py-10 max-w-5xl w-full mx-auto">
          <span className={`inline-block text-sm font-medium px-2 py-0.5 rounded ${TYPE_META[theme.theme_type].badge}`}>
            {TYPE_META[theme.theme_type].label.replace(/s$/, '')}
          </span>
          <h2 className="mt-3 text-4xl font-bold text-gray-900">{theme.label}</h2>
          {theme.description && <p className="mt-3 text-xl text-gray-600">{theme.description}</p>}
          <p className="mt-6 text-2xl font-semibold text-gray-800">{prevalenceText(theme, view.run)}</p>
          <div className="mt-4 max-w-2xl"><LeanBar theme={theme} axis={view.axis} /></div>
          <div className="mt-10 space-y-6">
            {theme.quotes.slice(0, 3).map(q => (
              <blockquote key={q.mention_id} className="border-l-4 border-blue-400 pl-5 text-2xl text-gray-800 leading-snug">
                “{q.quote}”
                <footer className="mt-1 text-base text-gray-500">— {q.student}</footer>
              </blockquote>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-between px-8 py-3 border-t border-gray-200">
        <button type="button" disabled={i === 0} onClick={() => setI(n => n - 1)}
          className="px-4 py-2 rounded border border-gray-300 disabled:opacity-40">← Previous</button>
        <button type="button" disabled={i >= themes.length - 1} onClick={() => setI(n => n + 1)}
          className="px-4 py-2 rounded border border-gray-300 disabled:opacity-40">Next →</button>
      </div>
    </div>
  );
};

export default PresentMode;
