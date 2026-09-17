import React from 'react';
import { LEAN_COLORS, LeanAxis, NO_LEAN_COLOR, ThemeView } from './types';

/** Stacked bar: how the students who raised a theme split across the scenario's positions. */
const LeanBar: React.FC<{ theme: ThemeView; axis: LeanAxis; compact?: boolean }> = ({ theme, axis, compact }) => {
  const total = theme.students;
  if (total === 0) {
    return <div className="text-xs text-gray-400">No students yet</div>;
  }
  const parts = axis.leans.map((l, i) => ({
    key: l.key,
    label: l.label,
    detail: l.detail,
    n: theme.lean[l.key] || 0,
    color: LEAN_COLORS[i % LEAN_COLORS.length],
  }));
  if (theme.no_lean > 0) {
    parts.push({ key: '_none', label: 'no clear lean', detail: null, n: theme.no_lean, color: NO_LEAN_COLOR });
  }
  const shown = parts.filter(p => p.n > 0);

  return (
    <div>
      <div className={`flex w-full overflow-hidden rounded ${compact ? 'h-2' : 'h-3'} bg-gray-100`}
        role="img"
        aria-label={shown.map(p => `${p.label}: ${p.n}`).join(', ')}>
        {shown.map(p => (
          <div key={p.key} style={{ width: `${(p.n / total) * 100}%`, background: p.color }}
            title={`${p.label}${p.detail ? ` — ${p.detail}` : ''}: ${p.n} of ${total}`} />
        ))}
      </div>
      {!compact && (
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-600">
          {shown.map(p => (
            <span key={p.key} className="inline-flex items-center gap-1" title={p.detail || undefined}>
              <span className="inline-block w-2 h-2 rounded-sm" style={{ background: p.color }} />
              {p.label} {p.n}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

export default LeanBar;
