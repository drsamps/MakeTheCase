import { useEffect, useMemo, useRef, useState } from 'react';

export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export interface SaveStateApi {
  status: SaveStatus;
  dirty: boolean;
  // Wrap a save call so the hook can track its lifecycle.
  // The wrapped fn flips status to 'saving' before running and 'saved' on
  // success (auto-resetting to 'idle' 3s later) or 'error' on failure.
  run: (fn: () => Promise<{ ok: boolean; message?: string }>) => Promise<void>;
  // Manually reset the hook (e.g. after the parent reloaded data from server).
  reset: () => void;
  errorMessage: string | null;
}

// Tracks whether the current editing value differs from the last-loaded server
// value, and provides a `run()` wrapper for the save call so button labels can
// reflect: Save (dirty) → Saving… → Saved ✓ → Save (idle, no diff).
export function useSaveState(
  loadedValue: unknown,
  currentValue: unknown
): SaveStateApi {
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const resetTimer = useRef<number | null>(null);

  const dirty = useMemo(() => {
    try {
      return JSON.stringify(loadedValue) !== JSON.stringify(currentValue);
    } catch {
      return loadedValue !== currentValue;
    }
  }, [loadedValue, currentValue]);

  // When the user makes the value dirty after a save, drop the "saved" badge
  // back to 'dirty'. When they revert to the loaded value, go back to 'idle'.
  useEffect(() => {
    if (status === 'saving') return;
    if (dirty && (status === 'idle' || status === 'saved')) {
      setStatus('dirty');
    } else if (!dirty && status === 'dirty') {
      setStatus('idle');
    }
  }, [dirty, status]);

  useEffect(() => () => {
    if (resetTimer.current) window.clearTimeout(resetTimer.current);
  }, []);

  async function run(fn: () => Promise<{ ok: boolean; message?: string }>) {
    setStatus('saving');
    setErrorMessage(null);
    try {
      const result = await fn();
      if (result.ok) {
        setStatus('saved');
        if (resetTimer.current) window.clearTimeout(resetTimer.current);
        resetTimer.current = window.setTimeout(() => {
          setStatus(prev => (prev === 'saved' ? 'idle' : prev));
        }, 3000);
      } else {
        setStatus('error');
        setErrorMessage(result.message || 'Save failed');
      }
    } catch (err) {
      setStatus('error');
      setErrorMessage((err as Error).message);
    }
  }

  function reset() {
    setStatus('idle');
    setErrorMessage(null);
  }

  return { status, dirty, run, reset, errorMessage };
}

export function saveButtonLabel(status: SaveStatus): string {
  switch (status) {
    case 'saving': return 'Saving…';
    case 'saved':  return 'Saved ✓';
    case 'error':  return 'Save failed — retry';
    default:       return 'Save';
  }
}
