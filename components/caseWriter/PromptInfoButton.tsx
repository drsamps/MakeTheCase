import React, { useEffect, useState } from 'react';
import { getApiBaseUrl } from '../../services/apiClient';

interface Props {
  use: string;
  isAdmin: boolean;
}

interface PromptRow {
  id: number;
  use: string;
  version: string;
  description: string | null;
  prompt_template: string;
  enabled: 0 | 1;
  is_active?: boolean;
  active_version?: string | null;
}

// Per-(admin browser, prompt use) one-shot flag. Read by the Generate
// callsites and cleared after the request completes.
export const logKeyFor = (use: string) => `cw_log_prompt:${use}`;

const PromptInfoButton: React.FC<Props> = ({ use, isAdmin }) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [prompt, setPrompt] = useState<PromptRow | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [logFlagged, setLogFlagged] = useState<boolean>(() => {
    try { return localStorage.getItem(logKeyFor(use)) === '1'; } catch { return false; }
  });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Keep the badge in sync if the key is cleared from another tab or by the
  // Generate callsite's `finally` block.
  useEffect(() => {
    const key = logKeyFor(use);
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === key) {
        try { setLogFlagged(localStorage.getItem(key) === '1'); } catch { /* ignore */ }
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [use]);

  async function loadPrompt() {
    setLoading(true);
    setErr(null);
    setPrompt(null);
    try {
      const t = localStorage.getItem('admin_auth_token');
      const res = await fetch(`${getApiBaseUrl()}/prompts?use=${encodeURIComponent(use)}`, {
        headers: t ? { Authorization: `Bearer ${t}` } : {}
      });
      const json = await res.json();
      if (!res.ok) {
        setErr(json?.error?.message || `HTTP ${res.status}`);
        return;
      }
      const list: PromptRow[] = json?.data || [];
      const active = list.find(p => p.is_active) || list[0] || null;
      if (!active) {
        setErr(`No prompt rows found for use "${use}".`);
      } else {
        setPrompt(active);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function handleClick() {
    setOpen(true);
    loadPrompt();
  }

  function toggleLogFlag(next: boolean) {
    const key = logKeyFor(use);
    try {
      if (next) localStorage.setItem(key, '1');
      else localStorage.removeItem(key);
    } catch { /* ignore */ }
    setLogFlagged(next);
  }

  if (!isAdmin) return null;

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        title={`Click to display AI prompt: ${use}`}
        className="text-xs w-6 h-6 inline-flex items-center justify-center border border-gray-300 rounded-full hover:bg-gray-50 text-gray-600 font-semibold"
        aria-label={`View prompt template for ${use}`}
      >
        ⓘ
      </button>
      {logFlagged && (
        <span
          title="The next AI generation for this step will be logged. Click ⓘ to uncheck."
          className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 border border-amber-400 bg-amber-100 text-amber-900 rounded font-semibold"
        >
          log
        </span>
      )}
      {open && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3 border-b flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Prompt for <span className="font-mono text-base">{use}</span></h3>
                {prompt && (
                  <p className="text-xs text-gray-500 mt-0.5">
                    version <span className="font-mono">{prompt.version}</span>
                    {prompt.is_active && <span className="ml-2 text-green-700">(active)</span>}
                    {prompt.enabled ? '' : <span className="ml-2 text-amber-700">(disabled)</span>}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-gray-400 hover:text-gray-700 text-2xl leading-none"
                aria-label="Close"
              >×</button>
            </div>
            <div className="p-5 overflow-y-auto flex-1 space-y-3">
              {loading && <div className="text-sm text-gray-500">Loading…</div>}
              {err && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">{err}</div>}
              {prompt && (
                <>
                  {prompt.description && (
                    <p className="text-sm italic text-gray-600">{prompt.description}</p>
                  )}
                  <pre className="whitespace-pre-wrap break-words font-mono text-xs bg-gray-50 border border-gray-200 p-3 rounded">
                    {prompt.prompt_template}
                  </pre>
                </>
              )}
            </div>
            <div className="px-5 py-3 border-t space-y-2">
              <label className="flex items-start gap-2 text-sm text-gray-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={logFlagged}
                  onChange={(e) => toggleLogFlag(e.target.checked)}
                  className="mt-0.5 w-4 h-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500"
                />
                <span>
                  <span className="font-medium">Log this prompt with data</span>
                  <span className="block text-xs text-gray-500">
                    The next AI generation for this step will be saved to the prompt log (Admin → Logging). Cleared after one generation; uncheck here to cancel.
                  </span>
                </span>
              </label>
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>
                  Admin users can edit prompts under{' '}
                  <a href="#/admin?tab=prompts" className="text-blue-600 hover:underline">Admin → Prompts</a>.
                </span>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default PromptInfoButton;
