// Cache Metrics Component - LLM Prompt Caching Analytics
import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../services/apiClient';

interface SummaryData {
  total_requests: number;
  cache_hits: number;
  hit_rate_percent: number | null;
  total_input_tokens: number;
  total_cached_tokens: number;
  total_output_tokens: number;
  estimated_savings_usd: string;
  days_analyzed: number;
}

interface ProviderData {
  provider: string;
  total_requests: number;
  cache_hits: number;
  hit_rate_percent: number | null;
  total_input_tokens: number;
  total_cached_tokens: number;
  total_output_tokens: number;
}

interface TrendData {
  date: string;
  total_requests: number;
  cache_hits: number;
  hit_rate_percent: number | null;
  input_tokens: number;
  cached_tokens: number;
  output_tokens: number;
}

interface CaseData {
  case_id: string;
  case_title: string | null;
  total_requests: number;
  cache_hits: number;
  hit_rate_percent: number | null;
  total_input_tokens: number;
  total_cached_tokens: number;
  total_output_tokens: number;
}

interface MetricsData {
  summary: SummaryData;
  by_provider: ProviderData[];
  daily_trend: TrendData[];
  by_case: CaseData[];
}

export const CacheMetrics: React.FC = () => {
  const [metrics, setMetrics] = useState<MetricsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<number>(30);

  const fetchMetrics = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.get(`/llm-metrics/summary?days=${dateRange}`);
      if (response.error) {
        throw new Error(response.error.message);
      }
      setMetrics(response.data);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch cache metrics');
    } finally {
      setIsLoading(false);
    }
  }, [dateRange]);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  const formatNumber = (n: number | null | undefined): string => {
    if (n === null || n === undefined) return '-';
    return n.toLocaleString();
  };

  const formatTokens = (n: number | null | undefined): string => {
    if (n === null || n === undefined) return '-';
    if (n >= 1000000) return `${(n / 1000000).toFixed(2)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toString();
  };

  const getHitRateColor = (rate: number | null): string => {
    if (rate === null) return 'text-gray-400';
    if (rate >= 80) return 'text-green-600';
    if (rate >= 50) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getProviderColor = (provider: string): string => {
    switch (provider.toLowerCase()) {
      case 'anthropic': return 'bg-purple-100 text-purple-800';
      case 'openai': return 'bg-green-100 text-green-800';
      case 'google': return 'bg-blue-100 text-blue-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  if (isLoading) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <p className="mt-2 text-gray-600">Loading cache metrics...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800">{error}</p>
          <button
            onClick={fetchMetrics}
            className="mt-2 text-red-600 underline hover:text-red-800"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className="text-center py-12 text-gray-500">
          No cache metrics data available yet.
        </div>
      </div>
    );
  }

  const { summary, by_provider, daily_trend, by_case } = metrics;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6 flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Cache Analytics</h2>
          <p className="text-sm text-gray-500">Monitor LLM prompt caching performance and cost savings</p>
        </div>
        <div className="flex items-center gap-4">
          <select
            value={dateRange}
            onChange={(e) => setDateRange(parseInt(e.target.value))}
            className="border rounded px-3 py-2 text-sm"
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
            <option value={365}>Last year</option>
          </select>
          <button
            onClick={fetchMetrics}
            className="flex items-center gap-2 px-3 py-2 text-sm border rounded hover:bg-gray-50"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {/* Total Requests */}
        <div className="bg-white border rounded-lg p-4">
          <div className="text-sm text-gray-500 mb-1">Total Requests</div>
          <div className="text-2xl font-bold">{formatNumber(summary.total_requests)}</div>
          <div className="text-xs text-gray-400 mt-1">Last {summary.days_analyzed} days</div>
        </div>

        {/* Cache Hit Rate */}
        <div className="bg-white border rounded-lg p-4">
          <div className="text-sm text-gray-500 mb-1">Cache Hit Rate</div>
          <div className={`text-2xl font-bold ${getHitRateColor(summary.hit_rate_percent)}`}>
            {summary.hit_rate_percent !== null ? `${summary.hit_rate_percent}%` : '-'}
          </div>
          <div className="text-xs text-gray-400 mt-1">
            {formatNumber(summary.cache_hits)} / {formatNumber(summary.total_requests)} hits
          </div>
        </div>

        {/* Tokens Cached */}
        <div className="bg-white border rounded-lg p-4">
          <div className="text-sm text-gray-500 mb-1">Tokens Cached</div>
          <div className="text-2xl font-bold text-blue-600">
            {formatTokens(summary.total_cached_tokens)}
          </div>
          <div className="text-xs text-gray-400 mt-1">
            of {formatTokens(summary.total_input_tokens)} input tokens
          </div>
        </div>

        {/* Estimated Savings */}
        <div className="bg-white border rounded-lg p-4">
          <div className="text-sm text-gray-500 mb-1">Est. Cost Savings</div>
          <div className="text-2xl font-bold text-green-600">
            ${parseFloat(summary.estimated_savings_usd || '0').toFixed(2)}
          </div>
          <div className="text-xs text-gray-400 mt-1">Based on Anthropic pricing</div>
        </div>
      </div>

      {/* Provider Breakdown */}
      <div className="bg-white border rounded-lg p-6 mb-6">
        <h3 className="text-lg font-semibold mb-4">Performance by Provider</h3>
        {by_provider.length === 0 ? (
          <div className="text-center py-4 text-gray-500">No provider data available</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left">Provider</th>
                  <th className="px-4 py-2 text-right">Requests</th>
                  <th className="px-4 py-2 text-right">Cache Hits</th>
                  <th className="px-4 py-2 text-right">Hit Rate</th>
                  <th className="px-4 py-2 text-right">Input Tokens</th>
                  <th className="px-4 py-2 text-right">Cached Tokens</th>
                  <th className="px-4 py-2 text-right">Output Tokens</th>
                </tr>
              </thead>
              <tbody>
                {by_provider.map((p, i) => (
                  <tr key={p.provider} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-4 py-2">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${getProviderColor(p.provider)}`}>
                        {p.provider}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">{formatNumber(p.total_requests)}</td>
                    <td className="px-4 py-2 text-right">{formatNumber(p.cache_hits)}</td>
                    <td className={`px-4 py-2 text-right font-medium ${getHitRateColor(p.hit_rate_percent)}`}>
                      {p.hit_rate_percent !== null ? `${p.hit_rate_percent}%` : '-'}
                    </td>
                    <td className="px-4 py-2 text-right">{formatTokens(p.total_input_tokens)}</td>
                    <td className="px-4 py-2 text-right text-blue-600">{formatTokens(p.total_cached_tokens)}</td>
                    <td className="px-4 py-2 text-right">{formatTokens(p.total_output_tokens)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Daily Trend */}
        <div className="bg-white border rounded-lg p-6">
          <h3 className="text-lg font-semibold mb-4">Daily Trend</h3>
          {daily_trend.length === 0 ? (
            <div className="text-center py-4 text-gray-500">No trend data available</div>
          ) : (
            <div className="overflow-x-auto max-h-80">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left">Date</th>
                    <th className="px-3 py-2 text-right">Requests</th>
                    <th className="px-3 py-2 text-right">Hit Rate</th>
                    <th className="px-3 py-2 text-right">Cached</th>
                  </tr>
                </thead>
                <tbody>
                  {daily_trend.slice(0, 14).map((d, i) => (
                    <tr key={d.date} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-3 py-2">{new Date(d.date).toLocaleDateString()}</td>
                      <td className="px-3 py-2 text-right">{formatNumber(d.total_requests)}</td>
                      <td className={`px-3 py-2 text-right font-medium ${getHitRateColor(d.hit_rate_percent)}`}>
                        {d.hit_rate_percent !== null ? `${d.hit_rate_percent}%` : '-'}
                      </td>
                      <td className="px-3 py-2 text-right text-blue-600">{formatTokens(d.cached_tokens)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* By Case */}
        <div className="bg-white border rounded-lg p-6">
          <h3 className="text-lg font-semibold mb-4">Performance by Case</h3>
          {by_case.length === 0 ? (
            <div className="text-center py-4 text-gray-500">No case data available</div>
          ) : (
            <div className="overflow-x-auto max-h-80">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left">Case</th>
                    <th className="px-3 py-2 text-right">Requests</th>
                    <th className="px-3 py-2 text-right">Hit Rate</th>
                    <th className="px-3 py-2 text-right">Cached</th>
                  </tr>
                </thead>
                <tbody>
                  {by_case.map((c, i) => (
                    <tr key={c.case_id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-3 py-2">
                        <div className="font-medium truncate max-w-[200px]" title={c.case_title || c.case_id}>
                          {c.case_title || c.case_id}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right">{formatNumber(c.total_requests)}</td>
                      <td className={`px-3 py-2 text-right font-medium ${getHitRateColor(c.hit_rate_percent)}`}>
                        {c.hit_rate_percent !== null ? `${c.hit_rate_percent}%` : '-'}
                      </td>
                      <td className="px-3 py-2 text-right text-blue-600">{formatTokens(c.total_cached_tokens)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Info Panel */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h4 className="font-semibold text-blue-900 mb-2">How Cache Savings Work</h4>
        <div className="text-sm text-blue-800 space-y-1">
          <p><strong>Anthropic (Claude):</strong> Cache reads cost 90% less than regular input tokens ($0.30/MTok vs $3.00/MTok)</p>
          <p><strong>OpenAI:</strong> Automatic 50% discount on cached input tokens</p>
          <p><strong>Prompt structure:</strong> Static content (case documents, teaching notes) is placed first to maximize cache reuse across student conversations</p>
        </div>
      </div>
    </div>
  );
};

export default CacheMetrics;
