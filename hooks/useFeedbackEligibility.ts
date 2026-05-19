import { useEffect, useState } from 'react';
import { getApiBaseUrl } from '../services/apiClient';

export interface FeedbackEligibility {
  role: string | null;
  canSubmit: boolean;
  viewerHasAnyAllowedSource: boolean;
  isFeedbackAdmin: boolean;
  widgetStyle: 'right_edge_tab' | 'bottom_right_fab' | 'header_link' | 'hidden';
}

interface CacheEntry {
  data: FeedbackEligibility;
  inFlight?: Promise<FeedbackEligibility | null>;
}

let cache: CacheEntry | null = null;
let inFlight: Promise<FeedbackEligibility | null> | null = null;

export function clearFeedbackEligibilityCache() {
  cache = null;
  inFlight = null;
}

function getActiveToken(): string | null {
  const isAdmin = window.location.hash.startsWith('#/admin') || window.location.hash.startsWith('#/case-writer');
  return localStorage.getItem(isAdmin ? 'admin_auth_token' : 'student_auth_token');
}

async function fetchEligibility(): Promise<FeedbackEligibility | null> {
  const token = getActiveToken();
  if (!token) return null;
  try {
    const response = await fetch(`${getApiBaseUrl()}/feedback/eligibility`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return null;
    return (await response.json()) as FeedbackEligibility;
  } catch {
    return null;
  }
}

export function useFeedbackEligibility(userId?: string | null) {
  const [eligibility, setEligibility] = useState<FeedbackEligibility | null>(
    cache?.data || null
  );
  const [loading, setLoading] = useState<boolean>(!cache);

  useEffect(() => {
    let cancelled = false;
    if (!userId) {
      setEligibility(null);
      setLoading(false);
      return;
    }
    if (cache) {
      setEligibility(cache.data);
      setLoading(false);
      return;
    }
    setLoading(true);
    if (!inFlight) inFlight = fetchEligibility();
    inFlight.then(result => {
      inFlight = null;
      if (cancelled) return;
      if (result) {
        cache = { data: result };
        setEligibility(result);
      } else {
        setEligibility(null);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return { eligibility, loading };
}
