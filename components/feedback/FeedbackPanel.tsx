import React, { useEffect, useRef, useState } from 'react';
import { getApiBaseUrl } from '../../services/apiClient';
import { getCurrentScreen } from '../../services/screenContext';

interface Category {
  id: number;
  name: string;
  description?: string | null;
}

interface FeedbackPanelProps {
  open: boolean;
  onClose: () => void;
}

type SubmissionType = 'bug' | 'idea' | 'question' | 'praise';
type Sentiment = 'positive' | 'neutral' | 'negative';

const SUBMISSION_TYPES: { value: SubmissionType; label: string }[] = [
  { value: 'bug', label: 'Bug' },
  { value: 'idea', label: 'Idea' },
  { value: 'question', label: 'Question' },
  { value: 'praise', label: 'Praise' },
];

const SENTIMENTS: { value: Sentiment; emoji: string; label: string }[] = [
  { value: 'positive', emoji: '😀', label: 'Positive' },
  { value: 'neutral', emoji: '😐', label: 'Neutral' },
  { value: 'negative', emoji: '😞', label: 'Negative' },
];

const MAX_BODY_LEN = 5000;

function getActiveToken(): string | null {
  const isAdmin = window.location.hash.startsWith('#/admin') || window.location.hash.startsWith('#/case-writer');
  return localStorage.getItem(isAdmin ? 'admin_auth_token' : 'student_auth_token');
}

function detectCaseId(): string | null {
  const hash = window.location.hash;
  const match = hash.match(/case[s]?\/([\w-]+)/i);
  return match ? match[1] : null;
}

function describeScreen(): string {
  const fromStore = getCurrentScreen();
  if (fromStore) return fromStore;
  const hash = window.location.hash || '';
  if (hash.startsWith('#/case-writer')) return 'Case Writer';
  if (hash.startsWith('#/admin')) {
    const sub = hash.split('#').slice(2).join('#');
    return sub ? `Instructor Dashboard (${sub})` : 'Instructor Dashboard';
  }
  const caseId = detectCaseId();
  if (caseId) return `Case page (case ${caseId})`;
  if (!hash || hash === '#' || hash === '#/') return 'Student home';
  return `Page ${hash}`;
}

function isUserInterfaceCategory(name?: string | null): boolean {
  if (!name) return false;
  return name.trim().toLowerCase() === 'user interface';
}

const FeedbackPanel: React.FC<FeedbackPanelProps> = ({ open, onClose }) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [submissionType, setSubmissionType] = useState<SubmissionType | null>(null);
  const [sentiment, setSentiment] = useState<Sentiment | null>(null);
  const [categoryId, setCategoryId] = useState<string>('');
  const [body, setBody] = useState('');
  const [includeContext, setIncludeContext] = useState(true);
  const [screenLabel, setScreenLabel] = useState<string>(() => describeScreen());
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) setScreenLabel(describeScreen());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const token = getActiveToken();
    if (!token) return;
    fetch(`${getApiBaseUrl()}/feedback/categories`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => (r.ok ? r.json() : { categories: [] }))
      .then(d => setCategories(d.categories || []))
      .catch(() => setCategories([]));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      // Reset on close so reopening is a clean slate.
      setSubmitted(false);
      setError(null);
      setSubmitting(false);
      setSubmissionType(null);
      setSentiment(null);
      setCategoryId('');
      setBody('');
    }
  }, [open]);

  const handleSubmit = async () => {
    setError(null);
    const trimmed = body.trim();
    if (!trimmed) {
      setError('Please add a short description.');
      return;
    }
    if (trimmed.length > MAX_BODY_LEN) {
      setError(`Description is too long (${trimmed.length}/${MAX_BODY_LEN}).`);
      return;
    }
    const token = getActiveToken();
    if (!token) {
      setError('You must be logged in to submit feedback.');
      return;
    }
    setSubmitting(true);
    try {
      const wantsContext = forceIncludeContext || includeContext;
      const caseId = wantsContext ? detectCaseId() : null;
      const payload = {
        body: trimmed,
        submission_type: submissionType,
        sentiment,
        category_id: categoryId ? Number(categoryId) : null,
        context_route: wantsContext ? window.location.hash || window.location.pathname : null,
        context_screen: wantsContext ? screenLabel : null,
        context_case_id: caseId,
        user_agent: navigator.userAgent,
        build_sha: typeof __APP_BUILD_SHA__ !== 'undefined' ? __APP_BUILD_SHA__ : 'dev',
        viewport: `${window.innerWidth}x${window.innerHeight}`,
      };
      const response = await fetch(`${getApiBaseUrl()}/feedback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error || 'Submission failed');
      }
      setSubmitted(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  };

  const selectedCategory = categories.find(c => c.id === Number(categoryId)) || null;
  const forceIncludeContext = isUserInterfaceCategory(selectedCategory?.name);
  const effectiveInclude = forceIncludeContext || includeContext;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[1000] flex justify-end">
      <div
        className="absolute inset-0 bg-black/30"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-labelledby="feedback-panel-title"
        className="relative bg-white shadow-2xl w-full max-w-md h-full flex flex-col animate-slide-in"
        style={{ animation: 'feedback-slide-in 0.2s ease-out' }}
      >
        <style>{`
          @keyframes feedback-slide-in {
            from { transform: translateX(100%); }
            to { transform: translateX(0); }
          }
        `}</style>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 bg-gray-50">
          <h2 id="feedback-panel-title" className="font-semibold text-gray-900">Submit feedback</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 transition-colors"
            aria-label="Close feedback panel"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {submitted ? (
            <div className="text-center py-10 space-y-3">
              <div className="text-4xl">🙏</div>
              <p className="text-gray-700">Thanks — your feedback was submitted.</p>
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => setSubmitted(false)}
                  className="text-sm text-blue-600 hover:underline"
                >
                  Submit more feedback?
                </button>
                <p className="text-sm text-gray-600">
                  <button
                    type="button"
                    onClick={onClose}
                    className="text-blue-600 hover:underline"
                  >
                    or close this feedback pane
                  </button>
                </p>
              </div>
            </div>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">How are you feeling about this app?</label>
                <div className="flex gap-2">
                  {SENTIMENTS.map(s => (
                    <button
                      key={s.value}
                      type="button"
                      onClick={() => setSentiment(sentiment === s.value ? null : s.value)}
                      className={`flex-1 py-2 rounded-md border text-2xl ${
                        sentiment === s.value
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-300 bg-white hover:bg-gray-50'
                      }`}
                      aria-label={s.label}
                      aria-pressed={sentiment === s.value}
                    >
                      {s.emoji}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type of feedback</label>
                <div className="flex flex-wrap gap-2">
                  {SUBMISSION_TYPES.map(t => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => setSubmissionType(submissionType === t.value ? null : t.value)}
                      className={`px-3 py-1 text-sm rounded-full border ${
                        submissionType === t.value
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
                          : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                      }`}
                      aria-pressed={submissionType === t.value}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label htmlFor="fb-category" className="block text-sm font-medium text-gray-700 mb-1">
                  Category
                </label>
                <select
                  id="fb-category"
                  value={categoryId}
                  onChange={e => setCategoryId(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white"
                >
                  <option value="">— Select —</option>
                  {categories.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="fb-body" className="block text-sm font-medium text-gray-700 mb-1">
                  Your feedback <span className="text-red-500">*</span>
                </label>
                <textarea
                  id="fb-body"
                  value={body}
                  onChange={e => setBody(e.target.value)}
                  rows={6}
                  maxLength={MAX_BODY_LEN}
                  placeholder="What happened? What would help?"
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm resize-y"
                />
                <div className="text-xs text-gray-400 text-right mt-1">
                  {body.length}/{MAX_BODY_LEN}
                </div>
              </div>

              <div className="space-y-2">
                <label className="flex items-start gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={effectiveInclude}
                    onChange={e => setIncludeContext(e.target.checked)}
                    disabled={forceIncludeContext}
                    className="mt-0.5"
                  />
                  <span>
                    Include current page and case context.
                    <span className="block text-xs text-gray-500">
                      {forceIncludeContext
                        ? 'Required for User interface feedback so we know which screen you mean.'
                        : 'Helps the team reproduce the issue.'}
                    </span>
                  </span>
                </label>
                {effectiveInclude && (
                  <div className="text-xs bg-gray-50 border border-gray-200 rounded-md px-3 py-2 text-gray-700">
                    <div><span className="font-semibold">Screen:</span> {screenLabel}</div>
                    <div className="text-gray-500 mt-0.5">
                      <span className="font-semibold">Viewport:</span> {window.innerWidth}×{window.innerHeight}
                    </div>
                  </div>
                )}
              </div>

              {error && (
                <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        {!submitted && (
          <div className="px-5 py-3 border-t border-gray-200 bg-gray-50 flex justify-end gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-100"
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting || !body.trim()}
              className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Submitting…' : 'Submit feedback'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default FeedbackPanel;
