/**
 * AiUsageWarningBanner
 *
 * Sticky top-of-dashboard banner that fires when the current instructor's
 * weekly AI spend crosses their warning threshold (yellow) or the hard cap
 * (red). Polled once on mount and again every 5 minutes.
 *
 * Dismiss: stored in sessionStorage keyed by week-start, so a dismiss survives
 * tab switches but the banner returns on the next week or fresh session.
 *
 * Admins not impersonating see nothing — the global view has no per-instructor
 * cap to warn about.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../services/apiClient';

interface WeeklyStatus {
  scope: 'instructor' | 'global';
  costUsed: number;
  cap: number | null;
  warnPct: number | null;
  warnThreshold: number | null;
  capActive: boolean;
  overWarning: boolean;
  overCap: boolean;
  useSystemKey?: boolean;
  weekStart: string;
  weekEnd: string;
}

const POLL_INTERVAL_MS = 5 * 60 * 1000;

function dismissKey(weekStart: string, kind: 'warn' | 'over'): string {
  return `aiUsageDismiss:${kind}:${weekStart}`;
}

const AiUsageWarningBanner: React.FC<{ onNavigate?: () => void }> = ({ onNavigate }) => {
  const [status, setStatus] = useState<WeeklyStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await api.get<WeeklyStatus>('/usage/weekly-status');
    if (error || !data) return;
    setStatus(data);
    if (data.scope === 'instructor' && data.capActive) {
      const kind = data.overCap ? 'over' : data.overWarning ? 'warn' : null;
      if (kind) {
        setDismissed(sessionStorage.getItem(dismissKey(data.weekStart, kind)) === '1');
      } else {
        setDismissed(false);
      }
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [load]);

  if (!status || status.scope !== 'instructor' || !status.capActive) return null;
  if (!status.overWarning && !status.overCap) return null;
  if (dismissed) return null;

  const isHardCap = status.overCap;
  const kind: 'over' | 'warn' = isHardCap ? 'over' : 'warn';
  const colorClasses = isHardCap
    ? 'bg-red-100 border-red-300 text-red-900'
    : 'bg-yellow-100 border-yellow-300 text-yellow-900';

  const handleDismiss = () => {
    sessionStorage.setItem(dismissKey(status.weekStart, kind), '1');
    setDismissed(true);
  };

  return (
    <div className={`flex-shrink-0 flex items-center justify-between px-6 py-2 border-b text-sm font-medium ${colorClasses}`}>
      <span>
        {isHardCap ? (
          <>
            <strong>Weekly AI cap reached</strong> — ${status.costUsed.toFixed(2)} of ${status.cap?.toFixed(2)} used.
            Student chats and AI features are blocked until Monday 00:00 (America/Denver).
          </>
        ) : (
          <>
            <strong>AI spend warning</strong> — ${status.costUsed.toFixed(2)} of ${status.cap?.toFixed(2)} used
            ({status.warnPct}% threshold). Consider switching to your own API key or reducing usage.
          </>
        )}
        {onNavigate && (
          <button onClick={onNavigate} className="ml-3 underline">
            View details
          </button>
        )}
      </span>
      <button
        onClick={handleDismiss}
        className="ml-4 px-2 py-0.5 text-xs rounded bg-white/40 hover:bg-white/60"
      >
        Dismiss
      </button>
    </div>
  );
};

export default AiUsageWarningBanner;
