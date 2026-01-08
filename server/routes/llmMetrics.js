// LLM Metrics API - Cache analytics and performance tracking
import express from 'express';
import { pool } from '../db.js';
import { verifyToken } from '../middleware/auth.js';
import { requireRole } from '../middleware/auth.js';

const router = express.Router();

// GET /api/llm-metrics/summary - Overall cache performance summary
router.get('/summary', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const daysNum = parseInt(days) || 30;

    // Overall summary metrics
    const [summaryRows] = await pool.execute(`
      SELECT
        COUNT(*) as total_requests,
        SUM(cache_hit) as cache_hits,
        SUM(input_tokens) as total_input_tokens,
        SUM(cached_tokens) as total_cached_tokens,
        SUM(output_tokens) as total_output_tokens,
        ROUND(100.0 * SUM(cache_hit) / NULLIF(COUNT(*), 0), 2) as hit_rate_percent
      FROM llm_cache_metrics
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
    `, [daysNum]);

    // Per-provider breakdown
    const [providerRows] = await pool.execute(`
      SELECT
        provider,
        COUNT(*) as total_requests,
        SUM(cache_hit) as cache_hits,
        ROUND(100.0 * SUM(cache_hit) / NULLIF(COUNT(*), 0), 2) as hit_rate_percent,
        SUM(input_tokens) as total_input_tokens,
        SUM(cached_tokens) as total_cached_tokens,
        SUM(output_tokens) as total_output_tokens
      FROM llm_cache_metrics
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY provider
      ORDER BY total_requests DESC
    `, [daysNum]);

    // Daily trend (last N days)
    const [trendRows] = await pool.execute(`
      SELECT
        DATE(created_at) as date,
        COUNT(*) as total_requests,
        SUM(cache_hit) as cache_hits,
        ROUND(100.0 * SUM(cache_hit) / NULLIF(COUNT(*), 0), 2) as hit_rate_percent,
        SUM(input_tokens) as input_tokens,
        SUM(cached_tokens) as cached_tokens,
        SUM(output_tokens) as output_tokens
      FROM llm_cache_metrics
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `, [daysNum]);

    // Per-case breakdown
    const [caseRows] = await pool.execute(`
      SELECT
        m.case_id,
        c.case_title,
        COUNT(*) as total_requests,
        SUM(m.cache_hit) as cache_hits,
        ROUND(100.0 * SUM(m.cache_hit) / NULLIF(COUNT(*), 0), 2) as hit_rate_percent,
        SUM(m.input_tokens) as total_input_tokens,
        SUM(m.cached_tokens) as total_cached_tokens,
        SUM(m.output_tokens) as total_output_tokens
      FROM llm_cache_metrics m
      LEFT JOIN cases c ON m.case_id = c.case_id
      WHERE m.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY m.case_id, c.case_title
      ORDER BY total_requests DESC
    `, [daysNum]);

    // Calculate estimated cost savings
    // Anthropic: Regular input $3/MTok, Cached input $0.30/MTok (90% savings)
    // OpenAI: 50% discount on cached tokens
    const summary = summaryRows[0] || {};
    const totalCachedTokens = parseInt(summary.total_cached_tokens) || 0;

    // Estimate savings (assuming mostly Anthropic with 90% cache discount)
    const regularCostPer1K = 0.003; // $3 per million = $0.003 per 1K
    const cachedCostPer1K = 0.0003; // $0.30 per million = $0.0003 per 1K
    const estimatedSavings = (totalCachedTokens / 1000) * (regularCostPer1K - cachedCostPer1K);

    res.json({
      data: {
        summary: {
          ...summary,
          estimated_savings_usd: estimatedSavings.toFixed(4),
          days_analyzed: daysNum
        },
        by_provider: providerRows,
        daily_trend: trendRows,
        by_case: caseRows
      },
      error: null
    });
  } catch (error) {
    console.error('[llm-metrics] Summary error:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// GET /api/llm-metrics/:caseId - Metrics for a specific case
router.get('/:caseId', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { caseId } = req.params;
    const { days = 30 } = req.query;
    const daysNum = parseInt(days) || 30;

    // Case-specific summary
    const [summaryRows] = await pool.execute(`
      SELECT
        COUNT(*) as total_requests,
        SUM(cache_hit) as cache_hits,
        ROUND(100.0 * SUM(cache_hit) / NULLIF(COUNT(*), 0), 2) as hit_rate_percent,
        SUM(input_tokens) as total_input_tokens,
        SUM(cached_tokens) as total_cached_tokens,
        SUM(output_tokens) as total_output_tokens
      FROM llm_cache_metrics
      WHERE case_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
    `, [caseId, daysNum]);

    // By provider for this case
    const [providerRows] = await pool.execute(`
      SELECT
        provider,
        model_id,
        COUNT(*) as total_requests,
        SUM(cache_hit) as cache_hits,
        ROUND(100.0 * SUM(cache_hit) / NULLIF(COUNT(*), 0), 2) as hit_rate_percent,
        SUM(input_tokens) as total_input_tokens,
        SUM(cached_tokens) as total_cached_tokens,
        SUM(output_tokens) as total_output_tokens
      FROM llm_cache_metrics
      WHERE case_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY provider, model_id
      ORDER BY total_requests DESC
    `, [caseId, daysNum]);

    // By request type (chat vs eval)
    const [typeRows] = await pool.execute(`
      SELECT
        request_type,
        COUNT(*) as total_requests,
        SUM(cache_hit) as cache_hits,
        ROUND(100.0 * SUM(cache_hit) / NULLIF(COUNT(*), 0), 2) as hit_rate_percent,
        SUM(input_tokens) as total_input_tokens,
        SUM(cached_tokens) as total_cached_tokens
      FROM llm_cache_metrics
      WHERE case_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY request_type
    `, [caseId, daysNum]);

    // Recent requests (last 50)
    const [recentRows] = await pool.execute(`
      SELECT
        id, provider, model_id, cache_hit, request_type,
        input_tokens, cached_tokens, output_tokens, created_at
      FROM llm_cache_metrics
      WHERE case_id = ?
      ORDER BY created_at DESC
      LIMIT 50
    `, [caseId]);

    res.json({
      data: {
        case_id: caseId,
        days_analyzed: daysNum,
        summary: summaryRows[0] || {},
        by_provider: providerRows,
        by_request_type: typeRows,
        recent_requests: recentRows
      },
      error: null
    });
  } catch (error) {
    console.error('[llm-metrics] Case metrics error:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// GET /api/llm-metrics/models/comparison - Compare cache performance across models
router.get('/models/comparison', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const daysNum = parseInt(days) || 30;

    const [rows] = await pool.execute(`
      SELECT
        provider,
        model_id,
        COUNT(*) as total_requests,
        SUM(cache_hit) as cache_hits,
        ROUND(100.0 * SUM(cache_hit) / NULLIF(COUNT(*), 0), 2) as hit_rate_percent,
        AVG(input_tokens) as avg_input_tokens,
        AVG(cached_tokens) as avg_cached_tokens,
        AVG(output_tokens) as avg_output_tokens,
        SUM(input_tokens) as total_input_tokens,
        SUM(cached_tokens) as total_cached_tokens,
        SUM(output_tokens) as total_output_tokens
      FROM llm_cache_metrics
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY provider, model_id
      ORDER BY total_requests DESC
    `, [daysNum]);

    res.json({
      data: {
        days_analyzed: daysNum,
        models: rows
      },
      error: null
    });
  } catch (error) {
    console.error('[llm-metrics] Model comparison error:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

export default router;
