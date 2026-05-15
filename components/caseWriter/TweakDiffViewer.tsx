import React, { useMemo, useState } from 'react';
import * as Diff from 'diff';

interface Props {
  original: string;
  tweaked: string;
  onApply: (merged: string) => void;
  onCancel: () => void;
}

// One contiguous block of change in the diff.
// `unchanged` blocks render as collapsible separators between hunks.
type Block =
  | { kind: 'unchanged'; text: string }
  | {
      kind: 'change';
      hunkIdx: number;
      leftText: string;       // the removed (original) content
      rightText: string;      // the added (tweaked) content
      decision: 'pending' | 'kept-left' | 'used-right';
    };

function countWords(text: string): number {
  const t = (text || '').trim();
  if (!t) return 0;
  return t.split(/\s+/).length;
}

// Given a "left" string (removed text) and "right" string (added text),
// produce HTML-safe spans showing character-level diffs:
//   - left side: words removed shown red strike-through, unchanged in normal text
//   - right side: words added shown green-highlighted, unchanged in normal text
function renderInlineDiff(left: string, right: string): { leftNodes: React.ReactNode[]; rightNodes: React.ReactNode[] } {
  const parts = Diff.diffWordsWithSpace(left, right);
  const leftNodes: React.ReactNode[] = [];
  const rightNodes: React.ReactNode[] = [];
  parts.forEach((p, i) => {
    if (p.added) {
      rightNodes.push(<span key={`r-${i}`} className="bg-green-100 text-green-900">{p.value}</span>);
    } else if (p.removed) {
      leftNodes.push(<span key={`l-${i}`} className="bg-red-100 text-red-900 line-through">{p.value}</span>);
    } else {
      leftNodes.push(<span key={`l-${i}`}>{p.value}</span>);
      rightNodes.push(<span key={`r-${i}`}>{p.value}</span>);
    }
  });
  return { leftNodes, rightNodes };
}

// Build the merged result by walking blocks in order. For each change-block,
// pick the side dictated by its current decision ('used-right' or 'kept-left').
function buildMerged(blocks: Block[]): string {
  let out = '';
  for (const b of blocks) {
    if (b.kind === 'unchanged') {
      out += b.text;
    } else {
      const useRight = b.decision === 'used-right' || b.decision === 'pending';
      out += useRight ? b.rightText : b.leftText;
    }
  }
  return out;
}

const TweakDiffViewer: React.FC<Props> = ({ original, tweaked, onApply, onCancel }) => {
  // Pre-compute the change blocks once. Toggling a hunk's decision only updates
  // local state; we never re-run the diff.
  const initialBlocks = useMemo<Block[]>(() => {
    const segments = Diff.diffLines(original, tweaked);
    const blocks: Block[] = [];
    let hunkCounter = 0;
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i];
      if (!s.added && !s.removed) {
        blocks.push({ kind: 'unchanged', text: s.value });
        continue;
      }
      // Pair adjacent removed+added segments as one hunk; otherwise treat the
      // single segment as a pure addition or deletion.
      const next = segments[i + 1];
      const isRemoved = !!s.removed;
      const isAdded = !!s.added;
      let leftText = '';
      let rightText = '';
      if (isRemoved && next && next.added) {
        leftText = s.value;
        rightText = next.value;
        i++; // consume the paired added segment
      } else if (isAdded && next && next.removed) {
        // unusual ordering but handle it
        leftText = next.value;
        rightText = s.value;
        i++;
      } else if (isRemoved) {
        leftText = s.value;
        rightText = '';
      } else {
        leftText = '';
        rightText = s.value;
      }
      blocks.push({
        kind: 'change',
        hunkIdx: hunkCounter++,
        leftText,
        rightText,
        decision: 'pending'
      });
    }
    return blocks;
  }, [original, tweaked]);

  const [blocks, setBlocks] = useState<Block[]>(initialBlocks);
  const [expandedUnchanged, setExpandedUnchanged] = useState<Record<number, boolean>>({});

  function setDecision(hunkIdx: number, decision: 'kept-left' | 'used-right') {
    setBlocks(prev => prev.map(b =>
      b.kind === 'change' && b.hunkIdx === hunkIdx ? { ...b, decision } : b
    ));
  }

  function applyAllRight() {
    onApply(buildMerged(blocks.map(b => b.kind === 'change' && b.decision === 'pending' ? { ...b, decision: 'used-right' } : b)));
  }

  const hunkCount = blocks.filter(b => b.kind === 'change').length;
  const previewMerged = useMemo(() => buildMerged(blocks), [blocks]);
  const wordsBefore = countWords(original);
  const wordsAfter = countWords(previewMerged);
  const wordsDelta = wordsAfter - wordsBefore;
  const pctDelta = wordsBefore > 0 ? ((wordsDelta / wordsBefore) * 100).toFixed(1) : '0';

  if (hunkCount === 0) {
    return (
      <div className="border border-amber-200 bg-amber-50 rounded-md p-4 space-y-2">
        <p className="text-sm text-amber-900">
          The tweak returned an identical document — no changes to review.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="border border-blue-200 bg-blue-50 rounded-md">
      <div className="px-4 py-3 border-b border-blue-200 bg-blue-100 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-blue-900">
          <span className="font-semibold">Tweak preview:</span>{' '}
          {hunkCount} change-hunk{hunkCount === 1 ? '' : 's'} ·{' '}
          {wordsBefore.toLocaleString()} → {wordsAfter.toLocaleString()} words{' '}
          <span className={wordsDelta === 0 ? 'text-gray-600' : wordsDelta > 0 ? 'text-green-700' : 'text-red-700'}>
            ({wordsDelta >= 0 ? '+' : ''}{wordsDelta.toLocaleString()}, {wordsDelta >= 0 ? '+' : ''}{pctDelta}%)
          </span>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={applyAllRight}
            className="px-3 py-1.5 text-sm font-semibold bg-green-600 hover:bg-green-700 text-white rounded"
          >
            Apply changes
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-sm border border-gray-300 bg-white rounded hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 divide-x divide-blue-200">
        <div className="px-3 py-2 text-xs font-semibold uppercase text-gray-600 bg-white">Original</div>
        <div className="px-3 py-2 text-xs font-semibold uppercase text-gray-600 bg-white">Tweaked</div>
      </div>

      <div className="bg-white max-h-[60vh] overflow-y-auto">
        {blocks.map((b, idx) => {
          if (b.kind === 'unchanged') {
            const lineCount = b.text.split('\n').length - 1;
            const expanded = !!expandedUnchanged[idx];
            // Only collapse blocks longer than 3 lines.
            if (lineCount > 3 && !expanded) {
              return (
                <div key={idx} className="grid grid-cols-2 divide-x divide-blue-200">
                  {[0, 1].map(col => (
                    <button
                      key={col}
                      type="button"
                      onClick={() => setExpandedUnchanged(prev => ({ ...prev, [idx]: true }))}
                      className="text-xs italic text-gray-400 hover:text-gray-600 hover:bg-gray-50 text-left px-3 py-1 border-y border-gray-100"
                    >
                      … {lineCount} unchanged lines …
                    </button>
                  ))}
                </div>
              );
            }
            return (
              <div key={idx} className="grid grid-cols-2 divide-x divide-blue-200">
                {[b.text, b.text].map((t, col) => (
                  <pre
                    key={col}
                    className="whitespace-pre-wrap break-words font-mono text-xs text-gray-700 px-3 py-1"
                  >{t}</pre>
                ))}
              </div>
            );
          }
          // Change hunk
          const { leftNodes, rightNodes } = renderInlineDiff(b.leftText, b.rightText);
          const usingRight = b.decision === 'used-right' || b.decision === 'pending';
          return (
            <div key={idx} className="grid grid-cols-2 divide-x divide-blue-200 border-y border-blue-100">
              <div className={`px-3 py-2 text-xs font-mono whitespace-pre-wrap break-words ${b.decision === 'kept-left' ? 'bg-blue-50' : 'bg-red-50/40'}`}>
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-[10px] uppercase font-semibold text-gray-500">Hunk {b.hunkIdx + 1} · Original</span>
                  <button
                    type="button"
                    onClick={() => setDecision(b.hunkIdx, 'kept-left')}
                    disabled={b.decision === 'kept-left'}
                    className={`text-[10px] px-1.5 py-0.5 rounded border ${b.decision === 'kept-left' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-blue-700 border-blue-300 hover:bg-blue-50'}`}
                  >
                    Keep left
                  </button>
                </div>
                <div>{leftNodes.length ? leftNodes : <em className="text-gray-400">(nothing on this side)</em>}</div>
              </div>
              <div className={`px-3 py-2 text-xs font-mono whitespace-pre-wrap break-words ${usingRight ? 'bg-green-50/60' : 'bg-white'}`}>
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-[10px] uppercase font-semibold text-gray-500">Hunk {b.hunkIdx + 1} · Tweaked</span>
                  <button
                    type="button"
                    onClick={() => setDecision(b.hunkIdx, 'used-right')}
                    disabled={b.decision === 'used-right' || b.decision === 'pending'}
                    className={`text-[10px] px-1.5 py-0.5 rounded border ${usingRight ? 'bg-green-600 text-white border-green-600' : 'bg-white text-green-700 border-green-300 hover:bg-green-50'}`}
                  >
                    Use right
                  </button>
                </div>
                <div>{rightNodes.length ? rightNodes : <em className="text-gray-400">(nothing on this side)</em>}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default TweakDiffViewer;
