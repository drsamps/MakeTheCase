import express from 'express';
import { pool } from '../db.js';
import { verifyToken, requireRole } from '../middleware/auth.js';

const router = express.Router();

/**
 * GET /api/analytics/results
 * Consolidated results endpoint for the streamlined Results section
 *
 * Query Parameters:
 * - section_ids: comma-separated list of section_ids, or "all" (default: "all")
 * - case_ids: comma-separated list of case_ids, or "all" (default: "all")
 * - statuses: comma-separated list of statuses (completed, in_progress, not_started), or "all" (default: "all")
 * - limit: number of student records to return (default: 20)
 * - offset: number of records to skip (default: 0)
 * - sort_by: column to sort by (default: "completion_time")
 * - sort_dir: "asc" or "desc" (default: "desc")
 */
router.get('/results', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const {
      section_ids = 'all',
      case_ids = 'all',
      statuses = 'all',
      limit = 20,
      offset = 0,
      sort_by = 'completion_time',
      sort_dir = 'desc'
    } = req.query;

    // Parse section, case IDs, and statuses
    const sectionIdList = section_ids === 'all' ? null : section_ids.split(',').map(s => s.trim());
    const caseIdList = case_ids === 'all' ? null : case_ids.split(',').map(s => s.trim());
    const statusList = statuses === 'all' ? null : statuses.split(',').map(s => s.trim());

    // Validate sort direction
    const sortDirection = sort_dir.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    // Validate sort column (whitelist to prevent SQL injection)
    const validSortColumns = {
      'student_name': 's.full_name',
      'section_title': 'sec.section_title',
      'case_title': 'c.case_title',
      'status': 'COALESCE(cc.status, "not_started")',
      'initial_position': 'cc.initial_position',
      'final_position': 'cc.final_position',
      'persona': 'cc.persona',
      'score': 'e.score',
      'hints': 'e.hints',
      'helpful': 'e.helpful',
      'completion_time': 'cc.end_time'
    };
    const sortColumn = validSortColumns[sort_by] || 'cc.end_time';

    // Build WHERE clause for filtering
    let whereConditions = ['sec.enabled = TRUE'];
    let params = [];

    if (sectionIdList) {
      whereConditions.push(`sec.section_id IN (${sectionIdList.map(() => '?').join(',')})`);
      params.push(...sectionIdList);
    }

    if (caseIdList) {
      whereConditions.push(`c.case_id IN (${caseIdList.map(() => '?').join(',')})`);
      params.push(...caseIdList);
    }

    if (statusList) {
      // Status is computed as COALESCE(cc.status, 'not_started')
      // We need to filter based on this computed value
      const statusConditions = statusList.map(status => {
        if (status === 'not_started') {
          return 'cc.status IS NULL';
        } else {
          return 'cc.status = ?';
        }
      });
      whereConditions.push(`(${statusConditions.join(' OR ')})`);
      // Add params for non-not_started statuses
      statusList.forEach(status => {
        if (status !== 'not_started') {
          params.push(status);
        }
      });
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // ============ SUMMARY STATISTICS ============

    // Get overall stats
    const statsQuery = `
      SELECT
        COUNT(DISTINCT s.id) as total_students,
        COUNT(DISTINCT CASE WHEN e.id IS NOT NULL THEN s.id END) as completed_students,
        COUNT(e.id) as total_completions,
        AVG(e.score) as avg_score,
        AVG(e.hints) as avg_hints,
        AVG(e.helpful) as avg_helpful
      FROM students s
      JOIN student_sections ss ON s.id = ss.student_id
      JOIN sections sec ON ss.section_id = sec.section_id
      JOIN section_cases sc ON sec.section_id = sc.section_id
      JOIN cases c ON sc.case_id = c.case_id
      LEFT JOIN case_chats cc ON s.id = cc.student_id AND c.case_id = cc.case_id AND cc.section_id = sec.section_id
      LEFT JOIN evaluations e ON cc.evaluation_id = e.id
      ${whereClause}
    `;

    const [statsRows] = await pool.execute(statsQuery, params);
    const stats = statsRows[0];

    const summary = {
      totalStudents: stats.total_students || 0,
      completedStudents: stats.completed_students || 0,
      totalCompletions: stats.total_completions || 0,
      avgScore: stats.avg_score ? parseFloat(stats.avg_score) : null,
      avgHints: stats.avg_hints ? parseFloat(stats.avg_hints) : null,
      avgHelpful: stats.avg_helpful ? parseFloat(stats.avg_helpful) : null,
      completionRate: stats.total_students > 0
        ? (stats.completed_students / stats.total_students) * 100
        : 0
    };

    // ============ SCORE DISTRIBUTION ============

    const distributionQuery = `
      SELECT e.score, COUNT(*) as count
      FROM students s
      JOIN student_sections ss ON s.id = ss.student_id
      JOIN sections sec ON ss.section_id = sec.section_id
      JOIN section_cases sc ON sec.section_id = sc.section_id
      JOIN cases c ON sc.case_id = c.case_id
      JOIN case_chats cc ON s.id = cc.student_id AND c.case_id = cc.case_id AND cc.section_id = sec.section_id
      JOIN evaluations e ON cc.evaluation_id = e.id
      ${whereClause}
      GROUP BY e.score
      ORDER BY e.score
    `;

    const [distributionRows] = await pool.execute(distributionQuery, params);

    // Fill in missing scores with 0 count
    const scoreDistribution = [];
    for (let score = 0; score <= 15; score++) {
      const found = distributionRows.find(r => r.score === score);
      scoreDistribution.push({
        score,
        count: found ? parseInt(found.count) : 0
      });
    }

    // ============ BREAKDOWN BY SECTION (if multiple sections) ============

    let sectionBreakdown = null;
    if (!sectionIdList || sectionIdList.length > 1) {
      const sectionBreakdownQuery = `
        SELECT
          sec.section_id,
          sec.section_title,
          sec.year_term,
          COUNT(DISTINCT s.id) as total_students,
          COUNT(e.id) as completions,
          AVG(e.score) as avg_score
        FROM sections sec
        JOIN student_sections ss ON sec.section_id = ss.section_id
        JOIN students s ON ss.student_id = s.id
        JOIN section_cases sc ON sec.section_id = sc.section_id
        JOIN cases c ON sc.case_id = c.case_id
        LEFT JOIN case_chats cc ON s.id = cc.student_id AND c.case_id = cc.case_id AND cc.section_id = sec.section_id
        LEFT JOIN evaluations e ON cc.evaluation_id = e.id
        ${whereClause}
        GROUP BY sec.section_id, sec.section_title, sec.year_term
        ORDER BY sec.section_title
      `;

      const [sectionRows] = await pool.execute(sectionBreakdownQuery, params);
      sectionBreakdown = sectionRows.map(row => ({
        section_id: row.section_id,
        section_title: row.section_title,
        year_term: row.year_term,
        total_students: parseInt(row.total_students) || 0,
        completions: parseInt(row.completions) || 0,
        avg_score: row.avg_score ? parseFloat(row.avg_score) : null
      }));
    }

    // ============ BREAKDOWN BY CASE (if multiple cases) ============

    let caseBreakdown = null;
    if (!caseIdList || caseIdList.length > 1) {
      const caseBreakdownQuery = `
        SELECT
          c.case_id,
          c.case_title,
          COUNT(e.id) as completions,
          AVG(e.score) as avg_score
        FROM cases c
        JOIN section_cases sc ON c.case_id = sc.case_id
        JOIN sections sec ON sc.section_id = sec.section_id
        JOIN student_sections ss ON sec.section_id = ss.section_id
        JOIN students s ON ss.student_id = s.id
        LEFT JOIN case_chats cc ON s.id = cc.student_id AND c.case_id = cc.case_id AND cc.section_id = sec.section_id
        LEFT JOIN evaluations e ON cc.evaluation_id = e.id
        ${whereClause}
        GROUP BY c.case_id, c.case_title
        ORDER BY c.case_title
      `;

      const [caseRows] = await pool.execute(caseBreakdownQuery, params);
      caseBreakdown = caseRows.map(row => ({
        case_id: row.case_id,
        case_title: row.case_title,
        completions: parseInt(row.completions) || 0,
        avg_score: row.avg_score ? parseFloat(row.avg_score) : null
      }));
    }

    // ============ STUDENT DETAILS ============

    // Get total count for pagination
    const countQuery = `
      SELECT COUNT(*) as total
      FROM students s
      JOIN student_sections ss ON s.id = ss.student_id
      JOIN sections sec ON ss.section_id = sec.section_id
      JOIN section_cases sc ON sec.section_id = sc.section_id
      JOIN cases c ON sc.case_id = c.case_id
      LEFT JOIN case_chats cc ON s.id = cc.student_id AND c.case_id = cc.case_id AND cc.section_id = sec.section_id
      LEFT JOIN evaluations e ON cc.evaluation_id = e.id
      ${whereClause}
    `;

    const [countRows] = await pool.execute(countQuery, params);
    const totalRecords = countRows[0].total;

    // Get student details with pagination
    const studentsQuery = `
      SELECT
        s.id as student_id,
        s.full_name as student_name,
        sec.section_id,
        sec.section_title,
        c.case_id,
        c.case_title,
        COALESCE(cc.status, 'not_started') as status,
        cc.initial_position,
        cc.final_position,
        cc.persona,
        e.score,
        e.hints,
        e.helpful,
        TIMESTAMPDIFF(MINUTE, cc.start_time, cc.end_time) as time_minutes,
        e.id as evaluation_id,
        cc.id as case_chat_id,
        cc.end_time as completion_time,
        e.allow_rechat
      FROM students s
      JOIN student_sections ss ON s.id = ss.student_id
      JOIN sections sec ON ss.section_id = sec.section_id
      JOIN section_cases sc ON sec.section_id = sc.section_id
      JOIN cases c ON sc.case_id = c.case_id
      LEFT JOIN case_chats cc ON s.id = cc.student_id AND c.case_id = cc.case_id AND cc.section_id = sec.section_id
      LEFT JOIN evaluations e ON cc.evaluation_id = e.id
      ${whereClause}
      ORDER BY ${sortColumn} ${sortDirection}
      LIMIT ? OFFSET ?
    `;

    // Using pool.query instead of pool.execute for queries with LIMIT placeholders
    // as some MySQL versions have issues with prepared statements and LIMIT.
    const [studentRows] = await pool.query(studentsQuery, [...params, parseInt(limit), parseInt(offset)]);

    const students = studentRows.map(row => ({
      student_id: row.student_id,
      student_name: row.student_name,
      section_id: row.section_id,
      section_title: row.section_title,
      case_id: row.case_id,
      case_title: row.case_title,
      status: row.status,
      initial_position: row.initial_position,
      final_position: row.final_position,
      persona: row.persona,
      score: row.score !== null ? parseInt(row.score) : null,
      hints: row.hints !== null ? parseInt(row.hints) : null,
      helpful: row.helpful !== null ? parseFloat(row.helpful) : null,
      time_minutes: row.time_minutes !== null ? parseInt(row.time_minutes) : null,
      evaluation_id: row.evaluation_id,
      case_chat_id: row.case_chat_id,
      completion_time: row.completion_time,
      allow_rechat: !!row.allow_rechat
    }));

    // ============ RESPONSE ============

    res.json({
      data: {
        summary: {
          ...summary,
          scoreDistribution,
          sectionBreakdown,
          caseBreakdown
        },
        students,
        total: parseInt(totalRecords),
        limit: parseInt(limit),
        offset: parseInt(offset)
      },
      error: null
    });

  } catch (error) {
    console.error('Error fetching analytics results:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

/**
 * GET /api/analytics/filters
 * Get available sections and cases for filter dropdowns
 */
router.get('/filters', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    // Get enabled sections
    const [sections] = await pool.execute(`
      SELECT DISTINCT sec.section_id, sec.section_title, sec.year_term
      FROM sections sec
      WHERE sec.enabled = TRUE
      ORDER BY sec.section_title
    `);

    // Get enabled cases that are assigned to at least one section
    const [cases] = await pool.execute(`
      SELECT DISTINCT c.case_id, c.case_title
      FROM cases c
      JOIN section_cases sc ON c.case_id = sc.case_id
      WHERE c.enabled = TRUE
      ORDER BY c.case_title
    `);

    res.json({
      data: {
        sections: sections.map(s => ({
          section_id: s.section_id,
          section_title: s.section_title,
          year_term: s.year_term
        })),
        cases: cases.map(c => ({
          case_id: c.case_id,
          case_title: c.case_title
        }))
      },
      error: null
    });

  } catch (error) {
    console.error('Error fetching analytics filters:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

export default router;
