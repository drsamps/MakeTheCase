import React, { useEffect, useMemo, useState } from 'react';
import LeanBar from './LeanBar';
import { buildQuoteRotation, quoteWindow } from './quoteSampling';
import { Quote, RunView, ThemeType, ThemeView, TYPE_META, prevalenceText } from './types';

/**
 * Full-screen, one theme per slide, for projecting in class. Uses whatever the screen shows:
 * selected themes only, and names only if "Show names" is on (off by default). Slide 0 is a
 * clickable summary of every issue, so the deck can be navigated rather than only paged.
 *
 * Quotes start hidden on every slide and are revealed on request, so the slide opens the
 * discussion rather than answering it. When revealed they come from a rotation that spreads
 * across students (see quoteSampling.ts) instead of always the first three.
 */

const QUOTES_PER_SET = 3;
const TYPES: ThemeType[] = ['topic', 'argument', 'friction'];

const FONT_KEY = 'mtc_ia_present_font';
const WIDTH_KEY = 'mtc_ia_present_width';
const DARK_KEY = 'mtc_ia_present_dark';
// 1 is the size this screen shipped with; the range covers a small laptop to a distant projector.
const FONT_SCALES = [0.6, 0.75, 0.9, 1, 1.15, 1.35, 1.6, 2];
const DEFAULT_FONT = 3;
// '64rem' is the old max-w-5xl.
const WIDTHS = ['48rem', '64rem', '80rem', '100%'];
const WIDTH_LABELS = ['narrow', 'normal', 'wide', 'full width'];
const DEFAULT_WIDTH = 1;

/**
 * Two palettes for the slide. Measured WCAG contrast against the dark page (zinc-950 #09090b):
 *   titles zinc-50 19.1:1, quotes zinc-100 18.1:1, descriptions zinc-300 13.5:1,
 *   bylines/counts zinc-400 7.8:1 -- every text role AAA (7:1+). Button borders zinc-500 4.1:1
 *   and the quote bar blue-400 7.8:1 clear the 3:1 rule for UI boundaries. Keep new text roles
 *   at zinc-400 or lighter; zinc-500 text drops to 4.1:1.
 * Dark is near-black rather than #000 on purpose: pure black plus white text haloes badly on
 * a projector. The type badges keep their light pills in both modes -- they carry their own
 * background, so they stay legible and give the slide its only colour.
 */
const PALETTES = {
  light: {
    page: 'bg-white',
    primary: 'text-gray-900',
    secondary: 'text-gray-600',
    body: 'text-gray-800',
    muted: 'text-gray-500',
    border: 'border-gray-300',
    rule: 'border-gray-200',
    hover: 'hover:bg-gray-50',
    rowHover: 'hover:bg-gray-100',
    linkHover: 'hover:text-gray-900',
    leader: 'border-gray-400',
  },
  dark: {
    page: 'bg-zinc-950',
    primary: 'text-zinc-50',
    secondary: 'text-zinc-300',
    body: 'text-zinc-100',
    muted: 'text-zinc-400',
    border: 'border-zinc-500',
    rule: 'border-zinc-700',
    hover: 'hover:bg-zinc-800',
    rowHover: 'hover:bg-zinc-800',
    linkHover: 'hover:text-zinc-50',
    leader: 'border-zinc-600',
  },
};

function readStep(key: string, fallback: number, length: number): number {
  try {
    // Number(null) is 0 and would pass every check below, so an unset key has to be caught
    // first -- otherwise the deck always opens at the smallest step instead of the default.
    const raw = localStorage.getItem(key);
    if (raw === null || raw.trim() === '') return fallback;
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 0 && n < length) return n;
  } catch { /* private browsing */ }
  return fallback;
}

function writeStep(key: string, value: number | boolean) {
  try { localStorage.setItem(key, typeof value === 'boolean' ? (value ? '1' : '0') : String(value)); }
  catch { /* private browsing */ }
}

function readFlag(key: string): boolean {
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}

/** "19 students - 41%". prevalenceText is too long to read on a summary row. */
function shortPrevalence(theme: ThemeView): string {
  const pct = theme.prevalence_pct == null ? '—' : `${Math.round(theme.prevalence_pct)}%`;
  return `${theme.students} student${theme.students === 1 ? '' : 's'} · ${pct}`;
}

/**
 * With names off this is plain text, exactly as before. With names on it is click-to-reveal,
 * so a name reaches the projector only when the presenter deliberately puts it there.
 */
const QuoteByline: React.FC<{ quote: Quote; revealable: boolean; style: React.CSSProperties; c: typeof PALETTES.light }> =
  ({ quote, revealable, style, c }) => {
    const [shown, setShown] = useState(false);
    if (!revealable || quote.student === quote.student_anon) {
      return <footer className={`mt-1 ${c.muted}`} style={style}>&mdash; {quote.student_anon}</footer>;
    }
    return (
      <footer className={`mt-1 ${c.muted}`} style={style}>
        &mdash;{' '}
        <button type="button" onClick={() => setShown(s => !s)}
          className={`underline decoration-dotted underline-offset-2 ${c.linkHover}`}
          title={shown ? "Hide the student's name" : "Show the student's name"}>
          {shown ? quote.student : quote.student_anon}
        </button>
      </footer>
    );
  };

const PresentMode: React.FC<{ view: RunView; onClose: () => void }> = ({ view, onClose }) => {
  const themes = view.themes.filter(t => t.selected);
  // Slide 0 is the summary, so slide n shows themes[n - 1].
  const [i, setI] = useState(0);
  const theme = i > 0 ? themes[i - 1] : null;

  const [showQuotes, setShowQuotes] = useState(false);
  const [cursors, setCursors] = useState<Record<number, number>>({});
  const [fontStep, setFontStep] = useState(() => readStep(FONT_KEY, DEFAULT_FONT, FONT_SCALES.length));
  const [widthStep, setWidthStep] = useState(() => readStep(WIDTH_KEY, DEFAULT_WIDTH, WIDTHS.length));
  const [dark, setDark] = useState(() => readFlag(DARK_KEY));

  const c = dark ? PALETTES.dark : PALETTES.light;

  // Built once for the deck, so paging away and back never reshuffles under the presenter.
  const rotations = useMemo(() => {
    const map = new Map<number, Quote[]>();
    for (const t of view.themes) map.set(t.id, buildQuoteRotation(t.quotes, `${view.run.id}:${t.id}`));
    return map;
  }, [view.run.id, view.themes]);

  // Every slide arrives with its quotes hidden, including one already visited.
  useEffect(() => { setShowQuotes(false); }, [i]);

  const scale = FONT_SCALES[fontStep];
  const fs = (rem: number): React.CSSProperties => ({ fontSize: `${(rem * scale).toFixed(3)}rem` });

  const stepFont = (d: number) => setFontStep(n => {
    const next = Math.min(Math.max(n + d, 0), FONT_SCALES.length - 1);
    writeStep(FONT_KEY, next);
    return next;
  });
  const stepWidth = (d: number) => setWidthStep(n => {
    const next = Math.min(Math.max(n + d, 0), WIDTHS.length - 1);
    writeStep(WIDTH_KEY, next);
    return next;
  });
  const toggleDark = () => setDark(d => {
    writeStep(DARK_KEY, !d);
    return !d;
  });
  const otherQuotes = (themeId: number) => {
    setShowQuotes(true);
    setCursors(cur => ({ ...cur, [themeId]: (cur[themeId] || 0) + QUOTES_PER_SET }));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Leave browser shortcuts alone: Ctrl/Cmd +/- is how people zoom on a projector.
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key;
      if (k === 'Escape') onClose();
      else if (k === 'ArrowRight' || k === ' ' || k === 'PageDown') setI(n => Math.min(n + 1, themes.length));
      else if (k === 'ArrowLeft' || k === 'PageUp') setI(n => Math.max(n - 1, 0));
      else if (k === 'Home' || k.toLowerCase() === 's') setI(0);
      else if (k === '+' || k === '=') stepFont(1);
      else if (k === '-' || k === '_') stepFont(-1);
      else if (k === ']') stepWidth(1);
      else if (k === '[') stepWidth(-1);
      else if (k.toLowerCase() === 'd') toggleDark();
      else if (k.toLowerCase() === 'q') setShowQuotes(s => !s);
      else if (k.toLowerCase() === 'r') { if (theme) otherQuotes(theme.id); }
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, themes.length, theme]);

  const rotation = theme ? rotations.get(theme.id) || [] : [];
  const cursor = theme ? cursors[theme.id] || 0 : 0;
  const shownQuotes = quoteWindow(rotation, cursor, QUOTES_PER_SET);
  const hasMore = rotation.length > QUOTES_PER_SET;

  const btn = `px-3 py-1 rounded border ${c.border} ${c.hover} disabled:opacity-40`;
  const action = `px-4 py-2 rounded border ${c.border} ${c.hover}`;

  return (
    <div className={`fixed inset-0 z-50 ${c.page} flex flex-col`} role="dialog" aria-modal="true" aria-label="Present themes">
      <div className={`flex items-center justify-between px-8 py-3 border-b ${c.rule} text-sm ${c.muted}`}>
        <span className="truncate">{view.run.case_title}{view.run.scenario_name ? ` — ${view.run.scenario_name}` : ''}</span>
        <span className="flex items-center gap-4 shrink-0">
          <span className="flex items-center gap-1" title={`Text size: ${Math.round(scale * 100)}%`}>
            <button type="button" onClick={() => stepFont(-1)} disabled={fontStep === 0}
              className={btn} aria-label="Smaller text">&minus;</button>
            <span className="px-1">A</span>
            <button type="button" onClick={() => stepFont(1)} disabled={fontStep === FONT_SCALES.length - 1}
              className={btn} aria-label="Larger text">+</button>
          </span>
          <span className="flex items-center gap-1" title={`Slide width: ${WIDTH_LABELS[widthStep]}`}>
            <button type="button" onClick={() => stepWidth(-1)} disabled={widthStep === 0}
              className={btn} aria-label="Narrower slide">&rsaquo;&lsaquo;</button>
            <button type="button" onClick={() => stepWidth(1)} disabled={widthStep === WIDTHS.length - 1}
              className={btn} aria-label="Wider slide">&lsaquo;&rsaquo;</button>
          </span>
          <button type="button" onClick={toggleDark} className={btn} aria-pressed={dark}
            title={dark ? 'Switch to a light slide (D)' : 'Switch to a dark slide (D)'}>
            {dark ? '☀ Light' : '☾ Dark'}
          </button>
          {i > 0 && <button type="button" onClick={() => setI(0)} className={btn}>Summary (S)</button>}
          <span>{i === 0 ? 'Summary' : `${i} / ${themes.length}`}</span>
          <button type="button" onClick={onClose} className={btn}>Exit (Esc)</button>
        </span>
      </div>

      {themes.length === 0 ? (
        <div className={`flex-1 flex items-center justify-center ${c.muted} text-xl`}>No themes are selected.</div>
      ) : (
        <div className="flex-1 overflow-y-auto px-12 py-10 w-full mx-auto" style={{ maxWidth: WIDTHS[widthStep] }}>
          {!theme ? (
            <>
              <h2 className={`font-bold ${c.primary}`} style={fs(2.25)}>Summary of Student Issues</h2>
              {TYPES.map(type => {
                const list = themes.filter(t => t.theme_type === type);
                if (list.length === 0) return null;
                return (
                  <section key={type} className="mt-8">
                    <h3>
                      <span className={`inline-block font-medium px-2 py-0.5 rounded ${TYPE_META[type].badge}`}
                        style={fs(1.125)}>{TYPE_META[type].label}</span>
                    </h3>
                    <ul className="mt-2">
                      {list.map(t => (
                        <li key={t.id}>
                          <button type="button" onClick={() => setI(themes.indexOf(t) + 1)}
                            className={`w-full text-left py-1.5 px-2 -mx-2 rounded ${c.rowHover} flex items-baseline gap-3`}>
                            <span className={`${c.primary} min-w-0`} style={fs(1.375)}>{t.label}</span>
                            {/* Table-of-contents leader, so a label and its count can be matched across a
                                wide slide. An empty flex item baseline-aligns on its bottom edge, which puts
                                the dots on the text baseline. */}
                            <span aria-hidden="true" className={`flex-1 min-w-8 border-b-2 border-dotted ${c.leader}`} />
                            <span className={`${c.muted} whitespace-nowrap`} style={fs(1)}>{shortPrevalence(t)}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </>
          ) : (
            <>
              <span className={`inline-block font-medium px-2 py-0.5 rounded ${TYPE_META[theme.theme_type].badge}`}
                style={fs(0.875)}>
                {TYPE_META[theme.theme_type].label.replace(/s$/, '')}
              </span>
              <h2 className={`mt-3 font-bold ${c.primary}`} style={fs(2.25)}>{theme.label}</h2>
              {theme.description && <p className={`mt-3 ${c.secondary}`} style={fs(1.25)}>{theme.description}</p>}
              <p className={`mt-6 font-semibold ${c.body}`} style={fs(1.5)}>{prevalenceText(theme, view.run)}</p>
              <div className="mt-4 max-w-2xl"><LeanBar theme={theme} axis={view.axis} dark={dark} /></div>

              {!showQuotes ? (
                <div className="mt-10 flex flex-wrap items-center gap-4">
                  <button type="button" onClick={() => setShowQuotes(true)} disabled={rotation.length === 0}
                    className={`px-5 py-2.5 rounded border ${c.border} ${c.hover} ${c.body} disabled:opacity-40`}
                    style={fs(1.125)}>
                    Show quotes (Q)
                  </button>
                  <span className={c.muted} style={fs(1)}>
                    {rotation.length === 0
                      ? 'No quotes for this theme'
                      : `${rotation.length} student quote${rotation.length === 1 ? '' : 's'}`}
                  </span>
                </div>
              ) : (
                <>
                  <div className="mt-10 space-y-6">
                    {shownQuotes.map(q => (
                      <blockquote key={q.mention_id} className={`border-l-4 border-blue-400 pl-5 ${c.body} leading-snug`}
                        style={fs(1.5)}>
                        &ldquo;{q.quote}&rdquo;
                        <QuoteByline quote={q} revealable={view.names} style={fs(1)} c={c} />
                      </blockquote>
                    ))}
                  </div>
                  <div className="mt-8 flex flex-wrap items-center gap-4">
                    {hasMore && (
                      <button type="button" onClick={() => otherQuotes(theme.id)}
                        className={`${action} ${c.body}`} style={fs(1)}>
                        Other student quotes (R)
                      </button>
                    )}
                    <button type="button" onClick={() => setShowQuotes(false)}
                      className={`${action} ${c.body}`} style={fs(1)}>
                      Hide quotes
                    </button>
                    <span className={c.muted} style={fs(0.875)}>
                      {shownQuotes.length} of {rotation.length} quote{rotation.length === 1 ? '' : 's'}
                    </span>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}

      <div className={`flex justify-between px-8 py-3 border-t ${c.rule}`}>
        <button type="button" disabled={i === 0} onClick={() => setI(n => n - 1)}
          className={`px-4 py-2 rounded border ${c.border} ${c.body} disabled:opacity-40`}>&larr; Previous</button>
        <button type="button" disabled={i >= themes.length} onClick={() => setI(n => n + 1)}
          className={`px-4 py-2 rounded border ${c.border} ${c.body} disabled:opacity-40`}>Next &rarr;</button>
      </div>
    </div>
  );
};

export default PresentMode;
