import React, { useState, useEffect, useCallback } from 'react';
import { api, getApiBaseUrl } from '../services/apiClient';

interface ChatTimerProps {
  chatId: string;
  warningMinutes?: number;
  onTimeUp?: () => void;
  className?: string;
}

export const ChatTimer: React.FC<ChatTimerProps> = ({
  chatId,
  warningMinutes = 5,
  onTimeUp,
  className = ''
}) => {
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [timeLimitMinutes, setTimeLimitMinutes] = useState<number | null>(null);
  const [timerStarted, setTimerStarted] = useState(false);
  const [hasTimeLimit, setHasTimeLimit] = useState(false);
  const [isExpired, setIsExpired] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<number>(Date.now());

  // Fetch time remaining from server
  const syncWithServer = useCallback(async () => {
    try {
      const response = await fetch(`${getApiBaseUrl()}/case-chats/${chatId}/time-remaining`);
      const result = await response.json();

      if (result.data) {
        setHasTimeLimit(result.data.has_time_limit);
        setTimeLimitMinutes(result.data.time_limit_minutes);
        setTimerStarted(result.data.timer_started);

        if (result.data.has_time_limit && result.data.timer_started) {
          setRemainingSeconds(result.data.remaining_seconds);
          setIsExpired(result.data.expired);

          if (result.data.expired && onTimeUp) {
            onTimeUp();
          }
        } else if (result.data.has_time_limit && !result.data.timer_started) {
          // Timer not started yet - show full time
          setRemainingSeconds(result.data.time_limit_minutes * 60);
        }
        setLastSyncTime(Date.now());
      }
    } catch (err) {
      console.error('Failed to sync timer:', err);
    }
  }, [chatId, onTimeUp]);

  // Initial sync and periodic re-sync every 30 seconds
  useEffect(() => {
    syncWithServer();
    const syncInterval = setInterval(syncWithServer, 30000);
    return () => clearInterval(syncInterval);
  }, [syncWithServer]);

  // Local countdown (updates every second)
  useEffect(() => {
    if (!hasTimeLimit || !timerStarted || remainingSeconds === null) return;

    const countdownInterval = setInterval(() => {
      setRemainingSeconds(prev => {
        if (prev === null || prev <= 0) {
          if (!isExpired) {
            setIsExpired(true);
            onTimeUp?.();
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(countdownInterval);
  }, [hasTimeLimit, timerStarted, isExpired, onTimeUp]);

  // Don't render if no time limit
  if (!hasTimeLimit || timeLimitMinutes === null) {
    return null;
  }

  const minutes = remainingSeconds !== null ? Math.floor(remainingSeconds / 60) : timeLimitMinutes;
  const seconds = remainingSeconds !== null ? remainingSeconds % 60 : 0;
  const warningThreshold = warningMinutes * 60;
  const isWarning = remainingSeconds !== null && remainingSeconds <= warningThreshold && remainingSeconds > 0;
  const isCritical = remainingSeconds !== null && remainingSeconds <= 60;

  // Determine color based on state
  let colorClasses = 'text-gray-500 bg-gray-100';
  if (isExpired) {
    colorClasses = 'text-red-700 bg-red-100 animate-pulse';
  } else if (isCritical) {
    colorClasses = 'text-red-600 bg-red-50';
  } else if (isWarning) {
    colorClasses = 'text-amber-600 bg-amber-50';
  }

  return (
    <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-sm font-mono ${colorClasses} ${className}`}>
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <span>
        {isExpired ? (
          "Time's up"
        ) : !timerStarted ? (
          `${minutes}:00`
        ) : (
          `${minutes}:${seconds.toString().padStart(2, '0')}`
        )}
      </span>
    </div>
  );
};

export default ChatTimer;
