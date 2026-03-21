import express from 'express';
import { pool } from '../db.js';
import { verifyToken, requireRole } from '../middleware/auth.js';

const router = express.Router(); // Position analytics updated to show all defined positions

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
      student_search = '',
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
      'case_id': 'c.case_id',
      'case_title': 'c.case_title',
      'status': 'COALESCE(cc.status, "not_started")',
      'initial_position': 'cc.initial_position',
      'final_position': 'cc.final_position',
      'persona': 'cc.persona',
      'score': 'e.score',
      'hints': 'cc.hints_used',
      'helpful': 'e.helpful',
      'completion_time': 'cc.end_time',
      'time_minutes': 'TIMESTAMPDIFF(MINUTE, cc.start_time, cc.end_time)'
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

    if (student_search && student_search.trim()) {
      whereConditions.push('s.full_name LIKE ?');
      params.push(`%${student_search.trim()}%`);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // ============ SUMMARY STATISTICS ============

    // Get overall stats
    // Note: Include students enrolled via student_sections OR legacy students.section_id
    const statsQuery = `
      SELECT
        COUNT(DISTINCT s.id) as total_students,
        COUNT(DISTINCT CASE WHEN e.id IS NOT NULL THEN s.id END) as completed_students,
        COUNT(e.id) as total_completions,
        AVG(e.score) as avg_score,
        AVG(cc.hints_used) as avg_hints,
        AVG(e.helpful) as avg_helpful
      FROM students s
      LEFT JOIN student_sections ss ON s.id = ss.student_id
      JOIN sections sec ON (ss.section_id = sec.section_id OR s.section_id = sec.section_id)
      JOIN section_cases sc ON sec.section_id = sc.section_id
      JOIN cases c ON sc.case_id = c.case_id
      JOIN case_chats cc ON s.id = cc.student_id AND c.case_id = cc.case_id AND (cc.section_id = sec.section_id OR cc.section_id IS NULL)
      LEFT JOIN evaluations e ON e.case_chat_id = cc.id
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
      LEFT JOIN student_sections ss ON s.id = ss.student_id
      JOIN sections sec ON (ss.section_id = sec.section_id OR s.section_id = sec.section_id)
      JOIN section_cases sc ON sec.section_id = sc.section_id
      JOIN cases c ON sc.case_id = c.case_id
      JOIN case_chats cc ON s.id = cc.student_id AND c.case_id = cc.case_id AND (cc.section_id = sec.section_id OR cc.section_id IS NULL)
      JOIN evaluations e ON e.case_chat_id = cc.id
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
        JOIN students s ON (
          EXISTS (SELECT 1 FROM student_sections WHERE student_id = s.id AND section_id = sec.section_id)
          OR s.section_id = sec.section_id
        )
        JOIN section_cases sc ON sec.section_id = sc.section_id
        JOIN cases c ON sc.case_id = c.case_id
        JOIN case_chats cc ON s.id = cc.student_id AND c.case_id = cc.case_id AND (cc.section_id = sec.section_id OR cc.section_id IS NULL)
        LEFT JOIN evaluations e ON e.case_chat_id = cc.id
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
        JOIN students s ON (
          EXISTS (SELECT 1 FROM student_sections WHERE student_id = s.id AND section_id = sec.section_id)
          OR s.section_id = sec.section_id
        )
        JOIN case_chats cc ON s.id = cc.student_id AND c.case_id = cc.case_id AND (cc.section_id = sec.section_id OR cc.section_id IS NULL)
        LEFT JOIN evaluations e ON e.case_chat_id = cc.id
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
    // Note: Include students enrolled via student_sections OR legacy students.section_id
    const countQuery = `
      SELECT COUNT(*) as total
      FROM students s
      LEFT JOIN student_sections ss ON s.id = ss.student_id
      JOIN sections sec ON (ss.section_id = sec.section_id OR s.section_id = sec.section_id)
      JOIN section_cases sc ON sec.section_id = sc.section_id
      JOIN cases c ON sc.case_id = c.case_id
      JOIN case_chats cc ON s.id = cc.student_id AND c.case_id = cc.case_id AND (cc.section_id = sec.section_id OR cc.section_id IS NULL)
      LEFT JOIN evaluations e ON e.case_chat_id = cc.id
      ${whereClause}
    `;

    const [countRows] = await pool.execute(countQuery, params);
    const totalRecords = countRows[0].total;

    // Get student details with pagination
    // Note: Include students enrolled via student_sections OR legacy students.section_id
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
        cc.hints_used as hints,
        e.helpful,
        TIMESTAMPDIFF(MINUTE, cc.start_time, cc.end_time) as time_minutes,
        e.id as evaluation_id,
        cc.id as case_chat_id,
        cc.end_time as completion_time,
        e.allow_rechat,
        e.liked,
        e.improve,
        COALESCE(r.total_points, 15) as out_of
      FROM students s
      LEFT JOIN student_sections ss ON s.id = ss.student_id
      JOIN sections sec ON (ss.section_id = sec.section_id OR s.section_id = sec.section_id)
      JOIN section_cases sc ON sec.section_id = sc.section_id
      JOIN cases c ON sc.case_id = c.case_id
      JOIN case_chats cc ON s.id = cc.student_id AND c.case_id = cc.case_id AND (cc.section_id = sec.section_id OR cc.section_id IS NULL)
      LEFT JOIN evaluations e ON e.case_chat_id = cc.id
      LEFT JOIN rubrics r ON e.rubric_id = r.rubric_id
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
      out_of: row.out_of !== null ? parseInt(row.out_of) : 15,
      hints: row.hints !== null ? parseInt(row.hints) : null,
      helpful: row.helpful !== null ? parseFloat(row.helpful) : null,
      time_minutes: row.time_minutes !== null ? parseInt(row.time_minutes) : null,
      evaluation_id: row.evaluation_id,
      case_chat_id: row.case_chat_id,
      completion_time: row.completion_time,
      allow_rechat: !!row.allow_rechat,
      liked: row.liked || null,
      improve: row.improve || null
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

// =====================================================
// POSITION ANALYTICS ENDPOINTS
// =====================================================

/**
 * GET /api/analytics/positions
 * Position distribution, changes, and student-level data
 *
 * Query Parameters:
 * - section_id: filter by section (optional)
 * - case_id: filter by case (optional)
 * - scenario_id: filter by scenario (optional)
 */
router.get('/positions', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { section_id, case_id, scenario_id } = req.query;

    // Build WHERE clause
    let whereConditions = ["cc.status = 'completed'"];
    let params = [];

    if (section_id) {
      whereConditions.push('cc.section_id = ?');
      params.push(section_id);
    }

    if (case_id) {
      whereConditions.push('cc.case_id = ?');
      params.push(case_id);
    }

    if (scenario_id) {
      whereConditions.push('cc.scenario_id = ?');
      params.push(scenario_id);
    }

    const whereClause = whereConditions.join(' AND ');

    // Get summary statistics
    const [summaryRows] = await pool.execute(
      `SELECT
        COUNT(*) as total_chats,
        SUM(CASE WHEN cc.initial_position IS NOT NULL OR cc.initial_position_id IS NOT NULL THEN 1 ELSE 0 END) as chats_with_initial,
        SUM(CASE WHEN cc.final_position IS NOT NULL OR cc.final_position_id IS NOT NULL THEN 1 ELSE 0 END) as chats_with_final,
        SUM(CASE
          WHEN (cc.initial_position IS NOT NULL OR cc.initial_position_id IS NOT NULL)
           AND (cc.final_position IS NOT NULL OR cc.final_position_id IS NOT NULL)
           AND (cc.initial_position != cc.final_position OR cc.initial_position_id != cc.final_position_id)
          THEN 1 ELSE 0
        END) as position_changes
       FROM case_chats cc
       WHERE ${whereClause}`,
      params
    );

    const summary = summaryRows[0];
    const totalWithPositions = Math.max(summary.chats_with_initial, summary.chats_with_final);
    const changeRate = totalWithPositions > 0
      ? (summary.position_changes / totalWithPositions * 100).toFixed(1)
      : 0;

    // Get all positions defined for the relevant scenario(s)
    let allPositionsQuery = `
      SELECT DISTINCT sp.position_id, sp.position_name
      FROM scenario_positions sp
      WHERE sp.position_enabled = TRUE
    `;
    let allPositionsParams = [];

    if (scenario_id) {
      allPositionsQuery += ' AND sp.scenario_id = ?';
      allPositionsParams.push(scenario_id);
    } else if (case_id) {
      // Get all scenarios for this case
      allPositionsQuery += `
        AND sp.scenario_id IN (
          SELECT id FROM case_scenarios WHERE case_id = ?
        )
      `;
      allPositionsParams.push(case_id);
    } else {
      // Get all scenarios for all enabled cases
      allPositionsQuery += `
        AND sp.scenario_id IN (
          SELECT cs.id FROM case_scenarios cs
          JOIN cases c ON cs.case_id = c.case_id
          WHERE c.enabled = TRUE
        )
      `;
    }

    allPositionsQuery += ' ORDER BY sp.position_name';

    const [allPositions] = await pool.execute(allPositionsQuery, allPositionsParams);

    // Get position distribution (using position names for grouping)
    const [positionRows] = await pool.execute(
      `SELECT
        COALESCE(cc.initial_position, cc.final_position, sp_init.position_name, sp_final.position_name) as position_name,
        COALESCE(cc.initial_position_id, cc.final_position_id, sp_init.position_id, sp_final.position_id) as position_id,
        SUM(CASE WHEN cc.initial_position IS NOT NULL OR cc.initial_position_id IS NOT NULL THEN 1 ELSE 0 END) as initial_count,
        SUM(CASE WHEN cc.final_position IS NOT NULL OR cc.final_position_id IS NOT NULL THEN 1 ELSE 0 END) as final_count
       FROM case_chats cc
       LEFT JOIN scenario_positions sp_init ON cc.initial_position_id = sp_init.position_id
       LEFT JOIN scenario_positions sp_final ON cc.final_position_id = sp_final.position_id
       WHERE ${whereClause}
         AND (cc.initial_position IS NOT NULL OR cc.initial_position_id IS NOT NULL
              OR cc.final_position IS NOT NULL OR cc.final_position_id IS NOT NULL)
       GROUP BY
         cc.initial_position, cc.final_position, sp_init.position_name, sp_final.position_name,
         cc.initial_position_id, cc.final_position_id, sp_init.position_id, sp_final.position_id`,
      params
    );

    // Create a map of position counts from actual data
    const positionCountMap = new Map();
    positionRows.forEach(row => {
      positionCountMap.set(row.position_name, {
        position_id: row.position_id,
        initial_count: row.initial_count,
        final_count: row.final_count
      });
    });

    // Build by_position array including ALL defined positions
    const byPosition = allPositions.map(pos => {
      const counts = positionCountMap.get(pos.position_name) || {
        position_id: pos.position_id,
        initial_count: 0,
        final_count: 0
      };

      return {
        position_id: counts.position_id,
        position_name: pos.position_name,
        initial_count: counts.initial_count,
        initial_percentage: totalWithPositions > 0
          ? (counts.initial_count / totalWithPositions * 100).toFixed(1)
          : '0.0',
        final_count: counts.final_count,
        final_percentage: totalWithPositions > 0
          ? (counts.final_count / totalWithPositions * 100).toFixed(1)
          : '0.0',
        net_change: counts.final_count - counts.initial_count
      };
    });

    // Get change matrix data
    const [changeRows] = await pool.execute(
      `SELECT
        COALESCE(cc.initial_position, sp_init.position_name) as from_position,
        COALESCE(cc.final_position, sp_final.position_name, 'Unspecified') as to_position,
        COUNT(*) as count
       FROM case_chats cc
       LEFT JOIN scenario_positions sp_init ON cc.initial_position_id = sp_init.position_id
       LEFT JOIN scenario_positions sp_final ON cc.final_position_id = sp_final.position_id
       WHERE ${whereClause}
         AND (cc.initial_position IS NOT NULL OR cc.initial_position_id IS NOT NULL)
       GROUP BY cc.initial_position, sp_init.position_name, cc.final_position, sp_final.position_name`,
      params
    );

    // Build complete change matrix with all positions (including 0s)
    const changeMatrix = {};
    const allPositionNames = allPositions.map(p => p.position_name);
    
    // Initialize matrix with all positions and 0 counts
    for (const fromPos of allPositionNames) {
      changeMatrix[fromPos] = {};
      for (const toPos of allPositionNames) {
        changeMatrix[fromPos][toPos] = 0;
      }
      // Also include "Unspecified" column
      changeMatrix[fromPos]['Unspecified'] = 0;
    }

    // Fill in actual counts from data
    for (const row of changeRows) {
      if (!changeMatrix[row.from_position]) {
        changeMatrix[row.from_position] = {};
      }
      changeMatrix[row.from_position][row.to_position] = row.count;
    }

    // Get student-level data
    const [studentRows] = await pool.execute(
      `SELECT
        s.id as student_id,
        s.full_name as student_name,
        COALESCE(cc.initial_position, sp_init.position_name) as initial_position,
        COALESCE(cc.final_position, sp_final.position_name) as final_position,
        cc.initial_position_id,
        cc.final_position_id,
        e.score as evaluation_score,
        cc.end_time as completion_time
       FROM case_chats cc
       JOIN students s ON cc.student_id = s.id
       LEFT JOIN evaluations e ON e.case_chat_id = cc.id
       LEFT JOIN scenario_positions sp_init ON cc.initial_position_id = sp_init.position_id
       LEFT JOIN scenario_positions sp_final ON cc.final_position_id = sp_final.position_id
       WHERE ${whereClause}
         AND (cc.initial_position IS NOT NULL OR cc.initial_position_id IS NOT NULL
              OR cc.final_position IS NOT NULL OR cc.final_position_id IS NOT NULL)
       ORDER BY cc.end_time DESC
       LIMIT 100`,
      params
    );

    const byStudent = studentRows.map(row => ({
      student_id: row.student_id,
      student_name: row.student_name,
      initial_position: row.initial_position,
      final_position: row.final_position,
      changed: row.initial_position !== row.final_position &&
               row.initial_position !== null &&
               row.final_position !== null,
      evaluation_score: row.evaluation_score,
      completion_time: row.completion_time
    }));

    res.json({
      data: {
        summary: {
          total_chats: summary.total_chats,
          total_chats_with_positions: totalWithPositions,
          total_position_changes: summary.position_changes,
          change_rate: parseFloat(changeRate)
        },
        by_position: byPosition,
        change_matrix: changeMatrix,
        by_student: byStudent
      },
      error: null
    });

  } catch (error) {
    console.error('Error fetching position analytics:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

/**
 * GET /api/analytics/positions/correlation
 * Position-score correlations
 *
 * Query Parameters:
 * - section_id: filter by section (optional)
 * - case_id: filter by case (optional)
 * - scenario_id: filter by scenario (optional)
 */
router.get('/positions/correlation', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { section_id, case_id, scenario_id } = req.query;

    // Build WHERE clause
    let whereConditions = ["cc.status = 'completed'"];
    let params = [];

    if (section_id) {
      whereConditions.push('cc.section_id = ?');
      params.push(section_id);
    }

    if (case_id) {
      whereConditions.push('cc.case_id = ?');
      params.push(case_id);
    }

    if (scenario_id) {
      whereConditions.push('cc.scenario_id = ?');
      params.push(scenario_id);
    }

    const whereClause = whereConditions.join(' AND ');

    // Get max score from actual data (for dynamic rubric support)
    const [maxScoreRows] = await pool.execute(
      `SELECT MAX(e.score) as max_score
       FROM case_chats cc
       JOIN evaluations e ON e.case_chat_id = cc.id AND e.score IS NOT NULL
       WHERE ${whereClause}`,
      params
    );

    const maxScore = maxScoreRows[0]?.max_score || 15; // Default to 15 if no scores yet

    // Get average score by final position
    const [positionScoreRows] = await pool.execute(
      `SELECT
        COALESCE(cc.final_position, sp.position_name, cc.initial_position) as position_name,
        AVG(e.score) as avg_score,
        COUNT(*) as count
       FROM case_chats cc
       JOIN evaluations e ON e.case_chat_id = cc.id AND e.score IS NOT NULL
       LEFT JOIN scenario_positions sp ON cc.final_position_id = sp.position_id
       WHERE ${whereClause}
         AND (cc.final_position IS NOT NULL OR cc.final_position_id IS NOT NULL
              OR cc.initial_position IS NOT NULL OR cc.initial_position_id IS NOT NULL)
       GROUP BY cc.final_position, sp.position_name, cc.initial_position
       ORDER BY avg_score DESC`,
      params
    );

    const positionScoreCorrelation = positionScoreRows.map(row => ({
      position_name: row.position_name,
      avg_score: row.avg_score != null ? parseFloat(Number(row.avg_score).toFixed(1)) : 0,
      count: row.count
    }));

    // Get average score for changed vs unchanged positions
    const [changeScoreRows] = await pool.execute(
      `SELECT
        CASE
          WHEN (cc.final_position IS NULL AND cc.final_position_id IS NULL)
          THEN 'unspecified'
          WHEN (cc.initial_position IS NOT NULL OR cc.initial_position_id IS NOT NULL)
           AND (cc.final_position IS NOT NULL OR cc.final_position_id IS NOT NULL)
           AND (cc.initial_position != cc.final_position OR cc.initial_position_id != cc.final_position_id)
          THEN 'changed'
          ELSE 'unchanged'
        END as change_status,
        AVG(e.score) as avg_score,
        COUNT(*) as count
       FROM case_chats cc
       JOIN evaluations e ON e.case_chat_id = cc.id AND e.score IS NOT NULL
       WHERE ${whereClause}
         AND (cc.initial_position IS NOT NULL OR cc.initial_position_id IS NOT NULL
              OR cc.final_position IS NOT NULL OR cc.final_position_id IS NOT NULL)
       GROUP BY
        CASE
          WHEN (cc.final_position IS NULL AND cc.final_position_id IS NULL)
          THEN 'unspecified'
          WHEN (cc.initial_position IS NOT NULL OR cc.initial_position_id IS NOT NULL)
           AND (cc.final_position IS NOT NULL OR cc.final_position_id IS NOT NULL)
           AND (cc.initial_position != cc.final_position OR cc.initial_position_id != cc.final_position_id)
          THEN 'changed'
          ELSE 'unchanged'
        END`,
      params
    );

    let changeScoreCorrelation = {
      changed_avg_score: null,
      changed_count: 0,
      unchanged_avg_score: null,
      unchanged_count: 0,
      unspecified_avg_score: null,
      unspecified_count: 0
    };

    for (const row of changeScoreRows) {
      if (row.change_status === 'changed') {
        changeScoreCorrelation.changed_avg_score = row.avg_score != null ? parseFloat(Number(row.avg_score).toFixed(1)) : null;
        changeScoreCorrelation.changed_count = row.count;
      } else if (row.change_status === 'unspecified') {
        changeScoreCorrelation.unspecified_avg_score = row.avg_score != null ? parseFloat(Number(row.avg_score).toFixed(1)) : null;
        changeScoreCorrelation.unspecified_count = row.count;
      } else {
        changeScoreCorrelation.unchanged_avg_score = row.avg_score != null ? parseFloat(Number(row.avg_score).toFixed(1)) : null;
        changeScoreCorrelation.unchanged_count = row.count;
      }
    }

    res.json({
      data: {
        position_score_correlation: positionScoreCorrelation,
        change_score_correlation: changeScoreCorrelation,
        max_score: maxScore
      },
      error: null
    });

  } catch (error) {
    console.error('Error fetching position correlations:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

/**
 * GET /api/analytics/positions/score-distribution
 * Get score distribution by position for histogram visualization
 *
 * Query Parameters:
 * - section_id: filter by section (optional)
 * - case_id: filter by case (optional)
 * - scenario_id: filter by scenario (optional)
 */
router.get('/positions/score-distribution', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { section_id, case_id, scenario_id } = req.query;

    // Build WHERE clause
    let whereConditions = ["cc.status = 'completed'"];
    let params = [];

    if (section_id) {
      whereConditions.push('cc.section_id = ?');
      params.push(section_id);
    }

    if (case_id) {
      whereConditions.push('cc.case_id = ?');
      params.push(case_id);
    }

    if (scenario_id) {
      whereConditions.push('cc.scenario_id = ?');
      params.push(scenario_id);
    }

    const whereClause = whereConditions.join(' AND ');

    // Get max score for this dataset
    const [maxScoreResult] = await pool.execute(
      `SELECT MAX(e.score) as max_score
       FROM case_chats cc
       JOIN evaluations e ON e.case_chat_id = cc.id
       WHERE ${whereClause}
         AND e.score IS NOT NULL`,
      params
    );

    const maxScore = maxScoreResult[0]?.max_score || 15;

    // Get score distribution by position
    const [rows] = await pool.execute(
      `SELECT
        COALESCE(cc.final_position, sp.position_name, cc.initial_position) as position_name,
        e.score,
        COUNT(*) as count
       FROM case_chats cc
       JOIN evaluations e ON e.case_chat_id = cc.id
       LEFT JOIN scenario_positions sp ON cc.final_position_id = sp.position_id
       WHERE ${whereClause}
         AND e.score IS NOT NULL
       GROUP BY cc.final_position, sp.position_name, cc.initial_position, e.score
       ORDER BY position_name, e.score`,
      params
    );

    // Group by position
    const byPosition = {};
    rows.forEach(row => {
      if (!byPosition[row.position_name]) {
        byPosition[row.position_name] = {
          scores: [],
          counts: []
        };
      }
      byPosition[row.position_name].scores.push(row.score);
      byPosition[row.position_name].counts.push(parseInt(row.count));
    });

    res.json({
      data: {
        by_position: byPosition,
        max_score: maxScore
      },
      error: null
    });
  } catch (error) {
    console.error('Error fetching score distribution:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

export default router;
